using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Cutscene;

public sealed record CutsceneIssue(string Path, string Message);

/// <summary>Checks an AI-written (or hand-edited) script against the motion-comic contract and the case it belongs to.</summary>
public static class CutsceneScriptValidator
{
    private static readonly string[] EnglishStopwords =
        { "the", "and", "with", "was", "were", "her", "his", "their", "she", "they", "for", "from", "that", "this", "into", "had" };

    private static readonly Regex AccusationWords = new(
        @"hung thu|thu pham|ke giet|sat nhan|giet nguoi|ke gian|ke trom|the culprit|murderer|killer", RegexOptions.Compiled);

    public static List<CutsceneIssue> Validate(MotionComicScript? script, GameCase gameCase)
    {
        var issues = new List<CutsceneIssue>();
        if (script is null) { issues.Add(new("$", "Script is empty.")); return issues; }
        void Add(string path, string message) => issues.Add(new CutsceneIssue(path, message));

        if (script.Format != MotionComicScript.FormatName) Add("format", $"format must be {MotionComicScript.FormatName}.");
        if (!string.Equals(script.CaseId, gameCase.CaseId, StringComparison.Ordinal)) Add("caseId", "caseId must match the case.");
        if (script.Language != "vi") Add("language", "language must be vi.");
        if (!MotionComicRules.Moods.Contains(script.Mood)) Add("mood", "mood is not in the allowed list.");
        CheckText(script.Title?.Title, "title.title", MotionComicRules.MaxTitleLength, Add);
        CheckText(script.Title?.Eyebrow, "title.eyebrow", MotionComicRules.MaxTitleLength, Add);
        CheckText(script.Title?.Subtitle, "title.subtitle", MotionComicRules.MaxSubtitleLength, Add);

        var pages = script.Pages ?? new();
        if (pages.Count < MotionComicRules.MinPages || pages.Count > MotionComicRules.MaxPages)
            Add("pages", $"Use {MotionComicRules.MinPages}-{MotionComicRules.MaxPages} pages.");
        var scenes = gameCase.Stages.SelectMany(stage => stage.Scenes).GroupBy(scene => scene.SceneId)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var characters = gameCase.Characters.GroupBy(character => character.CharacterId)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var items = gameCase.Items.GroupBy(item => item.ItemId)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var texts = new List<(string Path, string Text)>();
        var panelCount = 0;

        for (var p = 0; p < pages.Count; p++)
        {
            var page = pages[p];
            if (page is null || !MotionComicRules.Layouts.TryGetValue(page.Layout ?? "", out var expected))
            { Add($"pages[{p}].layout", "Unknown layout."); continue; }
            var panels = page.Panels ?? new();
            if (panels.Count != expected) Add($"pages[{p}].panels", $"Layout {page.Layout} holds exactly {expected} panels.");
            panelCount += panels.Count;
            for (var q = 0; q < panels.Count; q++)
                ValidatePanel(panels[q], $"pages[{p}].panels[{q}]", gameCase, scenes, characters, items, texts, Add);
        }
        if (panelCount < MotionComicRules.MinPanels || panelCount > MotionComicRules.MaxPanels)
            Add("pages", $"Use {MotionComicRules.MinPanels}-{MotionComicRules.MaxPanels} panels in total (got {panelCount}).");

        if (issues.Count == 0)
        {
            var seconds = MotionComicRules.EstimateSeconds(script);
            if (seconds < MotionComicRules.MinSeconds || seconds > MotionComicRules.MaxSeconds)
                Add("duration", $"Estimated duration {seconds:0.#}s must be {MotionComicRules.MinSeconds:0}-{MotionComicRules.MaxSeconds:0}s: " +
                    (seconds < MotionComicRules.MinSeconds ? "add more or longer beats." : "shorten or remove beats."));
        }

        var languageTexts = texts.Select(entry => entry.Text).Append(script.Title?.Title ?? "").Append(script.Title?.Subtitle ?? "").ToList();
        CheckVietnamese(languageTexts, Add);
        CheckSpoilers(script, gameCase, texts, Add);
        return issues;
    }

