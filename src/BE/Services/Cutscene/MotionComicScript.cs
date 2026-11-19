using System.Text.Json.Serialization;

namespace SirLocked.Api.Services.Cutscene;

/// <summary>
/// The motion-comic intro script. The AI only fills this data: layouts, art picks, text beats. Geometry, camera and
/// timing are computed by the front-end engine, so a valid script always plays.
/// </summary>
public sealed class MotionComicScript
{
    public const string FormatName = "motion-comic-v1";

    [JsonPropertyName("format")] public string Format { get; set; } = FormatName;
    [JsonPropertyName("caseId")] public string CaseId { get; set; } = string.Empty;
    [JsonPropertyName("language")] public string Language { get; set; } = "vi";
    [JsonPropertyName("title")] public ComicTitle Title { get; set; } = new();
    [JsonPropertyName("mood")] public string Mood { get; set; } = string.Empty;
    [JsonPropertyName("pages")] public List<ComicPage> Pages { get; set; } = new();
}

public sealed class ComicTitle
{
    [JsonPropertyName("eyebrow")] public string Eyebrow { get; set; } = string.Empty;
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
    [JsonPropertyName("subtitle")] public string Subtitle { get; set; } = string.Empty;
}

public sealed class ComicPage
{
    [JsonPropertyName("layout")] public string Layout { get; set; } = string.Empty;
    [JsonPropertyName("panels")] public List<ComicPanel> Panels { get; set; } = new();
}

public sealed class ComicPanel
{
    [JsonPropertyName("art")] public ComicArt Art { get; set; } = new();
    [JsonPropertyName("weather")] public string Weather { get; set; } = "none";
    [JsonPropertyName("enter")] public string Enter { get; set; } = "none";
    [JsonPropertyName("beats")] public List<ComicBeat> Beats { get; set; } = new();
    [JsonPropertyName("audio")] public List<string> Audio { get; set; } = new();
}

public sealed class ComicArt
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = string.Empty;
    [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
    /// <summary>Focus rectangle as fractions of the source image: x, y, width, height.</summary>
    [JsonPropertyName("focus")] public List<double> Focus { get; set; } = new();
}

public sealed class ComicBeat
{
    [JsonPropertyName("type")] public string Type { get; set; } = string.Empty;
    [JsonPropertyName("speakerId")] public string SpeakerId { get; set; } = string.Empty;
    [JsonPropertyName("text")] public string Text { get; set; } = string.Empty;
    [JsonPropertyName("style")] public string Style { get; set; } = string.Empty;
}

public static class MotionComicRules
{
    public const int MinPages = 2, MaxPages = 3, MinPanels = 5, MaxPanels = 9, MaxBeatsPerPanel = 3;
    public const int MaxLineLength = 90, MaxSfxLength = 12, MaxTitleLength = 80, MaxSubtitleLength = 140;
    public const double MinSeconds = 40, MaxSeconds = 75;

    /// <summary>Layout name to the number of panels it holds (the front end owns the polygons).</summary>
    public static readonly IReadOnlyDictionary<string, int> Layouts = new Dictionary<string, int>
    {
        ["wide-top-two-bottom"] = 3,
        ["tall-left-two-right"] = 3,
        ["three-strips"] = 3,
        ["splash"] = 1,
        ["splash-inset"] = 2
    };

    public static readonly string[] Moods = { "rain-night", "fog-morning", "warm-dusk", "neon-night", "clear-day", "storm-night", "candle-dark" };
    public static readonly string[] Weathers = { "none", "rain", "fog", "streetlight", "sunrise", "night" };
    public static readonly string[] Enters = { "none", "top", "left", "right", "bottom" };
    public static readonly string[] ArtKinds = { "scene", "character", "item", "cover" };
    public static readonly string[] BeatTypes = { "caption", "speech", "sfx" };
    public static readonly string[] SfxStyles = { "impact", "soft", "glass", "phone", "thunder" };
    public static readonly string[] AudioCues = { "thump", "ring", "siren", "shatter", "thunder", "ticking" };
    public const int MaxAudioCuesPerPanel = 2;

    // The engine uses the same constants, so the estimate here matches playback.
    private const double TitleSeconds = 4.5, PanelSeconds = 0.9, PageFlipSeconds = 1.1, SfxSeconds = 1.2,
        LineBaseSeconds = 1.7, LinePerCharSeconds = 0.05;

    public static double EstimateSeconds(MotionComicScript script)
    {
        var total = TitleSeconds;
        foreach (var page in script.Pages)
        {
            total += PageFlipSeconds;
            foreach (var panel in page.Panels)
            {
                total += PanelSeconds;
                foreach (var beat in panel.Beats)
                    total += beat.Type == "sfx" ? SfxSeconds : LineBaseSeconds + LinePerCharSeconds * (beat.Text?.Length ?? 0);
            }
        }
        return Math.Round(total, 1);
    }
}
