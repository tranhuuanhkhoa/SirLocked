using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Applies the V3 caller knowledge boundary to a complete canonical game-state response.
/// It is intentionally deterministic and I/O-free so serialized leak tests can exercise it.
/// </summary>
public static class V3KnowledgeProjector
{
    public const string AttemptDisclosed = "ATTEMPT_DISCLOSED";
    public const string ResolvedSharedTruth = "RESOLVED_SHARED_TRUTH";

    public static void Apply(GameStateResponse response, GameRoom room, GameCase gameCase, string userId)
    {
        if (gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV3PairedConfrontation)
        {
            return;
        }

        var player = room.Players.FirstOrDefault(candidate => candidate.UserId == userId)
            ?? throw ApiException.Forbidden("You are not a member of this room.");
        var state = room.GameplayState
            ?? throw ApiException.Conflict("The game has not started.");
        var photoUrls = response.UnlockedClues
            .Concat(response.EvidenceClues)
            .Where(clue => !string.IsNullOrWhiteSpace(clue.PhotoUrl))
            .GroupBy(clue => clue.ClueId)
            .ToDictionary(group => group.Key, group => group.First().PhotoUrl);

        response.PrivateEvidence = state.ClueDiscoveries
            .Where(discovery => discovery.DiscoveredByUserId == userId)
            .Select(discovery => discovery.ClueId)
            .Distinct()
            .Select(clueId => gameCase.Clues.FirstOrDefault(clue => clue.ClueId == clueId))
            .Where(clue => clue is { IsEvidence: true })
            .Select(clue => BuildEvidence(clue!, photoUrls))
            .ToList();

        response.PrivateTestimonies = state.TestimonyDiscoveries
            .Where(discovery => discovery.DiscoveredByUserId == userId)
            .Select(discovery => discovery.TestimonyFragmentId)
            .Distinct()
            .Select(fragmentId => gameCase.TestimonyFragments.FirstOrDefault(fragment => fragment.Id == fragmentId))
            .Where(fragment => fragment is not null)
            .Select(fragment => BuildTestimony(fragment!, gameCase))
            .ToList();

        response.SharedKnowledge = BuildSharedKnowledge(state, gameCase, photoUrls);
        response.ActiveConfrontation = BuildActiveView(state.ActiveConfrontation, room, gameCase, player, photoUrls);
        response.IsCaseComplete = room.Status == RoomStatus.Completed;
        var knownClueIds = ProjectV2Knowledge(response, state, gameCase, player);
        ProjectActiveAccusation(response, knownClueIds);
        V3SceneProjectionPolicy.Apply(response, gameCase, player);
    }

    public static bool CanViewEvidencePhoto(GameRoom room, GameCase gameCase, string userId, string clueId)
    {
        var state = room.GameplayState;
        if (state is null) return false;
        if (gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV3PairedConfrontation)
        {
            return EvidenceCapturePersistenceCoordinator.IsPhotoVisible(room, clueId);
        }

        var discoveredByCaller = state.ClueDiscoveries.Any(discovery =>
            discovery.ClueId == clueId && discovery.DiscoveredByUserId == userId);
        if (discoveredByCaller) return true;

        return (state.ActiveConfrontation?.Disclosures.Any(disclosure => disclosure.EvidenceId == clueId) ?? false)
               || state.PairedConfrontationAttempts.Any(attempt =>
                   attempt.Disclosures.Any(disclosure => disclosure.EvidenceId == clueId));
    }

