using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.DTOs.Submission;

namespace SirLocked.Api.Services;

public enum ConfrontationOutcome
{
    Resolved,
    Rejected,
    DuplicateRejected,
    AlreadyResolved,
    /// <summary>The correct evidence has not been discovered yet, so no attempt can succeed.</summary>
    NotYetPossible
}

public enum DeductionOutcome
{
    Solved,
    Rejected,
    DuplicateRejected,
    AlreadySolved
}

public sealed record ConfrontationRuleResult(
    ConfrontationOutcome Outcome,
    bool Changed,
    IReadOnlyList<string> UnlockedClueIds);

public sealed record DeductionRuleResult(
    DeductionOutcome Outcome,
    bool Changed,
    IReadOnlyList<string> UnlockedClueIds);

public static class GameplayV2Rules
{
    public static string? ValidateAccusation(GameCase gameCase, GameplayState state, AccuseRequest request)
    {
        if (gameCase.FinalLogic.MotiveOptions.All(option => option.Id != request.MotiveId))
            return "Select a valid motive option.";
        if (gameCase.FinalLogic.MethodOptions.All(option => option.Id != request.MethodId))
            return "Select a valid method option.";

        var claims = request.EvidenceLinks.Select(link => link.ClaimType.Trim().ToUpperInvariant()).ToList();
        var evidenceIds = request.EvidenceLinks.Select(link => link.EvidenceId).ToList();
        var expectedClaims = EvidenceClaimTypes.ForContract(gameCase.LogicContractVersion);
        if (request.EvidenceLinks.Count != expectedClaims.Count || claims.Distinct().Count() != expectedClaims.Count || !expectedClaims.SetEquals(claims))
            return gameCase.LogicContractVersion >= CaseLogicContractVersions.CausalFiveClaim
                ? "Submit exactly one MOTIVE, METHOD, OPPORTUNITY, IDENTITY, and TIMELINE evidence link."
                : "Submit exactly one MOTIVE, METHOD, and OPPORTUNITY evidence link.";
        if (evidenceIds.Distinct().Count() != evidenceIds.Count)
            return "Each accusation claim must use different evidence.";
        if (evidenceIds.Any(id => !state.UnlockedClueIds.Contains(id)
            || gameCase.Clues.All(clue => clue.ClueId != id || !clue.IsEvidence)))
            return "You can only use unlocked evidence clues.";
        foreach (var deductionId in gameCase.FinalLogic.RequiredDeductionIds)
        {
            if (state.SolvedDeductionRecords.All(record => record.DeductionId != deductionId))
                return "Resolve all required deductions before making the final accusation.";
        }
        foreach (var chainId in gameCase.FinalLogic.RequiredTeamworkChainIds)
        {
            if (!GameRules.IsTeamworkChainComplete(gameCase, state, chainId))
                return "Complete the required teamwork chain before making the final accusation.";
        }
        return null;
    }

    public static bool IsAccusationCorrect(GameCase gameCase, AccuseRequest request) =>
        request.CulpritId == gameCase.FinalLogic.CulpritId
        && request.MotiveId == gameCase.FinalLogic.CorrectMotiveId
        && request.MethodId == gameCase.FinalLogic.CorrectMethodId
        && gameCase.FinalLogic.RequiredEvidenceLinks.All(required => request.EvidenceLinks.Any(selected =>
            selected.ClaimType.Equals(required.ClaimType, StringComparison.OrdinalIgnoreCase)
            && selected.EvidenceId == required.EvidenceId));