    private static void ValidatePanel(ComicPanel? panel, string path, GameCase gameCase, Dictionary<string, CaseScene> scenes,
        Dictionary<string, CaseCharacter> characters, Dictionary<string, CaseItem> items,
        List<(string, string)> texts, Action<string, string> add)
    {
        if (panel is null) { add(path, "Panel is empty."); return; }
        var art = panel.Art ?? new ComicArt();
        if (!MotionComicRules.ArtKinds.Contains(art.Kind)) add($"{path}.art.kind", "Unknown art kind.");
        else if (!ArtExists(art, gameCase, scenes, characters, items)) add($"{path}.art.id", $"No {art.Kind} with an image has id '{art.Id}'.");
        var focus = art.Focus ?? new();
        if (focus.Count != 4 || focus.Any(v => double.IsNaN(v) || v < 0 || v > 1) || focus[2] < 0.2 || focus[3] < 0.2
            || focus[0] + focus[2] > 1.001 || focus[1] + focus[3] > 1.001)
            add($"{path}.art.focus", "focus must be [x, y, w, h] fractions inside the image, with w and h at least 0.2.");
        if (!MotionComicRules.Weathers.Contains(panel.Weather)) add($"{path}.weather", "Unknown weather.");
        if (!MotionComicRules.Enters.Contains(panel.Enter)) add($"{path}.enter", "Unknown enter direction.");
        var audio = panel.Audio ?? new();
        if (audio.Count > MotionComicRules.MaxAudioCuesPerPanel || audio.Any(cue => !MotionComicRules.AudioCues.Contains(cue)))
            add($"{path}.audio", $"At most {MotionComicRules.MaxAudioCuesPerPanel} cues from the allowed list.");

        var beats = panel.Beats ?? new();
        if (beats.Count < 1 || beats.Count > MotionComicRules.MaxBeatsPerPanel)
            add($"{path}.beats", $"Use 1-{MotionComicRules.MaxBeatsPerPanel} beats per panel.");
        for (var b = 0; b < beats.Count; b++)
        {
            var beat = beats[b];
            var bp = $"{path}.beats[{b}]";
            if (beat is null || !MotionComicRules.BeatTypes.Contains(beat.Type)) { add(bp, "Unknown beat type."); continue; }
            if (beat.Type == "sfx")
            {
                CheckText(beat.Text, bp + ".text", MotionComicRules.MaxSfxLength, add);
                if (!MotionComicRules.SfxStyles.Contains(beat.Style)) add(bp + ".style", "Unknown sfx style.");
            }
            else
            {
                CheckText(beat.Text, bp + ".text", MotionComicRules.MaxLineLength, add);
                if (beat.Type == "speech" && !characters.ContainsKey(beat.SpeakerId ?? ""))
                    add(bp + ".speakerId", "speakerId must be a character of the case.");
            }
            texts.Add((bp, beat.Text ?? ""));
        }
    }

    private static bool ArtExists(ComicArt art, GameCase gameCase, Dictionary<string, CaseScene> scenes,
        Dictionary<string, CaseCharacter> characters, Dictionary<string, CaseItem> items) => art.Kind switch
    {
        "scene" => scenes.TryGetValue(art.Id ?? "", out var scene) && !string.IsNullOrWhiteSpace(scene.BackgroundUrl),
        "character" => characters.TryGetValue(art.Id ?? "", out var character) && !string.IsNullOrWhiteSpace(character.ImageUrl),
        "item" => items.TryGetValue(art.Id ?? "", out var item) && !string.IsNullOrWhiteSpace(item.ImageUrl),
        "cover" => art.Id == CutsceneInputBuilder.CoverId && !string.IsNullOrWhiteSpace(gameCase.CoverImageUrl),
        _ => false
    };

    private static void CheckText(string? text, string path, int max, Action<string, string> add)
    {
        if (string.IsNullOrWhiteSpace(text)) add(path, "Text is required.");
        else if (text.Trim().Length > max) add(path, $"Text is {text.Trim().Length} characters; the limit is {max}.");
    }

    private static void CheckVietnamese(List<string> texts, Action<string, string> add)
    {
        var lines = texts.Where(text => text.Trim().Length >= 15).ToList();
        if (lines.Count == 0) return;
        var withDiacritics = lines.Count(text => text.Any(IsVietnameseLetter));
        var englishHits = lines.Sum(text => Regex.Matches(text.ToLowerInvariant(), @"\b[a-z']+\b")
            .Count(word => EnglishStopwords.Contains(word.Value)));
        if (withDiacritics * 2 < lines.Count || englishHits >= 3) add("language", "Text must be Vietnamese with proper diacritics.");
    }

