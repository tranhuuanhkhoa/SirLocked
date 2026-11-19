using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The truth budget, the contract and the suspect count of an OPEN_COOP_1 draft come from its level.</summary>
public sealed class AiDifficultyBudgetTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static AiDraftSettings S(string level) => new()
    {
        PipelineVersion = AiPipelineVersions.OpenCoop1, Difficulty = level, Leaning = AiCaseLeanings.Balanced, StageCount = 1,
        IncludeCrackTheLie = true, MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
    };

    [Fact]
    public void HardOneStage_AllowsFiveSuspects() => Assert.Equal(5, AiTruthGenerationBudget.ForProjection(S("hard")).MaxSuspects);

    [Fact]
    public void HardBudget_AllowsEightLocations() => Assert.Equal(8, AiTruthGenerationBudget.For(S("hard")).MaxLocations);

    [Fact]
    public void EasyBudget_CapsRedHerringsAtOne() => Assert.Equal(1, AiTruthGenerationBudget.ForProjection(S("easy")).MaxRedHerrings);

    [Fact]
    public void Contract_ComesFromTheProfile()
    {
        var contract = AiGenerationContract.For(S("medium"));
        Assert.Equal((4, 5), (contract.MinScenes, contract.MaxScenes));
        Assert.Equal((1, 1), (contract.MinStages, contract.MaxStages));
        Assert.Equal(2, contract.EvidenceChallenges);
    }

    [Theory]
    [InlineData("easy", CaseTargetKinds.Asset, 3)]
    [InlineData("medium", CaseTargetKinds.Character, 4)]
    [InlineData("hard", CaseTargetKinds.Asset, 5)]
    [InlineData("hard", CaseTargetKinds.Character, 5)]
    public void RequiredSuspects_AreTheLevelsSuspects(string level, string targetKind, int expected) =>
        Assert.Equal(expected, CaseTargetAllocationPolicy.RequiredSuspects(S(level), AiGenerationContract.For(S(level)), targetKind));

    [Fact]
    public void OldDraft_KeepsThePresetContractAndSuspects()
    {
        var legacy = new AiDraftSettings { StageCount = 4 };
        Assert.Equal(AiGenerationContract.For(AiGenerationPresets.NormalRandom, 4), AiGenerationContract.For(legacy));
        Assert.Equal(AiTruthGenerationBudget.For(AiGenerationPresets.NormalRandom, 4), AiTruthGenerationBudget.For(legacy));
        var contract = AiGenerationContract.For(legacy);
        Assert.Equal(CaseTargetAllocationPolicy.RequiredSuspects(contract, CaseTargetKinds.Asset),
            CaseTargetAllocationPolicy.RequiredSuspects(legacy, contract, CaseTargetKinds.Asset));
    }

    private static (AiCaseDraft Draft, CaseTruthPackage Truth) HardTruth()
    {
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f22", LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset, Settings = S("hard")
        };
        return (draft, JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!);
    }

    [Fact]
    public void HardTruthWithTooFewRedHerrings_IsRefusedAtTheTruthStep()
    {
        var (draft, truth) = HardTruth();
        truth.RedHerringLedger.RemoveRange(1, truth.RedHerringLedger.Count - 1);
        var result = new GameplayProjectionPlanner(new CaseTruthService()).ValidateProjectability(draft, truth);
        Assert.Contains(result.Errors, error => error.Code == "TruthRedHerringCountForLevel" && error.Message.Contains("at least 2"));
    }

    [Fact]
    public void HardTruthWithTooFewTimelineEvents_IsRefusedAtTheTruthStep()
    {
        var (draft, truth) = HardTruth();
        truth.TrueTimeline.RemoveRange(3, truth.TrueTimeline.Count - 3);
        var result = new GameplayProjectionPlanner(new CaseTruthService()).ValidateProjectability(draft, truth);
        Assert.Contains(result.Errors, error => error.Code == "TruthTimelineForLevel" && error.Message.Contains("at least 7"));
    }

    [Fact]
    public void HardMockTruth_MeetsTheLevelsMinimums()
    {
        var (draft, truth) = HardTruth();
        var result = new GameplayProjectionPlanner(new CaseTruthService()).ValidateProjectability(draft, truth);
        Assert.DoesNotContain(result.Errors, error => error.Code is "TruthRedHerringCountForLevel" or "TruthTimelineForLevel");
    }

    [Fact]
    public void HardTruthWithTooFewLocations_IsRefusedWithTheLevelsRange()
    {
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f21", LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset, Settings = S("hard")
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!;
        var four = truth.CaseSeed.LocationIds.Take(4).ToList();
        truth.CaseSeed.LocationIds = four;
        foreach (var timelineEvent in truth.TrueTimeline.Where(item => !four.Contains(item.LocationId)))
            timelineEvent.LocationId = four[0];
        foreach (var trace in truth.TraceLedger.Where(item => !four.Contains(item.LocationId)))
            trace.LocationId = four[0];

        var result = new GameplayProjectionPlanner(new CaseTruthService()).ValidateProjectability(draft, truth);

        var error = Assert.Single(result.Errors, item => item.Code == "TruthLocationCountForLevel");
        Assert.Contains("hard needs 6-8 locations", error.Message);
    }

    [Fact]
    public void AnEnglishMethodInAVietnameseCase_IsRefusedAtTheTruthStep()
    {
        var (draft, truth) = HardTruth();
        draft.Settings.Language = CaseLanguages.Vietnamese;
        truth.CoreTruth.Method = "Before the box was sealed he swapped the finished chronometer for a jammed copy.";
        truth.CoreTruth.Motive = "Ông muốn giữ căn nhà thừa kế không bị đem ra bảo lãnh cho hợp đồng.";
        var result = new GameplayProjectionPlanner(new CaseTruthService()).ValidateProjectability(draft, truth);
        var error = Assert.Single(result.Errors, item => item.Code == "TruthLanguageMismatch");
        Assert.Equal("coreTruth.method", error.Path);
    }

    [Fact]
    public void AVietnameseMethodAndMotive_PassTheLanguageCheck()
    {
        var (draft, truth) = HardTruth();
        draft.Settings.Language = CaseLanguages.Vietnamese;
        truth.CoreTruth.Method = "Trước khi hộp được niêm phong, hắn tráo chiếc đồng hồ thật bằng một bản sao đã bị chèn lá đồng.";
        truth.CoreTruth.Motive = "Ông muốn giữ căn nhà thừa kế không bị đem ra bảo lãnh cho hợp đồng.";
        var result = new GameplayProjectionPlanner(new CaseTruthService()).ValidateProjectability(draft, truth);
        Assert.DoesNotContain(result.Errors, item => item.Code == "TruthLanguageMismatch");
    }
}