    public static ConfrontationRuleResult ApplyEvidence(
        GameplayState state,
        EvidenceChallenge challenge,
        string evidenceId,
        string userId,
        string role,
        DateTime resolvedAt)
    {
        if (state.ResolvedConfrontationRecords.Any(record => record.ChallengeId == challenge.ChallengeId))
            return new ConfrontationRuleResult(ConfrontationOutcome.AlreadyResolved, false, Array.Empty<string>());

        // The right evidence may live in a scene the team has not searched yet. Guessing at that
        // point cannot succeed, so it neither burns an attempt nor counts against the score.
        if (!string.IsNullOrWhiteSpace(challenge.CorrectEvidenceId)
            && !state.UnlockedClueIds.Contains(challenge.CorrectEvidenceId))
            return new ConfrontationRuleResult(ConfrontationOutcome.NotYetPossible, false, Array.Empty<string>());

        var attemptKey = $"{challenge.ChallengeId}:{evidenceId}";
        if (state.EvidenceAttemptKeys.Contains(attemptKey))
            return new ConfrontationRuleResult(ConfrontationOutcome.DuplicateRejected, false, Array.Empty<string>());

        if (challenge.CorrectEvidenceId != evidenceId)
        {
            state.EvidenceAttemptKeys.Add(attemptKey);
            state.WrongEvidencePresentationCount++;
            return new ConfrontationRuleResult(ConfrontationOutcome.Rejected, true, Array.Empty<string>());
        }

        state.ResolvedConfrontationRecords.Add(new ResolvedConfrontationRecord
        {
            ChallengeId = challenge.ChallengeId,
            EvidenceId = evidenceId,
            ResolvedByUserId = userId,
            ResolvedByRole = role,
            ResolvedAt = resolvedAt
        });
        var newClues = challenge.UnlockClueIds.Where(id => !state.UnlockedClueIds.Contains(id)).ToList();
        state.UnlockedClueIds.AddRange(newClues);
        RecordDiscoveries(state, newClues, userId, role, ClueDiscoverySources.Challenge, resolvedAt);
        return new ConfrontationRuleResult(ConfrontationOutcome.Resolved, true, newClues);
    }

    public static DeductionRuleResult ApplyDeduction(
        GameplayState state,
        DeductionChallenge deduction,
        string optionId,
        string userId,
        string role,
        DateTime solvedAt)
    {
        if (state.SolvedDeductionRecords.Any(record => record.DeductionId == deduction.DeductionId))
            return new DeductionRuleResult(DeductionOutcome.AlreadySolved, false, Array.Empty<string>());

        var attemptKey = $"{deduction.DeductionId}:{optionId}";
        if (state.DeductionAttemptKeys.Contains(attemptKey))
            return new DeductionRuleResult(DeductionOutcome.DuplicateRejected, false, Array.Empty<string>());

        if (deduction.CorrectOptionId != optionId)
        {
            state.DeductionAttemptKeys.Add(attemptKey);
            state.WrongDeductionCount++;
            return new DeductionRuleResult(DeductionOutcome.Rejected, true, Array.Empty<string>());
        }

        state.SolvedDeductionRecords.Add(new SolvedDeductionRecord
        {
            DeductionId = deduction.DeductionId,
            SelectedOptionId = optionId,
            SolvedByUserId = userId,
            SolvedByRole = role,
            SolvedAt = solvedAt
        });
        var newClues = deduction.UnlockClueIds.Where(id => !state.UnlockedClueIds.Contains(id)).ToList();
        state.UnlockedClueIds.AddRange(newClues);
        RecordDiscoveries(state, newClues, userId, role, ClueDiscoverySources.Deduction, solvedAt);
        return new DeductionRuleResult(DeductionOutcome.Solved, true, newClues);
    }

    private static void RecordDiscoveries(
        GameplayState state,
        IEnumerable<string> clueIds,
        string userId,
        string role,
        string sourceAction,
        DateTime discoveredAt)
    {
        foreach (var clueId in clueIds)
        {
            if (state.ClueDiscoveries.Any(record => record.ClueId == clueId)) continue;
            state.ClueDiscoveries.Add(new ClueDiscoveryRecord
            {
                ClueId = clueId,
                DiscoveredByUserId = userId,
                DiscoveredByRole = role,
                SourceAction = sourceAction,
                DiscoveredAt = discoveredAt
            });
        }
    }