    private static bool IsVietnameseLetter(char c) =>
        "ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ".Contains(char.ToLowerInvariant(c));

    // ---------------------------------------------------------------- spoilers

    private static void CheckSpoilers(MotionComicScript script, GameCase gameCase,
        List<(string Path, string Text)> texts, Action<string, string> add)
    {
        var scriptTexts = texts.Select(entry => (entry.Path, Norm: Normalize(entry.Text)))
            .Append(("title.subtitle", Normalize(script.Title?.Subtitle)))
            .Append(("title.title", Normalize(script.Title?.Title))).ToList();

        var forbidden = new List<string>();
        foreach (var clue in gameCase.Clues.Where(clue => clue.IsCritical)) forbidden.Add(clue.Title);
        foreach (var challenge in gameCase.EvidenceChallenges) forbidden.Add(challenge.RevealTitle);
        foreach (var puzzle in gameCase.Puzzles)
        {
            forbidden.Add(puzzle.CorrectCode);
            forbidden.AddRange(puzzle.CorrectSequence);
        }
        // Anything the player already sees (the case title, an item or place name) is not a spoiler, even when a
        // hidden clue happens to share that wording.
        var publicText = PublicCorpus(gameCase);
        foreach (var phrase in forbidden.Select(Normalize).Where(phrase => phrase.Length >= 4).Distinct()
                     .Where(phrase => !ContainsPhrase(publicText, phrase)))
            foreach (var (path, norm) in scriptTexts)
                if (ContainsPhrase(norm, phrase)) add(path, "Text repeats a hidden clue title, reveal title or puzzle answer.");

        var sources = gameCase.Clues.Where(clue => clue.IsCritical).Select(clue => clue.Content)
            .Append(gameCase.FinalLogic?.Motive ?? "").Append(gameCase.FinalLogic?.Method ?? "")
            .Append(gameCase.FinalLogic?.WinEnding ?? "").Append(gameCase.FinalLogic?.FailEnding ?? "");
        var publicShingles = Shingles(publicText, 5).ToHashSet(StringComparer.Ordinal);
        var shingles = sources.SelectMany(source => Shingles(Normalize(source), 5)).Where(shingle => !publicShingles.Contains(shingle))
            .ToHashSet(StringComparer.Ordinal);
        foreach (var (path, norm) in scriptTexts)
            if (Shingles(norm, 5).Any(shingles.Contains)) add(path, "Text copies a sentence from a critical clue or the case solution.");

        var culprit = gameCase.Characters.FirstOrDefault(character => character.CharacterId == gameCase.FinalLogic?.CulpritId);
        if (culprit is not null)
        {
            var name = Normalize(culprit.Name);
            foreach (var (path, norm) in scriptTexts)
                if (name.Length > 0 && norm.Contains(name) && AccusationWords.IsMatch(norm)) add(path, "Text accuses a named character.");
        }
    }

    /// <summary>The text a player reads before any investigation: the same allow-list the AI is given.</summary>
    internal static string PublicCorpus(GameCase gameCase)
    {
        var parts = new List<string> { gameCase.Title, gameCase.Summary };
        parts.AddRange(gameCase.Stages.SelectMany(stage => stage.Scenes).SelectMany(scene => new[] { scene.Title, scene.Description }));
        parts.AddRange(gameCase.Characters.SelectMany(character => new[] { character.Name, character.Role, character.Description }));
        parts.AddRange(gameCase.Items.SelectMany(item => new[] { item.Name, item.Description }));
        return " " + string.Join(" . ", parts.Select(Normalize)) + " ";
    }

    private static bool ContainsPhrase(string haystack, string phrase) =>
        Regex.IsMatch(haystack, $@"(^|\s){Regex.Escape(phrase)}(\s|$)");

    private static IEnumerable<string> Shingles(string normalized, int size)
    {
        var words = normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i + size <= words.Length; i++) yield return string.Join(' ', words, i, size);
    }

    /// <summary>Lower-case, no diacritics, punctuation collapsed to single spaces.</summary>
    internal static string Normalize(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        var decomposed = text.Replace('đ', 'd').Replace('Đ', 'D').Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            sb.Append(char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : ' ');
        }
        return Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
    }
}
