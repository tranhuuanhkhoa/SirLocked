using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>P8 · parallax_code: per-case characters and viewpoints, stroke alignment, code check, lockout.</summary>
public sealed class PuzzleKindParallaxCodeTests
{
    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    private static PuzzleKindContext Make(int seed, string difficulty = PuzzleDifficulties.Easy, string? paramsJson = null, string? solutionJson = null)
    {
        var context = new PuzzleKindContext
        {
            PuzzleId = "parallax",
            Difficulty = difficulty,
            Params = PuzzleKindRegistry.ParseObject(paramsJson ?? "{}"),
            Solution = PuzzleKindRegistry.ParseObject(solutionJson ?? "{}")
        };
        new ParallaxCodeKind().Generate(context, new Random(seed));
        // stored cases are JSON text: read it back the same way
        return new PuzzleKindContext
        {
            PuzzleId = context.PuzzleId,
            Difficulty = context.Difficulty,
            Params = PuzzleKindRegistry.ParseObject(context.Params.ToJsonString()),
            Solution = PuzzleKindRegistry.ParseObject(context.Solution.ToJsonString()),
            Reveal = PuzzleKindRegistry.ParseObject(context.Reveal.ToJsonString())
        };
    }

    private static string Code(PuzzleKindContext context) => context.Solution["code"]!.GetValue<string>();

    private sealed class FakeClock
    {
        public DateTime Now = new(2026, 10, 25, 12, 0, 0, DateTimeKind.Utc);
    }

    [Fact]
    public void Registry_DiscoversParallaxCode()
    {
        Assert.NotNull(PuzzleKindRegistry.Find("parallax_code"));
    }

    [Fact]
    public void Generate_IsDeterministicPerSeed_AndDifferentSeedsGiveDifferentCodesAndViewpoints()
    {
        var a = Make(21);
        var b = Make(21);
        Assert.Equal(a.Params.ToJsonString(), b.Params.ToJsonString());
        Assert.Equal(Code(a), Code(b));
        var codes = Enumerable.Range(1, 10).Select(seed => Code(Make(seed))).ToHashSet();
        Assert.True(codes.Count >= 8, "different seeds should give different codes");
        Assert.NotEqual(a.Params["views"]!.ToJsonString(), Make(22).Params["views"]!.ToJsonString());
        foreach (var code in codes)
        {
            Assert.Equal(3, code.Length);
            Assert.Equal(3, code.Distinct().Count());
            Assert.All(code, ch => Assert.True(ParallaxCodeKind.Glyphs.ContainsKey(ch)));
        }
    }

    [Fact]
    public void Params_NeverCarryTheCode()
    {
        for (var seed = 1; seed <= 6; seed++)
        {
            var context = Make(seed, PuzzleDifficulties.Normal);
            var json = context.Params.ToJsonString();
            Assert.False(context.Params.ContainsKey("code"));
            Assert.DoesNotContain("\"" + Code(context) + "\"", json);
            Assert.DoesNotContain("\"char", json);
            Assert.DoesNotContain("\"glyph", json);
        }
    }

    [Fact]
    public void EveryDifficulty_Validates_AndEasyIsMoreForgiving()
    {
        foreach (var difficulty in new[] { PuzzleDifficulties.Easy, PuzzleDifficulties.Normal, PuzzleDifficulties.Hard })
        for (var seed = 1; seed <= 15; seed++)
        {
            var context = Make(seed, difficulty);
            var errors = new List<string>();
            new ParallaxCodeKind().Validate(context, (field, message) => errors.Add(field + ": " + message));
            Assert.Empty(errors);
        }
        var easy = Make(4, PuzzleDifficulties.Easy);
        var hard = Make(4, PuzzleDifficulties.Hard);
        Assert.True(easy.Params["snap"]!.GetValue<double>() > hard.Params["snap"]!.GetValue<double>());
        Assert.True(easy.Params["glimmer"]!.GetValue<double>() > hard.Params["glimmer"]!.GetValue<double>());
        Assert.Equal(2, (easy.Solution["hints"] as JsonArray)!.Count);
    }

