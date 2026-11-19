using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// P9 · tilt_maze: what the frontend relies on (the socket is boxed in by three walls and the gate, every
/// generated level is solvable with the lever, falls replay correctly) — complements PuzzleKindTests.
/// </summary>
public sealed class PuzzleKindTiltMazeTests
{
    private static readonly TiltMazeKind Kind = new();

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    private static PuzzleKindContext Make(int seed, string difficulty)
    {
        var context = new PuzzleKindContext { PuzzleId = "maze", Difficulty = difficulty };
        Kind.Generate(context, new Random(seed));
        return new PuzzleKindContext
        {
            PuzzleId = "maze",
            Difficulty = difficulty,
            Params = PuzzleKindRegistry.ParseObject(context.Params.ToJsonString()),
            Solution = PuzzleKindRegistry.ParseObject(context.Solution.ToJsonString())
        };
    }

    [Fact]
    public void GeneratedLevels_BoxTheSocketWithThreeWallsAndTheGate_AndNeedTheLever()
    {
        foreach (var difficulty in new[] { PuzzleDifficulties.Easy, PuzzleDifficulties.Normal, PuzzleDifficulties.Hard })
        for (var seed = 1; seed <= 25; seed++)
        {
            var context = Make(seed, difficulty);
            var level = TiltMazeKind.Read(context.Params);
            Assert.Equal(difficulty == PuzzleDifficulties.Easy ? 6 : 7, level.Size);
            var (r, c) = level.Socket;
            bool Touches((int R1, int C1, int R2, int C2) e) => (e.R1 == r && e.C1 == c) || (e.R2 == r && e.C2 == c);
            Assert.True(Touches(level.Gate), "the gate is one side of the socket");
            Assert.Equal(3, level.Walls.Count(Touches));
            var moves = context.Solution["moves"]!.GetValue<string>();
            Assert.True(Kind.Check(context, Json($$"""{"moves":"{{moves}}"}"""), new PuzzleRunState()).Solved);
            // without the lever the gate never opens
            var noLever = level with { Lever = (-5, -5) };
            Assert.Null(TiltMazeKind.Solve(noLever));
        }
    }

    [Fact]
    public void Replay_HandlesFallsAndBlockedTilts_LikeTheBoard()
    {
        // the mockup level (PuzzleTiltMaze.dc.html)
        var context = new PuzzleKindContext
        {
            PuzzleId = "p",
            Params = PuzzleKindRegistry.ParseObject("""
            {"size":7,"start":[6,0],"socket":[3,3],"lever":[1,1],"holes":[[3,5],[4,2],[6,4]],"gate":[3,3,4,3],
             "walls":[[0,5,1,5],[1,4,1,5],[1,4,2,4],[1,5,2,5],[2,0,2,1],[2,2,2,3],[2,2,3,2],[2,3,3,3],[2,6,3,6],
                      [3,2,3,3],[3,3,3,4],[4,1,4,2],[4,0,5,0],[4,5,5,5],[5,1,5,2],[5,4,5,5],[6,3,6,4]]}
            """)
        };
        var level = TiltMazeKind.Read(context.Params);
        // a blocked tilt (L at the start, against the rim) changes nothing
        var blocked = TiltMazeKind.Slide(level, 6, 0, false, 'L');
        Assert.Equal(TiltMazeKind.SlideKind.Stop, blocked.Kind);
        Assert.Equal((6, 0), (blocked.R, blocked.C));
        // R from the start stops at the wall (6,3)|(6,4), just before the hole at (6,4)
        var right = TiltMazeKind.Slide(level, 6, 0, false, 'R');
        Assert.Equal((6, 3), (right.R, right.C));
        // a history with blocked tilts and a detour still solves when it ends with the solution from the start
        Assert.True(Kind.Check(context, Json("""{"moves":"LLURULDRDRU"}"""), new PuzzleRunState()).Solved);
        var verdict = Kind.Check(context, Json("""{"moves":"URUL"}"""), new PuzzleRunState());
        Assert.False(verdict.Solved);
        Assert.Equal(0, verdict.Feedback!["falls"]!.GetValue<int>());

        // find a short tilt sequence that drops the ball into a hole: it goes back to the start, gate shut
        string? fall = null;
        var queue = new Queue<(int R, int C, bool Gate, string Path)>();
        queue.Enqueue((6, 0, false, string.Empty));
        while (queue.Count > 0 && fall is null)
        {
            var (r, c, gate, path) = queue.Dequeue();
            if (path.Length >= 5) continue;
            foreach (var move in "UDLR")
            {
                var result = TiltMazeKind.Slide(level, r, c, gate, move);
                if (result.Kind == TiltMazeKind.SlideKind.Hole) { fall = path + move; break; }
                if (result.Kind == TiltMazeKind.SlideKind.Stop) queue.Enqueue((result.R, result.C, result.Gate, path + move));
            }
        }
        Assert.NotNull(fall);
        var fell = Kind.Check(context, Json($$"""{"moves":"{{fall}}"}"""), new PuzzleRunState());
        Assert.Equal(1, fell.Feedback!["falls"]!.GetValue<int>());
        Assert.Equal(6, fell.Feedback!["r"]!.GetValue<int>());
        Assert.Equal(0, fell.Feedback!["c"]!.GetValue<int>());
        Assert.False(fell.Feedback!["gate"]!.GetValue<bool>());
        Assert.True(Kind.Check(context, Json($$"""{"moves":"{{fall}}URULDRDRU"}"""), new PuzzleRunState()).Solved);
    }
}
