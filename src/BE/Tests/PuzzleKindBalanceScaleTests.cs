using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>P7 · balance_scale: server-counted weighings, the final pick and the seeded re-roll.</summary>
public sealed class PuzzleKindBalanceScaleTests
{
    private static readonly BalanceScaleKind Kind = new();

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    private static PuzzleKindContext Make(int seed, string difficulty = PuzzleDifficulties.Easy, string? paramsJson = null, string? solutionJson = null)
    {
        // round-trip through JSON text like a stored case does
        var context = new PuzzleKindContext
        {
            PuzzleId = "scale",
            Difficulty = difficulty,
            Params = PuzzleKindRegistry.ParseObject(paramsJson ?? "{}"),
            Solution = PuzzleKindRegistry.ParseObject(solutionJson ?? "{}")
        };
        Kind.Generate(context, new Random(seed));
        return new PuzzleKindContext
        {
            PuzzleId = context.PuzzleId,
            Difficulty = context.Difficulty,
            Params = PuzzleKindRegistry.ParseObject(context.Params.ToJsonString()),
            Solution = PuzzleKindRegistry.ParseObject(context.Solution.ToJsonString())
        };
    }

    private static int Heavy(PuzzleKindContext context) => context.Solution["heavy"]!.GetValue<int>();

    private static string Weigh(PuzzleKindContext context, PuzzleRunState run, int[] left, int[] right)
    {
        var verdict = Kind.Probe(context, Json(JsonSerializer.Serialize(new { left, right })), run)!;
        Assert.False(verdict.Solved);
        Assert.False(verdict.CountsAsMistake);
        return verdict.Feedback!["res"]?.GetValue<string>() ?? "error:" + verdict.Feedback!["error"]!.GetValue<string>();
    }

    [Fact]
    public void Registry_DiscoversBalanceScale()
    {
        Assert.NotNull(PuzzleKindRegistry.Find("balance_scale"));
    }

    [Fact]
    public void Generate_IsDeterministicPerSeed_KeepsTheHeavyVialSecret_AndVariesBySeed()
    {
        var a = Make(5);
        var b = Make(5);
        Assert.Equal(a.Params.ToJsonString(), b.Params.ToJsonString());
        Assert.Equal(Heavy(a), Heavy(b));
        Assert.False(a.Params.ContainsKey("heavy"));
        Assert.DoesNotContain(a.Params.Select(pair => pair.Key), key => key.Contains("heavy", StringComparison.OrdinalIgnoreCase));
        var heavies = Enumerable.Range(1, 12).Select(seed => Heavy(Make(seed))).ToHashSet();
        Assert.True(heavies.Count >= 3, "different seeds should hide the powder in different vials");
        Assert.All(heavies, heavy => Assert.InRange(heavy, 1, 9));
        Assert.Equal(2, (a.Solution["hints"] as JsonArray)!.Count);
    }

    [Fact]
    public void Easy_GivesASpareToken_NormalAndHardGiveTheMinimum_AndAllValidate()
    {
        foreach (var (difficulty, tokens, perPan) in new[] { (PuzzleDifficulties.Easy, 3, 4), (PuzzleDifficulties.Normal, 2, 4), (PuzzleDifficulties.Hard, 2, 3) })
        {
            var context = Make(3, difficulty);
            Assert.Equal(9, context.Params["vials"]!.GetValue<int>());
            Assert.Equal(tokens, context.Params["tokens"]!.GetValue<int>());
            Assert.Equal(perPan, context.Params["perPan"]!.GetValue<int>());
            var errors = new List<string>();
            Kind.Validate(context, (field, message) => errors.Add(field + ": " + message));
            Assert.Empty(errors);
        }
    }

    [Fact]
    public void Generate_KeepsAuthoredValues()
    {
        var context = Make(1, PuzzleDifficulties.Easy, """{"vials":9,"tokens":2,"shop":"Hiệu thuốc Hưng Long"}""", """{"heavy":4}""");
        Assert.Equal(4, Heavy(context));
        Assert.Equal(2, context.Params["tokens"]!.GetValue<int>());
        Assert.Equal("Hiệu thuốc Hưng Long", context.Params["shop"]!.GetValue<string>());
    }