    private static SharedKnowledgeDto BuildSharedKnowledge(
        GameplayState state,
        GameCase gameCase,
        IReadOnlyDictionary<string, string?> photoUrls)
    {
        var shared = new SharedKnowledgeDto();
        if (state.ActiveConfrontation is { } active)
        {
            foreach (var disclosure in active.Disclosures)
            {
                var pair = BuildPair(active.AttemptId, active.ChallengeId, disclosure, AttemptDisclosed, null, null, gameCase, photoUrls);
                if (pair is not null) shared.AttemptHistory.Add(pair);
            }
        }

        foreach (var attempt in state.PairedConfrontationAttempts)
        {
            foreach (var disclosure in attempt.Disclosures)
            {
                var isFinal = disclosure.Revision == attempt.FinalRevision;
                var isTruth = isFinal && attempt.Status == PairedConfrontationStatus.ResolvedCorrect;
                var status = isTruth
                    ? ResolvedSharedTruth
                    : isFinal && attempt.Status == PairedConfrontationStatus.ResolvedIncorrect
                        ? PairedConfrontationStatus.ResolvedIncorrect.ToString()
                        : isFinal && attempt.Status == PairedConfrontationStatus.Cancelled
                            ? PairedConfrontationStatus.Cancelled.ToString()
                            : AttemptDisclosed;
                var challenge = gameCase.EvidenceChallenges.FirstOrDefault(candidate => candidate.ChallengeId == attempt.ChallengeId);
                var feedback = isFinal
                    ? attempt.Status switch
                    {
                        PairedConfrontationStatus.ResolvedCorrect => challenge?.SuccessResponse,
                        PairedConfrontationStatus.ResolvedIncorrect => challenge?.FailureResponse,
                        _ => null
                    }
                    : null;
                var pair = BuildPair(
                    attempt.AttemptId,
                    attempt.ChallengeId,
                    disclosure,
                    status,
                    feedback,
                    attempt.ResolvedAt,
                    gameCase,
                    photoUrls);
                if (pair is null) continue;
                if (isTruth && challenge is not null)
                {
                    pair.RevealTitle = challenge.RevealTitle;
                    pair.Reveals = challenge.UnlockClueIds
                        .Select(clueId => gameCase.Clues.FirstOrDefault(clue => clue.ClueId == clueId))
                        .Where(clue => clue is not null)
                        .Select(clue => new SharedRevealDto
                        {
                            ClueId = clue!.ClueId,
                            Title = clue.Title,
                            Content = clue.Content,
                            NarrativeMeaning = clue.NarrativeMeaning
                        })
                        .ToList();
                }
                if (isTruth) shared.ResolvedTruths.Add(pair);
                else shared.AttemptHistory.Add(pair);
            }
        }
        return shared;
    }

    private static PairedConfrontationViewDto? BuildActiveView(
        PairedConfrontationState? active,
        GameRoom room,
        GameCase gameCase,
        RoomPlayer player,
        IReadOnlyDictionary<string, string?> photoUrls)
    {
        if (active is null) return null;

        var reviewVisible = active.Status is PairedConfrontationStatus.ReadyForReview
            or PairedConfrontationStatus.AwaitingSecondConfirmation;
        var isInvestigator = player.Role == PlayerRole.Investigator;
        var isInterrogator = player.Role == PlayerRole.Interrogator;
        var evidence = !string.IsNullOrWhiteSpace(active.EvidenceId)
            ? gameCase.Clues.FirstOrDefault(clue => clue.ClueId == active.EvidenceId)
            : null;
        var testimony = gameCase.TestimonyFragments.FirstOrDefault(fragment => fragment.Id == active.TestimonyFragmentId);
        var confirmations = active.Confirmations
            .Where(confirmation => confirmation.Revision == active.Revision)
            .ToList();
        var confirmedByMe = confirmations.Any(confirmation => confirmation.UserId == player.UserId);
        var partner = room.Players.FirstOrDefault(candidate => candidate.UserId != player.UserId);

        return new PairedConfrontationViewDto
        {
            AttemptId = active.AttemptId,
            Revision = active.Revision,
            Status = active.Status,
            Evidence = evidence is not null && (reviewVisible || isInvestigator)
                ? BuildEvidence(evidence, photoUrls)
                : null,
            Testimony = testimony is not null && (reviewVisible || isInterrogator)
                ? BuildTestimony(testimony, gameCase)
                : null,
            PartnerHasProposed = isInvestigator
                ? !string.IsNullOrWhiteSpace(active.TestimonyFragmentId)
                : !string.IsNullOrWhiteSpace(active.EvidenceId),
            ConfirmedByMe = confirmedByMe,
            PartnerConfirmed = confirmations.Any(confirmation => confirmation.UserId != player.UserId),
            PartnerConnected = partner?.IsConnected == true,
            CanEdit = isInvestigator || isInterrogator,
            CanConfirm = reviewVisible && !confirmedByMe,
            CanCancel = isInvestigator || isInterrogator
        };
    }

    private static DisclosedPairDto? BuildPair(
        string attemptId,
        string challengeId,
        PairedConfrontationDisclosureRecord disclosure,
        string status,
        string? feedback,
        DateTime? resolvedAt,
        GameCase gameCase,
        IReadOnlyDictionary<string, string?> photoUrls)
    {
        var evidence = gameCase.Clues.FirstOrDefault(clue => clue.ClueId == disclosure.EvidenceId);
        var testimony = gameCase.TestimonyFragments.FirstOrDefault(fragment => fragment.Id == disclosure.TestimonyFragmentId);
        if (evidence is null || testimony is null) return null;

        return new DisclosedPairDto
        {
            AttemptId = attemptId,
            Revision = disclosure.Revision,
            Status = status,
            Evidence = BuildEvidence(evidence, photoUrls),
            Testimony = BuildTestimony(testimony, gameCase),
            Feedback = feedback,
            DisclosedAt = disclosure.DisclosedAt,
            ResolvedAt = resolvedAt
        };
    }

