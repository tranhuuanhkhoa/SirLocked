using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public sealed record ProjectionCapacity(
    int FinalTraceSlots,
    int MaxChallengeSlots,
    int MaxRedHerringSlots,
    int BaseTraceCapacity,
    int MaxProjectedClues)
{
    public void EnsureValid(string preset)
    {
        if (FinalTraceSlots != ProofConclusionIds.ByCategory.Count
            || MaxChallengeSlots < 0
            || MaxRedHerringSlots < 0
            || BaseTraceCapacity < FinalTraceSlots
            || BaseTraceCapacity + MaxChallengeSlots + MaxRedHerringSlots != MaxProjectedClues)
        {
            throw new InvalidOperationException(
                $"Projection capacity for {preset} cannot satisfy the five-claim contract.");
        }
    }
}

public static class ProjectionCapacityPolicy
{
    public static ProjectionCapacity For(AiDraftSettings settings)
    {
        var effectiveSettings = EffectiveSettings(settings);
        var contract = AiGenerationContract.For(effectiveSettings);
        var challengeSlots = contract.MaxEvidenceChallenges > 0
            ? contract.MaxEvidenceChallenges
            : contract.EvidenceChallenges;
        var desiredRedHerrings = DesiredRedHerrings(effectiveSettings.GenerationPreset);
        var availableAfterFinalAndChallenges =
            contract.MaxClues - ProofConclusionIds.ByCategory.Count - challengeSlots;
        var redHerringSlots = Math.Clamp(
            desiredRedHerrings,
            0,
            Math.Max(0, availableAfterFinalAndChallenges));
        var capacity = new ProjectionCapacity(
            ProofConclusionIds.ByCategory.Count,
            challengeSlots,
            redHerringSlots,
            contract.MaxClues - challengeSlots - redHerringSlots,
            contract.MaxClues);
        capacity.EnsureValid(effectiveSettings.GenerationPreset);
        return capacity;
    }

    public static void EnsureAllContractsValid()
    {
        foreach (var preset in AiGenerationPresets.All
                     .Where(item => item != AiGenerationPresets.CrackTheLieV3))
        {
            For(new AiDraftSettings
            {
                GenerationPreset = preset,
                StageCount = AiGenerationContract.For(preset, 4).MinStages
            }).EnsureValid(preset);
            For(new AiDraftSettings
            {
                GenerationPreset = preset,
                StageCount = AiGenerationContract.For(preset, 4).MinStages,
                IncludeCrackTheLie = true,
                MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
            }).EnsureValid($"{preset}+V3");
        }

        For(new AiDraftSettings
        {
            GenerationPreset = AiGenerationPresets.CrackTheLieV3,
            StageCount = 1,
            IncludeCrackTheLie = true,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
        }).EnsureValid(AiGenerationPresets.CrackTheLieV3);
    }

    private static AiDraftSettings EffectiveSettings(AiDraftSettings settings)
    {
        if (AiGenerationPresets.Normalize(settings.GenerationPreset)
            != AiGenerationPresets.CrackTheLieV3)
            return settings;
        return new AiDraftSettings
        {
            StageCount = 2,
            Difficulty = settings.Difficulty,
            VisualStyle = settings.VisualStyle,
            GenerationMode = settings.GenerationMode,
            GenerationPreset = AiGenerationPresets.ShortDemo,
            Language = settings.Language,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            IncludeCrackTheLie = true,
            CaseType = settings.CaseType
        };
    }

    private static int DesiredRedHerrings(string? preset) =>
        AiGenerationPresets.Normalize(preset) switch
        {
            AiGenerationPresets.DialogueHeavy or AiGenerationPresets.FullFeature => 2,
            _ => 1
        };
}
