using SirLocked.Api.Models;
using SirLocked.Api.Services.Projection;

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
    int MaxRedHerrings,
    int ProofConclusionCount,
    int MaxIdLength,
    int MaxDescriptionLength)
{
    public static AiTruthGenerationBudget For(AiDraftSettings settings)
        => AiPipelineVersions.IsOpenCoop(settings)
            ? ForLevel(AiDifficultyProfiles.For(settings.Difficulty))
            : For(settings.GenerationPreset, settings.StageCount);

    /// <summary>
    /// An OPEN_COOP_1 draft: exactly the level's suspects, up to its most scenes as locations, its red herrings; the
    /// statement and timeline room of a balanced case of that many scenes, and its trace room plus one trace per
    /// optional puzzle.
    /// </summary>
    public static AiTruthGenerationBudget ForLevel(AiDifficultyProfile profile)
    {
        var scenes = profile.Scenes.Max;
        var room = ForProjection(new AiDraftSettings
        {
            GenerationPreset = AiGenerationPresets.NormalRandom,
            StageCount = Math.Min(6, scenes),
            IncludeCrackTheLie = true,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
        });
        return room with
        {
            // Room for one corroborating trace per optional puzzle on top of the proofs and confrontations.
            MaxTraces = room.MaxTraces + profile.Puzzles.Max,
            MaxSuspects = profile.Suspects,
            MaxLocations = scenes,
            MaxRedHerrings = profile.RedHerrings.Max,
            MaxTimelineEvents = Math.Min(28, scenes * 4 + 4)
        };
    }

    public static AiTruthGenerationBudget ForProjection(AiDraftSettings settings)
    {
        if (AiPipelineVersions.IsOpenCoop(settings)) return ForLevel(AiDifficultyProfiles.For(settings.Difficulty));
        var normalizedPreset = AiGenerationPresets.Normalize(settings.GenerationPreset);
        var effectivePreset = normalizedPreset == AiGenerationPresets.CrackTheLieV3
            ? AiGenerationPresets.ShortDemo
            : normalizedPreset;
        var boundedStages = Math.Max(1, normalizedPreset == AiGenerationPresets.CrackTheLieV3
            ? 2
            : settings.StageCount);
        var contract = AiGenerationContract.For(
            normalizedPreset == AiGenerationPresets.CrackTheLieV3
                ? new AiDraftSettings
                {
                    GenerationPreset = AiGenerationPresets.ShortDemo,
                    StageCount = 2,
                    IncludeCrackTheLie = true,
                    MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
                }
                : settings);
        var capacity = ProjectionCapacityPolicy.For(settings);
        var maxStatements = effectivePreset switch
        {
            AiGenerationPresets.ShortDemo => 10,
            AiGenerationPresets.PuzzleHeavy => 14,
            AiGenerationPresets.DialogueHeavy or AiGenerationPresets.FullFeature => 20,
            _ => 16
        };
        return new AiTruthGenerationBudget(
            MaxSuspects: Math.Clamp(
                Math.Max(boundedStages + 1, contract.MinCharacters),
                3,
                6),
            MaxLocations: Math.Clamp(boundedStages + 1, 3, 6),
            MaxTimelineEvents: Math.Min(28, boundedStages * 4 + 4),
            MaxTraces: capacity.BaseTraceCapacity,
            MaxStatements: maxStatements,
            MaxRedHerrings: capacity.MaxRedHerringSlots,
            ProofConclusionCount: ProofConclusionIds.ByCategory.Count,
            MaxIdLength: 96,
            MaxDescriptionLength: 400);
    }

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
        var maxSuspects = Math.Clamp(boundedStages + 1, 3, 6);
        return new AiTruthGenerationBudget(
            MaxSuspects: maxSuspects,
            MaxLocations: Math.Clamp(boundedStages + 1, 3, 6),
            MaxTimelineEvents: Math.Min(28, boundedStages * 4 + 4),
            MaxTraces: maxTraces,
            MaxStatements: maxStatements,
            MaxRedHerrings: Math.Max(0, maxSuspects - 1),
            ProofConclusionCount: ProofConclusionIds.ByCategory.Count,
            MaxIdLength: 96,
            MaxDescriptionLength: 400);
    }

    /// <summary>Compatibility ceiling for callers that do not own preset context.</summary>
    public static AiTruthGenerationBudget Maximum => For(AiGenerationPresets.FullFeature, 6);
}