    private static PrivateEvidenceDto BuildEvidence(
        CaseClue clue,
        IReadOnlyDictionary<string, string?> photoUrls) => new()
    {
        ClueId = clue.ClueId,
        Title = clue.Title,
        Content = clue.Content,
        Source = clue.Source,
        SourceType = clue.SourceType,
        SceneId = clue.SceneId,
        InventoryDescription = clue.InventoryDescription,
        NarrativeMeaning = clue.NarrativeMeaning,
        PhotoUrl = photoUrls.TryGetValue(clue.ClueId, out var photoUrl) ? photoUrl : null
    };

    private static PrivateTestimonyDto BuildTestimony(TestimonyFragment fragment, GameCase gameCase)
    {
        var dialogue = gameCase.Dialogues.FirstOrDefault(candidate => candidate.DialogueId == fragment.DialogueId);
        var character = dialogue is null
            ? null
            : gameCase.Characters.FirstOrDefault(candidate => candidate.CharacterId == dialogue.CharacterId);
        return new PrivateTestimonyDto
        {
            TestimonyFragmentId = fragment.Id,
            DialogueId = fragment.DialogueId,
            CharacterId = dialogue?.CharacterId ?? string.Empty,
            CharacterName = character?.Name ?? string.Empty,
            Text = fragment.Text
        };
    }

    /// <summary>
    /// A standing proposal is shared knowledge, but its evidence ids are not automatically granted:
    /// the proposer may cite a clue only they discovered. Those ids are replaced with a placeholder so
    /// the partner still reviews the full shape of the accusation — every claim, in order — without
    /// receiving a semantic id the paired-confrontation disclosure path never handed them.
    /// </summary>
    private static void ProjectActiveAccusation(GameStateResponse response, IReadOnlySet<string> knownClueIds)
    {
        if (response.ActiveAccusation is not { } proposal) return;

        proposal.EvidenceIds = proposal.EvidenceIds.Where(knownClueIds.Contains).ToList();
        foreach (var link in proposal.EvidenceLinks
                     .Where(link => link.EvidenceId is null || !knownClueIds.Contains(link.EvidenceId)))
        {
            link.EvidenceId = null;
            link.IsUndisclosed = true;
        }
    }

    private static IReadOnlySet<string> ProjectV2Knowledge(
        GameStateResponse response,
        GameplayState state,
        GameCase gameCase,
        RoomPlayer player)
    {
        var knownClueIds = state.ClueDiscoveries
            .Where(discovery => discovery.DiscoveredByUserId == player.UserId
                || discovery.SourceAction is ClueDiscoverySources.Challenge or ClueDiscoverySources.Deduction)
            .Select(discovery => discovery.ClueId)
            .ToHashSet(StringComparer.Ordinal);
        foreach (var disclosure in state.PairedConfrontationAttempts.SelectMany(attempt => attempt.Disclosures)
                     .Concat(state.ActiveConfrontation?.Disclosures ?? Enumerable.Empty<PairedConfrontationDisclosureRecord>()))
            knownClueIds.Add(disclosure.EvidenceId);
        foreach (var revealId in state.ResolvedConfrontationRecords
                     .Select(record => gameCase.EvidenceChallenges.FirstOrDefault(challenge => challenge.ChallengeId == record.ChallengeId))
                     .Where(challenge => challenge is not null)
                     .SelectMany(challenge => challenge!.UnlockClueIds))
            knownClueIds.Add(revealId);

        response.UnlockedClueIds = response.UnlockedClueIds.Where(knownClueIds.Contains).ToList();
        response.UnlockedClues = response.UnlockedClues.Where(clue => knownClueIds.Contains(clue.ClueId)).ToList();
        response.EvidenceClues = response.UnlockedClues.Where(clue => clue.IsEvidence).ToList();
        response.VisitedConversationNodeIds = player.Role == PlayerRole.Interrogator
            ? response.VisitedConversationNodeIds
            : new List<string>();
        foreach (var deduction in response.Deductions)
        {
            deduction.RequiredClueIds = new List<string>();
            deduction.RequiredChallengeIds = new List<string>();
            deduction.MissingClueIds = new List<string>();
            deduction.MissingChallengeIds = new List<string>();
        }
        response.Testimonies = new List<TestimonyDto>();
        response.ActionLog = new List<ActionLogEntryDto>();
        return knownClueIds;
    }
}
