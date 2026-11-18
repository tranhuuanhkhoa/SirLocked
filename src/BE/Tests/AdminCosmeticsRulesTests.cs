using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Market;
using SirLocked.Api.WebAPI.Controllers;
using Xunit;

namespace SirLocked.Tests;

public class AdminCosmeticsRulesTests
{
    private const string Picture = "https://res.cloudinary.com/demo/image/upload/v1/sirlocked/admin/abc.webp";
    private const string Frame = MarketCategories.Frame;
    private const string Title = MarketCategories.Title;
    private const string Entrance = MarketCategories.Entrance;

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    private static CosmeticVisualCheck Check(string category, string? template, string? parameters, string? imageUrl = null) =>
        AdminCosmeticRules.ValidateVisual(category, "x", imageUrl, template, parameters is null ? null : Json(parameters));

    private static string CodeOf(CosmeticVisualCheck check) => Assert.Single(check.Violations).Code;

    // ------------------------------------------------------------------ painted frames

    [Fact]
    public void APaintedFrameKeepsItsHoleAndEffects()
    {
        var check = Check(Frame, "painted", """
            { "hole": { "x": 120, "y": 130, "r": 78 }, "scale": 1.1,
              "live": { "aura": ["255,190,70", 0.3], "rays": ["255,210,110", 0.18], "comet": ["255,226,140", 0.17, 2], "spark": ["255,255,255", 3],
                        "fall": ["petal", 6], "embers": ["255,150,50", 9], "flame": 1, "breathe": 0.008 },
              "sheen": { "rgb": "255,236,180", "a": 0.35, "period": 8, "conic": true },
              "glowUrl": "https://res.cloudinary.com/demo/glow.webp" }
            """, Picture);

        Assert.Empty(check.Violations);
        var visual = check.Visual!;
        Assert.Equal("painted", visual.Template);
        Assert.Equal(Picture, visual.ImageUrl);
        Assert.Null(visual.BuiltinId);
        Assert.Equal(78, visual.Params["hole"]["r"].ToDouble());
        Assert.Equal("petal", visual.Params["live"]["fall"][0].AsString);
        Assert.Equal(2, visual.Params["live"]["comet"][2].ToDouble());
        Assert.True(visual.Params["sheen"]["conic"].AsBoolean);
    }

    [Theory]
    [InlineData("""{ }""")]
    [InlineData("""{ "hole": { "x": 10, "y": 10 } }""")]
    [InlineData("""{ "hole": { "x": 10, "y": 10, "r": 0 } }""")]
    [InlineData("""{ "hole": { "x": 10, "y": 10, "r": -4 } }""")]
    [InlineData("""{ "hole": { "x": -1, "y": 10, "r": 40 } }""")]
    [InlineData("""{ "hole": { "x": "10", "y": 10, "r": 40 } }""")]
    [InlineData("""{ "hole": 7 }""")]
    public void APaintedFrameNeedsAProperHole(string parameters) =>
        Assert.Equal(AdminCosmeticCodes.HoleInvalid, CodeOf(Check(Frame, "painted", parameters, Picture)));

    [Fact]
    public void APaintedFrameWithoutParametersIsAskedForItsHole() =>
        Assert.Equal(AdminCosmeticCodes.HoleInvalid, CodeOf(Check(Frame, "painted", null, Picture)));

