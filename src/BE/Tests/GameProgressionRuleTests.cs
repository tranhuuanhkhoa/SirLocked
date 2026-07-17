using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class GameProgressionRuleTests
{
    private static GameCase BuildCase() => new()
    {
        CaseId = "case-test",
        Stages =
        {
            new CaseStage
            {
                StageId = "stage-1",
                Order = 1,
                Scenes =
                {
                    new CaseScene
                    {
                        SceneId = "scene-a",
                        Title = "Scene A",
                        CompleteCondition = new CompleteCondition
                        {
                            RequiredItemIds = { "item-a" },
                            RequiredClueIds = { "clue-a" }
                        }
                    },
                    new CaseScene
                    {
                        SceneId = "scene-b",
                        Title = "Scene B",
                        CompleteCondition = new CompleteCondition { RequiredDialogueIds = { "dlg-b" } }
                    }
                }
            },
            new CaseStage
            {
                StageId = "stage-2",
                Order = 2,
                Scenes =
                {
                    new CaseScene
                    {
                        SceneId = "scene-c",
                        Title = "Scene C",
                        CompleteCondition = new CompleteCondition { RequiredClueIds = { "clue-c" } }
                    }
                }
            }
        }
    };

    [Fact]
    public void AutoComplete_CompletesVisitedSatisfiedScene_ButNotUnvisitedOnes()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            VisitedSceneIds = { "scene-a" },
            InspectedItemIds = { "item-a" },
            UnlockedClueIds = { "clue-a", "clue-c" },
            AskedDialogueIds = { "dlg-b" }
        };

        var result = GameRules.AutoCompleteProgress(gameCase, state);

        // scene-a is visited and satisfied; scene-b and scene-c are satisfied but never visited.
        Assert.Equal(new[] { "scene-a" }, result.NewSceneIds);
        Assert.Equal(new[] { "scene-a" }, state.CompletedSceneIds);
        Assert.Empty(state.CompletedStageIds);
    }

    [Fact]
    public void AutoComplete_MarksStageOnlyWhenAllItsScenesAreComplete()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            VisitedSceneIds = { "scene-a", "scene-b", "scene-c" },
            InspectedItemIds = { "item-a" },
            UnlockedClueIds = { "clue-a" }
        };

        GameRules.AutoCompleteProgress(gameCase, state);
        Assert.Equal(new[] { "scene-a" }, state.CompletedSceneIds);
        Assert.Empty(state.CompletedStageIds);

        // Finishing scene-b out of order closes stage-1; stage-2 stays open.
        state.AskedDialogueIds.Add("dlg-b");
        var second = GameRules.AutoCompleteProgress(gameCase, state);
        Assert.Equal(new[] { "scene-b" }, second.NewSceneIds);
        Assert.Equal(new[] { "stage-1" }, state.CompletedStageIds);

        state.UnlockedClueIds.Add("clue-c");
        var third = GameRules.AutoCompleteProgress(gameCase, state);
        Assert.Equal(new[] { "scene-c" }, third.NewSceneIds);
        Assert.Equal(new[] { "stage-1", "stage-2" }, state.CompletedStageIds);
    }

    [Fact]
    public void AutoComplete_IsIdempotent()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            VisitedSceneIds = { "scene-a" },
            InspectedItemIds = { "item-a" },
            UnlockedClueIds = { "clue-a" }
        };

        GameRules.AutoCompleteProgress(gameCase, state);
        var repeat = GameRules.AutoCompleteProgress(gameCase, state);

        Assert.Empty(repeat.NewSceneIds);
        Assert.Empty(repeat.NewStageIds);
        Assert.Single(state.CompletedSceneIds);
    }

    [Fact]
    public void AccusationAvailability_RequiresEverySceneCompleted_AndStandingInFinalScene()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            CurrentSceneId = "scene-c",
            CompletedSceneIds = { "scene-a", "scene-c" }
        };

        // scene-b is still open, so the accusation stays unavailable even in the final scene.
        Assert.False(GameRules.IsAccusationAvailable(gameCase, state, "scene-c"));

        state.CompletedSceneIds.Add("scene-b");
        Assert.True(GameRules.IsAccusationAvailable(gameCase, state, "scene-c"));

        // Standing anywhere else keeps it unavailable.
        Assert.False(GameRules.IsAccusationAvailable(gameCase, state, "scene-a"));
    }

    [Fact]
    public void PresentEvidence_BeforeCorrectEvidenceExists_IsNotPenalized()
    {
        var state = new GameplayState { UnlockedClueIds = { "clue-wrong" } };
        var challenge = new EvidenceChallenge
        {
            ChallengeId = "challenge-1",
            CorrectEvidenceId = "clue-correct"
        };
        var now = new DateTime(2026, 7, 9, 10, 0, 0, DateTimeKind.Utc);

        var early = GameplayV2Rules.ApplyEvidence(state, challenge, "clue-wrong", "user", "INTERROGATOR", now);

        Assert.Equal(ConfrontationOutcome.NotYetPossible, early.Outcome);
        Assert.False(early.Changed);
        Assert.Equal(0, state.WrongEvidencePresentationCount);
        Assert.Empty(state.EvidenceAttemptKeys);

        // Once the correct evidence is in hand, a wrong guess counts again.
        state.UnlockedClueIds.Add("clue-correct");
        var wrong = GameplayV2Rules.ApplyEvidence(state, challenge, "clue-wrong", "user", "INTERROGATOR", now);
        Assert.Equal(ConfrontationOutcome.Rejected, wrong.Outcome);
        Assert.Equal(1, state.WrongEvidencePresentationCount);
    }
}
