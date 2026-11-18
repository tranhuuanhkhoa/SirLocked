using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>Before layout, an OPEN_COOP_1 case is checked against its level; the mock case of every level passes.</summary>
public sealed class AiDifficultyConformanceTests
{
    private static (GameCase Case, AiCaseDraft Draft) MockCase(string level)
    {
        var draft = OpenCoopProjectionTests.OpenCoopDraft(level);
        var plan = OptionalPuzzleProjectionTests.Plan(draft);
        return (new GameCaseProjectionCompiler().Compile(plan, ProjectionContentMockFactory.Build(plan), draft.Settings), draft);
    }

    [Theory]
    [InlineData("easy")]
    [InlineData("medium")]
    [InlineData("hard")]
    public void MockCase_PassesTheLevelAndTheContract(string level)
    {
        var (gameCase, draft) = MockCase(level);
        Assert.Empty(AiDifficultyConformance.Check(gameCase, draft.Settings, draft.CaseTruth));
        Assert.Empty(AiGenerationContract.For(draft.Settings).Validate(gameCase, draft.Settings).Errors);
    }

    [Fact]
    public void HardMockCase_NeedsADeductionAndHasFivePuzzles()
    {
        var (gameCase, _) = MockCase("hard");
        Assert.NotEmpty(gameCase.FinalLogic.RequiredDeductionIds);
        Assert.Equal(5, gameCase.Puzzles.Count);
        Assert.Equal(3, gameCase.EvidenceChallenges.Count);
    }

    [Theory]
    [InlineData("LevelRuleSet")]
    [InlineData("LevelSceneCount")]
    [InlineData("LevelSuspectCount")]
    [InlineData("LevelCrackCount")]
    [InlineData("LevelPuzzleCount")]
    [InlineData("LevelPuzzleNotOptional")]
    [InlineData("LevelPuzzleSoleProof")]
    [InlineData("LevelDeductionMissing")]
    [InlineData("LevelTimelineSize")]
    [InlineData("LevelRedHerringCount")]
    public void EachMismatch_IsReported(string code)
    {
        var (gameCase, draft) = MockCase("hard");
        var truth = draft.CaseTruth!;
        switch (code)
        {
            case "LevelRuleSet": gameCase.RuleSet = CaseRuleSets.Classic; break;
            case "LevelSceneCount": gameCase.Stages[0].Scenes.RemoveRange(1, gameCase.Stages[0].Scenes.Count - 1); break;
            case "LevelSuspectCount": truth.CaseSeed.SuspectIds.RemoveAt(truth.CaseSeed.SuspectIds.Count - 1); break;
            case "LevelCrackCount": gameCase.EvidenceChallenges.RemoveAt(0); break;
            case "LevelPuzzleCount": gameCase.Puzzles.RemoveAt(0); break;
            case "LevelPuzzleNotOptional": gameCase.Puzzles[0].ProgressionRole = "REQUIRED"; break;
            case "LevelPuzzleSoleProof": gameCase.FinalLogic.RequiredEvidenceIds.Add(gameCase.Puzzles[0].UnlockClueIds[0]); break;
            case "LevelDeductionMissing": gameCase.FinalLogic.RequiredDeductionIds.Clear(); break;
            case "LevelTimelineSize": gameCase.Timeline!.Events.RemoveRange(2, gameCase.Timeline.Events.Count - 2); break;
            case "LevelRedHerringCount": foreach (var clue in gameCase.Clues) clue.IsRedHerring = false; break;
        }
        Assert.Contains(AiDifficultyConformance.Check(gameCase, draft.Settings, truth), error => error.StartsWith(code));
    }

    [Fact]
    public void OldDraft_IsNotLevelChecked() =>
        Assert.Empty(AiDifficultyConformance.Check(new GameCase(), new AiDraftSettings { StageCount = 4 }, null));
}
