using System.Text.Json;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Services;

/// <summary>
/// The hint rule (VUAN-6, docs/AI_CASE_SETUP_VI.md): every question of a case has hints, so a later version
/// can sell them for coins or an advert. Every scene, confrontation and deduction needs hints at order 1
/// (general direction), 2 (where to look) and 3 (almost the answer); every interactive puzzle needs at least
/// three <c>solution.hints</c>. The validator reports findings as warnings; new cases and AI drafts apply them
/// strictly with <see cref="CaseValidationResult.RequireHints"/>, while cases that already existed (published
/// or bundled) only warn.
/// </summary>
public static class CaseHintRules
{
    public static readonly IReadOnlyList<int> Levels = [1, 2, 3];
    public const int MinPuzzleHints = 3;

    /// <summary>Adds every hint-rule finding to <paramref name="result"/> as a warning.</summary>
    public static void Check(GameCase gameCase, CaseValidationResult result)
    {
        if (gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV2) return;

        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
            CheckTarget(gameCase, HintContextTypes.Scene, scene.SceneId, result);
        foreach (var challenge in gameCase.EvidenceChallenges)
            CheckTarget(gameCase, HintContextTypes.Confrontation, challenge.ChallengeId, result);
        foreach (var deduction in gameCase.Deductions)
            CheckTarget(gameCase, HintContextTypes.Deduction, deduction.DeductionId, result);

        for (var index = 0; index < gameCase.Puzzles.Count; index++)
        {
            var puzzle = gameCase.Puzzles[index];
            // Classic CODE/SEQUENCE/SYMBOL puzzles carry no solution document, so the hints of their scene cover them.
            if (!PuzzleKinds.PuzzleKindRegistry.IsInteractive(puzzle)) continue;
            var count = PuzzleHintCount(puzzle.SolutionJson);
            if (count < MinPuzzleHints)
                result.AddWarning(CaseHintCodes.MissingPuzzleHints, $"puzzles[{index}].solution.hints",
                    $"Puzzle '{puzzle.PuzzleId}' needs at least {MinPuzzleHints} solution hints; it has {count}.",
                    puzzle.PuzzleId);
        }
    }

    /// <summary>
    /// True when an AI draft's persisted projection plan was built before the rule and has fewer than three hint
    /// slots for some target. Such a plan is immutable, so its draft only warns instead of failing for ever.
    /// </summary>
    public static bool PlanPredatesRule(GameplayProjectionPlan? plan)
    {
        if (plan is null || plan.Skeleton is null) return false;
        var skeleton = plan.Skeleton;
        var targets = skeleton.Stages.SelectMany(stage => stage.Scenes).Select(scene => (HintContextTypes.Scene, scene.SceneId))
            .Concat(skeleton.EvidenceChallenges.Select(challenge => (HintContextTypes.Confrontation, challenge.ChallengeId)))
            .Concat(skeleton.Deductions.Select(deduction => (HintContextTypes.Deduction, deduction.DeductionId)));
        return targets.Any(target => !Levels.All(level => skeleton.Hints.Any(hint =>
            hint.ContextType.Equals(target.Item1, StringComparison.OrdinalIgnoreCase)
            && hint.TargetId == target.Item2 && hint.Order == level)));
    }

    private static void CheckTarget(GameCase gameCase, string contextType, string targetId, CaseValidationResult result)
    {
        var orders = gameCase.Hints
            .Where(hint => string.Equals(hint.ContextType?.Trim(), contextType, StringComparison.OrdinalIgnoreCase)
                && hint.TargetId == targetId && !string.IsNullOrWhiteSpace(hint.Text))
            .Select(hint => hint.Order)
            .ToList();
        var missing = Levels.Where(level => !orders.Contains(level)).ToList();
        if (missing.Count > 0)
            result.AddWarning(CaseHintCodes.MissingHintLevel, $"hints[{contextType}:{targetId}]",
                $"{contextType} '{targetId}' needs hints at order 1, 2 and 3; missing order {string.Join(", ", missing)}.",
                targetId);
        var duplicated = Levels.Where(level => orders.Count(order => order == level) > 1).ToList();
        if (duplicated.Count > 0)
            result.AddWarning(CaseHintCodes.DuplicateHintLevel, $"hints[{contextType}:{targetId}]",
                $"{contextType} '{targetId}' has more than one hint at order {string.Join(", ", duplicated)}.",
                targetId);
    }

    private static int PuzzleHintCount(string? solutionJson)
    {
        if (string.IsNullOrWhiteSpace(solutionJson)) return 0;
        try
        {
            using var document = JsonDocument.Parse(solutionJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("hints", out var hints)
                || hints.ValueKind != JsonValueKind.Array)
                return 0;
            return hints.EnumerateArray().Count(hint =>
                hint.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(hint.GetString()));
        }
        catch (JsonException)
        {
            return 0;
        }
    }
}
