using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Drives the two-player final accusation with the same write discipline as
/// <see cref="PairedConfrontationCoordinator"/>: load, apply pure rules, one optimistic save, retry.
/// The only difference is the consequence of agreement, which ends the case.
/// </summary>
public sealed class AccusationConsensusCoordinator : IAccusationConsensusCoordinator
{
    public const string BusyCode = "ACCUSATION_BUSY";
    public const string UnilateralRouteCode = "ACCUSATION_CONSENSUS_NOT_REQUIRED";
    private const int MaxWriteAttempts = 3;

    private readonly IGameplayContextLoader _contextLoader;
    private readonly IGameplayStatePersistence _persistence;
    private readonly IGameStateBuilder _stateBuilder;
    private readonly IGameNotifier _notifier;
    private readonly IPlaytestEventSink _playtestEvents;
    private readonly IAccusationResolver _resolver;
    private readonly TimeProvider _timeProvider;
    private readonly AccusationSettings _settings;

    public AccusationConsensusCoordinator(
        IGameplayContextLoader contextLoader,
        IGameplayStatePersistence persistence,
        IGameStateBuilder stateBuilder,
        IGameNotifier notifier,
        IPlaytestEventSink playtestEvents,
        IAccusationResolver resolver,
        TimeProvider timeProvider,
        IOptions<AccusationSettings> settings)
    {
        _contextLoader = contextLoader;
        _persistence = persistence;
        _stateBuilder = stateBuilder;
        _notifier = notifier;
        _playtestEvents = playtestEvents;
        _resolver = resolver;
        _timeProvider = timeProvider;
        _settings = settings.Value;
    }

    public Task<AccusationCommandResponse> ProposeAsync(
        CurrentUser user,
        string roomId,
        AccuseRequest request,
        CancellationToken cancellationToken = default)
    {
        // Minted once so a retried write reuses the same attempt id instead of opening a rival proposal.
        var attemptId = Guid.NewGuid().ToString();
        return ExecuteAsync(user, roomId, (context, now) => AccusationConsensusRules.Propose(
            context.Case,
            context.Room.GameplayState!,
            attemptId,
            user.Id,
            context.Player.Role!,
            PlayerSceneId(context, user.Id),
            ToContent(request),
            RoomUserIds(context.Room),
            now), AccusationCommandKind.Propose, cancellationToken);
    }

    public Task<AccusationCommandResponse> AmendAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        AmendAccusationRequest request,
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(user, roomId, (context, now) => AccusationConsensusRules.Amend(
            context.Room.GameplayState!,
            attemptId,
            user.Id,
            context.Player.Role!,
            ToContent(request),
            request.ExpectedRevision,
            RoomUserIds(context.Room),
            now), AccusationCommandKind.Amend, cancellationToken);

    public Task<AccusationCommandResponse> ConfirmAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        AccusationRevisionRequest request,
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(user, roomId, (context, now) => AccusationConsensusRules.Confirm(
            context.Room.GameplayState!,
            attemptId,
            user.Id,
            context.Player.Role!,
            request.ExpectedRevision,
            RoomUserIds(context.Room),
            now), AccusationCommandKind.Confirm, cancellationToken);

    public Task<AccusationCommandResponse> CancelAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        AccusationRevisionRequest request,
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(user, roomId, (context, now) => AccusationConsensusRules.Cancel(
            context.Room.GameplayState!,
            attemptId,
            user.Id,
            context.Player.Role!,
            request.ExpectedRevision,
            now), AccusationCommandKind.Cancel, cancellationToken);

    private async Task<AccusationCommandResponse> ExecuteAsync(
        CurrentUser user,
        string roomId,
        Func<GameplayContext, DateTime, AccusationTransition> transitionFactory,
        AccusationCommandKind commandKind,
        CancellationToken cancellationToken)
    {
        for (var writeAttempt = 0; writeAttempt < MaxWriteAttempts; writeAttempt++)
        {
            var context = await _contextLoader.LoadAsync(user.Id, roomId, requireInProgress: true, cancellationToken);
            RequireConsensusRoute(context.Case);
            RequirePlayerRole(context.Player);
            RequireNoActiveConfrontation(context.Room.GameplayState!);

            AccusationTransition transition;
            try
            {
                transition = transitionFactory(context, _timeProvider.GetUtcNow().UtcDateTime);
            }
            catch (AccusationRuleException exception)
            {
                throw ToApiException(exception);
            }

            GameResultResponse? result = null;
            if (transition.ShouldResolve)
            {
                // The resolver owns the single optimistic write that carries both the final
                // confirmation and the completed room, so nobody can observe "agreed but not ended".
                result = await _resolver.ResolveAccusationAsync(
                    context.Room,
                    context.Case,
                    user,
                    ToRequest(transition.Terminal!));
            }
            else if (transition.Changed
                && !await _persistence.TrySaveAsync(context.Room, context.Case, cancellationToken))
            {
                await RecordAsync(
                    context,
                    roomId,
                    user.Id,
                    PlaytestEventType.OptimisticRetry,
                    context.Room.GameplayState?.Version ?? 0,
                    transition.Active?.AttemptId ?? transition.Terminal?.AttemptId,
                    transition.Active?.Revision ?? transition.Terminal?.Revision,
                    writeAttempt + 1,
                    cancellationToken);
                continue;
            }

            var state = await _stateBuilder.BuildStateAsync(context.Room, context.Case, user.Id);
            if (transition.Changed)
            {
                // The resolver already broadcast the completed state; repeating that version is noise.
                if (result is null) await _notifier.GameStateUpdated(roomId, state.Version);
                await RecordTransitionEventAsync(
                    context,
                    roomId,
                    user.Id,
                    state.Version,
                    commandKind,
                    transition,
                    cancellationToken);
            }
            return BuildResponse(state, transition, result);
        }

        throw ApiException.Conflict(
            "The accusation is busy; refresh and try again.",
            BusyCode,
            "game.accusation.busy");
    }

