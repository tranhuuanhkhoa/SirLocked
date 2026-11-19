using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public static class CaseTargetAllocationPolicy
{
    public static string ForCaseType(string? caseType) =>
        AiCaseTypes.Normalize(caseType) switch
        {
            AiCaseTypes.Murder or AiCaseTypes.MissingPerson or AiCaseTypes.Kidnapping =>
                CaseTargetKinds.Character,
            AiCaseTypes.Theft or AiCaseTypes.Sabotage or AiCaseTypes.Fraud =>
                CaseTargetKinds.Asset,
            _ => CaseTargetKinds.Asset
        };

    public static string Resolve(AiCaseDraft draft)
    {
        if (draft.CaseTruth is not null
            && CaseTargetKinds.All.Contains(draft.CaseTruth.CoreTruth.TargetKind))
            return draft.CaseTruth.CoreTruth.TargetKind;
        if (CaseTargetKinds.All.Contains(draft.PlannedTargetKind))
            return draft.PlannedTargetKind;
        var caseType = string.IsNullOrWhiteSpace(draft.StoryDiversity.CaseType)
            ? draft.Settings.CaseType
            : draft.StoryDiversity.CaseType;
        return ForCaseType(caseType);
    }

    /// <summary>An OPEN_COOP_1 draft has exactly its level's suspects; older drafts derive them from the contract.</summary>
    public static int RequiredSuspects(AiDraftSettings? settings, AiGenerationContract contract, string targetKind) =>
        AiPipelineVersions.IsOpenCoop(settings)
            ? AiDifficultyProfiles.For(settings!.Difficulty).Suspects
            : RequiredSuspects(contract, targetKind);

    public static int RequiredSuspects(AiGenerationContract contract, string targetKind)
    {
        var targetCharacterSlots = targetKind == CaseTargetKinds.Character ? 1 : 0;
        var required = contract.MinCharacters - targetCharacterSlots;
        if (required < 2)
            throw new InvalidOperationException(
                $"Gameplay contract needs at least two suspects after allocating target kind {targetKind}.");
        return required;
    }
}