    /// <summary>
    /// Coverage-based final score (max 100): evidence 40, contradiction 25,
    /// deduction 20, teamwork 15, minus penalties. A failed accusation always ranks D.
    /// </summary>
    public static ScoreSummary BuildScoreSummary(GameCase gameCase, GameplayState state, bool accusationSucceeded)
    {
        var evidenceCoverage = ScaledCoverage(
            gameCase.Clues.Count(clue => clue.IsEvidence),
            gameCase.Clues.Count(clue => clue.IsEvidence && state.UnlockedClueIds.Contains(clue.ClueId)),
            40);
        var contradictionCoverage = ScaledCoverage(
            gameCase.EvidenceChallenges.Count,
            state.ResolvedConfrontationRecords.Count,
            25);
        var deductionCoverage = ScaledCoverage(
            gameCase.Deductions.Count,
            state.SolvedDeductionRecords.Count,
            20);

        var (investigator, interrogator, handoff) = EvaluateTeamwork(gameCase, state);
        var teamworkScore = (investigator ? 5 : 0) + (interrogator ? 5 : 0) + (handoff ? 5 : 0);

        var wrongEvidencePenalty = state.WrongEvidencePresentationCount * 3;
        var wrongDeductionPenalty = state.WrongDeductionCount * 2;
        // Aiming the camera is a skill check, not a knowledge check — cap its drain on the score.
        var cameraMissPenalty = Math.Min(state.CameraMissCount, 10);

        var total = Math.Clamp(
            evidenceCoverage + contradictionCoverage + deductionCoverage + teamworkScore
                - wrongEvidencePenalty - wrongDeductionPenalty - cameraMissPenalty,
            0, 100);

        var rank = !accusationSucceeded
            ? "D"
            : total >= 90 ? "S" : total >= 75 ? "A" : total >= 60 ? "B" : "C";

        return new ScoreSummary
        {
            EvidenceCoverageScore = evidenceCoverage,
            ContradictionCoverageScore = contradictionCoverage,
            DeductionCoverageScore = deductionCoverage,
            TeamworkScore = teamworkScore,
            InvestigatorContribution = investigator,
            InterrogatorContribution = interrogator,
            CrossRoleHandoff = handoff,
            WrongEvidencePenalty = wrongEvidencePenalty,
            WrongDeductionPenalty = wrongDeductionPenalty,
            CameraMissPenalty = cameraMissPenalty,
            TotalScore = total,
            Rank = rank
        };
    }

    private static int ScaledCoverage(int total, int completed, int maxPoints)
    {
        if (total <= 0) return maxPoints;
        var clamped = Math.Clamp(completed, 0, total);
        return (int)Math.Round((double)clamped / total * maxPoints, MidpointRounding.AwayFromZero);
    }

    private static (bool Investigator, bool Interrogator, bool Handoff) EvaluateTeamwork(
        GameCase gameCase, GameplayState state)
    {
        var evidenceClueIds = gameCase.Clues
            .Where(clue => clue.IsEvidence)
            .Select(clue => clue.ClueId)
            .ToHashSet();

        var investigator = state.ClueDiscoveries.Any(record =>
            record.DiscoveredByRole == PlayerRole.Investigator
            && (record.SourceAction == ClueDiscoverySources.Inspect
                || record.SourceAction == ClueDiscoverySources.Camera)
            && evidenceClueIds.Contains(record.ClueId));

        var interrogator = state.ResolvedConfrontationRecords.Any(record =>
            record.ResolvedByRole == PlayerRole.Interrogator);

        var handoff = state.ResolvedConfrontationRecords.Any(confrontation =>
            state.ClueDiscoveries.Any(discovery =>
                discovery.ClueId == confrontation.EvidenceId
                && discovery.DiscoveredByRole == PlayerRole.Investigator));

        return (investigator, interrogator, handoff);
    }
}
