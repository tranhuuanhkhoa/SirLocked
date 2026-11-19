using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

/// <summary>A new order takes its size from the difficulty level; no other field can change it.</summary>
public sealed class AiOrderDifficultyTests
{
    [Fact]
    public void OldClientFields_AreIgnored_ForANewOrder()
    {
        var settings = AiCaseService.CreateNewDraftSettings(new GenerateAiCaseRequest
        {
            Difficulty = "hard", StageCount = 6, GenerationPreset = "CRACK_THE_LIE_V3", IncludeCrackTheLie = false, Leaning = "PUZZLE"
        });
        Assert.Equal(AiPipelineVersions.OpenCoop1, settings.PipelineVersion);
        Assert.Equal("hard", settings.Difficulty);
        Assert.Equal("PUZZLE", settings.Leaning);
        Assert.Equal(1, settings.StageCount);
        Assert.Equal(AiGenerationPresets.NormalRandom, settings.GenerationPreset);
        Assert.True(settings.IncludeCrackTheLie);
        Assert.Equal(CaseMechanicsVersions.InvestigationV3PairedConfrontation, settings.MechanicsVersion);
    }

    [Theory]
    [InlineData("FULL_FEATURE")]
    [InlineData("SHORT_DEMO")]
    [InlineData("PUZZLE_HEAVY")]
    [InlineData("DIALOGUE_HEAVY")]
    public void Preset_NeverChangesTheChosenDifficulty(string preset) =>
        Assert.Equal("easy", AiCaseService.CreateNewDraftSettings(new GenerateAiCaseRequest { Difficulty = "easy", GenerationPreset = preset }).Difficulty);

    [Fact]
    public void UnknownDifficulty_IsRejected() =>
        Assert.Throws<ApiException>(() => AiCaseService.CreateNewDraftSettings(new GenerateAiCaseRequest { Difficulty = "nightmare" }));

    [Fact]
    public void Normalize_TakesSuspectsAndMinutesFromTheLevel()
    {
        var order = AiCaseOrderPolicy.Normalize(new AiCaseOrder { SuspectCount = 6, PlayMinutes = 45 }, "ADMIN", AiDifficultyProfiles.For("easy"));
        Assert.Equal(3, order.SuspectCount);
        Assert.Equal(12, order.PlayMinutes);
    }

    [Fact]
    public void Normalize_NpcLimitFollowsTheLevel()
    {
        var picks = Enumerable.Range(1, 7).Select(i => $"npc-{i}").ToList();
        Assert.Throws<ApiException>(() => AiCaseOrderPolicy.Normalize(new AiCaseOrder { NpcIds = picks }, "ADMIN", AiDifficultyProfiles.For("easy")));
        Assert.Equal(7, AiCaseOrderPolicy.Normalize(new AiCaseOrder { NpcIds = picks }, "ADMIN", AiDifficultyProfiles.For("medium")).NpcIds.Count);
    }

    [Fact]
    public void PromptBlock_StatesTheLevelsPlayTime()
    {
        var profile = AiDifficultyProfiles.For("hard");
        var block = AiCaseOrderPolicy.BuildPromptBlock(AiCaseOrderPolicy.Normalize(new AiCaseOrder(), "ADMIN", profile), profile);
        Assert.Contains("about 40-60 minutes (hard)", block);
        Assert.Contains("suspects: exactly 5", block);
    }
}
