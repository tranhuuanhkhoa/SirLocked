using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>P3 · fingerprint: per-case print and reference cards, card check with the break line.</summary>
public sealed class PuzzleKindFingerprintTests
{
    private static readonly FingerprintKind Kind = new();

    private const string CaseCards = """
        {"cards":[
          {"id":"db","mono":"ĐB","name":"Đặng Bửu","role":"Chủ tiệm cầm đồ"},
          {"id":"tl","mono":"TL","name":"Trịnh Lực","role":"Tài xế"},
          {"id":"pt","mono":"PT","name":"Phạm Tùng","role":"Thợ phụ tiệm cầm đồ"}]}
        """;

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    private static PuzzleKindContext Make(int seed, string difficulty = PuzzleDifficulties.Easy, string? paramsJson = null, string? solutionJson = null)
    {
        var context = new PuzzleKindContext
        {
            PuzzleId = "p",
            Difficulty = difficulty,
            Params = paramsJson is null ? new JsonObject() : JsonNode.Parse(paramsJson)!.AsObject(),
            Solution = solutionJson is null ? new JsonObject() : JsonNode.Parse(solutionJson)!.AsObject()
        };
        Kind.Generate(context, new Random(seed));
        return context;
    }

    private static List<JsonObject> Cards(PuzzleKindContext context) => context.Params["cards"]!.AsArray().OfType<JsonObject>().ToList();
    private static string Correct(PuzzleKindContext context) => PuzzleJson.Text(context.Solution, "card");

    [Fact]
    public void Registry_DiscoversFingerprint() => Assert.True(PuzzleKindRegistry.Find("fingerprint") is FingerprintKind);

    [Fact]
    public void Generate_Easy_ExactlyOneCardMatches_AndEveryOtherCardHasAnotherPattern()
    {
        for (var seed = 1; seed <= 30; seed++)
        {
            var context = Make(seed, paramsJson: CaseCards);
            var errors = new List<string>();
            Kind.Validate(context, (field, message) => errors.Add($"{field}: {message}"));
            Assert.Empty(errors);
            var pattern = context.Params["print"]!["pattern"]!.GetValue<string>();
            var cards = Cards(context);
            var right = Assert.Single(cards, card => PuzzleJson.Text(card, "id") == Correct(context));
            Assert.Equal(pattern, PuzzleJson.Text(right, "pattern"));
            Assert.True(right["scar"]!.GetValue<bool>());
            var wrong = cards.Where(card => card != right).Select(card => PuzzleJson.Text(card, "pattern")).ToList();
            Assert.DoesNotContain(wrong, value => value == pattern);
            Assert.Equal(wrong.Count, wrong.Distinct().Count());
            Assert.Equal(0.6, PuzzleJson.Number(context.Params, "threshold"));
        }
    }

    [Fact]
    public void Generate_Normal_AddsADecoyWithTheSamePatternButNoScar()
    {
        var context = Make(3, PuzzleDifficulties.Normal, CaseCards);
        var errors = new List<string>();
        Kind.Validate(context, (field, message) => errors.Add(message));
        Assert.Empty(errors);
        var pattern = context.Params["print"]!["pattern"]!.GetValue<string>();
        var same = Cards(context).Where(card => PuzzleJson.Text(card, "pattern") == pattern).ToList();
        Assert.Equal(2, same.Count);
        Assert.Single(same, card => card["scar"]!.GetValue<bool>());
    }

    [Fact]
    public void Generate_IsDeterministicPerSeed_AndCasesGetDifferentAnswers()
    {
        Assert.Equal(Make(8).Params.ToJsonString(), Make(8).Params.ToJsonString());
        Assert.Equal(Make(8).Solution.ToJsonString(), Make(8).Solution.ToJsonString());
        var answers = Enumerable.Range(1, 12).Select(seed => Correct(Make(seed))).Distinct().Count();
        Assert.True(answers >= 2, "the culprit card should vary between cases");
        var prints = Enumerable.Range(1, 12).Select(seed => Make(seed).Params["print"]!.ToJsonString()).Distinct().Count();
        Assert.True(prints >= 10, "the print pose should vary between cases");
        Assert.False(Make(8).Params.ToJsonString().Contains("\"card\""), "the answer must stay out of params");
    }

    [Fact]
    public void Generate_KeepsTheAuthoredCulprit()
    {
        for (var seed = 1; seed <= 10; seed++)
            Assert.Equal("db", Correct(Make(seed, paramsJson: CaseCards, solutionJson: """{"card":"db"}""")));
    }

    [Fact]
    public void Check_RightCardMatches_WrongCardBreaksAtTheScarLine()
    {
        var context = Make(5, paramsJson: CaseCards, solutionJson: """{"card":"db"}""");
        var run = new PuzzleRunState();
        var right = Kind.Check(context, Json("""{"card":"db"}"""), run);
        Assert.True(right.Solved);
        Assert.True(right.Feedback!["match"]!.GetValue<bool>());
        foreach (var id in new[] { "tl", "pt" })
        {
            var wrong = Kind.Check(context, Json($$"""{"card":"{{id}}"}"""), run);
            Assert.False(wrong.Solved);
            Assert.True(wrong.CountsAsMistake);
            Assert.False(wrong.Feedback!["match"]!.GetValue<bool>());
            Assert.Equal(3, wrong.Feedback["breakAt"]!.GetValue<int>());
        }
    }

    [Fact]
    public void Check_MalformedAnswersFailSafely()
    {
        var context = Make(5, paramsJson: CaseCards, solutionJson: """{"card":"db"}""");
        foreach (var json in new[] { "{}", """{"card":""}""", """{"card":"zz"}""", """{"card":1}""", """{"card":["db"]}""", """{"card":null}""" })
        {
            var verdict = Kind.Check(context, Json(json), new PuzzleRunState());
            Assert.False(verdict.Solved);
            Assert.False(verdict.CountsAsMistake);
        }
    }

    [Fact]
    public void Validate_RejectsAnAmbiguousOrMissingCulprit()
    {
        var context = Make(5, paramsJson: CaseCards, solutionJson: """{"card":"db"}""");
        var pattern = context.Params["print"]!["pattern"]!.GetValue<string>();
        var other = Cards(context).First(card => PuzzleJson.Text(card, "id") == "tl");
        other["pattern"] = pattern;
        other["scar"] = true;
        var errors = new List<string>();
        Kind.Validate(context, (field, message) => errors.Add(field));
        Assert.Contains("params.cards", errors);

        context.Solution["card"] = "nobody";
        errors.Clear();
        Kind.Validate(context, (field, message) => errors.Add(field));
        Assert.Contains("solution.card", errors);
    }

    [Fact]
    public void FillMissing_UsesTheNeutralDefaultCards()
    {
        var gameCase = new GameCase
        {
            CaseId = "case-x",
            Puzzles = { new CasePuzzle { PuzzleId = "van-tay", Type = CasePuzzleTypes.InteractivePuzzle, Kind = "fingerprint" } }
        };
        PuzzleKindRegistry.FillMissing(gameCase);
        var parameters = JsonNode.Parse(gameCase.Puzzles[0].ParamsJson)!.AsObject();
        Assert.Equal(3, parameters["cards"]!.AsArray().Count);
        Assert.Contains("\"card\"", gameCase.Puzzles[0].SolutionJson);
        var errors = new List<string>();
        PuzzleKindRegistry.Validate(gameCase.Puzzles[0], "puzzles[0]", (field, message, _) => errors.Add($"{field}: {message}"));
        Assert.Empty(errors);
    }
}