    [Fact]
    public void MinimumWeighings_MatchesTheClassicPuzzle()
    {
        Assert.Equal(2, BalanceScaleKind.MinimumWeighings(9, 4));
        Assert.Equal(2, BalanceScaleKind.MinimumWeighings(9, 3));
        Assert.Equal(1, BalanceScaleKind.MinimumWeighings(3, 1));
        Assert.Equal(4, BalanceScaleKind.MinimumWeighings(9, 1));
        Assert.Equal(0, BalanceScaleKind.MinimumWeighings(1, 4));
    }

    [Fact]
    public void Validate_RejectsUnsolvableOrLeakyDefinitions()
    {
        var errors = new List<string>();
        var context = new PuzzleKindContext
        {
            PuzzleId = "scale",
            Params = PuzzleKindRegistry.ParseObject("""{"vials":9,"tokens":1,"perPan":4,"heavy":3}"""),
            Solution = PuzzleKindRegistry.ParseObject("""{"heavy":12}""")
        };
        Kind.Validate(context, (field, message) => errors.Add(field));
        Assert.Contains("params.tokens", errors);
        Assert.Contains("params.heavy", errors);
        Assert.Contains("solution.heavy", errors);
    }

    [Fact]
    public void Probe_WeighsOnTheServer_AndCountsTokens()
    {
        var context = Make(7, PuzzleDifficulties.Normal, solutionJson: """{"heavy":7}""");
        var run = new PuzzleRunState();
        Assert.Equal("E", Weigh(context, run, new[] { 1, 2, 3 }, new[] { 4, 5, 6 }));
        Assert.Equal("L", Weigh(context, run, new[] { 7 }, new[] { 8 }));
        Assert.Equal(0, Kind.RunView(context, run)!["tokensLeft"]!.GetValue<int>());
        Assert.Equal(2, (Kind.RunView(context, run)!["log"] as JsonArray)!.Count);
        // no tokens left: refused, nothing changes
        Assert.Equal("error:notoken", Weigh(context, run, new[] { 1 }, new[] { 2 }));
        Assert.Equal(2, (Kind.RunView(context, run)!["log"] as JsonArray)!.Count);
    }

    [Fact]
    public void Probe_RefusesBadWeighings_WithoutSpendingATokenOrLeakingTheResult()
    {
        var context = Make(7, PuzzleDifficulties.Normal, solutionJson: """{"heavy":2}""");
        var run = new PuzzleRunState();
        Assert.Equal("error:uneq", Weigh(context, run, new[] { 1, 2 }, new[] { 3 }));
        Assert.Equal("error:empty", Weigh(context, run, Array.Empty<int>(), new[] { 3 }));
        Assert.Equal("error:full", Weigh(context, run, new[] { 1, 2, 3, 4, 5 }, new[] { 6, 7, 8, 9, 1 }));
        Assert.Equal("error:invalid", Weigh(context, run, new[] { 1, 2 }, new[] { 2, 3 }));
        Assert.Equal("error:invalid", Weigh(context, run, new[] { 0 }, new[] { 10 }));
        foreach (var bad in new[] { "{}", """{"left":"1","right":[2]}""", """{"left":[1.5],"right":[2]}""", """{"left":[1],"right":[null]}""" })
        {
            var verdict = Kind.Probe(context, Json(bad), run)!;
            Assert.Equal("invalid", verdict.Feedback!["error"]!.GetValue<string>());
            Assert.False(verdict.Feedback!.ContainsKey("res"));
        }
        Assert.Equal(2, Kind.RunView(context, run)!["tokensLeft"]!.GetValue<int>());
    }

