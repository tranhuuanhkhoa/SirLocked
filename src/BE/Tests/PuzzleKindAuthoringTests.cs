using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The AI picks each optional puzzle's kind and writes its words; the server completes and checks the rest.</summary>
public sealed class PuzzleKindAuthoringTests
{
    private static (GameplayProjectionPlan Plan, AiCaseDraft Draft) MediumWithThreePuzzles()
    {
        var draft = OpenCoopProjectionTests.OpenCoopDraft("medium", AiCaseLeanings.Puzzle);
        return (OptionalPuzzleProjectionTests.Plan(draft), draft);
    }

    private static string[] CompileErrors(GameplayProjectionPlan plan, GameplayProjectionContent content, AiDraftSettings settings)
    {
        var error = Assert.Throws<ProjectionCompilationException>(() => new GameCaseProjectionCompiler().Compile(plan, content, settings));
        return error.Errors.ToArray();
    }

    [Fact]
    public void EveryKindTheAiMayPick_IsRegistered()
    {
        Assert.Equal(7, PuzzleKindAuthoring.FreeKinds.Count);
        Assert.All(PuzzleKindAuthoring.FreeKinds.Concat(PuzzleKindAuthoring.TruthBoundKinds),
            kind => Assert.Contains(kind, PuzzleKindRegistry.KnownKinds));
    }

    [Fact]
    public void MockContent_CompilesEveryPuzzleIntoAValidDistinctInteractivePuzzle()
    {
        var (plan, draft) = MediumWithThreePuzzles();
        var gameCase = new GameCaseProjectionCompiler().Compile(plan, ProjectionContentMockFactory.Build(plan), draft.Settings);
        Assert.Equal(3, gameCase.Puzzles.Count);
        Assert.Equal(3, gameCase.Puzzles.Select(puzzle => puzzle.Kind).Distinct().Count());
        foreach (var puzzle in gameCase.Puzzles)
        {
            Assert.Contains(puzzle.Kind, PuzzleKindAuthoring.FreeKinds);
            Assert.False(string.IsNullOrEmpty(puzzle.SolutionJson));
            var errors = new List<string>();
            PuzzleKindRegistry.Validate(puzzle, "puzzle", (field, message, _) => errors.Add($"{field}: {message}"));
            Assert.Empty(errors);
            Assert.False(string.IsNullOrWhiteSpace(puzzle.Prompt));
        }
    }

    [Fact]
    public void PuzzleItems_TakeTheirNamesFromTheContent()
    {
        var (plan, draft) = MediumWithThreePuzzles();
        var content = ProjectionContentMockFactory.Build(plan);
        foreach (var puzzle in plan.Skeleton.Puzzles)
            content.Items[puzzle.TargetId].Name = $"Tủ thuốc {puzzle.PuzzleId}";
        var gameCase = new GameCaseProjectionCompiler().Compile(plan, content, draft.Settings);
        foreach (var puzzle in gameCase.Puzzles)
            Assert.Equal($"Tủ thuốc {puzzle.PuzzleId}", gameCase.Items.Single(item => item.ItemId == puzzle.TargetId).Name);
    }

    [Fact]
    public void AuthoredText_IsKeptAndTheRestIsGenerated()
    {
        var (plan, draft) = MediumWithThreePuzzles();
        var content = ProjectionContentMockFactory.Build(plan);
        content.Puzzles["puzzle-01"].Kind = "torn_paper";
        content.Puzzles["puzzle-01"].Authored = """{"note":{"text":"Gửi ông Lục, đừng để ai thấy.","mark":"L"}}""";
        content.Puzzles["puzzle-02"].Kind = "lockpick";
        content.Puzzles["puzzle-03"].Kind = "music_box";
        var puzzle = new GameCaseProjectionCompiler().Compile(plan, content, draft.Settings).Puzzles.Single(item => item.PuzzleId == "puzzle-01");
        var parameters = JsonNode.Parse(puzzle.ParamsJson)!.AsObject();
        Assert.Equal("Gửi ông Lục, đừng để ai thấy.", parameters["note"]!["text"]!.GetValue<string>());
        Assert.True(parameters.ContainsKey("tearSeed"));
    }

    [Fact]
    public void AMechanicKey_IsRefusedOnItsPath()
    {
        var (plan, draft) = MediumWithThreePuzzles();
        var content = ProjectionContentMockFactory.Build(plan);
        content.Puzzles["puzzle-01"].Kind = "torn_paper";
        content.Puzzles["puzzle-01"].Authored = """{"pieceCount":3}""";
        Assert.Contains(CompileErrors(plan, content, draft.Settings), error => error.Contains("puzzles.puzzle-01.authored.pieceCount"));
    }

    [Fact]
    public void ARepeatedKind_IsRefused()
    {
        var (plan, draft) = MediumWithThreePuzzles();
        var content = ProjectionContentMockFactory.Build(plan);
        content.Puzzles["puzzle-01"].Kind = "tilt_maze";
        content.Puzzles["puzzle-02"].Kind = "tilt_maze";
        Assert.Contains(CompileErrors(plan, content, draft.Settings), error => error.Contains("PuzzleKindRepeated"));
    }

    [Fact]
    public void AnUnknownKind_IsRefused()
    {
        var (plan, draft) = MediumWithThreePuzzles();
        var content = ProjectionContentMockFactory.Build(plan);
        content.Puzzles["puzzle-01"].Kind = "jigsaw";
        Assert.Contains(CompileErrors(plan, content, draft.Settings), error => error.Contains("puzzles.puzzle-01.kind"));
    }

    [Fact]
    public void Schema_OffersTheKindsTheAiMayPick()
    {
        var (plan, _) = MediumWithThreePuzzles();
        var schema = new ProjectionContentSchemaFactory().Build(plan);
        var kinds = schema["properties"]!["puzzles"]!["properties"]!["puzzle-01"]!["properties"]!["kind"]!["enum"]!.AsArray()
            .Select(node => node!.GetValue<string>()).OrderBy(kind => kind).ToArray();
        Assert.Equal(PuzzleKindAuthoring.FreeKinds.OrderBy(kind => kind).ToArray(), kinds);
    }
}
