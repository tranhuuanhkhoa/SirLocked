using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>P4 document forgery: per-case alterations, lamp per trace, server-side answer set.</summary>
public sealed class PuzzleKindDocForgeryTests
{
    private static readonly DocForgeryKind Kind = new();

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

    private static string Answer(PuzzleKindContext context) => new JsonObject { ["marks"] = context.Solution["marks"]!.DeepClone() }.ToJsonString();

    /// <summary>The first test case's ledger (fixtures/doc_forgery.json).</summary>
    private const string Ledger = """
    {"fields":[
      {"id":"nguoi","label":"Người cầm:","value":"Bà Lâm · nhà xe họ Lâm"},
      {"id":"mon","label":"Món cầm:","value":"Trâm hồng ngọc"},
      {"id":"gia","label":"Định giá:","value":"3.000 đồng","ref":"300 đồng","trace":"ink"},
      {"id":"ngay","label":"Ngày nhận:","value":"10/10","ref":"14/10","trace":"erase"},
      {"id":"han","label":"Hạn chuộc:","value":"14/11"}
    ]}
    """;

    [Fact]
    public void Registry_DiscoversDocForgery() => Assert.NotNull(PuzzleKindRegistry.Find("doc_forgery"));

    [Fact]
    public void Generate_IsDeterministicPerSeed_AndValid()
    {
        foreach (var difficulty in new[] { PuzzleDifficulties.Easy, PuzzleDifficulties.Normal, PuzzleDifficulties.Hard })
        {
            var a = Make(3, difficulty);
            Assert.Equal(a.Params.ToJsonString(), Make(3, difficulty).Params.ToJsonString());
            Assert.Equal(a.Solution.ToJsonString(), Make(3, difficulty).Solution.ToJsonString());
            var errors = new List<string>();
            Kind.Validate(a, (field, message) => errors.Add($"{field}: {message}"));
            Assert.Empty(errors);
            Assert.Equal(2, InteractivePuzzles.Hints(a).Count);
        }
    }

    [Fact]
    public void Easy_HasTwoAlterations_OneForEachLamp()
    {
        for (var seed = 1; seed <= 25; seed++)
        {
            var context = Make(seed);
            var marks = (JsonObject)context.Solution["marks"]!;
            Assert.Equal(2, marks.Count);
            Assert.Equal(2, PuzzleJson.Int(context.Params, "need"));
            var lights = marks.Select(pair => pair.Value!.GetValue<string>()).OrderBy(light => light).ToList();
            Assert.Equal(new List<string> { "rake", "uv" }, lights);
        }
        Assert.Equal(3, ((JsonObject)Make(2, PuzzleDifficulties.Normal).Solution["marks"]!).Count);
        Assert.Equal(4, ((JsonObject)Make(2, PuzzleDifficulties.Hard).Solution["marks"]!).Count);
    }

    [Fact]
    public void Generate_DifferentSeedsGiveDifferentAnswers()
    {
        var answers = Enumerable.Range(1, 12).Select(seed => Make(seed).Solution["marks"]!.ToJsonString()).ToHashSet();
        Assert.True(answers.Count >= 3, $"only {answers.Count} different answer sets");
        var documents = Enumerable.Range(1, 12).Select(seed => Make(seed).Params["fields"]!.ToJsonString()).ToHashSet();
        Assert.True(documents.Count >= 10);
    }

    [Fact]
    public void AuthoredFields_GetTracesFromTheDifference_AndGhostsOfTheOldWriting()
    {
        var context = Make(1, PuzzleDifficulties.Easy, Ledger);
        var marks = (JsonObject)context.Solution["marks"]!;
        Assert.Equal("uv", PuzzleJson.Text(marks, "gia"));
        Assert.Equal("rake", PuzzleJson.Text(marks, "ngay"));
        Assert.Equal(2, marks.Count);
        var fields = (JsonArray)context.Params["fields"]!;
        var ngay = fields.OfType<JsonObject>().Single(field => PuzzleJson.Text(field, "id") == "ngay");
        Assert.Equal("14/10", PuzzleJson.Text(ngay, "ghost"));
        Assert.Equal("rake", PuzzleJson.Text(ngay, "light"));
        var mon = fields.OfType<JsonObject>().Single(field => PuzzleJson.Text(field, "id") == "mon");
        Assert.Equal("Trâm hồng ngọc", PuzzleJson.Text(mon, "ref"));
        Assert.False(mon.ContainsKey("trace"));
        // an empty reference line means the text was added later in another ink
        var added = Make(1, PuzzleDifficulties.Easy, """{"fields":[{"label":"A:","value":"x"},{"label":"Ghi chú:","value":"Thêm sau","ref":""},{"label":"Tên:","value":"Bửu","ref":"Lực"}]}""");
        Assert.Equal("uv", PuzzleJson.Text((JsonObject)added.Solution["marks"]!, "f2"));
        Assert.Equal("rake", PuzzleJson.Text((JsonObject)added.Solution["marks"]!, "f3"));
        var errors = new List<string>();
        Kind.Validate(context, (field, message) => errors.Add(message));
        Assert.Empty(errors);
    }

