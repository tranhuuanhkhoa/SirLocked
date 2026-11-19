using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>P2 · torn paper: per-case tear layout, placement check, partner hand-off.</summary>
public sealed class PuzzleKindTornPaperTests
{
    private static readonly TornPaperKind Kind = new();

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

    private static string Placed(int count, Func<int, (double X, double Y, double R)>? at = null) =>
        """{"placed":[""" + string.Join(",", Enumerable.Range(1, count).Select(id =>
        {
            var (x, y, r) = at?.Invoke(id) ?? (0, 0, 0);
            return FormattableString.Invariant($$"""{"id":{{id}},"x":{{x}},"y":{{y}},"r":{{r}}}""");
        })) + "]}";

    [Fact]
    public void Registry_DiscoversTornPaper() => Assert.True(PuzzleKindRegistry.Find("torn_paper") is TornPaperKind);

    [Fact]
    public void Generate_Easy_FourPiecesOneUpsideDownNoPartnerPiece()
    {
        for (var seed = 1; seed <= 30; seed++)
        {
            var context = Make(seed);
            var errors = new List<string>();
            Kind.Validate(context, (field, message) => errors.Add($"{field}: {message}"));
            Assert.Empty(errors);
            Assert.Equal(4, PuzzleJson.Int(context.Params, "pieceCount"));
            Assert.Equal(0, PuzzleJson.Int(context.Params, "partnerPiece"));
            Assert.Equal(1, PuzzleJson.Ints(context.Params, "flipped").Count);
            Assert.True(PuzzleJson.Int(context.Params, "tearSeed") > 0);
            Assert.Equal(2, InteractivePuzzles.Hints(context).Count);
        }
    }

    [Fact]
    public void Generate_IsDeterministicPerSeed_AndSeedsTearDifferently()
    {
        Assert.Equal(Make(4).Params.ToJsonString(), Make(4).Params.ToJsonString());
        var tears = Enumerable.Range(1, 10).Select(seed => PuzzleJson.Int(Make(seed).Params, "tearSeed")).Distinct().Count();
        Assert.Equal(10, tears);
        var flips = Enumerable.Range(1, 12).Select(seed => PuzzleJson.Ints(Make(seed).Params, "flipped")[0]).Distinct().Count();
        Assert.True(flips >= 3, "the upside-down piece should vary between cases");
    }

    [Fact]
    public void Generate_KeepsAuthoredDocument()
    {
        var context = Make(2, paramsJson: """{"doc":{"head":"GHI CHÚ","lines":["THỨ SÁU · 23 GIỜ"],"sign":"KÝ: Đ.B."},"tearSeed":77}""");
        Assert.Equal(77, PuzzleJson.Int(context.Params, "tearSeed"));
        Assert.Equal("KÝ: Đ.B.", context.Params["doc"]!["sign"]!.GetValue<string>());
    }

    [Fact]
    public void Check_AllPiecesOnTheirSlotAndUprightSolves()
    {
        var context = Make(9);
        Assert.True(Kind.Check(context, Json(Placed(4)), new PuzzleRunState()).Solved);
        // Within the tolerance (snapping lands exactly, but rounding must not matter) and a full turn.
        Assert.True(Kind.Check(context, Json(Placed(4, id => (id * 1.5, -2, id == 2 ? 360 : 0))), new PuzzleRunState()).Solved);
    }

    [Fact]
    public void Check_OffsetUpsideDownMissingOrDuplicatePiecesFail()
    {
        var context = Make(9);
        var run = new PuzzleRunState();
        var offset = Kind.Check(context, Json(Placed(4, id => (id == 3 ? 40 : 0, 0, 0))), run);
        Assert.False(offset.Solved);
        Assert.Equal(3, offset.Feedback!["placed"]!.GetValue<int>());
        Assert.False(Kind.Check(context, Json(Placed(4, id => (0, 0, id == 1 ? 180 : 0))), run).Solved);
        Assert.False(Kind.Check(context, Json(Placed(3)), run).Solved);
        Assert.False(Kind.Check(context, Json("""{"placed":[{"id":1,"x":0,"y":0,"r":0},{"id":1,"x":0,"y":0,"r":0},{"id":2,"x":0,"y":0,"r":0},{"id":3,"x":0,"y":0,"r":0}]}"""), run).Solved);
        Assert.False(Kind.Check(context, Json(Placed(5)), run).Solved);
    }

    [Fact]
    public void Check_MalformedAnswersFailSafely()
    {
        var context = Make(9);
        foreach (var json in new[]
        {
            "{}", """{"placed":"all"}""", """{"placed":[1,2,3,4]}""", """{"placed":[{"id":"1","x":0,"y":0,"r":0}]}""",
            """{"placed":[{"id":1.5,"x":0,"y":0,"r":0}]}""", """{"placed":[{"id":1,"x":0,"y":0}]}""", """{"placed":[{"id":1,"x":1e300,"y":0,"r":0}]}""",
            """{"placed":null}"""
        })
        {
            var verdict = Kind.Check(context, Json(json), new PuzzleRunState());
            Assert.False(verdict.Solved);
            Assert.False(verdict.CountsAsMistake);
        }
    }

    [Fact]
    public void PartnerPiece_MustBeHandedOverBeforeTheSheetCanBeCompleted()
    {
        var context = Make(5, PuzzleDifficulties.Normal);
        var partner = PuzzleJson.Int(context.Params, "partnerPiece");
        Assert.InRange(partner, 1, 5);
        Assert.Equal(5, PuzzleJson.Int(context.Params, "pieceCount"));
        Assert.DoesNotContain(PuzzleJson.Ints(context.Params, "flipped"), id => id == partner);
        var run = new PuzzleRunState();
        Assert.False(Kind.RunView(context, run)!["handedOff"]!.GetValue<bool>());
        var early = Kind.Check(context, Json(Placed(5)), run);
        Assert.False(early.Solved);
        Assert.Equal("partner", early.Feedback!["reason"]!.GetValue<string>());

        var handoff = Kind.Probe(context, Json("""{"handoff":true}"""), run)!;
        Assert.True(handoff.Feedback!["handedOff"]!.GetValue<bool>());
        Assert.Equal(partner, handoff.Feedback["piece"]!.GetValue<int>());
        Assert.True(Kind.RunView(context, run)!["handedOff"]!.GetValue<bool>());
        Assert.True(Kind.Check(context, Json(Placed(5)), run).Solved);
    }

    [Fact]
    public void Probe_WithoutAPartnerPieceOrPayloadIsRejected()
    {
        var easy = Make(5);
        Assert.Null(Kind.RunView(easy, new PuzzleRunState()));
        Assert.Equal("invalid", Kind.Probe(easy, Json("""{"handoff":true}"""), new PuzzleRunState())!.Feedback!["reason"]!.GetValue<string>());
        var normal = Make(5, PuzzleDifficulties.Normal);
        var run = new PuzzleRunState();
        Assert.Equal("invalid", Kind.Probe(normal, Json("""{"handoff":"yes"}"""), run)!.Feedback!["reason"]!.GetValue<string>());
        Assert.False(TornPaperKind.HandedOff(run));
    }

    [Fact]
    public void Validate_RejectsBrokenAuthoring()
    {
        var context = Make(1);
        context.Params["flipped"] = PuzzleJson.IntArray(new[] { 1, 2, 3, 4 });
        context.Params["partnerPiece"] = 9;
        var errors = new List<string>();
        Kind.Validate(context, (field, message) => errors.Add(field));
        Assert.Contains("params.flipped", errors);
        Assert.Contains("params.partnerPiece", errors);
    }
}
