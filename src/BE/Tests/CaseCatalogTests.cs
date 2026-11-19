using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The player-facing catalogue: pixel cases are the main game, older cases stay hidden but intact.</summary>
public sealed class CaseCatalogTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static GameCase Load(string fileName) =>
        JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", fileName)), JsonOptions)!;

    private static GameCase Published(GameCase gameCase)
    {
        gameCase.Status = CaseStatus.Published;
        return gameCase;
    }

    private static CaseCatalogPolicy PixelOnly(bool on = true) => new(new CaseCatalogSettings { PixelOnly = on });

    private static CaseSummaryResponse Summary(string id, string language, int minutes, bool pixel = true, string status = CaseStatus.Published) => new()
    {
        CaseId = id, Title = id, Language = language, EstimatedMinutes = minutes, StageCount = 1, Status = status, IsPixel = pixel
    };

    // ---------------------------------------------------------------- IsPixel

    [Theory]
    [InlineData("case-pixel-tram-hong-ngoc-vi.json", true)]
    [InlineData("case-pixel-lo-thuoc-thu-nam-vi.json", true)]
    [InlineData("case-v3-broken-seal-vi.json", false)]
    [InlineData("case-v3-broken-seal-en.json", false)]
    [InlineData("case-point-click-night-ledger-vi.json", false)]
    [InlineData("case-point-click-night-ledger-en.json", false)]
    public void IsPixel_BundledCases(string fileName, bool expected) =>
        Assert.Equal(expected, CaseCatalogRules.IsPixel(Load(fileName)));

    [Fact]
    public void IsPixel_MixedCase_IsNotPixel()
    {
        var gameCase = Load("case-pixel-tram-hong-ngoc-vi.json");
        Assert.True(CaseCatalogRules.IsPixel(gameCase));
        // One classic scene (runtime without pixel render settings) is enough to make it a classic case.
        gameCase.Stages.SelectMany(stage => stage.Scenes).First().Runtime!.Render = null;
        Assert.False(CaseCatalogRules.IsPixel(gameCase));
    }

    [Fact]
    public void IsPixel_NonPixelRenderMode_IsNotPixel()
    {
        var gameCase = Load("case-pixel-tram-hong-ngoc-vi.json");
        gameCase.Stages.SelectMany(stage => stage.Scenes).Last().Runtime!.Render!.Mode = "classic";
        Assert.False(CaseCatalogRules.IsPixel(gameCase));
    }

    [Fact]
    public void IsPixel_NoRuntimeAtAll_NoStages_AndNull_AreNotPixel()
    {
        var withoutRuntime = Load("case-pixel-tram-hong-ngoc-vi.json");
        foreach (var scene in withoutRuntime.Stages.SelectMany(stage => stage.Scenes)) scene.Runtime = null;
        Assert.False(CaseCatalogRules.IsPixel(withoutRuntime));
        Assert.False(CaseCatalogRules.IsPixel(new GameCase()));
        Assert.False(CaseCatalogRules.IsPixel(null));
    }

    [Fact]
    public void Summary_CarriesIsPixel_AndPublicDetailKeepsIt()
    {
        var pixel = Published(Load("case-pixel-tram-hong-ngoc-vi.json"));
        var classic = Published(Load("case-v3-broken-seal-vi.json"));
        Assert.True(CaseSummaryResponse.From(pixel).IsPixel);
        Assert.False(CaseSummaryResponse.From(classic).IsPixel);
        Assert.True(CasePublicDetailResponse.FromCase(pixel).IsPixel);
        Assert.False(CasePublicDetailResponse.FromCase(classic).IsPixel);
    }

    // ---------------------------------------------------------------- policy

    [Fact]
    public void Policy_PixelOnlyOff_AnyPublishedCaseIsPlayable()
    {
        var policy = PixelOnly(false);
        Assert.True(policy.IsPlayable(Published(Load("case-v3-broken-seal-vi.json"))));
        Assert.True(policy.IsPlayable(Published(Load("case-pixel-tram-hong-ngoc-vi.json"))));
        Assert.False(policy.IsPlayable(Load("case-v3-broken-seal-vi.json"))); // draft
        Assert.False(policy.RelaxCaseFit);
        Assert.True(CaseCatalogPolicy.Open.IsPlayable(Published(Load("case-v3-broken-seal-vi.json"))));
    }

    [Fact]
    public void Policy_PixelOnlyOn_OnlyPublishedPixelCasesArePlayable()
    {
        var policy = PixelOnly();
        Assert.True(policy.IsPlayable(Published(Load("case-pixel-tram-hong-ngoc-vi.json"))));
        Assert.True(policy.IsPlayable(Published(Load("case-pixel-lo-thuoc-thu-nam-vi.json"))));
        Assert.False(policy.IsPlayable(Published(Load("case-v3-broken-seal-vi.json"))));
        Assert.False(policy.IsPlayable(Published(Load("case-point-click-night-ledger-en.json"))));
        Assert.False(policy.IsPlayable(Load("case-pixel-tram-hong-ngoc-vi.json"))); // an unpublished pixel case
        Assert.True(policy.RelaxCaseFit);
    }

    [Fact]
    public void Policy_Summaries_FollowTheSameRule()
    {
        var policy = PixelOnly();
        Assert.True(policy.IsPlayable(Summary("a", "vi", 20)));
        Assert.False(policy.IsPlayable(Summary("b", "vi", 20, pixel: false)));
        Assert.False(policy.IsPlayable(Summary("c", "vi", 20, status: CaseStatus.Draft)));
        Assert.True(PixelOnly(false).IsPlayable(Summary("b", "vi", 20, pixel: false)));
    }

    [Fact]
    public void Settings_DefaultToOpenCatalogue()
    {
        var settings = new CaseCatalogSettings();
        Assert.False(settings.PixelOnly);
        Assert.False(settings.SeedPixelOnStartup);
    }

    // ---------------------------------------------------------------- matchmaking fit

    [Fact]
    public void FittingCasesRelaxed_PrefersTheExactFit()
    {
        var published = new[] { Summary("vi-short", "vi", 15), Summary("vi-medium", "vi", 30), Summary("en-short", "en", 15) };
        var fit = MatchmakingRules.FittingCasesRelaxed(published, "vi", MatchCaseLengths.Short);
        Assert.Equal(new[] { "vi-short" }, fit.Select(summary => summary.CaseId));
    }

    [Fact]
    public void FittingCasesRelaxed_WidensToAnyLengthInTheLanguage_ThenToTheLengthInAnyLanguage_ThenToAll()
    {
        var published = new[] { Summary("vi-short", "vi", 15), Summary("vi-medium", "vi", 30) };
        // nothing long: any length in Vietnamese
        Assert.Equal(new[] { "vi-short", "vi-medium" }, MatchmakingRules.FittingCasesRelaxed(published, "vi", MatchCaseLengths.Long).Select(s => s.CaseId));
        // nothing English at all: the requested length in any language (an English player still gets a match)
        Assert.Equal(new[] { "vi-short" }, MatchmakingRules.FittingCasesRelaxed(published, "en", MatchCaseLengths.Short).Select(s => s.CaseId));
        Assert.Equal(new[] { "vi-medium" }, MatchmakingRules.FittingCasesRelaxed(published, "en", MatchCaseLengths.Medium).Select(s => s.CaseId));
        // neither English nor that length: everything playable
        Assert.Equal(new[] { "vi-short", "vi-medium" }, MatchmakingRules.FittingCasesRelaxed(published, "en", MatchCaseLengths.Long).Select(s => s.CaseId));
    }

    [Fact]
    public void FittingCasesRelaxed_SkipsUnpublishedAndEmptyCases_AndCanBeEmpty()
    {
        var draft = Summary("draft", "vi", 15, status: CaseStatus.Draft);
        var empty = Summary("empty", "vi", 15); empty.StageCount = 0;
        Assert.Empty(MatchmakingRules.FittingCasesRelaxed(new[] { draft, empty }, "vi", MatchCaseLengths.Short));
        Assert.Empty(MatchmakingRules.FittingCasesRelaxed(Array.Empty<CaseSummaryResponse>(), "en", MatchCaseLengths.Long));
    }

    [Fact]
    public void FittingCases_Strict_StillRefusesAMismatch()
    {
        var published = new[] { Summary("vi-short", "vi", 15) };
        Assert.Empty(MatchmakingRules.FittingCases(published, "en", MatchCaseLengths.Short));
        Assert.Empty(MatchmakingRules.FittingCases(published, "vi", MatchCaseLengths.Long));
    }

    // ---------------------------------------------------------------- startup seeding worker

    private sealed class FakeSeeder(Func<IReadOnlyList<string>> result) : IPixelCaseSeeder
    {
        public int Calls;
        public Task<IReadOnlyList<string>> SeedMissingPixelCasesAsync(CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(result());
        }
    }

    private static (PixelCaseSeedWorker Worker, FakeSeeder Seeder) Worker(bool seedOnStartup, Func<IReadOnlyList<string>> result)
    {
        var seeder = new FakeSeeder(result);
        var services = new ServiceCollection();
        services.AddSingleton<IPixelCaseSeeder>(seeder);
        var provider = services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
        var options = Options.Create(new CaseCatalogSettings { SeedPixelOnStartup = seedOnStartup });
        return (new PixelCaseSeedWorker(provider, options, NullLogger<PixelCaseSeedWorker>.Instance), seeder);
    }

    [Fact]
    public async Task Worker_Pass_ReturnsTrueWhenItSeededOrNothingWasMissing()
    {
        var (worker, seeder) = Worker(true, () => new[] { "case-pixel-tram-hong-ngoc-vi" });
        Assert.True(await worker.RunPassAsync(CancellationToken.None));
        Assert.Equal(1, seeder.Calls);
        var (idle, idleSeeder) = Worker(true, () => Array.Empty<string>());
        Assert.True(await idle.RunPassAsync(CancellationToken.None));
        Assert.Equal(1, idleSeeder.Calls);
    }

    [Fact]
    public async Task Worker_Pass_FailureIsSwallowedAndReported()
    {
        var (worker, seeder) = Worker(true, () => throw new InvalidOperationException("mongo is down"));
        Assert.False(await worker.RunPassAsync(CancellationToken.None));
        Assert.Equal(1, seeder.Calls);
    }

    [Fact]
    public async Task Worker_Disabled_DoesNotSeed()
    {
        var (worker, seeder) = Worker(false, () => new[] { "x" });
        await worker.StartAsync(CancellationToken.None);
        await worker.StopAsync(CancellationToken.None);
        Assert.Equal(0, seeder.Calls);
    }

    [Fact]
    public async Task Worker_Enabled_SeedsOnceAtStart()
    {
        var (worker, seeder) = Worker(true, () => Array.Empty<string>());
        await worker.StartAsync(CancellationToken.None);
        for (var i = 0; i < 50 && seeder.Calls == 0; i++) await Task.Delay(20);
        await worker.StopAsync(CancellationToken.None);
        Assert.Equal(1, seeder.Calls);
    }
}