    [Fact]
    public void Check_TheExactSetOfMarksSolves()
    {
        var context = Make(1, PuzzleDifficulties.Easy, Ledger);
        var run = new PuzzleRunState();
        Assert.True(Kind.Check(context, Json(Answer(context)), run).Solved);
        Assert.True(Kind.Check(context, Json("""{"marks":{"ngay":"rake","gia":"uv"}}"""), run).Solved);
        Assert.False(Kind.Check(context, Json("""{"marks":{"ngay":"rake","gia":"rake"}}"""), run).Solved);
        Assert.False(Kind.Check(context, Json("""{"marks":{"ngay":"rake"}}"""), run).Solved);
        Assert.False(Kind.Check(context, Json("""{"marks":{"ngay":"rake","gia":"uv","fold":"rake"}}"""), run).Solved);
        Assert.False(Kind.Check(context, Json("""{"marks":{"ngay":"rake","gia":"uv","mon":"uv"}}"""), run).Solved);
        var generated = Make(8, PuzzleDifficulties.Normal);
        Assert.True(Kind.Check(generated, Json(Answer(generated)), run).Solved);
    }

    [Fact]
    public void MalformedAnswers_FailSafely()
    {
        var context = Make(1, PuzzleDifficulties.Easy, Ledger);
        var run = new PuzzleRunState();
        foreach (var json in new[]
                 {
                     """{}""", """{"marks":[]}""", """{"marks":"ngay"}""", """{"marks":{}}""", """{"marks":{"ngay":"laser","gia":"uv"}}""",
                     """{"marks":{"ngay":1,"gia":"uv"}}""", """{"marks":{"ngay":null,"gia":"uv"}}""", """{"marks":{"ngay":["rake"]}}""", """["ngay"]"""
                 })
        {
            var verdict = Kind.Check(context, Json(json), run);
            Assert.False(verdict.Solved);
            Assert.NotNull(verdict.Feedback);
        }
    }

    [Fact]
    public void Validate_ReportsInconsistentAuthoring()
    {
        var context = Make(1, PuzzleDifficulties.Easy, Ledger);
        context.Solution["marks"] = new JsonObject { ["gia"] = "rake", ["ngay"] = "rake" };
        var errors = new List<string>();
        Kind.Validate(context, (field, message) => errors.Add(field));
        Assert.Contains("solution.marks", errors);
        var nothing = Make(1, PuzzleDifficulties.Easy, """{"fields":[{"label":"A:","value":"x"},{"label":"B:","value":"y"}]}""");
        errors.Clear();
        Kind.Validate(nothing, (field, message) => errors.Add(field));
        Assert.Contains("solution.marks", errors);
    }

    [Fact]
    public void FillMissing_GivesEachCaseItsOwnDocument()
    {
        GameCase Case(string id) => new()
        {
            CaseId = id,
            Puzzles = { new CasePuzzle { PuzzleId = "doc", Type = CasePuzzleTypes.InteractivePuzzle, Kind = "doc_forgery" } }
        };
        var docs = new[] { "case-a", "case-b", "case-c" }.Select(id =>
        {
            var gameCase = Case(id);
            PuzzleKindRegistry.FillMissing(gameCase);
            Assert.DoesNotContain("\"marks\"", gameCase.Puzzles[0].ParamsJson);
            Assert.Contains("\"marks\"", gameCase.Puzzles[0].SolutionJson);
            return gameCase.Puzzles[0].ParamsJson;
        }).ToHashSet();
        Assert.True(docs.Count >= 2);
    }
}
