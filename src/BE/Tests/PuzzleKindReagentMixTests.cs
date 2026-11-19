using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>P10 · reagent mix: RYB mixing + ΔE match on the server, per-case recipe.</summary>
public sealed class PuzzleKindReagentMixTests
{
    private static readonly ReagentMixKind Kind = new();

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    private static PuzzleKindContext Make(int seed, string difficulty = PuzzleDifficulties.Easy, string? solutionJson = null)
    {
        var context = new PuzzleKindContext
        {
            PuzzleId = "p",
            Difficulty = difficulty,
            Solution = solutionJson is null ? new JsonObject() : JsonNode.Parse(solutionJson)!.AsObject()
        };
        Kind.Generate(context, new Random(seed));
        return context;
    }

    private static ReagentMixKind.Combo Recipe(PuzzleKindContext context)
    {
        var recipe = context.Solution["recipe"]!.AsObject();
        return new ReagentMixKind.Combo(PuzzleJson.Int(recipe, "y"), PuzzleJson.Int(recipe, "b"), PuzzleJson.Int(recipe, "r"));
    }

    private static string Drops(ReagentMixKind.Combo combo) => $$$"""{"drops":{"y":{{{combo.Y}}},"b":{{{combo.B}}},"r":{{{combo.R}}}}}""";

    [Fact]
    public void Registry_DiscoversReagentMix() => Assert.True(PuzzleKindRegistry.Find("reagent_mix") is ReagentMixKind);

    [Fact]
    public void Mix_MatchesTheMockupTarget()
    {
        var cube = ReagentMixKind.DefaultCubeValues();
        Assert.Equal(new[] { 113, 119, 47 }, ReagentMixKind.Mix(cube, new ReagentMixKind.Combo(3, 2, 1)));
        Assert.Null(ReagentMixKind.Mix(cube, new ReagentMixKind.Combo(0, 0, 0)));
        Assert.Equal(new[] { 226, 172, 34 }, ReagentMixKind.Mix(cube, new ReagentMixKind.Combo(2, 0, 0)));
        Assert.True(ReagentMixKind.NearestOther(cube, new ReagentMixKind.Combo(3, 2, 1), 8) > 7);
        Assert.Equal("xanh rêu", ReagentMixKind.ColourName(new[] { 113, 119, 47 }));
        Assert.Equal("nhiều vàng hơn lam, đỏ chỉ một giọt", ReagentMixKind.Rule(new ReagentMixKind.Combo(3, 2, 1)));
    }

    [Fact]
    public void MockupRecipe_SolvesOnlyWithItsOwnRatio()
    {
        var context = Make(1, solutionJson: """{"recipe":{"y":3,"b":2,"r":1}}""");
        Assert.Equal(new[] { 113, 119, 47 }, PuzzleJson.Ints(context.Params, "target").ToArray());
        Assert.Equal("xanh rêu", PuzzleJson.Text(context.Params, "targetName"));
        var run = new PuzzleRunState();
        Assert.True(Kind.Check(context, Json("""{"drops":{"y":3,"b":2,"r":1}}"""), run).Solved);
        var wrong = Kind.Check(context, Json("""{"drops":{"y":4,"b":1,"r":1}}"""), run);
        Assert.False(wrong.Solved);
        Assert.True(wrong.CountsAsMistake);
        Assert.True(wrong.Feedback!["stain"]!.GetValue<bool>());
        Assert.False(wrong.Feedback.ToJsonString().Contains("recipe"));
        Assert.False(Kind.Check(context, Json("""{"drops":{"y":3,"b":2,"r":0}}"""), run).Solved);
    }

