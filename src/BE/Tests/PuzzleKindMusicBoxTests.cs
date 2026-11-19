using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>P5 music box: per-case melody, postcard with smudged notes, server-side playback.</summary>
public sealed class PuzzleKindMusicBoxTests
{
    private static readonly MusicBoxKind Kind = new();

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

    private static List<int> Melody(PuzzleKindContext context) => PuzzleJson.Ints(context.Solution, "melody");

    private static string Pins(IEnumerable<int> pins) => $$"""{"pins":[{{string.Join(",", pins)}}]}""";

    /// <summary>The design mockup's tune: MI · SON · LA · SON · MI · RÊ · ĐỒ · MI, last three smudged.</summary>
    private static PuzzleKindContext Mockup() => new()
    {
        PuzzleId = "p",
        Params = JsonNode.Parse("""{"beats":8,"known":[3,2,1,2,3,0,0,0],"quote":"…"}""")!.AsObject(),
        Solution = JsonNode.Parse("""{"melody":[3,2,1,2,3,4,5,3]}""")!.AsObject()
    };

    [Fact]
    public void Registry_DiscoversMusicBox() => Assert.NotNull(PuzzleKindRegistry.Find("music_box"));

    [Fact]
    public void Generate_IsDeterministicPerSeed_AndValid()
    {
        var a = Make(11);
        var b = Make(11);
        Assert.Equal(a.Params.ToJsonString(), b.Params.ToJsonString());
        Assert.Equal(a.Solution.ToJsonString(), b.Solution.ToJsonString());
        var errors = new List<string>();
        Kind.Validate(a, (field, message) => errors.Add($"{field}: {message}"));
        Assert.Empty(errors);
    }

    [Fact]
    public void Generate_DifferentSeedsGiveDifferentMelodies()
    {
        var melodies = Enumerable.Range(1, 12).Select(seed => string.Join("", Melody(Make(seed)))).ToHashSet();
        Assert.True(melodies.Count >= 8, $"only {melodies.Count} different melodies for 12 seeds");
        Assert.NotEqual(string.Join("", Melody(Make(1))), string.Join("", Melody(Make(2))));
    }

    [Fact]
    public void Easy_IsShort_AndThePostcardHidesOnlyTheLastTwoNotes()
    {
        for (var seed = 1; seed <= 30; seed++)
        {
            var context = Make(seed);
            Assert.Equal(6, PuzzleJson.Int(context.Params, "beats"));
            var melody = Melody(context);
            var known = PuzzleJson.Ints(context.Params, "known");
            Assert.Equal(6, melody.Count);
            Assert.Equal(melody.Take(4).ToList(), known.Take(4).ToList());
            Assert.Equal(new List<int> { 0, 0 }, known.Skip(4).ToList());
            Assert.All(melody, row => Assert.InRange(row, 1, 5));
            // the witness describes exactly the two smudged notes
            var quote = PuzzleJson.Text(context.Params, "quote");
            Assert.Contains("rồi", quote);
            Assert.Equal(2, InteractivePuzzles.Hints(context).Count);
        }
        Assert.Equal(8, PuzzleJson.Int(Make(3, PuzzleDifficulties.Normal).Params, "beats"));
    }

    [Fact]
    public void Params_NeverContainTheMelody()
    {
        var context = Make(5);
        Assert.False(context.Params.ContainsKey("melody"));
        Assert.DoesNotContain("melody", context.Params.ToJsonString());
        // the full tune must not be readable from the postcard
        var known = PuzzleJson.Ints(context.Params, "known");
        Assert.True(known.Contains(0));
    }

    [Fact]
    public void Describe_MatchesTheMockupWitness()
    {
        var text = MusicBoxKind.Describe(new[] { 3, 2, 1, 2, 3, 4, 5, 3 }, new[] { 3, 2, 1, 2, 3, 0, 0, 0 });
        Assert.Equal("‘…rồi xuống một bậc, rồi xuống một bậc tới nốt thấp nhất, và quay về đúng nốt mở đầu.’", text);
    }

    [Fact]
    public void Check_CorrectPinsSolve_WrongPinsReportTheFirstWrongBeat()
    {
        var run = new PuzzleRunState();
        Assert.True(Kind.Check(Mockup(), Json(Pins(new[] { 3, 2, 1, 2, 3, 4, 5, 3 })), run).Solved);
        var wrong = Kind.Check(Mockup(), Json(Pins(new[] { 3, 2, 1, 2, 3, 2, 3, 5 })), run);
        Assert.False(wrong.Solved);
        Assert.Equal(6, wrong.Feedback!["firstWrong"]!.GetValue<int>());
        var empty = Kind.Check(Mockup(), Json(Pins(new[] { 3, 2, 1, 0, 0, 0, 0, 0 })), run);
        Assert.Equal(4, empty.Feedback!["firstWrong"]!.GetValue<int>());
        var generated = Make(21);
        Assert.True(Kind.Check(generated, Json(Pins(Melody(generated))), run).Solved);
        var off = Melody(generated).ToList();
        off[^1] = off[^1] == 1 ? 2 : off[^1] - 1;
        var verdict = Kind.Check(generated, Json(Pins(off)), run);
        Assert.False(verdict.Solved);
        Assert.Equal(off.Count, verdict.Feedback!["firstWrong"]!.GetValue<int>());
    }