    [Fact]
    public void Strokes_JoinIntoTheCharacter_OnlyAtTheirViewpoint()
    {
        foreach (var difficulty in new[] { PuzzleDifficulties.Easy, PuzzleDifficulties.Normal, PuzzleDifficulties.Hard })
        for (var seed = 1; seed <= 8; seed++)
        {
            var p = Make(seed, difficulty).Params;
            var depth = p["depth"]!.AsObject();
            var views = p["views"]!.AsArray();
            var slots = p["slots"]!.AsArray();
            for (var s = 0; s < 3; s++)
            {
                var (tx, ty) = (views[s]![0]!.GetValue<double>(), views[s]![1]!.GetValue<double>());
                var (sx, sy) = (slots[s]!["at"]![0]!.GetValue<double>(), slots[s]!["at"]![1]!.GetValue<double>());
                // every piece of this character, as seen from its viewpoint and from the middle of the room
                var pieces = new List<(string Layer, List<(double X, double Y)> AtTarget, List<(double X, double Y)> AtStart)>();
                foreach (var (layer, list) in p["paint"]!.AsObject())
                foreach (var piece in list!.AsArray().Where(piece => piece!["g"]!.GetValue<int>() == s))
                {
                    var f = depth[layer]!.GetValue<double>();
                    var drawn = Points(piece!["d"]!.GetValue<string>()).ToList();
                    pieces.Add((layer, drawn.Select(pt => (pt.X - tx * ParallaxCodeKind.AmpX * f, pt.Y - ty * ParallaxCodeKind.AmpY * f)).ToList(), drawn));
                }
                Assert.True(pieces.Select(piece => piece.Layer).Distinct().Count() >= 3, "a character must be split over at least three depth layers");
                // seen from its viewpoint, every piece lands inside the character's box around its object
                Assert.All(pieces.SelectMany(piece => piece.AtTarget), pt =>
                {
                    Assert.InRange(pt.X, sx - 40, sx + 40);
                    Assert.InRange(pt.Y, sy - 52, sy + 52);
                });
                // joints between pieces on different layers close at the viewpoint and open up from the start view
                var widest = 0.0;
                var joints = 0;
                for (var i = 0; i < pieces.Count; i++)
                for (var j = i + 1; j < pieces.Count; j++)
                {
                    if (pieces[i].Layer == pieces[j].Layer) continue;
                    foreach (var (a, ka) in pieces[i].AtTarget.Select((pt, k) => (pt, k)))
                    foreach (var (b, kb) in pieces[j].AtTarget.Select((pt, k) => (pt, k)))
                    {
                        if (Distance(a, b) > 6) continue;
                        joints++;
                        widest = Math.Max(widest, Distance(pieces[i].AtStart[ka], pieces[j].AtStart[kb]));
                    }
                }
                Assert.True(joints >= 1, "pieces on different layers must meet");
                Assert.True(widest >= 15, $"the character must fall apart away from its viewpoint ({widest:0.0}px)");
            }
        }
    }

