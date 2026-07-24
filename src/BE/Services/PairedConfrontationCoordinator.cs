using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class PairedConfrontationCoordinator : IPairedConfrontationCoordinator
{
    public const string TestimonyUnavailableCode = "TESTIMONY_NOT_AVAILABLE";
    public const string EvidenceUnavailableCode = "EVIDENCE_NOT_AVAILABLE";
    public const string BusyCode = "CONFRONTATION_BUSY";
    public const string V3NotEnabledCode = "V3_NOT_ENABLED";
    private const int MaxWriteAttempts = 3;

    private readonly IGameplayContextLoader _contextLoader;
    private readonly IGameplayStatePersistence _persistence;
    private readonly IGameStateBuilder _stateBuilder;
    private readonly IGameNotifier _notifier;
    private readonly IPlaytestEventSink _playtestEvents;
    private readonly TimeProvider _timeProvider;
    private readonly GameplayV3Settings _settings;

    public PairedConfrontationCoordinator(
        IGameplayContextLoader contextLoader,
        IGameplayStatePersistence persistence,
        IGameStateBuilder stateBuilder,
        IGameNotifier notifier,
        IPlaytestEventSink playtestEvents,
        TimeProvider timeProvider,
        IOptions<GameplayV3Settings> settings)
    {
        _contextLoader = contextLoader;
        _persistence = persistence;
        _stateBuilder = stateBuilder;
        _notifier = notifier;
        _playtestEvents = playtestEvents;
        _timeProvider = timeProvider;
        _settings = settings.Value;
    }

    public Task<PairedConfrontationCommandResponse> StartAsync(
        CurrentUser user,
        string roomId,
        StartPairedConfrontationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!Guid.TryParse(request.AttemptId, out _))
        {
            throw ApiException.BadRequest("attemptId must be a UUID.");
        }

        return ExecuteAsync(user, roomId, (context, now) =>
        {
            RequireRole(context.Player, PlayerRole.Interrogator);
            var (fragment, challenge) = RequireOwnedTestimony(context, user.Id, request.TestimonyFragmentId);
            RequireUnresolved(context.Room.GameplayState!, challenge.ChallengeId);
            RequireGeneratedPresetReady(context, challenge);
            return PairedConfrontationRules.Start(
                context.Room.GameplayState!,
                request.AttemptId,
                challenge.ChallengeId,
                fragment.Id,
                user.Id,
                context.Player.Role!,
                now);
        }, PairedCommandKind.Start, cancellationToken);
    }

    public Task<PairedConfrontationCommandResponse> EditTestimonyAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        EditPairedTestimonyRequest request,
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(user, roomId, (context, now) =>
        {
            RequireRole(context.Player, PlayerRole.Interrogator);
            var (fragment, challenge) = RequireOwnedTestimony(context, user.Id, request.TestimonyFragmentId);
            RequireUnresolved(context.Room.GameplayState!, challenge.ChallengeId);
            return PairedConfrontationRules.ProposeTestimony(
                context.Room.GameplayState!,
                attemptId,
                challenge.ChallengeId,
                fragment.Id,
                user.Id,
                context.Player.Role!,
                request.ExpectedRevision,
                now);
        }, PairedCommandKind.EditTestimony, cancellationToken);

    public Task<PairedConfrontationCommandResponse> SubmitEvidenceAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        SubmitPairedEvidenceRequest request,
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(user, roomId, (context, now) =>
        {
            RequireRole(context.Player, PlayerRole.Investigator);
            var active = context.Room.GameplayState!.ActiveConfrontation;
            var challenge = active is null
                ? null
                : context.Case.EvidenceChallenges.FirstOrDefault(candidate => candidate.ChallengeId == active.ChallengeId);
            RequireOwnedEvidence(context, user.Id, request.EvidenceId, challenge);
            return PairedConfrontationRules.ProposeEvidence(
                context.Room.GameplayState!,
                attemptId,
                request.EvidenceId,
                user.Id,
                context.Player.Role!,
                request.ExpectedRevision,
                now);
        }, PairedCommandKind.SubmitEvidence, cancellationToken);

    public Task<PairedConfrontationCommandResponse> ConfirmAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        PairedConfrontationRevisionRequest request,
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(user, roomId, (context, now) =>
        {
            RequirePlayerRole(context.Player);
            var state = context.Room.GameplayState!;
            var terminal = state.PairedConfrontationAttempts.LastOrDefault(record => record.AttemptId == attemptId);
            var challengeId = terminal?.ChallengeId
                ?? (state.ActiveConfrontation?.AttemptId == attemptId ? state.ActiveConfrontation.ChallengeId : null);
            var challenge = context.Case.EvidenceChallenges.FirstOrDefault(candidate => candidate.ChallengeId == challengeId)
                ?? throw NotAvailable();
            var active = state.ActiveConfrontation;
            var isCorrect = active is not null
                && active.AttemptId == attemptId
                && active.TestimonyFragmentId == challenge.TestimonyFragmentId
                && active.EvidenceId == challenge.CorrectEvidenceId;
            return PairedConfrontationRules.Confirm(
                state,
                attemptId,
                user.Id,
                context.Player.Role!,
                request.ExpectedRevision,
                isCorrect,
                challenge.UnlockClueIds,
                now);
        }, PairedCommandKind.Confirm, cancellationToken);

    public Task<PairedConfrontationCommandResponse> CancelAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        PairedConfrontationRevisionRequest request,
        CancellationToken cancellationToken = default) =>
        ExecuteAsync(user, roomId, (context, now) =>
        {
            RequirePlayerRole(context.Player);
            return PairedConfrontationRules.Cancel(
                context.Room.GameplayState!,
                attemptId,
                user.Id,
                context.Player.Role!,
                request.ExpectedRevision,
                now);
        }, PairedCommandKind.Cancel, cancellationToken);

    private async Task<PairedConfrontationCommandResponse> ExecuteAsync(
        CurrentUser user,
        string roomId,
        Func<GameplayContext, DateTime, PairedConfrontationTransition> transitionFactory,
        PairedCommandKind commandKind,
        CancellationToken cancellationToken)
    {
        for (var writeAttempt = 0; writeAttempt < MaxWriteAttempts; writeAttempt++)
        {
            var context = await _contextLoader.LoadAsync(user.Id, roomId, requireInProgress: true, cancellationToken);
            RequireV3(context.Case);

            PairedConfrontationTransition transition;
            try
            {
                transition = transitionFactory(context, _timeProvider.GetUtcNow().UtcDateTime);
            }
            catch (PairedConfrontationRuleException exception)
            {
                throw ToApiException(exception);
            }

            if (transition.Changed
                && !await _persistence.TrySaveAsync(context.Room, context.Case, cancellationToken))
            {
                await _playtestEvents.RecordAsync(
                    roomId,
                    user.Id,
                    context.Player.Role ?? string.Empty,
                    PlaytestEventType.OptimisticRetry,
                    context.Room.GameplayState?.Version ?? 0,
                    transition.Active?.AttemptId ?? transition.Terminal?.AttemptId,
                    transition.Active?.Revision ?? transition.Terminal?.FinalRevision,
                    count: writeAttempt + 1,
                    cancellationToken: cancellationToken);
                continue;
            }

            var state = await _stateBuilder.BuildStateAsync(context.Room, context.Case, user.Id);
            if (transition.Changed)
            {
                await _notifier.GameStateUpdated(roomId, state.Version);
                await RecordTransitionEventsAsync(
                    roomId,
                    user.Id,
                    context.Player.Role ?? string.Empty,
                    state.Version,
                    commandKind,
                    transition,
                    cancellationToken);
            }
            return BuildResponse(state, transition);
        }

        throw ApiException.Conflict(
            "The confrontation is busy; refresh and try again.",
            BusyCode,
            "game.confrontation.busy");
    }

    private async Task RecordTransitionEventsAsync(
        string roomId,
        string userId,
        string role,
        long stateVersion,
        PairedCommandKind commandKind,
        PairedConfrontationTransition transition,
        CancellationToken cancellationToken)
    {
        var attemptId = transition.Active?.AttemptId ?? transition.Terminal?.AttemptId;
        var revision = transition.Active?.Revision ?? transition.Terminal?.FinalRevision;
        var eventTypes = new List<PlaytestEventType>();
        switch (commandKind)
        {
            case PairedCommandKind.Start:
                eventTypes.Add(PlaytestEventType.ConfrontationStarted);
                break;
            case PairedCommandKind.SubmitEvidence:
                eventTypes.Add(PlaytestEventType.ProposalSubmitted);
                break;
            case PairedCommandKind.EditTestimony:
                eventTypes.Add(PlaytestEventType.ProposalEdited);
                break;
            case PairedCommandKind.Confirm when transition.Terminal is null:
                eventTypes.Add(PlaytestEventType.ConfirmationFirst);
                break;
            case PairedCommandKind.Confirm:
                eventTypes.Add(PlaytestEventType.ConfirmationSecond);
                eventTypes.Add(transition.Status == PairedConfrontationStatus.ResolvedCorrect
                    ? PlaytestEventType.ResolvedCorrect
                    : PlaytestEventType.ResolvedIncorrect);
                break;
            case PairedCommandKind.Cancel:
                eventTypes.Add(PlaytestEventType.Cancelled);
                break;
        }

        if (transition.Active is { Status: PairedConfrontationStatus.ReadyForReview } active
            && active.Disclosures.Any(disclosure => disclosure.Revision == active.Revision))
        {
            eventTypes.Add(PlaytestEventType.JointReviewDisclosed);
        }

        foreach (var eventType in eventTypes)
        {
            await _playtestEvents.RecordAsync(
                roomId,
                userId,
                role,
                eventType,
                stateVersion,
                attemptId,
                revision,
                cancellationToken: cancellationToken);
        }
    }

    private void RequireV3(GameCase gameCase)
    {
        if (!_settings.Enabled)
        {
            throw ApiException.Conflict(
                "Paired confrontation is not enabled.",
                V3NotEnabledCode,
                "game.confrontation.disabled");
        }
        if (gameCase.MechanicsVersion != CaseMechanicsVersions.InvestigationV3PairedConfrontation)
        {
            throw NotAvailable();
        }
    }

    private static (TestimonyFragment Fragment, EvidenceChallenge Challenge) RequireOwnedTestimony(
        GameplayContext context,
        string userId,
        string fragmentId)
    {
        var state = context.Room.GameplayState!;
        var owned = state.TestimonyDiscoveries.Any(discovery =>
            discovery.TestimonyFragmentId == fragmentId && discovery.DiscoveredByUserId == userId);
        var fragment = owned
            ? context.Case.TestimonyFragments.FirstOrDefault(candidate => candidate.Id == fragmentId)
            : null;
        if (fragment is null) throw TestimonyUnavailable();

        var challenges = context.Case.EvidenceChallenges
            .Where(candidate => candidate.CandidateTestimonyFragmentIds.Count > 0
                ? candidate.CandidateTestimonyFragmentIds.Contains(fragment.Id, StringComparer.Ordinal)
                : candidate.DialogueId == fragment.DialogueId)
            .ToList();
        if (challenges.Count != 1) throw TestimonyUnavailable();
        return (fragment, challenges[0]);
    }

    private static ApiException TestimonyUnavailable() => ApiException.NotFound(
        "This testimony is not available.",
        TestimonyUnavailableCode,
        "game.confrontation.testimonyUnavailable");

    private static void RequireOwnedEvidence(
        GameplayContext context,
        string userId,
        string evidenceId,
        EvidenceChallenge? challenge)
    {
        var state = context.Room.GameplayState!;
        var owned = state.ClueDiscoveries.Any(discovery =>
            discovery.ClueId == evidenceId && discovery.DiscoveredByUserId == userId);
        var evidence = owned
            ? context.Case.Clues.FirstOrDefault(candidate => candidate.ClueId == evidenceId && candidate.IsEvidence)
            : null;
        var allowedByChallenge = challenge is not null
            && (challenge.CandidateEvidenceIds.Count == 0
                || challenge.CandidateEvidenceIds.Contains(evidenceId, StringComparer.Ordinal));
        if (evidence is not null && allowedByChallenge) return;

        throw ApiException.NotFound(
            "This evidence is not available.",
            EvidenceUnavailableCode,
            "game.confrontation.evidenceUnavailable");
    }

    private static void RequireUnresolved(GameplayState state, string challengeId)
    {
        if (state.ResolvedConfrontationRecords.Any(record => record.ChallengeId == challengeId))
        {
            throw NotAvailable();
        }
    }

    private static void RequireGeneratedPresetReady(GameplayContext context, EvidenceChallenge challenge)
    {
        // Legacy hand-authored V3 challenges had no candidate allowlists. Keep
        // their dialogue-level behavior; all new AI V3 challenges use explicit
        // dynamic candidate lists and cannot start until their configured readiness sets exist.
        if (challenge.CandidateEvidenceIds.Count == 0
            && challenge.CandidateTestimonyFragmentIds.Count == 0) return;

        var state = context.Room.GameplayState!;
        var requiredEvidenceIds = AiV3GenerationProfile.ResolveStartRequiredEvidenceIds(challenge);
        var requiredTestimonyIds = AiV3GenerationProfile.ResolveStartRequiredTestimonyIds(challenge);
        var investigatorHasEveryCandidate = requiredEvidenceIds.Count >= 2
            && requiredEvidenceIds.All(evidenceId => state.ClueDiscoveries.Any(discovery =>
                discovery.ClueId == evidenceId
                && discovery.DiscoveredByRole == PlayerRole.Investigator));
        var interrogatorHasEveryCandidate = requiredTestimonyIds.Count >= 2
            && requiredTestimonyIds.All(fragmentId => state.TestimonyDiscoveries.Any(discovery =>
                discovery.TestimonyFragmentId == fragmentId
                && discovery.DiscoveredByRole == PlayerRole.Interrogator));

        if (investigatorHasEveryCandidate && interrogatorHasEveryCandidate) return;

        // Deliberately avoid identifying the missing private choice or its owner.
        throw NotAvailable();
    }

    private static void RequireRole(RoomPlayer player, string role)
    {
        if (player.Role == role) return;
        throw ApiException.Forbidden(
            "This role cannot perform that confrontation action.",
            PairedConfrontationRules.WrongRoleCode,
            "game.confrontation.wrongRole");
    }

    private static void RequirePlayerRole(RoomPlayer player)
    {
        if (PlayerRole.IsValid(player.Role)) return;
        throw ApiException.Forbidden(
            "A valid room role is required.",
            PairedConfrontationRules.WrongRoleCode,
            "game.confrontation.wrongRole");
    }

    private static PairedConfrontationCommandResponse BuildResponse(
        GameStateResponse state,
        PairedConfrontationTransition transition)
    {
        var active = transition.Active;
        var terminal = transition.Terminal;
        var attemptId = active?.AttemptId ?? terminal?.AttemptId ?? string.Empty;
        var revision = active?.Revision ?? terminal?.FinalRevision ?? 0;
        var pair = state.SharedKnowledge.ResolvedTruths
            .Concat(state.SharedKnowledge.AttemptHistory)
            .LastOrDefault(candidate => candidate.AttemptId == attemptId && candidate.Revision == revision);
        return new PairedConfrontationCommandResponse
        {
            State = state,
            Changed = transition.Changed,
            AttemptId = attemptId,
            Revision = revision,
            Status = transition.Status,
            IsTerminal = terminal is not null,
            Feedback = pair?.Feedback,
            Reveals = pair?.Reveals ?? new List<SharedRevealDto>()
        };
    }

    private static ApiException ToApiException(PairedConfrontationRuleException exception) => exception.Code switch
    {
        PairedConfrontationRules.StaleCode => ApiException.Conflict(
            "The confrontation changed; refresh and try again.",
            PairedConfrontationRules.StaleCode,
            "game.confrontation.stale"),
        PairedConfrontationRules.WrongRoleCode => ApiException.Forbidden(
            "This role cannot perform that confrontation action.",
            PairedConfrontationRules.WrongRoleCode,
            "game.confrontation.wrongRole"),
        _ => NotAvailable()
    };

    private static ApiException NotAvailable() => ApiException.Conflict(
        "The confrontation is not available.",
        PairedConfrontationRules.NotAvailableCode,
        "game.confrontation.notAvailable");

    private enum PairedCommandKind
    {
        Start,
        EditTestimony,
        SubmitEvidence,
        Confirm,
        Cancel
    }
}