    [Fact]
    public void Probe_PlaysTheBoxWithoutCountingAMistake()
    {
        var run = new PuzzleRunState();
        var bad = Kind.Probe(Mockup(), Json(Pins(new[] { 3, 2, 1, 2, 3, 4, 4, 3 })), run)!;
        Assert.False(bad.Solved);
        Assert.False(bad.CountsAsMistake);
        Assert.Equal(7, bad.Feedback!["firstWrong"]!.GetValue<int>());
        var good = Kind.Probe(Mockup(), Json(Pins(new[] { 3, 2, 1, 2, 3, 4, 5, 3 })), run)!;
        Assert.Equal(0, good.Feedback!["firstWrong"]!.GetValue<int>());
        Assert.DoesNotContain("melody", good.Feedback!.ToJsonString());
    }

    [Fact]
    public void MalformedAnswers_FailSafely()
    {
        var run = new PuzzleRunState();
        foreach (var json in new[]
                 {
                     """{}""", """{"pins":"32123"}""", """{"pins":[3,2,1]}""", """{"pins":[3,2,1,2,3,4,5,3,1]}""",
                     """{"pins":[3,2,1,2,3,4,5,9]}""", """{"pins":[3,2,1,2,3,4,5,-1]}""", """{"pins":[3,2,1,2,3,4,5,"3"]}""",
                     """{"pins":[3,2,1,2,3,4,5,3.5]}""", """{"pins":null}""", """[3,2,1,2,3,4,5,3]""", "123"
                 })
        {
            var verdict = Kind.Check(Mockup(), Json(json), run);
            Assert.False(verdict.Solved);
            var probe = Kind.Probe(Mockup(), Json(json), run)!;
            Assert.False(probe.Solved);
            Assert.False(probe.CountsAsMistake);
        }
    }

    [Fact]
    public void Generate_KeepsAuthoredContent()
    {
        var context = Make(4, PuzzleDifficulties.Easy, """{"quote":"‘…tự viết.’","postcard":{"text":"Hát lại cho ta nghe."},"keyMark":"ĐB"}""");
        Assert.Equal("‘…tự viết.’", PuzzleJson.Text(context.Params, "quote"));
        Assert.Equal("ĐB", PuzzleJson.Text(context.Params, "keyMark"));
        var again = new PuzzleKindContext { PuzzleId = "p", Params = context.Params.DeepClone().AsObject(), Solution = context.Solution.DeepClone().AsObject() };
        Kind.Generate(again, new Random(999));
        Assert.Equal(context.Params.ToJsonString(), again.Params.ToJsonString());
        Assert.Equal(context.Solution.ToJsonString(), again.Solution.ToJsonString());
    }

    [Fact]
    public void Validate_ReportsBrokenAuthoring()
    {
        var context = Mockup();
        context.Params["known"] = PuzzleJson.IntArray(new[] { 3, 2, 1, 2, 3, 4, 5, 3 });
        var errors = new List<string>();
        Kind.Validate(context, (field, message) => errors.Add(field));
        Assert.Contains("params.known", errors);
        context.Params["known"] = PuzzleJson.IntArray(new[] { 3, 2, 5, 2, 3, 0, 0, 0 });
        errors.Clear();
        Kind.Validate(context, (field, message) => errors.Add(field));
        Assert.Contains("params.known", errors);
    }

    [Fact]
    public void FillMissing_GivesEachCaseItsOwnTune()
    {
        GameCase Case(string id) => new()
        {
            CaseId = id,
            Puzzles = { new CasePuzzle { PuzzleId = "box", Type = CasePuzzleTypes.InteractivePuzzle, Kind = "music_box" } }
        };
        var tunes = new[] { "case-a", "case-b", "case-c", "case-d" }.Select(id =>
        {
            var gameCase = Case(id);
            PuzzleKindRegistry.FillMissing(gameCase);
            Assert.DoesNotContain("melody", gameCase.Puzzles[0].ParamsJson);
            return gameCase.Puzzles[0].SolutionJson;
        }).ToHashSet();
        Assert.True(tunes.Count >= 3);
    }
}