    private static double Distance((double X, double Y) a, (double X, double Y) b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));

    [Fact]
    public void Check_RightCodeSolves_InAnyCaseAndWithSeparators_AndWithSlotReferences()
    {
        var context = Make(3);
        var code = Code(context);
        var kind = new ParallaxCodeKind();
        Assert.True(kind.Check(context, Json($$"""{"code":"{{code}}"}"""), new PuzzleRunState()).Solved);
        Assert.True(kind.Check(context, Json($$"""{"code":"{{string.Join(" · ", code.ToLowerInvariant().ToCharArray())}}"}"""), new PuzzleRunState()).Solved);

        // "@slot" = whatever is painted on that object: the clue's order of objects is the code order
        var order = context.Params["order"]!.AsArray().Select(node => "\"@" + node!.GetValue<string>() + "\"");
        Assert.True(kind.Check(context, Json($$"""{"code":[{{string.Join(",", order)}}]}"""), new PuzzleRunState()).Solved);
        var mixed = $$"""{"code":["{{code[0]}}","@{{context.Params["order"]![1]!.GetValue<string>()}}","{{code[2]}}"]}""";
        Assert.True(kind.Check(context, Json(mixed), new PuzzleRunState()).Solved);
    }

    [Fact]
    public void Check_WrongCode_ReportsOnlyTheFirstWrongCell()
    {
        var context = Make(5, PuzzleDifficulties.Normal, solutionJson: """{"code":"74N"}""");
        Assert.Equal("74N", Code(context));
        var kind = new ParallaxCodeKind();
        var run = new PuzzleRunState();
        var verdict = kind.Check(context, Json("""{"code":"7N4"}"""), run);
        Assert.False(verdict.Solved);
        Assert.True(verdict.CountsAsMistake);
        Assert.Equal(1, verdict.Feedback!["firstWrong"]!.GetValue<int>());
        Assert.DoesNotContain("74N", verdict.Feedback!.ToJsonString());
        Assert.DoesNotContain("74N", verdict.Message ?? string.Empty);
        Assert.Equal(0, kind.Check(context, Json("""{"code":"A4N"}"""), run).Feedback!["firstWrong"]!.GetValue<int>());
        // wrong slot reference
        var slots = context.Params["order"]!.AsArray().Select(node => node!.GetValue<string>()).ToList();
        var swapped = $$"""{"code":["@{{slots[1]}}","@{{slots[0]}}","@{{slots[2]}}"]}""";
        Assert.False(new ParallaxCodeKind().Check(context, Json(swapped), new PuzzleRunState()).Solved);
    }

    [Fact]
    public void Check_MalformedAnswersFailSafely()
    {
        var context = Make(6);
        var kind = new ParallaxCodeKind();
        foreach (var bad in new[]
                 {
                     "{}", """{"code":""}""", """{"code":"74"}""", """{"code":"74NX"}""", """{"code":742}""", """{"code":null}""",
                     """{"code":["7","4"]}""", """{"code":["7","4",5]}""", """{"code":["77","4","N"]}""", """{"code":["@nope","4","N"]}""",
                     """{"code":{"a":1}}""", "[]", "\"74N\""
                 })
        {
            var run = new PuzzleRunState();
            var verdict = kind.Check(context, Json(bad), run);
            Assert.False(verdict.Solved);
            Assert.False(verdict.CountsAsMistake);
            Assert.False(run.Data.ContainsKey("wrong"));
        }
    }

    [Fact]
    public void RepeatedWrongCodes_JamTheLock_ForAFewSeconds()
    {
        var clock = new FakeClock();
        var kind = new ParallaxCodeKind { Clock = () => clock.Now };
        var context = Make(7, solutionJson: """{"code":"KT4"}""");
        var run = new PuzzleRunState();
        Assert.False(kind.Check(context, Json("""{"code":"AAA"}"""), run).Feedback!.ContainsKey("wait"));
        Assert.False(kind.Check(context, Json("""{"code":"AAA"}"""), run).Feedback!.ContainsKey("wait"));
        var third = kind.Check(context, Json("""{"code":"AAA"}"""), run);
        Assert.Equal(5, third.Feedback!["wait"]!.GetValue<int>());

        // while jammed even the right code is refused, and it is not a mistake
        var jammed = kind.Check(context, Json("""{"code":"KT4"}"""), run);
        Assert.False(jammed.Solved);
        Assert.False(jammed.CountsAsMistake);
        Assert.True(jammed.Feedback!["locked"]!.GetValue<bool>());
        Assert.InRange(jammed.Feedback!["wait"]!.GetValue<int>(), 1, 5);

        clock.Now = clock.Now.AddSeconds(6);
        var fourth = kind.Check(context, Json("""{"code":"AAA"}"""), run);
        Assert.Equal(10, fourth.Feedback!["wait"]!.GetValue<int>());
        clock.Now = clock.Now.AddSeconds(11);
        Assert.True(kind.Check(context, Json("""{"code":"kt4"}"""), run).Solved);
    }

    [Fact]
    public void Authored_Code_And_Text_AreKept_AndBadAuthoredCodesAreReported()
    {
        var context = Make(1, PuzzleDifficulties.Easy, """{"frameLabel":"PHÔNG CHỤP","views":[[-0.7,0.4],[0.35,0.45],[0.95,0.6]]}""", """{"code":"74N"}""");
        Assert.Equal("74N", Code(context));
        Assert.Equal("PHÔNG CHỤP", context.Params["frameLabel"]!.GetValue<string>());
        Assert.Equal(0.95, context.Params["views"]![2]![0]!.GetValue<double>());
        Assert.Equal("Mã: 7 4 N", context.Reveal["title"]!.GetValue<string>());

        var errors = new List<string>();
        var bad = Make(1);
        bad.Solution["code"] = "7Q";
        bad.Params["views"] = JsonNode.Parse("[[0.05,0.05],[0.4,0.4],[0.42,0.41]]");
        new ParallaxCodeKind().Validate(bad, (field, message) => errors.Add(field));
        Assert.Contains("solution.code", errors);
        Assert.Contains("params.views[0]", errors);
        Assert.Contains("params.views[2]", errors);
    }

    [Fact]
    public void Reveal_CanQuoteTheCode_OnlyInTheRevealSentAfterSolving()
    {
        var context = new PuzzleKindContext
        {
            PuzzleId = "parallax",
            Reveal = PuzzleKindRegistry.ParseObject("""{"title":"Mã két: {code}","text":"Ba ký tự {code}."}"""),
            Solution = PuzzleKindRegistry.ParseObject("""{"code":"KT4"}""")
        };
        new ParallaxCodeKind().Generate(context, new Random(3));
        Assert.Equal("Mã két: K T 4", context.Reveal["title"]!.GetValue<string>());
        Assert.Equal("Ba ký tự K T 4.", context.Reveal["text"]!.GetValue<string>());
        Assert.Equal("sách", context.Params["slots"]![0]!["short"]!.GetValue<string>());
        Assert.DoesNotContain("KT4", context.Params.ToJsonString());
    }

    [Fact]
    public void FillMissing_GivesEachCaseItsOwnCode()
    {
        var codes = new HashSet<string>();
        foreach (var id in new[] { "case-a", "case-b", "case-c" })
        {
            var gameCase = new GameCase
            {
                CaseId = id,
                Puzzles = { new CasePuzzle { PuzzleId = "goc-nhin", Type = CasePuzzleTypes.InteractivePuzzle, Kind = "parallax_code", Difficulty = "EASY" } }
            };
            PuzzleKindRegistry.FillMissing(gameCase);
            var solution = PuzzleKindRegistry.ParseObject(gameCase.Puzzles[0].SolutionJson);
            codes.Add(solution["code"]!.GetValue<string>());
            Assert.DoesNotContain("\"code\"", gameCase.Puzzles[0].ParamsJson);
        }
        Assert.Equal(3, codes.Count);
    }

    private static IEnumerable<(double X, double Y)> Points(string d) =>
        Regex.Matches(d, @"[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)").Select(match =>
            (double.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture), double.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture)));
}
