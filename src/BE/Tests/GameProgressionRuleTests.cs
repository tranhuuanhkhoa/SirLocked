using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class GameProgressionRuleTests
{
    private static readonly HashSet<string> Empty = new();

    private static HashSet<string> Set(params string[] values) => new(values);

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
    public void StartProgression_OnlyFirstAuthoredSceneIsEnterable()
    {
        var gameCase = BuildCase();
        gameCase.Stages.Reverse();
        var state = new GameplayState
        {
            VisitedSceneIds = { "scene-a" },
            UnlockedSceneIds = { "scene-a" }
        };

        Assert.Equal(new[] { "scene-a", "scene-b", "scene-c" },
            GameRules.GetAuthoredScenes(gameCase).Select(scene => scene.SceneId));
        Assert.True(GameRules.CanEnterScene(gameCase, state, "scene-a"));
        Assert.False(GameRules.CanEnterScene(gameCase, state, "scene-b"));
        Assert.False(GameRules.CanEnterScene(gameCase, state, "scene-c"));
    }

    [Fact]
    public void AutoComplete_CompletesVisitedScene_AndUnlocksOnlyImmediateSuccessor()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            VisitedSceneIds = { "scene-a" },
            UnlockedSceneIds = { "scene-a" },
            InspectedItemIds = { "item-a" },
            UnlockedClueIds = { "clue-a", "clue-c" },
            AskedDialogueIds = { "dlg-b" }
        };

        var result = GameRules.AutoCompleteProgress(gameCase, state);

        Assert.Equal(new[] { "scene-a" }, result.NewSceneIds);
        Assert.Equal(new[] { "scene-a" }, state.CompletedSceneIds);
        Assert.Equal(new[] { "scene-a", "scene-b" }, state.UnlockedSceneIds);
        Assert.DoesNotContain("scene-b", state.VisitedSceneIds);
        Assert.False(GameRules.CanEnterScene(gameCase, state, "scene-c"));
        Assert.Empty(state.CompletedStageIds);
    }

    [Fact]
    public void AutoComplete_UnlocksAcrossStageBoundary_WhenStageFinishes()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            VisitedSceneIds = { "scene-a", "scene-b" },
            UnlockedSceneIds = { "scene-a", "scene-b" },
            CompletedSceneIds = { "scene-a" },
            AskedDialogueIds = { "dlg-b" }
        };

        var result = GameRules.AutoCompleteProgress(gameCase, state);

        Assert.Equal(new[] { "scene-b" }, result.NewSceneIds);
        Assert.Equal(new[] { "stage-1" }, result.NewStageIds);
        Assert.Equal(new[] { "stage-1" }, state.CompletedStageIds);
        Assert.Contains("scene-c", state.UnlockedSceneIds);
        Assert.DoesNotContain("scene-c", state.VisitedSceneIds);
    }

    [Fact]
    public void ExplicitUnlock_CanOpenLaterSceneEarly_WithoutOpeningMiddleScene()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            VisitedSceneIds = { "scene-a" },
            UnlockedSceneIds = { "scene-a", "scene-c" }
        };

        Assert.False(GameRules.CanEnterScene(gameCase, state, "scene-b"));
        Assert.True(GameRules.CanEnterScene(gameCase, state, "scene-c"));
    }

    [Fact]
    public void VisitedScene_RemainsEnterableForRevisit()
    {
        var gameCase = BuildCase();
        var state = new GameplayState { VisitedSceneIds = { "scene-b" } };

        Assert.True(GameRules.CanEnterScene(gameCase, state, "scene-b"));
    }

    [Fact]
    public void Continue_NewlySatisfiedScene_CompletesAndMovesOnlyCallerToImmediateSuccessor()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            CurrentStageId = "stage-1",
            CurrentSceneId = "scene-a",
            VisitedSceneIds = { "scene-a" },
            UnlockedSceneIds = { "scene-a" },
            PlayerSceneIds = new Dictionary<string, string>
            {
                ["caller"] = "scene-a",
                ["teammate"] = "scene-a"
            }
        };

        var result = GameRules.ApplySceneContinuation(gameCase, state, "caller", "scene-a");

        Assert.True(result.CompletedNow);
        Assert.False(result.IsContinuation);
        Assert.True(result.CallerMoved);
        Assert.True(result.SuccessorUnlockedNow);
        Assert.True(result.SuccessorVisitedNow);
        Assert.Equal("scene-b", result.SuccessorSceneId);
        Assert.False(result.CrossesStage);
        Assert.Equal("scene-b", state.PlayerSceneIds["caller"]);
        Assert.Equal("scene-a", state.PlayerSceneIds["teammate"]);
        Assert.Contains("scene-a", state.CompletedSceneIds);
        Assert.Contains("scene-b", state.UnlockedSceneIds);
        Assert.Contains("scene-b", state.VisitedSceneIds);
    }

    [Fact]
    public void Continue_TeammateAlreadyCompletedScene_IsContinuationWithoutDuplicateCompletionOrUnlock()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            CurrentStageId = "stage-1",
            CurrentSceneId = "scene-a",
            VisitedSceneIds = { "scene-a" },
            UnlockedSceneIds = { "scene-a", "scene-b" },
            CompletedSceneIds = { "scene-a" },
            PlayerSceneIds = new Dictionary<string, string>
            {
                ["caller"] = "scene-a",
                ["teammate"] = "scene-a"
            }
        };

        var result = GameRules.ApplySceneContinuation(gameCase, state, "caller", "scene-a");

        Assert.False(result.CompletedNow);
        Assert.True(result.IsContinuation);
        Assert.True(result.CallerMoved);
        Assert.False(result.SuccessorUnlockedNow);
        Assert.Equal("scene-b", state.PlayerSceneIds["caller"]);
        Assert.Equal("scene-a", state.PlayerSceneIds["teammate"]);
        Assert.Equal(1, state.CompletedSceneIds.Count(id => id == "scene-a"));
        Assert.Equal(1, state.UnlockedSceneIds.Count(id => id == "scene-b"));
    }

    [Fact]
    public void Continue_AuthoredSuccessorAcrossStage_ReportsStageBoundary()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            CurrentStageId = "stage-1",
            CurrentSceneId = "scene-b",
            VisitedSceneIds = { "scene-a", "scene-b" },
            UnlockedSceneIds = { "scene-a", "scene-b" },
            CompletedSceneIds = { "scene-a" },
            PlayerSceneIds = new Dictionary<string, string>
            {
                ["caller"] = "scene-b",
                ["teammate"] = "scene-a"
            }
        };

        var result = GameRules.ApplySceneContinuation(gameCase, state, "caller", "scene-b");

        Assert.True(result.CrossesStage);
        Assert.Equal("stage-1", result.CurrentStageId);
        Assert.Equal("stage-2", result.SuccessorStageId);
        Assert.Equal("scene-c", result.SuccessorSceneId);
        Assert.Equal("scene-c", state.PlayerSceneIds["caller"]);
        Assert.Equal("scene-a", state.PlayerSceneIds["teammate"]);
    }

    /// <summary>
    /// Both detectives cross the same boundary, but a stage only ends once. StageCompleted telemetry
    /// is gated on <c>CompletedNow &amp;&amp; CrossesStage</c>, so the second crossing must not qualify or
    /// the median gap between stages collapses to zero.
    /// </summary>
    [Fact]
    public void Continue_BothPlayersCrossSameStageBoundary_OnlyTheFirstReportsCompletedNow()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            CurrentStageId = "stage-1",
            CurrentSceneId = "scene-b",
            VisitedSceneIds = { "scene-a", "scene-b" },
            UnlockedSceneIds = { "scene-a", "scene-b" },
            CompletedSceneIds = { "scene-a" },
            PlayerSceneIds = new Dictionary<string, string>
            {
                ["caller"] = "scene-b",
                ["teammate"] = "scene-b"
            }
        };

        var first = GameRules.ApplySceneContinuation(gameCase, state, "caller", "scene-b");
        var second = GameRules.ApplySceneContinuation(gameCase, state, "teammate", "scene-b");

        Assert.True(first.CrossesStage);
        Assert.True(first.CompletedNow);
        Assert.True(second.CrossesStage);
        Assert.False(second.CompletedNow);
    }

    [Fact]
    public void Continue_FinalScene_CompletesWithoutMovingCaller()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            CurrentStageId = "stage-2",
            CurrentSceneId = "scene-c",
            VisitedSceneIds = { "scene-c" },
            UnlockedSceneIds = { "scene-c" },
            PlayerSceneIds = new Dictionary<string, string>
            {
                ["caller"] = "scene-c",
                ["teammate"] = "scene-b"
            }
        };

        var result = GameRules.ApplySceneContinuation(gameCase, state, "caller", "scene-c");

        Assert.True(result.CompletedNow);
        Assert.Null(result.SuccessorSceneId);
        Assert.Null(result.SuccessorStageId);
        Assert.False(result.CallerMoved);
        Assert.False(result.CrossesStage);
        Assert.Equal("scene-c", state.PlayerSceneIds["caller"]);
        Assert.Equal("scene-b", state.PlayerSceneIds["teammate"]);
    }

    [Fact]
    public void Continue_ReapplyingSameDecision_IsIdempotentAndCallerOnly()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            CurrentStageId = "stage-1",
            CurrentSceneId = "scene-a",
            VisitedSceneIds = { "scene-a" },
            UnlockedSceneIds = { "scene-a" },
            PlayerSceneIds = new Dictionary<string, string>
            {
                ["caller"] = "scene-a",
                ["teammate"] = "scene-a"
            }
        };

        var first = GameRules.ApplySceneContinuation(gameCase, state, "caller", "scene-a");
        var replay = GameRules.ApplySceneContinuation(gameCase, state, "caller", "scene-a");

        Assert.True(first.HasChanges);
        Assert.False(replay.HasChanges);
        Assert.False(replay.CompletedNow);
        Assert.False(replay.CallerMoved);
        Assert.Equal("scene-b", state.PlayerSceneIds["caller"]);
        Assert.Equal("scene-a", state.PlayerSceneIds["teammate"]);
        Assert.Equal(1, state.CompletedSceneIds.Count(id => id == "scene-a"));
        Assert.Equal(1, state.UnlockedSceneIds.Count(id => id == "scene-b"));
        Assert.Equal(1, state.VisitedSceneIds.Count(id => id == "scene-b"));
    }

    [Fact]
    public void AutoComplete_IsIdempotent()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            VisitedSceneIds = { "scene-a" },
            UnlockedSceneIds = { "scene-a" },
            InspectedItemIds = { "item-a" },
            UnlockedClueIds = { "clue-a" }
        };

        GameRules.AutoCompleteProgress(gameCase, state);
        var repeat = GameRules.AutoCompleteProgress(gameCase, state);

        Assert.Empty(repeat.NewSceneIds);
        Assert.Empty(repeat.NewStageIds);
        Assert.Single(state.CompletedSceneIds);
        Assert.Equal(1, state.UnlockedSceneIds.Count(id => id == "scene-b"));
    }

    [Fact]
    public void FinalScene_IsInitiallyLocked_AndAccusationRequiresEverySceneCompleted()
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            CurrentSceneId = "scene-a",
            VisitedSceneIds = { "scene-a" },
            UnlockedSceneIds = { "scene-a" }
        };

        Assert.False(GameRules.CanEnterScene(gameCase, state, "scene-c"));
        Assert.Null(GameRules.GetNextAuthoredScene(gameCase, "scene-c"));
        Assert.False(GameRules.IsAccusationAvailable(gameCase, state, "scene-a"));

        state.CompletedSceneIds.AddRange(new[] { "scene-a", "scene-b", "scene-c" });
        Assert.True(GameRules.IsAccusationAvailable(gameCase, state, "scene-c"));
        Assert.False(GameRules.IsAccusationAvailable(gameCase, state, "scene-a"));
    }

    [Fact]
    public void CompleteConditionProgress_AndCountsEveryMissingId_AndPreservesEmptyAllBehavior()
    {
        var condition = new CompleteCondition
        {
            Logic = "AND",
            RequiredItemIds = { "item-1", "item-2" },
            RequiredClueIds = { "clue-1" }
        };

        var partial = CompleteConditionProgress.Evaluate(condition, Set("item-1"), Empty, Empty);

        Assert.False(partial.IsSatisfied);
        Assert.Equal(2, partial.PendingCount);
        Assert.Equal(new[] { "item-2" }, partial.MissingItemIds);
        Assert.Equal(new[] { "clue-1" }, partial.MissingClueIds);
        Assert.Empty(partial.MissingDialogueIds);
        Assert.Empty(partial.Alternatives);

        var complete = CompleteConditionProgress.Evaluate(
            condition,
            Set("item-1", "item-2"),
            Set("clue-1"),
            Empty);
        Assert.True(complete.IsSatisfied);
        Assert.Equal(0, complete.PendingCount);

        var emptyAnd = CompleteConditionProgress.Evaluate(new CompleteCondition(), Empty, Empty, Empty);
        Assert.True(emptyAnd.IsSatisfied);
        Assert.Equal(0, emptyAnd.PendingCount);
    }

    [Fact]
    public void CompleteConditionProgress_OrCanBeSatisfiedByAnyRequirementType_AndClearsPublicMissingIds()
    {
        var condition = new CompleteCondition
        {
            Logic = "OR",
            RequiredItemIds = { "item-1", "item-2" },
            RequiredClueIds = { "clue-1" },
            RequiredDialogueIds = { "dialogue-1" }
        };
        var results = new[]
        {
            CompleteConditionProgress.Evaluate(condition, Set("item-1", "item-2"), Empty, Empty),
            CompleteConditionProgress.Evaluate(condition, Empty, Set("clue-1"), Empty),
            CompleteConditionProgress.Evaluate(condition, Empty, Empty, Set("dialogue-1"))
        };

        foreach (var result in results)
        {
            Assert.True(result.IsSatisfied);
            Assert.Equal(0, result.PendingCount);
            Assert.Empty(result.MissingItemIds);
            Assert.Empty(result.MissingClueIds);
            Assert.Empty(result.MissingDialogueIds);
            Assert.Empty(result.Alternatives);
        }
    }

    [Fact]
    public void CompleteConditionProgress_OrIgnoresEmptyBranches_AndUsesShortestUnfinishedBranch()
    {
        var condition = new CompleteCondition
        {
            Logic = "OR",
            RequiredItemIds = { "item-1", "item-2" },
            RequiredClueIds = { "clue-1", "clue-2", "clue-3" }
        };

        var progress = CompleteConditionProgress.Evaluate(condition, Set("item-1"), Empty, Empty);

        Assert.False(progress.IsSatisfied);
        Assert.Equal(1, progress.PendingCount);
        Assert.Equal(2, progress.Alternatives.Count);
        Assert.DoesNotContain(
            progress.Alternatives,
            alternative => alternative.Type == CompleteConditionAlternativeType.Dialogues);
        Assert.False(CaseValidationService.IsConditionSatisfied(condition, Set("item-1"), Empty, Empty));
    }

    [Fact]
    public void CompleteConditionProgress_EmptyOrIsDefensivelyUnsatisfied()
    {
        var condition = new CompleteCondition { Logic = "OR" };

        var progress = CompleteConditionProgress.Evaluate(condition, Empty, Empty, Empty);

        Assert.False(progress.IsSatisfied);
        Assert.Equal(0, progress.PendingCount);
        Assert.Empty(progress.Alternatives);
    }

    [Fact]
    public void Validation_EmptyOrRemainsInvalidContent()
    {
        var gameCase = BuildCase();
        gameCase.Stages[0].Scenes[0].CompleteCondition = new CompleteCondition { Logic = "OR" };

        var result = new CaseValidationService().Validate(gameCase);

        Assert.Contains(result.Errors, error =>
            error.Code == "InvalidValue"
            && error.Path.EndsWith("completeCondition", StringComparison.Ordinal));
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
