using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class GameStateProjectionTests
{
    private static readonly HashSet<string> Empty = new();

    private static HashSet<string> Set(params string[] values) => new(values);

    [Fact]
    public void OrObjective_ListsOnlyNonEmptyAlternatives_WithPartialMissingCounts()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-or",
            Title = "Archive",
            CompleteCondition = new CompleteCondition
            {
                Logic = "OR",
                RequiredItemIds = { "item-1", "item-2", "item-3" },
                RequiredClueIds = { "clue-1", "clue-2", "clue-3" },
                RequiredDialogueIds = { "dialogue-1" }
            }
        };
        var gameCase = BuildCase(scene);
        var state = BuildState(scene.SceneId);
        var inspected = Set("item-1");
        var progress = CompleteConditionProgress.Evaluate(scene.CompleteCondition, inspected, Empty, Empty);

        var objective = GameStateBuilder.BuildObjective(gameCase, state, scene, progress, Empty);

        Assert.Contains("choose one", objective);
        Assert.Contains("examine 2 physical evidence item(s)", objective);
        Assert.Contains("ask 1 question(s)", objective);
        Assert.Contains("uncover 3 clue(s)", objective);
    }

    [Fact]
    public void OrObjective_ExcludesEmptyRequirementTypes()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-or",
            Title = "Archive",
            CompleteCondition = new CompleteCondition
            {
                Logic = "OR",
                RequiredClueIds = { "clue-1", "clue-2" }
            }
        };
        var gameCase = BuildCase(scene);
        var state = BuildState(scene.SceneId);
        var progress = CompleteConditionProgress.Evaluate(scene.CompleteCondition, Empty, Empty, Empty);

        var objective = GameStateBuilder.BuildObjective(gameCase, state, scene, progress, Empty);

        Assert.Contains("choose one", objective);
        Assert.Contains("uncover 2 clue(s)", objective);
        Assert.DoesNotContain("physical evidence", objective);
        Assert.DoesNotContain("question(s)", objective);
    }

    [Fact]
    public void SatisfiedOr_ProjectsNoMissingRequirements_CompletionCopy_AndZeroMapPending()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-or",
            Title = "Archive",
            CompleteCondition = new CompleteCondition
            {
                Logic = "OR",
                RequiredItemIds = { "item-1", "item-2" },
                RequiredClueIds = { "clue-1", "clue-2", "clue-3" }
            }
        };
        var gameCase = BuildCase(scene);
        var state = BuildState(scene.SceneId);
        var inspected = Set("item-1", "item-2");
        var progress = CompleteConditionProgress.Evaluate(scene.CompleteCondition, inspected, Empty, Empty);

        var missing = GameStateBuilder.BuildMissingRequirements(progress);
        var objective = GameStateBuilder.BuildObjective(gameCase, state, scene, progress, Empty);
        var map = GameStateBuilder.BuildSceneMap(gameCase, state, scene.SceneId, inspected, Empty, Empty);

        Assert.True(progress.IsSatisfied);
        Assert.True(GameStateBuilder.CanCompleteScene(state, scene.SceneId, progress));
        Assert.Empty(missing.RequiredItemIds);
        Assert.Empty(missing.RequiredClueIds);
        Assert.Empty(missing.RequiredDialogueIds);
        Assert.Contains("found everything that matters", objective);
        Assert.Equal(0, Assert.Single(map).PendingRequirementCount);
    }

    [Fact]
    public void OrMapPending_UsesShortestUnfinishedBranch_AndCompletedScenesStayZero()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-or",
            Title = "Archive",
            CompleteCondition = new CompleteCondition
            {
                Logic = "OR",
                RequiredItemIds = { "item-1", "item-2", "item-3" },
                RequiredClueIds = { "clue-1", "clue-2", "clue-3" },
                RequiredDialogueIds = { "dialogue-1", "dialogue-2" }
            }
        };
        var gameCase = BuildCase(scene);
        var state = BuildState(scene.SceneId);

        var unfinishedMap = GameStateBuilder.BuildSceneMap(
            gameCase,
            state,
            scene.SceneId,
            Set("item-1"),
            Empty,
            Empty);
        Assert.Equal(2, Assert.Single(unfinishedMap).PendingRequirementCount);

        state.CompletedSceneIds.Add(scene.SceneId);
        var completedMap = GameStateBuilder.BuildSceneMap(
            gameCase,
            state,
            scene.SceneId,
            Set("item-1"),
            Empty,
            Empty);
        Assert.Equal(0, Assert.Single(completedMap).PendingRequirementCount);
    }

    [Fact]
    public void AndObjective_RemainsCumulative()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-and",
            Title = "Archive",
            CompleteCondition = new CompleteCondition
            {
                RequiredItemIds = { "item-1", "item-2" },
                RequiredClueIds = { "clue-1" }
            }
        };
        var gameCase = BuildCase(scene);
        var state = BuildState(scene.SceneId);
        var progress = CompleteConditionProgress.Evaluate(scene.CompleteCondition, Set("item-1"), Empty, Empty);

        var objective = GameStateBuilder.BuildObjective(gameCase, state, scene, progress, Empty);

        Assert.DoesNotContain("choose one", objective);
        Assert.Contains("examine 1 more piece(s) of physical evidence", objective);
        Assert.Contains("uncover 1 more clue(s)", objective);
    }

    [Fact]
    public void AccusationProjection_IsAbsentUntilAProposalExists()
    {
        var withoutProposal = BuildState("scene-1");

        // The absent-proposal contract lives in the projection itself, not in a caller-side ternary,
        // so this exercises the same call GameStateBuilder makes rather than restating it.
        Assert.Null(withoutProposal.ActiveAccusation);
        Assert.Null(AccusationProposalDto.From(withoutProposal.ActiveAccusation));
    }

    [Fact]
    public void AccusationProjection_ExposesOnlyTheConfirmationsBindingTheCurrentRevision()
    {
        var proposal = new AccusationProposalState
        {
            AttemptId = "attempt-1",
            Revision = 2,
            ProposedByUserId = "inv",
            ProposedByRole = PlayerRole.Investigator,
            CulpritId = "char-1",
            MotiveId = "motive-1",
            MethodId = "method-1",
            EvidenceLinks = { new SelectedEvidenceLink { ClaimType = "MOTIVE", EvidenceId = "clue-1" } },
            Confirmations =
            {
                new PlayerConfrontationConfirmation { UserId = "inv", Revision = 1 },
                new PlayerConfrontationConfirmation { UserId = "int", Revision = 1 },
                new PlayerConfrontationConfirmation { UserId = "int", Revision = 2 }
            }
        };

        var projected = Assert.IsType<AccusationProposalDto>(AccusationProposalDto.From(proposal));

        Assert.Equal(new[] { "int" }, projected.ConfirmedUserIds);
        Assert.Equal(2, projected.Revision);
        Assert.Equal("clue-1", Assert.Single(projected.EvidenceLinks).EvidenceId);
    }

    private static GameCase BuildCase(CaseScene scene) => new()
    {
        CaseId = "case-projection",
        Stages =
        {
            new CaseStage
            {
                StageId = "stage-1",
                Order = 1,
                Scenes = { scene }
            }
        }
    };

    private static GameplayState BuildState(string sceneId) => new()
    {
        CurrentStageId = "stage-1",
        CurrentSceneId = sceneId,
        VisitedSceneIds = { sceneId },
        UnlockedSceneIds = { sceneId }
    };
}