    [Fact]
    public void APaintedFrameNeedsAPicture() =>
        Assert.Equal(AdminCosmeticCodes.ImageRequired, CodeOf(Check(Frame, "painted", """{ "hole": { "x": 1, "y": 1, "r": 1 } }""")));

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("http://example.com/a.webp")]
    [InlineData("data:image/png;base64,AAAA")]
    [InlineData("https://example.com/a.webp\" onerror=\"alert(1)")]
    [InlineData("/etc/passwd")]
    [InlineData("https://example.com/a b.webp")]
    public void PicturesMustBeOrdinaryAddresses(string url) =>
        Assert.Equal(AdminCosmeticCodes.ImageInvalid, CodeOf(Check(Frame, "painted", """{ "hole": { "x": 1, "y": 1, "r": 1 } }""", url)));

    [Fact]
    public void ThePicturesThatShipWithTheGameAreAccepted() =>
        Assert.Empty(Check(Frame, "painted", """{ "hole": { "x": 1, "y": 1, "r": 1 } }""", "/assets/cosmetics/vien-dong.webp").Violations);

    [Theory]
    [InlineData("""{ "aura": ["255,190,70"] }""")]
    [InlineData("""{ "aura": ["255,190,70", 5] }""")]
    [InlineData("""{ "aura": ["red", 0.3] }""")]
    [InlineData("""{ "aura": ["300,0,0", 0.3] }""")]
    [InlineData("""{ "aura": ["1,2,3);background:url(x", 0.3] }""")]
    [InlineData("""{ "comet": ["255,255,255", 0.2] }""")]
    [InlineData("""{ "comet": ["255,255,255", 0.2, 1.5] }""")]
    [InlineData("""{ "spark": ["255,255,255", 500] }""")]
    [InlineData("""{ "fall": ["fish", 3] }""")]
    [InlineData("""{ "flame": 2 }""")]
    [InlineData("""{ "breathe": 1 }""")]
    [InlineData("""{ "lightning": ["255,255,255", 1] }""")]
    [InlineData("""[]""")]
    public void BrokenLiveEffectsAreRefused(string live) =>
        Assert.Equal(AdminCosmeticCodes.LiveInvalid, CodeOf(Check(Frame, "painted", $$"""{ "hole": { "x": 1, "y": 1, "r": 1 }, "live": {{live}} }""", Picture)));

    [Theory]
    [InlineData("""{ "a": 0.3 }""")]
    [InlineData("""{ "rgb": "255,255,255" }""")]
    [InlineData("""{ "rgb": "255,255,255", "a": 3 }""")]
    [InlineData("""{ "rgb": "255,255,255", "a": 0.3, "period": 0 }""")]
    [InlineData("""{ "rgb": "255,255,255", "a": 0.3, "conic": "yes" }""")]
    public void BrokenSheenIsRefused(string sheen) =>
        Assert.Equal(AdminCosmeticCodes.SheenInvalid, CodeOf(Check(Frame, "painted", $$"""{ "hole": { "x": 1, "y": 1, "r": 1 }, "sheen": {{sheen}} }""", Picture)));

    [Fact]
    public void UnknownParametersAreNotStored()
    {
        var check = Check(Frame, "painted", """{ "hole": { "x": 1, "y": 1, "r": 1, "evil": 1 }, "script": "<script>" }""", Picture);

        Assert.Empty(check.Violations);
        Assert.False(check.Visual!.Params.Contains("script"));
        Assert.False(check.Visual.Params["hole"].AsBsonDocument.Contains("evil"));
    }

    // ------------------------------------------------------------------ clones

    [Fact]
    public void ACloneNamesAShippedFrame()
    {
        var check = Check(Frame, "builtin-clone", """{ "base": "kimlong", "live": { "aura": ["120,200,255", 0.3] } }""");

        Assert.Empty(check.Violations);
        Assert.Equal("kimlong", check.Visual!.Params["base"].AsString);
        Assert.Null(check.Visual.ImageUrl);
    }

    [Theory]
    [InlineData("""{ }""")]
    [InlineData("""{ "base": "nothing" }""")]
    [InlineData("""{ "base": "none" }""")]
    [InlineData("""{ "base": 3 }""")]
    public void ACloneOfNothingIsRefused(string parameters) =>
        Assert.Equal(AdminCosmeticCodes.BaseUnknown, CodeOf(Check(Frame, "builtin-clone", parameters)));

    // ------------------------------------------------------------------ titles

    [Fact]
    public void ATitleNamesAStyleAndMayOverrideItsColours()
    {
        var check = Check(Title, "style", """{ "style": "kimlong", "glow": "120,200,255", "parts": [["rise", 6, "255,214,120"], ["tw", 3, "255,255,255"]] }""");

        Assert.Empty(check.Violations);
        Assert.Equal("kimlong", check.Visual!.Params["style"].AsString);
        Assert.Equal("120,200,255", check.Visual.Params["glow"].AsString);
        Assert.Equal(2, check.Visual.Params["parts"].AsBsonArray.Count);
    }

    [Fact]
    public void EveryStyleOfTheTableIsAccepted()
    {
        Assert.Equal(18, AdminCosmeticRules.TitleStyles.Count);
        foreach (var style in AdminCosmeticRules.TitleStyles)
            Assert.Empty(Check(Title, "style", $$"""{ "style": "{{style}}" }""").Violations);
    }

    [Theory]
    [InlineData("""{ }""")]
    [InlineData("""{ "style": "rainbow" }""")]
    [InlineData("""{ "style": 4 }""")]
    public void AStyleThatDoesNotExistIsRefused(string parameters) =>
        Assert.Equal(AdminCosmeticCodes.StyleUnknown, CodeOf(Check(Title, "style", parameters)));

    [Theory]
    [InlineData("""{ "style": "ngan", "glow": "blue" }""")]
    [InlineData("""{ "style": "ngan", "parts": [["fish", 3, "1,2,3"]] }""")]
    [InlineData("""{ "style": "ngan", "parts": [["tw", 300, "1,2,3"]] }""")]
    [InlineData("""{ "style": "ngan", "parts": [["tw", 3, "1,2,3\"><script>"]] }""")]
    [InlineData("""{ "style": "ngan", "parts": [["tw", 1, "1,2,3"], ["tw", 1, "1,2,3"], ["tw", 1, "1,2,3"], ["tw", 1, "1,2,3"], ["tw", 1, "1,2,3"]] }""")]
    public void TitleOverridesAreChecked(string parameters) =>
        Assert.Equal(AdminCosmeticCodes.ParamInvalid, CodeOf(Check(Title, "style", parameters)));

    // ------------------------------------------------------------------ titles painted from an uploaded picture

    [Fact]
    public void APaintedTitleKeepsItsPictureTextBoxAndEffects()
    {
        var check = Check(Title, "painted", """
            { "size": { "w": 600, "h": 160 }, "box": { "x": 0.2, "y": 0.3, "w": 0.6, "h": 0.4 }, "color": "255,240,200", "scale": 1.2,
              "glow": "120,200,255", "parts": [["tw", 3, "255,255,255"]] }
            """, Picture);

        Assert.Empty(check.Violations);
        var visual = check.Visual!;
        Assert.Equal("painted", visual.Template);
        Assert.Equal(Picture, visual.ImageUrl);
        Assert.Equal(600, visual.Params["size"]["w"].ToDouble());
        Assert.Equal(0.6, visual.Params["box"]["w"].ToDouble());
        Assert.Equal("255,240,200", visual.Params["color"].AsString);
        Assert.Equal(1.2, visual.Params["scale"].ToDouble());
        Assert.Equal("120,200,255", visual.Params["glow"].AsString);
        Assert.Single(visual.Params["parts"].AsBsonArray);
        Assert.False(visual.Params.Contains("textBaked"));
    }

    [Fact]
    public void APaintedTitleWithTheWordsInItsArtNeedsNoTextBox()
    {
        var check = Check(Title, "painted", """{ "size": { "w": 512, "h": 128 }, "textBaked": true }""", Picture);

        Assert.Empty(check.Violations);
        Assert.True(check.Visual!.Params["textBaked"].AsBoolean);
        Assert.False(check.Visual.Params.Contains("box"));
    }

    [Fact]
    public void APaintedTitleNeedsAnUploadedPicture()
    {
        const string parameters = """{ "size": { "w": 512, "h": 128 }, "textBaked": true }""";
        Assert.Equal(AdminCosmeticCodes.ImageRequired, CodeOf(Check(Title, "painted", parameters)));
        Assert.Equal(AdminCosmeticCodes.ImageInvalid, CodeOf(Check(Title, "painted", parameters, "http://example.com/a.png")));
        Assert.Equal(AdminCosmeticCodes.ImageInvalid, CodeOf(Check(Title, "painted", parameters, "javascript:alert(1)")));
    }

    [Fact]
    public void APaintedTitleTakesAnyPictureTheUploadTakes()
    {
        // The upload accepts up to 8000 px a side; a nameplate that big must still save.
        var check = Check(Title, "painted", """{ "size": { "w": 8000, "h": 2000 }, "textBaked": true }""", Picture);

        Assert.Empty(check.Violations);
        Assert.Equal(AdminCosmeticCodes.ParamInvalid, CodeOf(Check(Title, "painted", """{ "size": { "w": 8001, "h": 2000 }, "textBaked": true }""", Picture)));
    }

    [Theory]
    [InlineData("https://res.cloudinary.com/demo/a.png\n")]
    [InlineData("https://res.cloudinary.com/demo/a b.png")]
    [InlineData("HTTPS://res.cloudinary.com/demo/a.png")]
    public void APictureAddressThePageWouldRefuseIsRefusedHere(string url)
    {
        // The page draws only what its own URL_OK accepts; anything else would be stored and never shown.
        Assert.Equal(AdminCosmeticCodes.ImageInvalid, CodeOf(Check(Title, "painted", """{ "size": { "w": 512, "h": 128 }, "textBaked": true }""", url)));
        Assert.Equal(AdminCosmeticCodes.ImageInvalid, CodeOf(Check(Entrance, "flipbook", $$"""{ "sheetUrl": {{System.Text.Json.JsonSerializer.Serialize(url)}}, "cols": 1, "rows": 1 }""")));
    }

    [Theory]
    [InlineData("""{ "size": { "w": 512, "h": 128 } }""")]
    [InlineData("""{ "box": { "x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5 } }""")]
    [InlineData("""{ "size": { "w": 0, "h": 128 }, "box": { "x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5 } }""")]
    [InlineData("""{ "size": { "w": 99999, "h": 128 }, "box": { "x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5 } }""")]
    [InlineData("""{ "size": { "w": 512, "h": 128 }, "box": { "x": 0.9, "y": 0.1, "w": 0.5, "h": 0.5 } }""")]
    [InlineData("""{ "size": { "w": 512, "h": 128 }, "box": { "x": 0.1, "y": 0.1, "w": 0, "h": 0.5 } }""")]
    [InlineData("""{ "size": { "w": 512, "h": 128 }, "box": { "x": -0.1, "y": 0.1, "w": 0.5, "h": 0.5 } }""")]
    [InlineData("""{ "size": { "w": 512, "h": 128 }, "box": { "x": "0.1", "y": 0.1, "w": 0.5, "h": 0.5 } }""")]
    [InlineData("""{ "size": { "w": 512, "h": 128 }, "textBaked": true, "color": "gold" }""")]
    [InlineData("""{ "size": { "w": 512, "h": 128 }, "textBaked": true, "scale": 5 }""")]
    [InlineData("""{ "size": { "w": 512, "h": 128 }, "textBaked": "yes" }""")]
    [InlineData("""{ "size": { "w": 512, "h": 128 }, "textBaked": true, "glow": "blue" }""")]
    public void APaintedTitleChecksItsLayout(string parameters) =>
        Assert.Equal(AdminCosmeticCodes.ParamInvalid, CodeOf(Check(Title, "painted", parameters, Picture)));

    // ------------------------------------------------------------------ entrances

    [Fact]
    public void EveryStageIsATemplate()
    {
        Assert.Equal(10, AdminCosmeticRules.EntranceTemplates.Count);
        foreach (var template in AdminCosmeticRules.EntranceTemplates) Assert.Empty(Check(Entrance, template, null).Violations);
    }

    [Fact]
    public void ACreatureEntranceMayChangeItsPicture()
    {
        var check = Check(Entrance, "kim-long", $$"""{ "imageUrl": "{{Picture}}", "tint": "120,200,255", "duration": 9 }""");

        Assert.Empty(check.Violations);
        Assert.Equal(Picture, check.Visual!.Params["imageUrl"].AsString);
        Assert.Equal("120,200,255", check.Visual.Params["tint"].AsString);
        Assert.Equal(9, check.Visual.Params["duration"].ToDouble());
    }

    [Theory]
    [InlineData("lang-le", """{ "imageUrl": "/assets/a.webp" }""")]
    [InlineData("kim-long", """{ "swordUrl": "/assets/a.webp" }""")]
    [InlineData("van-kiem", """{ "imageUrl": "/assets/a.webp" }""")]
    [InlineData("kim-long", """{ "tint": "gold" }""")]
    [InlineData("kim-long", """{ "duration": 1 }""")]
    [InlineData("kim-long", """{ "duration": 90 }""")]
    public void AnEntranceTakesOnlyWhatItsTemplateUses(string template, string parameters) =>
        Assert.Equal(AdminCosmeticCodes.ParamInvalid, CodeOf(Check(Entrance, template, parameters)));

    [Fact]
    public void AFlipbookEntrancePlaysAnUploadedSpriteSheet()
    {
        var check = Check(Entrance, "flipbook", $$"""
            { "sheetUrl": "{{Picture}}", "cols": 4, "rows": 2, "frames": 7, "fps": 12, "loop": false, "place": "hero", "size": 1.2,
              "blend": "add", "tint": "120,200,255", "duration": 6 }
            """);

        Assert.Empty(check.Violations);
        var values = check.Visual!.Params;
        Assert.Equal("flipbook", check.Visual.Template);
        Assert.Null(check.Visual.ImageUrl);
        Assert.Equal(Picture, values["sheetUrl"].AsString);
        Assert.Equal(4, values["cols"].ToDouble());
        Assert.Equal(7, values["frames"].ToDouble());
        Assert.False(values["loop"].AsBoolean);
        Assert.Equal("hero", values["place"].AsString);
        Assert.Equal("add", values["blend"].AsString);
        Assert.Equal(6, values["duration"].ToDouble());
    }

    [Theory]
    [InlineData("hero")]
    [InlineData("screen")]
    [InlineData("across")]
    [InlineData("drop")]
    public void AFlipbookMayPlayInFourPlaces(string place) =>
        Assert.Empty(Check(Entrance, "flipbook", $$"""{ "sheetUrl": "{{Picture}}", "cols": 1, "rows": 1, "place": "{{place}}" }""").Violations);

    [Fact]
    public void AFlipbookNeedsASheet()
    {
        Assert.Equal(AdminCosmeticCodes.ImageRequired, CodeOf(Check(Entrance, "flipbook", """{ "cols": 1, "rows": 1 }""")));
        Assert.Equal(AdminCosmeticCodes.ImageInvalid, CodeOf(Check(Entrance, "flipbook", """{ "sheetUrl": "javascript:alert(1)", "cols": 1, "rows": 1 }""")));
    }

    [Theory]
    [InlineData(""" "cols": 0, "rows": 1 """)]
    [InlineData(""" "cols": 40, "rows": 1 """)]
    [InlineData(""" "rows": 2 """)]
    [InlineData(""" "cols": 2, "rows": 0 """)]
    [InlineData(""" "cols": 4, "rows": 2, "frames": 9 """)]
    [InlineData(""" "cols": 4, "rows": 2, "frames": 0 """)]
    [InlineData(""" "cols": 4, "rows": 2, "fps": 0 """)]
    [InlineData(""" "cols": 4, "rows": 2, "fps": 200 """)]
    [InlineData(""" "cols": 4, "rows": 2, "place": "moon" """)]
    [InlineData(""" "cols": 4, "rows": 2, "blend": "multiply" """)]
    [InlineData(""" "cols": 4, "rows": 2, "size": 10 """)]
    [InlineData(""" "cols": 4, "rows": 2, "loop": "yes" """)]
    [InlineData(""" "cols": 4, "rows": 2, "imageUrl": "/assets/a.webp" """)]
    [InlineData(""" "cols": 4, "rows": 2, "swordUrl": "/assets/a.webp" """)]
    public void AFlipbookChecksItsSheetLayout(string fields) =>
        Assert.Equal(AdminCosmeticCodes.ParamInvalid, CodeOf(Check(Entrance, "flipbook", $$"""{ "sheetUrl": "{{Picture}}", {{fields}} }""")));

    [Fact]
    public void TheSwordStageMayChangeItsSword() =>
        Assert.Empty(Check(Entrance, "van-kiem", """{ "swordUrl": "/assets/cosmetics/kiem.webp" }""").Violations);

    // ------------------------------------------------------------------ templates

    [Theory]
    [InlineData(Frame, "style")]
    [InlineData(Frame, null)]
    [InlineData(Frame, "shiny")]
    [InlineData(Title, "shiny")]
    [InlineData(Title, null)]
    [InlineData(Entrance, "painted")]
    [InlineData(Entrance, null)]
    [InlineData(Entrance, "rong-bay")]
    public void AnUnknownTemplateIsRefused(string category, string? template) =>
        Assert.Equal(AdminCosmeticCodes.TemplateUnknown, CodeOf(Check(category, template, "{}")));

    [Fact]
    public void OnlyCosmeticsHaveAVisualHere() =>
        Assert.Equal(AdminCosmeticCodes.NotCosmetic, CodeOf(Check(MarketCategories.Curio, "painted", "{}")));

    // ------------------------------------------------------------------ small fields

    [Theory]
    [InlineData("Hắc Long Đỏ", "hac-long-do")]
    [InlineData("  Vạn   Kiếm!! ", "van-kiem")]
    [InlineData("!!!", "mon")]
    [InlineData("none", "none-moi")]
    [InlineData("constructor", "constructor-moi")]
    public void IdsAreBuiltFromNames(string name, string slug) => Assert.Equal(slug, AdminCosmeticRules.SlugOf(name));

    [Fact]
    public void ALongNameMakesAShortId() => Assert.True(AdminCosmeticRules.SlugOf(new string('a', 90)).Length <= 40);

    [Theory]
    [InlineData(null, false)]
    [InlineData("   ", false)]
    [InlineData("Viền", true)]
    public void NamesMustNotBeBlank(string? name, bool valid) => Assert.Equal(valid, AdminCosmeticRules.ValidateName(name) is null);

    [Fact]
    public void NamesHaveALimit() => Assert.NotNull(AdminCosmeticRules.ValidateName(new string('a', 61)));

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(50, true)]
    [InlineData(51, false)]
    public void LevelsFollowTheCap(int level, bool valid) => Assert.Equal(valid, AdminCosmeticRules.ValidateLevel(level) is null);

    [Fact]
    public void ALevelIsRequired() => Assert.NotNull(AdminCosmeticRules.ValidateLevel(null));

    [Theory]
    [InlineData("Played", 10, null)]
    [InlineData("Nothing", 10, AdminCosmeticCodes.MetricUnknown)]
    [InlineData(null, 10, AdminCosmeticCodes.MetricUnknown)]
    [InlineData("Played", 0, AdminCosmeticCodes.TargetInvalid)]
    [InlineData("OwnsWatch217", 1, null)]
    [InlineData("OwnsWatch217", 2, AdminCosmeticCodes.TargetInvalid)]
    public void AchievementsCountWhatTheGameCounts(string? metric, int target, string? code) =>
        Assert.Equal(code, AdminCosmeticRules.ValidateAchievement(metric, target)?.Code);

    [Theory]
    [InlineData(150, 600, true)]
    [InlineData(0, 600, false)]
    [InlineData(150, -1, false)]
    [InlineData(150, 100_001, false)]
    public void XpRatesHaveLimits(long rare, long epic, bool valid) => Assert.Equal(valid, AdminCosmeticRules.ValidateXp(rare, epic) is null);

    [Theory]
    [InlineData("level", true)]
    [InlineData("achievement", true)]
    [InlineData("default", true)]
    [InlineData("admin", false)]
    public void WhatIsHandedOutForFreeCannotBeTraded(string mode, bool earned) => Assert.Equal(earned, AdminCosmeticRules.IsEarnedMode(mode));

    [Fact]
    public void AReasonIsTrimmedAndBlankMeansNone()
    {
        Assert.Null(AdminCosmeticRules.CleanReason("   "));
        Assert.Equal("Sửa lỗi", AdminCosmeticRules.CleanReason("  Sửa lỗi "));
        Assert.Equal(AdminCosmeticRules.MaxReasonLength, AdminCosmeticRules.CleanReason(new string('a', 900))!.Length);
    }

    // ------------------------------------------------------------------ who may call it

    [Fact]
    public void OnlyAdminsReachTheAdminRoutes()
    {
        var authorize = typeof(AdminCosmeticsController).GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single();
        Assert.Equal(UserRole.Admin, authorize.Roles);
    }

    [Fact]
    public void NoAdminRouteOpensItselfUp()
    {
        var open = typeof(AdminCosmeticsController).GetMethods()
            .Where(method => method.GetCustomAttributes(typeof(AllowAnonymousAttribute), true).Length > 0);
        Assert.Empty(open);
    }

    [Fact]
    public void ThePlayersCatalogNeedsASignedInPlayer()
    {
        var authorize = typeof(CosmeticsCatalogController).GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single();
        Assert.Null(authorize.Roles);
    }
}
