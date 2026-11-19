using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>An OPEN_COOP_1 draft projects into a one-stage OPEN_COOP case of its level; older drafts keep their stages.</summary>
public sealed class OpenCoopProjectionTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly CaseTruthService _truthService = new();

    internal static AiCaseDraft OpenCoopDraft(string level, string leaning = AiCaseLeanings.Balanced) => new()
    {
        Id = "64b64c0f0f0f0f0f0f0f0f31", LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
        PlannedTargetKind = CaseTargetKinds.Asset,
        Settings = new AiDraftSettings
        {
            PipelineVersion = AiPipelineVersions.OpenCoop1, Difficulty = level, Leaning = leaning, StageCount = 1,
            IncludeCrackTheLie = true, MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            Language = CaseLanguages.Vietnamese
        }
    };

    private GameplayProjectionPlan Plan(AiCaseDraft draft)
    {
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!;
        draft.CaseTruth = truth;
        draft.TruthHash = _truthService.ComputeHash(truth);
        return new GameplayProjectionPlanner(_truthService).Build(draft, truth);
    }

    [Theory]
    [InlineData("easy", 12)]
    [InlineData("medium", 25)]
    public void NewDraft_HasOneOpenCoopStageWithEveryScene(string level, int minutes)
    {
        var plan = Plan(OpenCoopDraft(level));
        var stage = Assert.Single(plan.Skeleton.Stages);
        var profile = AiDifficultyProfiles.For(level);
        Assert.InRange(stage.Scenes.Count, profile.Scenes.Min, profile.Scenes.Max);
        Assert.Equal(CaseRuleSets.OpenCoop, plan.Skeleton.RuleSet);
        Assert.Equal(CaseMechanicsVersions.InvestigationV3PairedConfrontation, plan.Skeleton.MechanicsVersion);
        Assert.Equal(minutes, plan.Skeleton.EstimatedMinutes);
        Assert.Equal(profile.Cracks, plan.Skeleton.EvidenceChallenges.Count);
    }

    [Fact]
    public void NewDraft_KeepsTheFiveClaimAccusation() =>
        Assert.Equal(5, Plan(OpenCoopDraft("medium")).Skeleton.FinalLogic.RequiredEvidenceLinks.Count);

    [Fact]
    public void OldDraft_StillBuildsStagesWithoutTheOpenCoopRules()
    {
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f32", LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.NormalRandom, StageCount = 4 }
        };
        var plan = Plan(draft);
        Assert.True(plan.Skeleton.Stages.Count > 1);
        Assert.Equal(string.Empty, plan.Skeleton.RuleSet);
    }
}
