using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Cutscene;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public sealed class CutsceneScriptTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public static IEnumerable<object[]> PixelCases() =>
        new[] { "case-pixel-tram-hong-ngoc-vi.json", "case-pixel-lo-thuoc-thu-nam-vi.json" }.Select(file => new object[] { file });

    internal static GameCase Load(string file) => JsonSerializer.Deserialize<GameCase>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", file)), Web)!;

    private static MotionComicScript Valid(GameCase gameCase) => CutsceneMockScriptFactory.Create(gameCase);

    private static List<CutsceneIssue> Check(MotionComicScript script, GameCase gameCase) => CutsceneScriptValidator.Validate(script, gameCase);

    // ---------------------------------------------------------------- input builder: no secrets

    [Theory, MemberData(nameof(PixelCases))]
    public void Input_ContainsNoHiddenCaseData(string file)
    {
        var gameCase = Load(file);
        var json = CutsceneInputBuilder.BuildJson(gameCase);
        var normalized = CutsceneScriptValidator.Normalize(json);

        foreach (var field in new[] { "narrativeMeaning", "evidenceChallenges", "revealTitle", "successResponse", "failureResponse", "timeline",
                     "finalLogic", "culpritId", "correctCode", "correctSequence", "solutionJson", "revealJson", "clues", "puzzles", "deductions" })
            Assert.DoesNotContain(field, json, StringComparison.OrdinalIgnoreCase);

        var secrets = gameCase.Clues.Where(clue => clue.IsCritical).SelectMany(clue => new[] { clue.Title, clue.Content })
            .Concat(gameCase.EvidenceChallenges.SelectMany(challenge => new[] { challenge.RevealTitle, challenge.SuccessResponse }))
            .Concat(gameCase.Puzzles.SelectMany(puzzle => puzzle.CorrectSequence.Append(puzzle.CorrectCode)))
            .Append(gameCase.FinalLogic.Motive).Append(gameCase.FinalLogic.Method).Append(gameCase.FinalLogic.WinEnding)
            .Select(CutsceneScriptValidator.Normalize).Where(text => text.Length >= 6).Distinct()
            .Where(text => !CutsceneScriptValidator.PublicCorpus(gameCase).Contains(text)).ToList();
        Assert.NotEmpty(secrets);
        foreach (var secret in secrets)
            Assert.False(normalized.Contains(secret), $"The AI input contains hidden case text: {secret}");
    }

    [Theory, MemberData(nameof(PixelCases))]
    public void Input_OnlyListsPlayableArt(string file)
    {
        var gameCase = Load(file);
        var input = CutsceneInputBuilder.Build(gameCase);
        var itemIds = input["itemsWithImages"]!.AsArray().Select(node => node!["id"]!.GetValue<string>()).ToHashSet();
        Assert.All(itemIds, id => Assert.False(string.IsNullOrWhiteSpace(gameCase.Items.Single(item => item.ItemId == id).ImageUrl)));
        Assert.Equal(gameCase.Items.Count(item => !string.IsNullOrWhiteSpace(item.ImageUrl)), itemIds.Count);
    }

    // ---------------------------------------------------------------- validator

    [Theory, MemberData(nameof(PixelCases))]
    public void Validator_AcceptsTheMockScript(string file)
    {
        var gameCase = Load(file);
        var script = Valid(gameCase);
        Assert.Empty(Check(script, gameCase));
        var seconds = MotionComicRules.EstimateSeconds(script);
        Assert.InRange(seconds, MotionComicRules.MinSeconds, MotionComicRules.MaxSeconds);
    }

    private const string Tram = "case-pixel-tram-hong-ngoc-vi.json";
    private const string LoThuoc = "case-pixel-lo-thuoc-thu-nam-vi.json";

    [Fact]
    public void Validator_RejectsWrongFormatCaseAndLanguage()
    {
        var gameCase = Load(Tram);
        var script = Valid(gameCase);
        script.Format = "other"; script.CaseId = "x"; script.Language = "en"; script.Mood = "sunny";
        var paths = Check(script, gameCase).Select(issue => issue.Path).ToList();
        Assert.Contains("format", paths); Assert.Contains("caseId", paths); Assert.Contains("language", paths); Assert.Contains("mood", paths);
    }

    [Fact]
    public void Validator_RejectsTooLongLinesAndSfx()
    {
        var gameCase = Load(Tram);
        var script = Valid(gameCase);
        script.Pages[0].Panels[0].Beats[0].Text = new string('a', 91);
        script.Pages[0].Panels[0].Beats[1].Text = "ẦM!!ẦM!!ẦM!!ẦM!!";
        var issues = Check(script, gameCase);
        Assert.Contains(issues, issue => issue.Path.EndsWith("beats[0].text"));
        Assert.Contains(issues, issue => issue.Path.EndsWith("beats[1].text"));
    }

    [Fact]
    public void Validator_RejectsUnknownIdsAndItemsWithoutImage()
    {
        var gameCase = Load(Tram);
        var noImage = gameCase.Items.First(item => string.IsNullOrWhiteSpace(item.ImageUrl));
        var script = Valid(gameCase);
        script.Pages[0].Panels[0].Art = new ComicArt { Kind = "scene", Id = "scene-does-not-exist", Focus = new() { 0, 0, 1, 1 } };
        script.Pages[0].Panels[1].Art = new ComicArt { Kind = "item", Id = noImage.ItemId, Focus = new() { 0, 0, 1, 1 } };
        script.Pages[0].Panels[2].Art = new ComicArt { Kind = "character", Id = "nobody", Focus = new() { 0, 0, 1, 1 } };
        var paths = Check(script, gameCase).Select(issue => issue.Path).ToList();
        Assert.Contains("pages[0].panels[0].art.id", paths);
        Assert.Contains("pages[0].panels[1].art.id", paths);
        Assert.Contains("pages[0].panels[2].art.id", paths);
    }

    [Fact]
    public void Validator_RejectsBadFocusSpeakerWeatherAndAudio()
    {
        var gameCase = Load(Tram);
        var script = Valid(gameCase);
        var panel = script.Pages[0].Panels[0];
        panel.Art.Focus = new() { 0.9, 0.9, 0.5, 0.5 };
        panel.Weather = "tornado"; panel.Enter = "diagonal"; panel.Audio = new() { "thump", "ring", "siren" };
        panel.Beats.Add(new ComicBeat { Type = "speech", SpeakerId = "ghost", Text = "Tôi không nói gì cả hôm nay." });
        var paths = Check(script, gameCase).Select(issue => issue.Path).ToList();
        Assert.Contains("pages[0].panels[0].art.focus", paths);
        Assert.Contains("pages[0].panels[0].weather", paths);
        Assert.Contains("pages[0].panels[0].enter", paths);
        Assert.Contains("pages[0].panels[0].audio", paths);
        Assert.Contains("pages[0].panels[0].beats[2].speakerId", paths);
    }

    [Fact]
    public void Validator_RejectsWrongPageAndPanelCounts()
    {
        var gameCase = Load(Tram);
        var script = Valid(gameCase);
        script.Pages.RemoveAt(1);
        Assert.Contains(Check(script, gameCase), issue => issue.Path == "pages");

        script = Valid(gameCase);
        script.Pages[0].Panels.RemoveAt(2);
        Assert.Contains(Check(script, gameCase), issue => issue.Path == "pages[0].panels");

        script = Valid(gameCase);
        script.Pages[0].Layout = "pinwheel";
        Assert.Contains(Check(script, gameCase), issue => issue.Path == "pages[0].layout");
    }

    [Fact]
    public void Validator_RejectsDurationOutsideTheRange()
    {
        var gameCase = Load(Tram);
        var tooShort = Valid(gameCase);
        foreach (var panel in tooShort.Pages.SelectMany(page => page.Panels)) panel.Beats.RemoveAt(0);
        Assert.Contains(Check(tooShort, gameCase), issue => issue.Path == "duration");

        var tooLong = Valid(gameCase);
        foreach (var panel in tooLong.Pages.SelectMany(page => page.Panels))
        {
            var line = "Một câu dài gần chín mươi ký tự để kéo thời lượng lên thật nhiều, vẫn còn đúng giới hạn.";
            panel.Beats = Enumerable.Range(0, 3).Select(_ => new ComicBeat { Type = "caption", Text = line }).ToList();
        }
        Assert.Contains(Check(tooLong, gameCase), issue => issue.Path == "duration");
    }

    [Fact]
    public void Validator_RejectsEnglishText()
    {
        var gameCase = Load(Tram);
        var script = Valid(gameCase);
        foreach (var beat in script.Pages.SelectMany(page => page.Panels).SelectMany(panel => panel.Beats).Where(beat => beat.Type == "caption"))
            beat.Text = "The night was quiet and the street was empty with her shadow.";
        Assert.Contains(Check(script, gameCase), issue => issue.Path == "language");
    }

    [Theory, InlineData(Tram), InlineData(LoThuoc)]
    public void Validator_RejectsCriticalClueTitlesAndCopiedSentences(string file)
    {
        var gameCase = Load(file);
        var publicText = CutsceneScriptValidator.PublicCorpus(gameCase);
        var critical = gameCase.Clues.First(clue => clue.IsCritical && clue.Title.Length >= 6
            && !publicText.Contains(" " + CutsceneScriptValidator.Normalize(clue.Title) + " "));

        var script = Valid(gameCase);
        script.Pages[0].Panels[0].Beats[0].Text = $"Tôi thấy {critical.Title} ngay đó.";
        Assert.Contains(Check(script, gameCase), issue => issue.Message.Contains("hidden clue title"));

        var words = critical.Content.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        Assert.True(words.Length >= 6, "fixture: critical clue content is long enough to copy");
        script = Valid(gameCase);
        script.Pages[0].Panels[0].Beats[0].Text = string.Join(' ', words.Take(6));
        Assert.Contains(Check(script, gameCase), issue => issue.Message.Contains("copies a sentence"));
    }

    [Theory, InlineData(Tram), InlineData(LoThuoc)]
    public void Validator_RejectsRevealTitlesAndPuzzleAnswers(string file)
    {
        var gameCase = Load(file);
        var reveal = gameCase.EvidenceChallenges.Select(challenge => challenge.RevealTitle).First(title => title.Length >= 6);
        var script = Valid(gameCase);
        script.Pages[0].Panels[0].Beats[0].Text = $"Rồi tôi biết: {reveal}.";
        Assert.Contains(Check(script, gameCase), issue => issue.Message.Contains("reveal title"));
    }

    [Theory, InlineData(Tram), InlineData(LoThuoc)]
    public void Validator_RejectsNamingTheCulpritAsGuilty(string file)
    {
        var gameCase = Load(file);
        var culprit = gameCase.Characters.Single(character => character.CharacterId == gameCase.FinalLogic.CulpritId);
        var script = Valid(gameCase);
        script.Pages[0].Panels[0].Beats[0].Text = $"{culprit.Name} chính là hung thủ trong vụ này.";
        Assert.Contains(Check(script, gameCase), issue => issue.Message.Contains("accuses"));
    }

    // ---------------------------------------------------------------- generator

    private sealed class FakeClient(params string[] bodies) : IAiOpenAiClient
    {
        public List<string> Payloads { get; } = new();
        public Task<AiProviderHttpResponse> PostStructuredJsonAsync(object payload, CancellationToken cancellationToken = default)
        {
            Payloads.Add(JsonSerializer.Serialize(payload, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
            var body = bodies[Math.Min(Payloads.Count - 1, bodies.Length - 1)];
            return Task.FromResult(new AiProviderHttpResponse(200, true, body));
        }
    }

    private static string Envelope(MotionComicScript script) => JsonSerializer.Serialize(new
    {
        id = "resp_1", status = "completed",
        output = new[] { new { content = new[] { new { type = "output_text", text = JsonSerializer.Serialize(script, CutsceneScriptGenerator.JsonOptions) } } } },
        usage = new { input_tokens = 100, output_tokens = 200 }
    });

    private static CutsceneScriptGenerator Generator(IAiOpenAiClient client, bool mock) => new(client, null,
        Options.Create(new OpenAiSettings { ApiKey = "test-key-not-real", MockAiResponses = mock }),
        Options.Create(new AiUsageSettings()), Options.Create(new CutsceneSettings()), NullLogger<CutsceneScriptGenerator>.Instance);

    [Theory, MemberData(nameof(PixelCases))]
    public async Task Generator_MockMode_NeverCallsTheProvider(string file)
    {
        var client = new FakeClient();
        var result = await Generator(client, mock: true).GenerateAsync(Load(file));
        Assert.True(result.Mock);
        Assert.Empty(client.Payloads);
    }

    [Theory, MemberData(nameof(PixelCases))]
    public async Task Generator_SendsNoHiddenCaseData(string file)
    {
        var gameCase = Load(file);
        var client = new FakeClient(Envelope(Valid(gameCase)));
        await Generator(client, mock: false).GenerateAsync(gameCase);
        var sent = CutsceneScriptValidator.Normalize(Assert.Single(client.Payloads));
        foreach (var secret in gameCase.Clues.Where(clue => clue.IsCritical).Select(clue => CutsceneScriptValidator.Normalize(clue.Content))
                     .Concat(gameCase.EvidenceChallenges.Select(challenge => CutsceneScriptValidator.Normalize(challenge.RevealTitle)))
                     .Where(text => text.Length >= 8))
            Assert.DoesNotContain(secret, sent);
        Assert.DoesNotContain("test key not real", sent);
    }

    [Fact]
    public async Task Generator_RepairsOnceThenSucceeds()
    {
        var gameCase = Load(Tram);
        var bad = Valid(gameCase);
        bad.Pages[0].Panels[0].Beats[0].Text = new string('x', 120);
        var client = new FakeClient(Envelope(bad), Envelope(Valid(gameCase)));
        var result = await Generator(client, mock: false).GenerateAsync(gameCase);
        Assert.True(result.Repaired);
        Assert.Equal(2, client.Payloads.Count);
        Assert.Contains("CÁC LỖI CẦN SỬA", client.Payloads[1]);
    }

    [Fact]
    public async Task Generator_StillInvalidAfterOneRepair_FailsAndSavesNothing()
    {
        var gameCase = Load(Tram);
        var bad = Valid(gameCase);
        bad.Pages[0].Panels[0].Art.Id = "nope";
        var client = new FakeClient(Envelope(bad));
        var error = await Assert.ThrowsAsync<ApiException>(() => Generator(client, mock: false).GenerateAsync(gameCase));
        Assert.Equal(422, error.StatusCode);
        Assert.Equal(2, client.Payloads.Count);
    }

    [Fact]
    public async Task Generator_NotJson_IsRejected()
    {
        var gameCase = Load(Tram);
        var body = JsonSerializer.Serialize(new { id = "r", status = "completed", output = new[] { new { content = new[] { new { type = "output_text", text = "không phải json" } } } } });
        await Assert.ThrowsAsync<ApiException>(() => Generator(new FakeClient(body), mock: false).GenerateAsync(gameCase));
    }
}
