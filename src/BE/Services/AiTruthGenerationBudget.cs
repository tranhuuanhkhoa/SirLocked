using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// The single source of truth for the bounded CaseTruth generation contract.
/// Prompt builders, strict schemas and deterministic validation must all use
/// the same instance for a draft.
/// </summary>
public sealed record AiTruthGenerationBudget(
    int MaxSuspects,
    int MaxLocations,
    int MaxTimelineEvents,
    int MaxTraces,
    int MaxStatements,
    int ProofConclusionCount,
    int MaxIdLength,
    int MaxDescriptionLength)
{
    public static AiTruthGenerationBudget For(AiDraftSettings settings) =>
        For(settings.GenerationPreset, settings.StageCount);

    public static AiTruthGenerationBudget For(string? preset, int stageCount)
    {
        var normalizedPreset = AiGenerationPresets.Normalize(preset);
        var boundedStages = Math.Max(1, stageCount);
        var maxTraces = normalizedPreset switch
        {
            AiGenerationPresets.ShortDemo => 10,
            AiGenerationPresets.FullFeature => 18,
            AiGenerationPresets.PuzzleHeavy or AiGenerationPresets.DialogueHeavy => 16,
            _ => 14
        };
        var maxStatements = normalizedPreset switch
        {
            AiGenerationPresets.ShortDemo => 10,
            AiGenerationPresets.PuzzleHeavy => 14,
            AiGenerationPresets.DialogueHeavy or AiGenerationPresets.FullFeature => 20,
            _ => 16
        };

        return new AiTruthGenerationBudget(
            MaxSuspects: Math.Clamp(boundedStages + 1, 3, 6),
            MaxLocations: Math.Clamp(boundedStages + 1, 3, 6),
            MaxTimelineEvents: Math.Min(28, boundedStages * 4 + 4),
            MaxTraces: maxTraces,
            MaxStatements: maxStatements,
            ProofConclusionCount: ProofConclusionIds.ByCategory.Count,
            MaxIdLength: 96,
            MaxDescriptionLength: 400);
    }

    /// <summary>Compatibility ceiling for callers that do not own preset context.</summary>
    public static AiTruthGenerationBudget Maximum => For(AiGenerationPresets.FullFeature, 6);
}
