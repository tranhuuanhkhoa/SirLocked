using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>P6 gear train: verified layout library, server-side mesh graph, per-case boards.</summary>
public sealed class PuzzleKindGearTrainTests
{
    private static readonly GearTrainKind Kind = new();

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    private static GearTrainKind.Board BoardOf(GearTrainKind.Layout layout) => new(
        GearTrainKind.DriveX, GearTrainKind.DriveY, GearTrainKind.DriveTeeth, GearTrainKind.OutX, GearTrainKind.OutY, GearTrainKind.OutTeeth,
        GearTrainKind.Module, GearTrainKind.Tolerance, GearTrainKind.Clearance,
        layout.Pegs.Select(peg => new GearTrainKind.Peg(peg.Id, peg.X, peg.Y)).ToList(),
        layout.Tray.Select(gear => new GearTrainKind.Gear(gear.Id, gear.Teeth, gear.Bent)).ToList());

    /// <summary>A mount as (peg, teeth) pairs, so swapping two identical gears counts as the same answer.</summary>
    private static HashSet<string> Core(GearTrainKind.Board board, Dictionary<string, string> mount) =>
        mount.Select(pair => $"{pair.Key}:{board.Tray.First(gear => gear.Id == pair.Value).Teeth}").ToHashSet();

    private static PuzzleKindContext Make(int seed, string difficulty = PuzzleDifficulties.Easy)
    {
        var context = new PuzzleKindContext { PuzzleId = "p", Difficulty = difficulty };
        Kind.Generate(context, new Random(seed));
        return context;
    }

    private static string MountJson(JsonObject? mount) => new JsonObject { ["mount"] = mount?.DeepClone() }.ToJsonString();

    [Fact]
    public void Registry_DiscoversGearTrain() => Assert.NotNull(PuzzleKindRegistry.Find("gear_train"));

    [Fact]
    public void EveryLibraryLayout_HasExactlyOneForwardTrain_AndABackwardsTrap()
    {
        foreach (var layout in GearTrainKind.Library)
        {
            var board = BoardOf(layout);
            var outcomes = GearTrainKind.AllMounts(board).Select(mount => (Mount: mount, Outcome: GearTrainKind.Run(board, mount))).ToList();
            var forward = outcomes.Where(item => item.Outcome == GearTrainKind.Outcome.Forward).Select(item => item.Mount).ToList();
            Assert.True(forward.Count > 0, $"{layout.Id}: no forward train");
            var solution = GearTrainKind.Solve(board)!;
            var core = Core(board, solution);
            Assert.Equal(3, core.Count);
            // every forward mount contains the same core (extra gears may only sit loose)
            Assert.All(forward, mount => Assert.True(core.IsSubsetOf(Core(board, mount)), $"{layout.Id}: second forward train {string.Join(",", Core(board, mount))}"));
            Assert.True(outcomes.Any(item => item.Outcome == GearTrainKind.Outcome.Backward), $"{layout.Id}: no backwards trap");
            // the bent gear never helps
            Assert.All(forward, mount => Assert.True(GearTrainKind.Route(board, mount).All(peg => board.Tray.First(gear => gear.Id == mount[peg]).Bent == false)));
            Assert.Equal(3, GearTrainKind.Route(board, solution).Count);
        }
        Assert.True(GearTrainKind.Library.Count(layout => layout.Difficulty == PuzzleDifficulties.Easy) >= 3);
        Assert.All(GearTrainKind.Library.Where(layout => layout.Difficulty == PuzzleDifficulties.Easy), layout => Assert.Equal(4, layout.Tray.Length));
    }

    [Fact]
    public void MockupBoard_LongWayRunsForward_ShortWayRunsBackwards()
    {
        var board = BoardOf(GearTrainKind.Library.Single(layout => layout.Id == "N1"));
        Assert.Equal(GearTrainKind.Outcome.Forward, GearTrainKind.Run(board, new Dictionary<string, string> { ["A"] = "M1", ["C"] = "L1", ["D"] = "M2" }));
        Assert.Equal(GearTrainKind.Outcome.Backward, GearTrainKind.Run(board, new Dictionary<string, string> { ["A"] = "M1", ["B"] = "L1" }));
        Assert.Equal(GearTrainKind.Outcome.Bent, GearTrainKind.Run(board, new Dictionary<string, string> { ["A"] = "X", ["C"] = "L1", ["D"] = "M2" }));
        Assert.Equal(GearTrainKind.Outcome.Open, GearTrainKind.Run(board, new Dictionary<string, string> { ["A"] = "M1" }));
        Assert.Equal(GearTrainKind.Outcome.Hit, GearTrainKind.Run(board, new Dictionary<string, string> { ["A"] = "L1" }));
    }

    [Fact]
    public void Generate_IsDeterministicPerSeed_Valid_AndKeepsTheSecretOutOfParams()
    {
        foreach (var difficulty in new[] { PuzzleDifficulties.Easy, PuzzleDifficulties.Normal, PuzzleDifficulties.Hard })
        {
            var a = Make(7, difficulty);
            Assert.Equal(a.Params.ToJsonString(), Make(7, difficulty).Params.ToJsonString());
            Assert.Equal(a.Solution.ToJsonString(), Make(7, difficulty).Solution.ToJsonString());
            var errors = new List<string>();
            Kind.Validate(a, (field, message) => errors.Add($"{field}: {message}"));
            Assert.Empty(errors);
            Assert.False(a.Params.ContainsKey("mount"));
            Assert.Equal(2, InteractivePuzzles.Hints(a).Count);
            Assert.True(Kind.Check(a, Json(MountJson(a.Solution["mount"] as JsonObject)), new PuzzleRunState()).Solved);
        }
        Assert.Equal(4, (Make(3).Params["tray"] as JsonArray)!.Count);
    }

