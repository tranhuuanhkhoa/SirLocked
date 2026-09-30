using System.Text.Json;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

public sealed class ProjectionMechanicQualityTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly CaseTruthService _truth = new();

    [Theory]
    [InlineData(AiGenerationPresets.PuzzleHeavy, 5)]
    [InlineData(AiGenerationPresets.FullFeature, 6)]
    public void RequiredMechanics_UnlockDistinctTruthSources_AndCraftedDossierCannotBeCollectedDirectly(string preset, int stages)
    {
        var (draft, truth, plan, gameCase) = Build(preset, stages);
        var rewards = gameCase.Puzzles.SelectMany(puzzle => puzzle.UnlockClueIds).ToList();
        var use = gameCase.Interactions.Single(item => item.Type == CaseInteractionTypes.UseItemOnTarget);
        rewards.AddRange(use.UnlockClueIds);
        Assert.Equal(4, rewards.Distinct(StringComparer.Ordinal).Count());
        Assert.All(rewards, id =>
        {
            var slot = plan.Clues[id];
            Assert.Contains(truth.TraceLedger, trace => trace.TraceId == slot.TraceId);
            Assert.NotEmpty(gameCase.Clues.Single(clue => clue.ClueId == id).SupportsConclusionIds);
            Assert.DoesNotContain(gameCase.Items, item => item.UnlockClueIds.Contains(id));
            Assert.DoesNotContain(gameCase.Clues, clue => clue.ClueId == id && clue.SourceType == "camera");
        });
        var combine = gameCase.Interactions.Single(item => item.Type == CaseInteractionTypes.CombineItems);
        Assert.Equal(combine.UnlockItemIds, use.RequiredItemIds);
        Assert.DoesNotContain(gameCase.Stages.SelectMany(stage => stage.Scenes).SelectMany(scene => scene.ItemIds),
            id => combine.UnlockItemIds.Contains(id));
        Assert.Contains(gameCase.Puzzles, puzzle => use.UnlockClueIds.All(puzzle.RequiredClueIds.Contains));
        AssertValid(draft, truth, plan, gameCase);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RequiredMechanics_CannotFinishWithoutCraftingOrEvidenceComparison(bool removeUse)
    {
        var (_, _, _, gameCase) = Build();
        gameCase.Interactions.RemoveAll(item => item.Type == (removeUse
            ? CaseInteractionTypes.UseItemOnTarget : CaseInteractionTypes.CombineItems));
        var result = CausalStateGraphValidator.Validate(gameCase);
        Assert.Contains(result.Errors, error => error.Code == "NoCanonicalWinPath");
    }

    [Fact]
    public void SelfDependentPuzzle_IsRejectedAsUnreachable()
    {
        var (_, _, _, gameCase) = Build();
        var puzzle = gameCase.Puzzles[0];
        puzzle.RequiredClueIds.Add(puzzle.UnlockClueIds.Single());
        var result = new CaseValidationService().ValidateFullLogic(gameCase);
        Assert.Contains(result.Errors, error => error.Code is "UnreachablePuzzle" or "UnwinnableCase");
    }

    [Fact]
    public void CodeAnswer_FollowsVisibleEvidenceRows_AndChangesWhenTheEvidenceChanges()
    {
        var (draft, truth, plan, _) = Build();
        var originalCode = plan.Skeleton.Puzzles.Single(item => item.Type == CasePuzzleTypes.CodePuzzle);
        var first = truth.TraceLedger.Single(trace => trace.TraceId == plan.Clues[originalCode.RequiredClueIds[0]].TraceId);
        var second = truth.TraceLedger.Single(trace => trace.TraceId == plan.Clues[originalCode.RequiredClueIds[1]].TraceId);
        first.Proves = "A recorded scratch crosses the seal.";
        second.Proves = "Zinc particles remain on the document cover.";
        first.DoesNotProve = second.DoesNotProve = "Motive cannot be determined from this observation alone.";
        var planner = new GameplayProjectionPlanner(_truth);
        var a = planner.Build(draft, truth).Skeleton.Puzzles.Single(item => item.Type == CasePuzzleTypes.CodePuzzle);
        (first.Proves, second.Proves) = (second.Proves, first.Proves);
        var b = planner.Build(draft, truth).Skeleton.Puzzles.Single(item => item.Type == CasePuzzleTypes.CodePuzzle);

        Assert.Equal("13", a.CorrectCode);
        Assert.Equal("31", b.CorrectCode);
        Assert.Contains(first.Proves, b.Prompt);
        Assert.Contains(second.Proves, b.Prompt);
        Assert.Contains(first.DoesNotProve, b.Prompt);
        Assert.DoesNotContain("314", b.Prompt);
        Assert.DoesNotContain(truth.CoreTruth.CulpritId, b.Prompt);
        Assert.DoesNotContain(truth.CoreTruth.Motive, b.Prompt);
    }

    [Fact]
    public void Compiler_PreservesObservableInstructions_WhenModelInventsAnotherTask()
    {
        var (draft, truth, plan, _) = Build();
        var content = ProjectionContentMockFactory.Build(plan);
        foreach (var puzzle in content.Puzzles.Values) puzzle.Prompt = "Guess the magic number 314.";
        foreach (var item in content.Items.Values) item.InspectText = "Ignore the evidence and use a secret key.";
        var compiled = new GameCaseProjectionCompiler().Compile(plan, content, draft.Settings);
        Assert.All(compiled.Puzzles, puzzle => Assert.Equal(
            plan.Skeleton.Puzzles.Single(item => item.PuzzleId == puzzle.PuzzleId).Prompt, puzzle.Prompt));
        Assert.All(compiled.Items.Where(item => item.ItemId.StartsWith("item-projection-", StringComparison.Ordinal)),
            item => Assert.Equal(plan.Skeleton.Items.Single(expected => expected.ItemId == item.ItemId).InspectText, item.InspectText));
        AssertValid(draft, truth, plan, compiled);
    }

    [Theory]
    [InlineData("answer")]
    [InlineData("requirement")]
    [InlineData("reward")]
    [InlineData("optional")]
    public void ProjectionValidation_RejectsChangesToLockedPuzzleMechanics(string mutation)
    {
        var (_, truth, plan, gameCase) = Build();
        var puzzle = gameCase.Puzzles[0];
        if (mutation == "answer") puzzle.CorrectCode = "314";
        else if (mutation == "requirement") puzzle.RequiredClueIds.Clear();
        else if (mutation == "optional") puzzle.ProgressionRole = PuzzleProgressionRoles.Optional;
        else puzzle.UnlockClueIds.Clear();
        var result = new ProjectionGraphValidator(_truth).Validate(truth, plan, gameCase);
        Assert.Contains(result.Errors, error => error.Code == "ProjectionDependencyMismatch"
            && error.RefId == puzzle.PuzzleId);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public void PuzzleDto_HidesEvidenceExcerptsUntilEveryPrerequisiteIsPresent(bool hasItem, bool hasClue)
    {
        var puzzle = new CasePuzzle
        {
            PuzzleId = "puzzle-private", Type = CasePuzzleTypes.SequencePuzzle,
            Prompt = "An undiscovered observation.", Options = ["An undiscovered fact", "A limit"],
            CorrectSequence = ["An undiscovered fact"], RequiredItemIds = ["item-a"], RequiredClueIds = ["clue-a"]
        };
        var dto = ScenePuzzleDto.From(puzzle,
            hasItem ? new HashSet<string> { "item-a" } : [],
            hasClue ? new HashSet<string> { "clue-a" } : [], new HashSet<string>());
        Assert.Equal(!(hasItem && hasClue), dto.IsLocked);
        if (dto.IsLocked)
        {
            Assert.Empty(dto.Prompt);
            Assert.Empty(dto.Options);
        }
        else
        {
            Assert.Equal(puzzle.Prompt, dto.Prompt);
            Assert.Equal(puzzle.Options, dto.Options);
        }
    }

    private (AiCaseDraft Draft, CaseTruthPackage Truth, GameplayProjectionPlan Plan, GameCase Case) Build(
        string preset = AiGenerationPresets.PuzzleHeavy, int stages = 5)
    {
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f0f", LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            Settings = new AiDraftSettings { StageCount = stages, Difficulty = "medium", GenerationPreset = preset,
                MechanicsVersion = CaseMechanicsVersions.InvestigationV2, Language = CaseLanguages.English }
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), Json)!;
        draft.CaseTruth = truth;
        draft.TruthHash = _truth.ComputeHash(truth);
        var plan = new GameplayProjectionPlanner(_truth).Build(draft, truth);
        var gameCase = new GameCaseProjectionCompiler().Compile(plan, ProjectionContentMockFactory.Build(plan), draft.Settings);
        return (draft, truth, plan, gameCase);
    }

    private void AssertValid(AiCaseDraft draft, CaseTruthPackage truth, GameplayProjectionPlan plan, GameCase gameCase)
    {
        var result = new CaseValidationService().ValidateFullLogic(gameCase);
        result.Errors.AddRange(new ProjectionGraphValidator(_truth).Validate(truth, plan, gameCase).Errors);
        result.Errors.AddRange(AiGenerationContract.For(draft.Settings).Validate(gameCase, draft.Settings).Errors);
        result.Errors.AddRange(_truth.ValidateProjection(truth, gameCase).Errors);
        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(error => $"{error.Code}: {error.Message}")));
    }
}
