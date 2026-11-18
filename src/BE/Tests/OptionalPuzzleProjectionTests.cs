using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// An OPEN_COOP_1 projection holds the level's optional interactive puzzles: each on its own clickable item, each
/// unlocking a clue the accusation, the confrontations and the deductions never need.
/// </summary>
public sealed class OptionalPuzzleProjectionTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    internal static GameplayProjectionPlan Plan(AiCaseDraft draft)
    {
        var truthService = new CaseTruthService();
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!;
        draft.CaseTruth = truth;
        draft.TruthHash = truthService.ComputeHash(truth);
        return new GameplayProjectionPlanner(truthService).Build(draft, truth);
    }

    [Theory]
    [InlineData("easy", AiCaseLeanings.Balanced, 1)]
    [InlineData("easy", AiCaseLeanings.Puzzle, 2)]
    [InlineData("medium", AiCaseLeanings.Puzzle, 3)]
    [InlineData("medium", AiCaseLeanings.Dialogue, 2)]
    public void PuzzleCount_FollowsLevelAndLeaning(string level, string leaning, int count) =>
        Assert.Equal(count, Plan(OpenCoopProjectionTests.OpenCoopDraft(level, leaning)).Skeleton.Puzzles.Count);

    [Fact]
    public void EveryPuzzleIsOptionalAndInteractiveOnAnItemInAScene()
    {
        var skeleton = Plan(OpenCoopProjectionTests.OpenCoopDraft("medium", AiCaseLeanings.Puzzle)).Skeleton;
        var scenes = skeleton.Stages.SelectMany(stage => stage.Scenes).ToList();
        Assert.All(skeleton.Puzzles, puzzle =>
        {
            Assert.Equal(CasePuzzleTypes.InteractivePuzzle, puzzle.Type);
            Assert.Equal(PuzzleProgressionRoles.Optional, puzzle.ProgressionRole);
            Assert.Equal("NORMAL", puzzle.Difficulty);
            Assert.Equal(string.Empty, puzzle.Kind); // the AI picks the kind in the content step
            Assert.True(skeleton.Items.Single(item => item.ItemId == puzzle.TargetId).IsInteractivePuzzleObject);
            Assert.Contains(scenes, scene => scene.ItemIds.Contains(puzzle.TargetId));
            Assert.Single(puzzle.UnlockClueIds);
        });
        // No dossier combine/use exercises in an OPEN_COOP case (the V3 evidence-source interaction may remain).
        Assert.DoesNotContain(skeleton.Interactions, interaction => interaction.InteractionId.StartsWith("interaction-projection-"));
    }

    // A puzzle reward may be offered as a distractor in a confrontation, never as what wins it.
    [Fact]
    public void PuzzleRewardIsNeverNeededElsewhere()
    {
        var skeleton = Plan(OpenCoopProjectionTests.OpenCoopDraft("medium", AiCaseLeanings.Puzzle)).Skeleton;
        var rewards = skeleton.Puzzles.SelectMany(puzzle => puzzle.UnlockClueIds).ToHashSet(StringComparer.Ordinal);
        var needed = skeleton.FinalLogic.RequiredEvidenceIds
            .Concat(skeleton.EvidenceChallenges.Select(challenge => challenge.CorrectEvidenceId))
            .Concat(skeleton.Deductions.SelectMany(deduction => deduction.RequiredClueIds))
            .Concat(skeleton.RequiredTeamworkChains.Select(chain => chain.InvestigatorClueId))
            .Concat(skeleton.Stages.SelectMany(stage => stage.Scenes).SelectMany(scene => scene.CompleteCondition.RequiredClueIds));
        Assert.DoesNotContain(needed, rewards.Contains);
        Assert.All(skeleton.Clues.Where(clue => rewards.Contains(clue.ClueId)),
            clue => Assert.StartsWith("puzzle-", clue.Source));
        Assert.All(skeleton.Items, item => Assert.DoesNotContain(item.UnlockClueIds, rewards.Contains));
    }

    [Fact]
    public void OldDraft_HasNoInteractivePuzzles()
    {
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f41", LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.NormalRandom, StageCount = 4 }
        };
        Assert.DoesNotContain(Plan(draft).Skeleton.Puzzles, puzzle => puzzle.Type == CasePuzzleTypes.InteractivePuzzle);
    }
}
