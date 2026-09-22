using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public sealed class CausalProjectionCorrection
{
    public string Code { get; init; } = string.Empty;
    public string RefId { get; init; } = string.Empty;
}

/// <summary>
/// Applies only truth-derived projection values that have exactly one valid answer.
/// It never changes approved truth, player-facing prose, statement authorship, or ambiguous mappings.
/// </summary>
public static class CausalProjectionNormalizer
{
    public static List<CausalProjectionCorrection> NormalizeGenerated(
        CaseTruthPackage truth,
        GameCase gameCase)
    {
        var corrections = new List<CausalProjectionCorrection>();
        SetLocked(
            gameCase.FinalLogic.CulpritId,
            truth.CoreTruth.CulpritId,
            value => gameCase.FinalLogic.CulpritId = value,
            "LOCKED_FINAL_CULPRIT",
            corrections);
        SetLocked(
            gameCase.FinalLogic.Motive,
            truth.CoreTruth.Motive,
            value => gameCase.FinalLogic.Motive = value,
            "LOCKED_FINAL_MOTIVE",
            corrections);
        SetLocked(
            gameCase.FinalLogic.Method,
            truth.CoreTruth.Method,
            value => gameCase.FinalLogic.Method = value,
            "LOCKED_FINAL_METHOD",
            corrections);

        var eventById = truth.TrueTimeline
            .GroupBy(item => item.EventId, StringComparer.Ordinal)
            .Where(group => group.Count() == 1)
            .ToDictionary(group => group.Key, group => group.Single(), StringComparer.Ordinal);
        var tracesByAction = truth.TraceLedger
            .GroupBy(item => item.SourceActionId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);

        foreach (var clue in gameCase.Clues)
        {
            if (!eventById.TryGetValue(clue.SourceActionId, out var sourceEvent)) continue;
            if (!string.Equals(clue.SceneId, sourceEvent.LocationId, StringComparison.Ordinal))
            {
                clue.SceneId = sourceEvent.LocationId;
                corrections.Add(new CausalProjectionCorrection
                {
                    Code = "CLUE_SCENE_FROM_SOURCE_ACTION",
                    RefId = clue.ClueId
                });
            }

            if (!tracesByAction.TryGetValue(clue.SourceActionId, out var actionTraces)
                || actionTraces.Count == 0)
                continue;

            if (string.IsNullOrWhiteSpace(clue.IndependentSourceGroup) && actionTraces.Count == 1)
            {
                clue.IndependentSourceGroup = actionTraces[0].IndependentSourceGroup;
                corrections.Add(new CausalProjectionCorrection
                {
                    Code = "CLUE_SOURCE_GROUP_FROM_UNIQUE_TRACE",
                    RefId = clue.ClueId
                });
            }

            var matchingTraces = string.IsNullOrWhiteSpace(clue.IndependentSourceGroup)
                ? actionTraces
                : actionTraces
                    .Where(trace => trace.IndependentSourceGroup == clue.IndependentSourceGroup)
                    .ToList();
            if (clue.SupportsConclusionIds.Count == 0 && matchingTraces.Count == 1)
            {
                clue.SupportsConclusionIds = matchingTraces[0].SupportsConclusionIds
                    .Distinct(StringComparer.Ordinal)
                    .ToList();
                corrections.Add(new CausalProjectionCorrection
                {
                    Code = "CLUE_PROOF_LINKS_FROM_UNIQUE_TRACE",
                    RefId = clue.ClueId
                });
            }
        }

        return corrections;
    }

    private static void SetLocked(
        string actual,
        string expected,
        Action<string> apply,
        string code,
        ICollection<CausalProjectionCorrection> corrections)
    {
        if (string.Equals(actual, expected, StringComparison.Ordinal)) return;
        apply(expected);
        corrections.Add(new CausalProjectionCorrection { Code = code });
    }
}