    [Fact]
    public void Generate_DifferentSeedsGiveDifferentAnswers()
    {
        var answers = Enumerable.Range(1, 16).Select(seed => Make(seed).Solution["mount"]!.ToJsonString()).ToHashSet();
        Assert.True(answers.Count >= 3, $"only {answers.Count} different answers");
        var layouts = Enumerable.Range(1, 16).Select(seed => PuzzleJson.Text(Make(seed).Params, "layout")).ToHashSet();
        Assert.Equal(3, layouts.Count);
    }

    [Fact]
    public void Check_RunsTheTrainOnTheServer()
    {
        var context = Make(5, PuzzleDifficulties.Normal);
        var run = new PuzzleRunState();
        var mount = (JsonObject)context.Solution["mount"]!;
        Assert.True(Kind.Check(context, Json(MountJson(mount)), run).Solved);

        // swapping in the bent gear for a 16-tooth gear on the route jams the machine
        var board = GearTrainKind.Read(context.Params);
        var dict = mount.ToDictionary(pair => pair.Key, pair => pair.Value!.GetValue<string>());
        var sixteen = dict.FirstOrDefault(pair => board.Tray.First(gear => gear.Id == pair.Value).Teeth == 16 && !board.Tray.First(gear => gear.Id == pair.Value).Bent);
        if (sixteen.Key is not null)
        {
            var bent = new JsonObject();
            foreach (var (peg, gear) in dict) bent[peg] = peg == sixteen.Key ? "X" : gear;
            var verdict = Kind.Check(context, Json(MountJson(bent)), run);
            Assert.False(verdict.Solved);
            Assert.Equal("bent", PuzzleJson.Text(verdict.Feedback!, "result"));
            Assert.True(verdict.CountsAsMistake);
        }

        // a backwards train fails
        var backward = GearTrainKind.AllMounts(board).First(item => GearTrainKind.Run(board, item) == GearTrainKind.Outcome.Backward);
        var back = new JsonObject();
        foreach (var (peg, gear) in backward) back[peg] = gear;
        var backVerdict = Kind.Check(context, Json(MountJson(back)), run);
        Assert.False(backVerdict.Solved);
        Assert.Equal("backward", PuzzleJson.Text(backVerdict.Feedback!, "result"));

        // turning a crank that drives nothing is not a mistake
        var open = Kind.Check(context, Json("""{"mount":{}}"""), run);
        Assert.False(open.Solved);
        Assert.Equal("open", PuzzleJson.Text(open.Feedback!, "result"));
        Assert.False(open.CountsAsMistake);
    }

    [Fact]
    public void MalformedAnswers_FailSafely()
    {
        var context = Make(9);
        var run = new PuzzleRunState();
        var gear = (context.Params["tray"] as JsonArray)![0]!["id"]!.GetValue<string>();
        foreach (var json in new[]
                 {
                     """{}""", """{"mount":[]}""", """{"mount":"A"}""", """{"mount":{"Z":"M1"}}""", "{\"mount\":{\"A\":\"" + gear + "\",\"B\":\"" + gear + "\"}}",
                     """{"mount":{"A":"nope"}}""", """{"mount":{"A":7}}""", """{"mount":{"A":{"id":"M1"}}}""", """[1,2]"""
                 })
        {
            var verdict = Kind.Check(context, Json(json), run);
            Assert.False(verdict.Solved);
            Assert.NotNull(verdict.Feedback);
        }
        var broken = new PuzzleKindContext { PuzzleId = "p", Params = JsonNode.Parse("""{"pegs":"x"}""")!.AsObject() };
        Assert.False(Kind.Check(broken, Json("""{"mount":{}}"""), run).Solved);
        var errors = new List<string>();
        Kind.Validate(broken, (field, message) => errors.Add(field));
        Assert.NotEmpty(errors);
    }

    [Fact]
    public void FillMissing_GivesCasesDifferentBoards_AndKeepsAuthoredValues()
    {
        GameCase Case(string id, string? paramsJson = null) => new()
        {
            CaseId = id,
            Puzzles = { new CasePuzzle { PuzzleId = "clock", Type = CasePuzzleTypes.InteractivePuzzle, Kind = "gear_train", ParamsJson = paramsJson ?? string.Empty } }
        };
        var boards = new[] { "a", "b", "c", "d", "e", "f" }.Select(id =>
        {
            var gameCase = Case(id);
            PuzzleKindRegistry.FillMissing(gameCase);
            return gameCase.Puzzles[0].ParamsJson;
        }).ToHashSet();
        Assert.True(boards.Count >= 2);
        var authored = Case("x", """{"targetMin":640,"maker":{"name":"XƯỞNG ĐỒNG HỒ HÀNG ĐƯỜNG"}}""");
        PuzzleKindRegistry.FillMissing(authored);
        var p = JsonNode.Parse(authored.Puzzles[0].ParamsJson)!.AsObject();
        Assert.Equal(640, PuzzleJson.Int(p, "targetMin"));
        Assert.Equal("XƯỞNG ĐỒNG HỒ HÀNG ĐƯỜNG", PuzzleJson.Text((JsonObject)p["maker"]!, "name"));
        Assert.True(p.ContainsKey("pegs"));
    }
}
