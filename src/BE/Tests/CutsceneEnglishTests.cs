using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Cutscene;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// The optional English version of an intro cutscene (titleEn + textEn on every beat): what the English interface
/// plays. When it is there it must be complete, English, within the limits, and never name the culprit.
/// </summary>
public sealed class CutsceneEnglishTests
{
    private const string Tram = "case-pixel-tram-hong-ngoc-vi";

    private static (MotionComicScript Script, GameCase Case) Bundled(string caseId = Tram) =>
        (JsonSerializer.Deserialize<MotionComicScript>(File.ReadAllText(CutsceneService.SeedFilePath(caseId)))!,
         CutsceneScriptTests.Load(caseId + ".json"));

    private static IEnumerable<ComicBeat> Beats(MotionComicScript script) =>
        script.Pages.SelectMany(page => page.Panels).SelectMany(panel => panel.Beats);

    private static List<CutsceneIssue> Check(MotionComicScript script, GameCase gameCase) => CutsceneScriptValidator.Validate(script, gameCase);

    [Fact]
    public void TheBundledScript_WithItsEnglishVersion_IsValid_AndPlaysInEnglish()
    {
        var (script, gameCase) = Bundled();
        Assert.Empty(Check(script, gameCase));
        var english = MotionComicRules.English(script);
        Assert.Equal(script.TitleEn!.Title, english.Title.Title);
        Assert.Equal(Beats(script).Select(beat => beat.TextEn), Beats(english).Select(beat => (string?)beat.Text));
        Assert.InRange(MotionComicRules.EstimateSeconds(english), MotionComicRules.MinSeconds, MotionComicRules.MaxSeconds);
        // The Vietnamese version is untouched by the translation.
        Assert.False(MotionComicRules.HasEnglish(MotionComicRules.WithoutEnglish(script)));
        Assert.Empty(Check(MotionComicRules.WithoutEnglish(script), gameCase));
    }

    [Fact]
    public void HalfATranslation_IsRefused()
    {
        var (script, gameCase) = Bundled();
        Beats(script).Last().TextEn = null;
        Assert.Contains(Check(script, gameCase), issue => issue.Path.EndsWith(".textEn", StringComparison.Ordinal));

        var (noTitle, _) = Bundled();
        noTitle.TitleEn = null;
        Assert.Contains(Check(noTitle, gameCase), issue => issue.Path == "titleEn");
    }

    [Fact]
    public void VietnameseInTheEnglishFields_IsRefused()
    {
        var (script, gameCase) = Bundled();
        foreach (var beat in Beats(script)) beat.TextEn = beat.Text;
        script.TitleEn = new ComicTitle { Eyebrow = script.Title.Eyebrow, Title = script.Title.Title, Subtitle = script.Title.Subtitle };
        Assert.Contains(Check(script, gameCase), issue => issue.Message.Contains("English", StringComparison.Ordinal));
    }

    [Fact]
    public void AnEnglishLineAccusingTheCulprit_IsRefused()
    {
        var (script, gameCase) = Bundled();
        var culprit = gameCase.Characters.Single(character => character.CharacterId == gameCase.FinalLogic.CulpritId);
        Beats(script).First(beat => beat.Type == "caption").TextEn = $"{culprit.Name} is the culprit, of course.";
        Assert.Contains(Check(script, gameCase), issue => issue.Message.Contains("accuses", StringComparison.Ordinal));
    }

    [Fact]
    public void TooLongAnEnglishLine_IsRefused()
    {
        var (script, gameCase) = Bundled();
        Beats(script).First(beat => beat.Type == "caption").TextEn = new string('a', MotionComicRules.MaxLineLength + 1);
        Assert.Contains(Check(script, gameCase), issue => issue.Message.Contains("limit", StringComparison.Ordinal));
    }
}
