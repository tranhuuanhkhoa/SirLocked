using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>P1 · lockpick: per-case binding order, binding-pin probe, answer check.</summary>
public sealed class PuzzleKindLockpickTests
{
    private static readonly LockpickKind Kind = new();

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    private static PuzzleKindContext Make(int seed, string difficulty = PuzzleDifficulties.Easy, string? paramsJson = null)
    {
        var context = new PuzzleKindContext
        {
            PuzzleId = "p",
            Difficulty = difficulty,
            Params = paramsJson is null ? new JsonObject() : JsonNode.Parse(paramsJson)!.AsObject()
        };
        Kind.Generate(context, new Random(seed));
        return context;
    }

    private static List<int> Order(PuzzleKindContext context) => PuzzleJson.Ints(context.Solution, "order");

    private static string OrderAnswer(IEnumerable<int> order) => $$"""{"order":[{{string.Join(",", order)}}]}""";

    [Fact]
    public void Registry_DiscoversLockpick()
    {
        Assert.NotNull(PuzzleKindRegistry.Find("lockpick"));
        Assert.True(PuzzleKindRegistry.Find("LOCKPICK") is LockpickKind);
    }

    [Fact]
    public void Generate_Easy_IsAGenuinelyEasyFourPinLock()
    {
        for (var seed = 1; seed <= 40; seed++)
        {
            var context = Make(seed);
            var errors = new List<string>();
            Kind.Validate(context, (field, message) => errors.Add($"{field}: {message}"));
            Assert.Empty(errors);
            Assert.Equal(4, PuzzleJson.Int(context.Params, "pinCount"));
            Assert.Equal(6, PuzzleJson.Int(context.Params, "win"));
            Assert.Equal(10, PuzzleJson.Int(context.Params, "over"));
            Assert.True(PuzzleJson.Int(context.Params, "win") + PuzzleJson.Int(context.Params, "over") < 20, "an overset jam must stay possible");
            var needs = PuzzleJson.Ints(context.Params, "needs");
            Assert.Equal(4, needs.Count);
            Assert.All(needs, need => Assert.InRange(need, 12, 34));
            var sorted = needs.OrderBy(value => value).ToList();
            Assert.True(sorted.Zip(sorted.Skip(1), (a, b) => b - a).All(gap => gap >= 4), "needs must be ≥ 4 apart");
            Assert.Equal(new[] { 1, 2, 3, 4 }, Order(context).OrderBy(value => value).ToArray());
            Assert.Equal(2, InteractivePuzzles.Hints(context).Count);
        }
    }

    [Fact]
    public void Generate_HarderLocksHaveMorePinsAndTighterWindows()
    {
        var normal = Make(3, PuzzleDifficulties.Normal);
        var hard = Make(3, PuzzleDifficulties.Hard);
        Assert.Equal(5, PuzzleJson.Int(normal.Params, "pinCount"));
        Assert.Equal(6, PuzzleJson.Int(hard.Params, "pinCount"));
        Assert.True(PuzzleJson.Int(hard.Params, "win") < PuzzleJson.Int(normal.Params, "win"));
        foreach (var context in new[] { normal, hard })
        {
            var errors = new List<string>();
            Kind.Validate(context, (field, message) => errors.Add(message));
            Assert.Empty(errors);
        }
    }

    [Fact]
    public void Generate_IsDeterministicPerSeed_AndSeedsGiveDifferentOrders()
    {
        Assert.Equal(Make(7).Params.ToJsonString(), Make(7).Params.ToJsonString());
        Assert.Equal(Make(7).Solution.ToJsonString(), Make(7).Solution.ToJsonString());
        var orders = Enumerable.Range(1, 12).Select(seed => string.Join(",", Order(Make(seed)))).Distinct().Count();
        Assert.True(orders >= 6, $"only {orders} distinct binding orders over 12 seeds");
        Assert.False(Make(7).Params.ToJsonString().Contains("order"), "the binding order must stay out of params");
    }

    [Fact]
    public void Generate_KeepsAuthoredValues()
    {
        var context = Make(5, paramsJson: """{"needs":[14,30,22],"win":5}""");
        Assert.Equal(3, PuzzleJson.Int(context.Params, "pinCount"));
        Assert.Equal(new[] { 14, 30, 22 }, PuzzleJson.Ints(context.Params, "needs").ToArray());
        Assert.Equal(5, PuzzleJson.Int(context.Params, "win"));
        var again = context.Params.ToJsonString() + context.Solution.ToJsonString();
        Kind.Generate(context, new Random(99));
        Assert.Equal(again, context.Params.ToJsonString() + context.Solution.ToJsonString());
    }