    [Fact]
    public void Generate_Easy_IsAShortRecipeOfAllThreeReagents_WithAClearMargin()
    {
        var cube = ReagentMixKind.DefaultCubeValues();
        for (var seed = 1; seed <= 25; seed++)
        {
            var context = Make(seed);
            var errors = new List<string>();
            Kind.Validate(context, (field, message) => errors.Add($"{field}: {message}"));
            Assert.Empty(errors);
            var recipe = Recipe(context);
            Assert.InRange(recipe.Total, 4, 6);
            Assert.True(recipe.Y > 0 && recipe.B > 0 && recipe.R > 0);
            Assert.True(ReagentMixKind.NearestOther(cube, recipe, 8) >= 5);
            Assert.True(Kind.Check(context, Json(Drops(recipe)), new PuzzleRunState()).Solved);
            Assert.Equal(recipe.Total, PuzzleJson.Int(context.Params, "total"));
            Assert.True(PuzzleJson.Text(context.Params, "testimony").Length > 0);
            Assert.False(context.Params.ToJsonString().Contains("recipe"));
            Assert.Equal(2, InteractivePuzzles.Hints(context).Count);
        }
    }

    [Fact]
    public void Generate_IsDeterministicPerSeed_AndSeedsGiveDifferentRecipes()
    {
        Assert.Equal(Make(6).Solution.ToJsonString(), Make(6).Solution.ToJsonString());
        Assert.Equal(Make(6).Params.ToJsonString(), Make(6).Params.ToJsonString());
        var recipes = Enumerable.Range(1, 15).Select(seed => Recipe(Make(seed)).ToString()).Distinct().Count();
        Assert.True(recipes >= 5, $"only {recipes} distinct recipes over 15 seeds");
    }

    [Fact]
    public void Generate_HarderLevelsUseLongerRecipes_AndHideTheClues()
    {
        foreach (var difficulty in new[] { PuzzleDifficulties.Normal, PuzzleDifficulties.Hard })
        {
            for (var seed = 1; seed <= 10; seed++)
            {
                var context = Make(seed, difficulty);
                var errors = new List<string>();
                Kind.Validate(context, (field, message) => errors.Add(message));
                Assert.Empty(errors);
                Assert.True(Recipe(context).Total >= 5);
                Assert.False(context.Params.ContainsKey("testimony"));
                Assert.True(Kind.Check(context, Json(Drops(Recipe(context))), new PuzzleRunState()).Solved);
            }
        }
        Assert.False(Make(1, PuzzleDifficulties.Hard).Params.ContainsKey("total"));
    }

    [Fact]
    public void Check_TheSameRatioWithMoreDropsAlsoMatches()
    {
        var context = Make(1, solutionJson: """{"recipe":{"y":2,"b":1,"r":1}}""");
        Assert.True(Kind.Check(context, Json("""{"drops":{"y":4,"b":2,"r":2}}"""), new PuzzleRunState()).Solved);
    }

    [Fact]
    public void Check_MalformedOrOverfullCupsFailSafely()
    {
        var context = Make(1, solutionJson: """{"recipe":{"y":3,"b":2,"r":1}}""");
        foreach (var json in new[]
        {
            "{}", """{"drops":[]}""", """{"drops":{}}""", """{"drops":{"y":0,"b":0,"r":0}}""", """{"drops":{"y":6,"b":4,"r":2}}""",
            """{"drops":{"y":-1,"b":2,"r":1}}""", """{"drops":{"y":"3","b":2,"r":1}}""", """{"drops":{"y":3,"b":2,"r":1,"g":1}}""",
            """{"drops":{"y":1.5,"b":2,"r":1}}""", """{"drops":null}"""
        })
        {
            var verdict = Kind.Check(context, Json(json), new PuzzleRunState());
            Assert.False(verdict.Solved);
            Assert.False(verdict.CountsAsMistake);
        }
    }

    [Fact]
    public void Validate_RejectsARecipeThatMissesTheTarget()
    {
        var context = Make(1, solutionJson: """{"recipe":{"y":3,"b":2,"r":1}}""");
        context.Params["target"] = PuzzleJson.IntArray(new[] { 10, 200, 10 });
        var errors = new List<string>();
        Kind.Validate(context, (field, message) => errors.Add(field));
        Assert.Contains("solution.recipe", errors);
    }
}