    private Task RecordTransitionEventAsync(
        GameplayContext context,
        string roomId,
        string userId,
        long stateVersion,
        AccusationCommandKind commandKind,
        AccusationTransition transition,
        CancellationToken cancellationToken)
    {
        var eventType = commandKind switch
        {
            AccusationCommandKind.Propose => PlaytestEventType.AccusationProposed,
            AccusationCommandKind.Amend => PlaytestEventType.AccusationAmended,
            AccusationCommandKind.Cancel => PlaytestEventType.AccusationCancelled,
            _ => PlaytestEventType.AccusationConfirmed
        };
        var proposal = transition.Active ?? transition.Terminal;
        return RecordAsync(
            context,
            roomId,
            userId,
            eventType,
            stateVersion,
            proposal?.AttemptId,
            proposal?.Revision,
            proposal?.Confirmations.Count(confirmation => confirmation.Revision == proposal.Revision),
            cancellationToken);
    }

    /// <summary>
    /// Playtest telemetry is scoped to V3 cases, so forcing consensus onto a V1/V2 case through
    /// configuration must not start recording events for it.
    /// </summary>
    private Task RecordAsync(
        GameplayContext context,
        string roomId,
        string userId,
        PlaytestEventType eventType,
        long stateVersion,
        string? attemptId,
        int? revision,
        int? count,
        CancellationToken cancellationToken)
    {
        if (context.Case.MechanicsVersion != CaseMechanicsVersions.InvestigationV3PairedConfrontation)
        {
            return Task.CompletedTask;
        }
        return _playtestEvents.RecordAsync(
            roomId,
            userId,
            context.Player.Role ?? string.Empty,
            eventType,
            stateVersion,
            attemptId,
            revision,
            count: count,
            cancellationToken: cancellationToken);
    }

    /// <summary>
    /// The consensus endpoints exist only where consensus is required; anywhere else the unilateral
    /// route is still the authoritative one and silently accepting both would fork the rules.
    /// </summary>
    private void RequireConsensusRoute(GameCase gameCase)
    {
        if (AccusationConsensusRules.RequiresConsensus(gameCase, _settings.RequireConsensus)) return;
        throw ApiException.Conflict(
            "This case does not use accusation consensus. Use the accuse endpoint instead.",
            UnilateralRouteCode,
            "game.accusation.consensusNotRequired");
    }

    private static void RequireNoActiveConfrontation(GameplayState state)
    {
        if (!PairedConfrontationRules.BlocksProgression(state)) return;
        throw ApiException.Conflict(
            "Finish or cancel the active confrontation before continuing.",
            "ACTION_BLOCKED_BY_CONFRONTATION",
            "game.confrontation.actionBlocked");
    }

    private static void RequirePlayerRole(RoomPlayer player)
    {
        if (PlayerRole.IsValid(player.Role)) return;
        throw ApiException.Forbidden(
            "A valid room role is required.",
            AccusationConsensusRules.NotActiveCode,
            "game.accusation.notActive");
    }

    private static string PlayerSceneId(GameplayContext context, string userId)
    {
        var state = context.Room.GameplayState!;
        return state.PlayerSceneIds.GetValueOrDefault(userId, state.CurrentSceneId);
    }

    private static IReadOnlyCollection<string> RoomUserIds(GameRoom room) =>
        room.Players.Select(player => player.UserId).Distinct().ToList();

    private static AccusationProposalContent ToContent(AccuseRequest request) => new(
        request.CulpritId,
        request.MotiveId,
        request.MethodId,
        request.EvidenceIds ?? new List<string>(),
        request.EvidenceLinks
            .Select(link => new SelectedEvidenceLink { ClaimType = link.ClaimType, EvidenceId = link.EvidenceId })
            .ToList());

    private static AccuseRequest ToRequest(AccusationProposalState proposal) => new()
    {
        CulpritId = proposal.CulpritId,
        MotiveId = proposal.MotiveId ?? string.Empty,
        MethodId = proposal.MethodId ?? string.Empty,
        EvidenceIds = proposal.EvidenceIds.ToList(),
        EvidenceLinks = proposal.EvidenceLinks
            .Select(link => new EvidenceLinkRequest { ClaimType = link.ClaimType, EvidenceId = link.EvidenceId })
            .ToList()
    };

    private static AccusationCommandResponse BuildResponse(
        DTOs.Investigation.GameStateResponse state,
        AccusationTransition transition,
        GameResultResponse? result)
    {
        var proposal = transition.Active ?? transition.Terminal;
        return new AccusationCommandResponse
        {
            State = state,
            Changed = transition.Changed,
            Accusation = AccusationProposalDto.From(proposal),
            Result = result
        };
    }

    private static ApiException ToApiException(AccusationRuleException exception) => exception.Code switch
    {
        AccusationConsensusRules.StaleRevisionCode => ApiException.Conflict(
            exception.Message,
            AccusationConsensusRules.StaleRevisionCode,
            "game.accusation.staleRevision"),
        AccusationConsensusRules.AlreadyConfirmedCode => ApiException.Conflict(
            exception.Message,
            AccusationConsensusRules.AlreadyConfirmedCode,
            "game.accusation.alreadyConfirmed"),
        _ => ApiException.Conflict(
            exception.Message,
            AccusationConsensusRules.NotActiveCode,
            "game.accusation.notActive")
    };

    private enum AccusationCommandKind
    {
        Propose,
        Amend,
        Confirm,
        Cancel
    }
}
