using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The interactive puzzle kind registry and the tilt-maze reference kind.</summary>
public sealed class PuzzleKindTests
{
    private static PuzzleKindContext Mockup() => new()
    {
        PuzzleId = "p",
        Params = JsonNode.Parse("""
        {"size":7,"start":[6,0],"socket":[3,3],"lever":[1,1],"holes":[[3,5],[4,2],[6,4]],"gate":[3,3,4,3],
         "walls":[[0,5,1,5],[1,4,1,5],[1,4,2,4],[1,5,2,5],[2,0,2,1],[2,2,2,3],[2,2,3,2],[2,3,3,3],[2,6,3,6],
                  [3,2,3,3],[3,3,3,4],[4,1,4,2],[4,0,5,0],[4,5,5,5],[5,1,5,2],[5,4,5,5],[6,3,6,4]]}
        """)!.AsObject()
    };

    private static JsonElement Answer(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void Registry_DiscoversTiltMaze()
    {
        Assert.NotNull(PuzzleKindRegistry.Find("tilt_maze"));
        Assert.NotNull(PuzzleKindRegistry.Find("TILT_MAZE"));
        Assert.Null(PuzzleKindRegistry.Find("nope"));
    }

    [Fact]
    public void TiltMaze_MockupLevel_HasTheDesignedNineTiltSolution()
    {
        var level = TiltMazeKind.Read(Mockup().Params);
        Assert.Equal("URULDRDRU", TiltMazeKind.Solve(level));
    }

    [Fact]
    public void TiltMaze_Check_ReplaysMovesOnTheServer()
    {
        var kind = new TiltMazeKind();
        var run = new PuzzleRunState();
        Assert.True(kind.Check(Mockup(), Answer("""{"moves":"URULDRDRU"}"""), run).Solved);
        Assert.False(kind.Check(Mockup(), Answer("""{"moves":"UUUU"}"""), run).Solved);
        Assert.False(kind.Check(Mockup(), Answer("""{"moves":"XYZ"}"""), run).Solved);
        Assert.False(kind.Check(Mockup(), Answer("""{"other":1}"""), run).Solved);
    }

    [Fact]
    public void TiltMaze_Generate_IsDeterministicPerSeed_AndEasyIsShort()
    {
        var kind = new TiltMazeKind();
        string Make(int seed)
        {
            var context = new PuzzleKindContext { PuzzleId = "p", Difficulty = PuzzleDifficulties.Easy };
            kind.Generate(context, new Random(seed));
            var errors = new List<string>();
            kind.Validate(context, (field, message) => errors.Add(message));
            Assert.Empty(errors);
            var moves = context.Solution["moves"]!.GetValue<string>();
            Assert.InRange(moves.Length, 5, 7);
            Assert.True(kind.Check(context, Answer($$"""{"moves":"{{moves}}"}"""), new PuzzleRunState()).Solved);
            Assert.False(context.Params.ContainsKey("moves"));
            return context.Params.ToJsonString();
        }
        Assert.Equal(Make(11), Make(11));
        Assert.NotEqual(Make(11), Make(12));
    }

    [Fact]
    public void FillMissing_GivesEachCaseItsOwnAnswer_AndKeepsAuthoredValues()
    {
        GameCase Case(string id) => new()
        {
            CaseId = id,
            Puzzles = { new CasePuzzle { PuzzleId = "maze", Type = CasePuzzleTypes.InteractivePuzzle, Kind = "tilt_maze" } }
        };
        var a = Case("case-a");
        var b = Case("case-b");
        PuzzleKindRegistry.FillMissing(a);
        PuzzleKindRegistry.FillMissing(b);
        Assert.NotEqual(a.Puzzles[0].ParamsJson, b.Puzzles[0].ParamsJson);
        var first = a.Puzzles[0].ParamsJson;
        PuzzleKindRegistry.FillMissing(a);
        Assert.Equal(first, a.Puzzles[0].ParamsJson);
        Assert.DoesNotContain("moves", a.Puzzles[0].ParamsJson);
        Assert.Contains("moves", a.Puzzles[0].SolutionJson);
    }

    [Fact]
    public void RawJsonConverter_RoundTripsObjectsThroughCaseJson()
    {
        var json = """{"puzzleId":"p","type":"INTERACTIVE_PUZZLE","kind":"tilt_maze","params":{"size":6},"solution":"{\"moves\":\"UR\"}"}""";
        var puzzle = JsonSerializer.Deserialize<CasePuzzle>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal("""{"size":6}""", puzzle.ParamsJson);
        Assert.Equal("""{"moves":"UR"}""", puzzle.SolutionJson);
        var back = JsonSerializer.Serialize(puzzle, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Contains("\"params\":{\"size\":6}", back);
    }
}