    [Fact]
    public void Check_RightPickSolves_WrongPickRerollsTheHeavyVialAndReturnsTheTokens()
    {
        var context = Make(9, PuzzleDifficulties.Normal, solutionJson: """{"heavy":7}""");
        var run = new PuzzleRunState();
        Weigh(context, run, new[] { 1, 2, 3 }, new[] { 4, 5, 6 });
        var wrong = Kind.Check(context, Json("""{"pick":8}"""), run);
        Assert.False(wrong.Solved);
        Assert.True(wrong.CountsAsMistake);
        Assert.Equal(1, wrong.Feedback!["round"]!.GetValue<int>());
        Assert.Equal(2, wrong.Feedback!["tokensLeft"]!.GetValue<int>());
        Assert.False(wrong.Feedback!.ContainsKey("heavy"));
        var view = Kind.RunView(context, run)!;
        Assert.Equal(2, view["tokensLeft"]!.GetValue<int>());
        Assert.Empty((view["log"] as JsonArray)!);

        // the heavy vial moved (never to the vial just ruled out) and is the same for the same history
        var next = BalanceScaleKind.Reroll(context, 1, 9, 8);
        Assert.True(next != 8);
        Assert.Equal(next, BalanceScaleKind.Reroll(context, 1, 9, 8));
        var others = Enumerable.Range(1, 9).Where(id => id != next).ToList();
        Assert.False(Kind.Check(context, Json($$"""{"pick":{{others[0]}}}"""), CloneOf(run)).Solved);
        Assert.True(Kind.Check(context, Json($$"""{"pick":{{next}}}"""), run).Solved);
    }

    [Fact]
    public void Check_MalformedAnswersFailSafely()
    {
        var context = Make(2);
        var run = new PuzzleRunState();
        foreach (var bad in new[] { "{}", """{"pick":"7"}""", """{"pick":0}""", """{"pick":10}""", """{"pick":1.5}""", """{"pick":null}""", """{"pick":[7]}""", "[]", "7" })
        {
            var verdict = Kind.Check(context, Json(bad), run);
            Assert.False(verdict.Solved);
            Assert.False(verdict.CountsAsMistake);
        }
        Assert.False(run.Data.ContainsKey("round"));
        Assert.True(Kind.Check(context, Json($$"""{"pick":{{Heavy(context)}}}"""), run).Solved);
    }

    [Fact]
    public void TheClassicStrategy_FindsTheHeavyVial_WithTheGivenTokens_ForEveryPosition()
    {
        for (var heavy = 1; heavy <= 9; heavy++)
        {
            var context = Make(heavy, PuzzleDifficulties.Normal, solutionJson: $$"""{"heavy":{{heavy}}}""");
            var run = new PuzzleRunState();
            var first = Weigh(context, run, new[] { 1, 2, 3 }, new[] { 4, 5, 6 });
            var group = first == "L" ? new[] { 1, 2, 3 } : first == "R" ? new[] { 4, 5, 6 } : new[] { 7, 8, 9 };
            var second = Weigh(context, run, new[] { group[0] }, new[] { group[1] });
            var pick = second == "L" ? group[0] : second == "R" ? group[1] : group[2];
            Assert.True(Kind.Check(context, Json($$"""{"pick":{{pick}}}"""), run).Solved, $"heavy {heavy}");
        }
    }

    [Fact]
    public void FillMissing_GivesEachCaseItsOwnHeavyVial()
    {
        var heavies = new HashSet<string>();
        foreach (var id in new[] { "case-a", "case-b", "case-c", "case-d", "case-e" })
        {
            var gameCase = new GameCase
            {
                CaseId = id,
                Puzzles = { new CasePuzzle { PuzzleId = "scale", Type = CasePuzzleTypes.InteractivePuzzle, Kind = "balance_scale", Difficulty = "EASY" } }
            };
            PuzzleKindRegistry.FillMissing(gameCase);
            Assert.DoesNotContain("heavy", gameCase.Puzzles[0].ParamsJson);
            heavies.Add(gameCase.Puzzles[0].SolutionJson);
            var again = gameCase.Puzzles[0].SolutionJson;
            PuzzleKindRegistry.FillMissing(gameCase);
            Assert.Equal(again, gameCase.Puzzles[0].SolutionJson);
        }
        Assert.True(heavies.Count >= 2);
    }

    private static PuzzleRunState CloneOf(PuzzleRunState run) => new()
    {
        Attempts = run.Attempts,
        ProbesUsed = run.ProbesUsed,
        Data = new Dictionary<string, string>(run.Data)
    };
}