    [Fact]
    public void Check_TheBindingOrderSolves_AnyOtherOrderFails()
    {
        var context = Make(11);
        var order = Order(context);
        var run = new PuzzleRunState();
        var verdict = Kind.Check(context, Json(OrderAnswer(order)), run);
        Assert.True(verdict.Solved);
        var reversed = order.AsEnumerable().Reverse().ToList();
        var wrong = Kind.Check(context, Json(OrderAnswer(reversed)), run);
        Assert.False(wrong.Solved);
        Assert.True(wrong.CountsAsMistake);
        Assert.Equal("order", wrong.Feedback!["reason"]!.GetValue<string>());
        Assert.False(wrong.Feedback.ToJsonString().Contains(string.Join(",", order)));
    }

    [Fact]
    public void Check_MalformedAnswersFailSafely()
    {
        var context = Make(11);
        var run = new PuzzleRunState();
        foreach (var json in new[]
        {
            "{}", """{"order":"3142"}""", """{"order":[1,2,3]}""", """{"order":[1,1,2,3]}""", """{"order":[0,1,2,3]}""",
            """{"order":[1,2,3,4,5]}""", """{"order":[1.5,2,3,4]}""", """{"order":["1","2","3","4"]}""", """{"order":null}""",
            """{"order":[[1],[2],[3],[4]]}""", """{"other":[1,2,3,4]}"""
        })
        {
            var verdict = Kind.Check(context, Json(json), run);
            Assert.False(verdict.Solved);
            Assert.False(verdict.CountsAsMistake);
        }
    }

    [Fact]
    public void Probe_OnlyTheFirstUnsetPinInTheOrderBinds()
    {
        var context = Make(21);
        var order = Order(context);
        var run = new PuzzleRunState();
        for (var step = 0; step < order.Count; step++)
        {
            var set = order.Take(step).ToList();
            foreach (var pin in Enumerable.Range(1, order.Count).Where(pin => !set.Contains(pin)))
            {
                var verdict = Kind.Probe(context, Json($$"""{"set":[{{string.Join(",", set)}}],"pin":{{pin}}}"""), run)!;
                Assert.False(verdict.Solved);
                Assert.False(verdict.CountsAsMistake);
                Assert.Equal(pin == order[step], verdict.Feedback!["binds"]!.GetValue<bool>());
            }
        }
        // A set that is not a prefix of the binding order never binds anything.
        var notPrefix = $$"""{"set":[{{order[1]}}],"pin":{{order[0]}}}""";
        Assert.False(Kind.Probe(context, Json(notPrefix), run)!.Feedback!["binds"]!.GetValue<bool>());
    }

    [Fact]
    public void Probe_MalformedInputFailsSafely()
    {
        var context = Make(21);
        var run = new PuzzleRunState();
        foreach (var json in new[]
        {
            "{}", """{"set":[],"pin":0}""", """{"set":[],"pin":9}""", """{"set":"x","pin":1}""", """{"set":[1,1],"pin":2}""",
            """{"set":[2],"pin":2}""", """{"set":[1,2,3,4],"pin":1}""", """{"set":[],"pin":"1"}""", """{"set":[9],"pin":1}"""
        })
        {
            var verdict = Kind.Probe(context, Json(json), run)!;
            Assert.False(verdict.Solved);
            Assert.Equal("invalid", verdict.Feedback!["reason"]!.GetValue<string>());
        }
    }

    [Fact]
    public void FillMissing_GivesEachCaseItsOwnBindingOrder()
    {
        var orders = new HashSet<string>();
        for (var i = 0; i < 8; i++)
        {
            var gameCase = new GameCase
            {
                CaseId = $"case-{i}",
                Puzzles = { new CasePuzzle { PuzzleId = "hom-sat", Type = CasePuzzleTypes.InteractivePuzzle, Kind = "lockpick", Difficulty = "EASY" } }
            };
            PuzzleKindRegistry.FillMissing(gameCase);
            Assert.False(gameCase.Puzzles[0].ParamsJson.Contains("order"));
            orders.Add(JsonNode.Parse(gameCase.Puzzles[0].SolutionJson)!["order"]!.ToJsonString());
        }
        Assert.True(orders.Count >= 4, $"only {orders.Count} distinct orders over 8 cases");
    }
}
