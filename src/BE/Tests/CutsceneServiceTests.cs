using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Cutscene;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.WebAPI.Controllers;
using Xunit;

namespace SirLocked.Tests;

public sealed class CutsceneServiceTests
{
    private const string Tram = "case-pixel-tram-hong-ngoc-vi.json";
    private const string LoThuoc = "case-pixel-lo-thuoc-thu-nam-vi.json";
    // The seeding tests write and delete this case's file; the bundled cases keep their real scripts.
    private const string SeedTestCaseId = "case-pixel-seed-test";

    private sealed class MemoryStore : ICutsceneStore
    {
        public readonly Dictionary<string, CaseCutscene> Rows = new();
        public Task<List<CaseCutscene>> ListAsync(string caseId, string trigger, CancellationToken ct = default) =>
            Task.FromResult(Rows.Values.Where(c => c.CaseId == caseId && c.Trigger == trigger).OrderByDescending(c => c.Version).ToList());
        public Task<CaseCutscene?> GetAsync(string id, CancellationToken ct = default) => Task.FromResult(Rows.GetValueOrDefault(id));
        public Task InsertAsync(CaseCutscene c, CancellationToken ct = default)
        {
            if (!Rows.TryAdd(c.Id, c)) throw ApiException.Conflict("duplicate");
            return Task.CompletedTask;
        }
        public Task ReplaceAsync(CaseCutscene c, CancellationToken ct = default) { Rows[c.Id] = c; return Task.CompletedTask; }
    }

    private sealed class StubCases(params GameCase[] cases) : ICaseService
    {
        public Task<GameCase> GetCaseAsync(string caseId) => Task.FromResult(cases.FirstOrDefault(c => c.CaseId == caseId) ?? throw ApiException.NotFound("Case not found."));
        public Task<GameCase?> FindCaseAsync(string caseId) => Task.FromResult(cases.FirstOrDefault(c => c.CaseId == caseId));
        public Task<List<CaseSummaryResponse>> GetPublishedAsync() => Task.FromResult(cases.Where(c => c.Status == CaseStatus.Published)
            .Select(c => new CaseSummaryResponse { CaseId = c.CaseId, Status = c.Status, IsPixel = CaseCatalogRules.IsPixel(c) }).ToList());
        public Task<CasePublicDetailResponse> GetPublicDetailAsync(string caseId) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> GetAllForAdminAsync() => throw new NotSupportedException();
        public CaseValidationResponse ValidateJson(JsonElement caseJson) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> ImportJsonAsync(JsonElement caseJson, bool overwrite, bool preserveServerMetadata = false) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> PublishAsync(string caseId) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> UnpublishAsync(string caseId) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> SeedSampleAsync(bool publish) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedDemoAsync() => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedCrackDemoAsync() => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedPointClickDemoAsync() => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedPixelDemoAsync() => throw new NotSupportedException();
        public GameCase ParseCase(JsonElement caseJson) => throw new NotSupportedException();
        public GameCase ParseCase(string caseJson) => throw new NotSupportedException();
    }

    private sealed class Rig
    {
        public MemoryStore Store { get; } = new();
        public GameCase Case { get; }
        public CutsceneService Service { get; }

        public Rig(string file = Tram, CutsceneSettings? cutscene = null, bool pixelOnly = true, bool published = true, bool mock = true, GameCase[]? extra = null, string? caseId = null)
        {
            Case = CutsceneScriptTests.Load(file);
            if (caseId is not null) Case.CaseId = caseId;
            Case.Status = published ? CaseStatus.Published : CaseStatus.Draft;
            var generation = Options.Create(new AiGenerationSettings { MockAiResponses = mock });
            var settings = Options.Create(cutscene ?? new CutsceneSettings());
            // The real bridge provider; in mock mode it answers before touching the queue, so no database is needed.
            var provider = new SirLocked.Api.Services.Bridge.ClaudeBridgeTextProvider(null!, null!, generation,
                Options.Create(new BridgeSettings()), new TestHostEnvironment(),
                NullLogger<SirLocked.Api.Services.Bridge.ClaudeBridgeTextProvider>.Instance);
            var generator = new CutsceneScriptGenerator(provider, generation, settings, NullLogger<CutsceneScriptGenerator>.Instance);
            Service = new CutsceneService(Store, new StubCases(new[] { Case }.Concat(extra ?? []).ToArray()),
                new CaseCatalogPolicy(new CaseCatalogSettings { PixelOnly = pixelOnly }), generator, settings, null!, generation,
                NullLogger<CutsceneService>.Instance);
        }
    }

    private sealed class TestHostEnvironment : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "SirLocked.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    // ---------------------------------------------------------------- lifecycle: draft / approved / disabled

    [Fact]
    public async Task Draft_IsNotServedToPlayers_ApprovedIs_DisabledIsNot()
    {
        var rig = new Rig();
        var generated = await rig.Service.GenerateAsync(rig.Case.CaseId, false, "admin");
        Assert.Equal(CutsceneStatus.Draft, generated.Latest!.Status);
        Assert.Null(await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId));

        var approved = await rig.Service.ApproveAsync(rig.Case.CaseId, generated.Latest.Id, "admin");
        Assert.Equal(CutsceneStatus.Approved, approved.Latest!.Status);
        var player = await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId);
        Assert.NotNull(player);
        Assert.Equal(MotionComicScript.FormatName, player!.Script.Format);
        Assert.NotEmpty(player.Assets.Scenes);

        await rig.Service.DisableAsync(rig.Case.CaseId);
        Assert.Null(await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId));
        // Approving the same version again brings it back.
        await rig.Service.ApproveAsync(rig.Case.CaseId, generated.Latest.Id, "admin");
        Assert.NotNull(await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId));
    }

    [Fact]
    public async Task Approving_ANewVersion_SupersedesTheOldOne_AndOnlyOneIsApproved()
    {
        var rig = new Rig();
        var first = (await rig.Service.GenerateAsync(rig.Case.CaseId, false, "admin")).Latest!;
        await rig.Service.ApproveAsync(rig.Case.CaseId, first.Id, "admin");
        var second = (await rig.Service.GenerateAsync(rig.Case.CaseId, true, "admin")).Latest!;
        Assert.Equal(2, second.Version);
        // The new draft does not replace the live one.
        Assert.Equal(1, (await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId))!.Version);
        await rig.Service.ApproveAsync(rig.Case.CaseId, second.Id, "admin");
        Assert.Equal(2, (await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId))!.Version);
        Assert.Single(rig.Store.Rows.Values, c => c.Status == CutsceneStatus.Approved);
        Assert.Equal(CutsceneStatus.Superseded, rig.Store.Rows[first.Id].Status);
    }

    [Fact]
    public async Task Generating_Again_NeedsConfirmation()
    {
        var rig = new Rig();
        await rig.Service.GenerateAsync(rig.Case.CaseId, false, "admin");
        var error = await Assert.ThrowsAsync<ApiException>(() => rig.Service.GenerateAsync(rig.Case.CaseId, false, "admin"));
        Assert.Equal(409, error.StatusCode);
        Assert.Single(rig.Store.Rows);
    }

    [Fact]
    public async Task AutoApprove_ApprovesAValidatedScript()
    {
        var rig = new Rig(cutscene: new CutsceneSettings { AutoApprove = true });
        await rig.Service.GenerateAsync(rig.Case.CaseId, false, "admin");
        Assert.NotNull(await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId));
    }

    // ---------------------------------------------------------------- who can see it

    [Fact]
    public async Task Players_GetNothing_ForHiddenUnpublishedOrDisabledSettings()
    {
        var legacy = new Rig(pixelOnly: true, published: true);
        foreach (var scene in legacy.Case.Stages.SelectMany(stage => stage.Scenes)) scene.Runtime = null; // no longer a pixel case
        var id = (await legacy.Service.GenerateAsync(legacy.Case.CaseId, false, "admin")).Latest!.Id;
        await legacy.Service.ApproveAsync(legacy.Case.CaseId, id, "admin");
        Assert.Null(await legacy.Service.GetPlayerIntroAsync(legacy.Case.CaseId)); // hidden by CaseCatalog:PixelOnly

        var unpublished = new Rig(published: false);
        var draftId = (await unpublished.Service.GenerateAsync(unpublished.Case.CaseId, false, "admin")).Latest!.Id;
        await unpublished.Service.ApproveAsync(unpublished.Case.CaseId, draftId, "admin");
        Assert.Null(await unpublished.Service.GetPlayerIntroAsync(unpublished.Case.CaseId));

        var off = new Rig(cutscene: new CutsceneSettings { Enabled = false });
        var offId = (await off.Service.GenerateAsync(off.Case.CaseId, false, "admin")).Latest!.Id;
        await off.Service.ApproveAsync(off.Case.CaseId, offId, "admin");
        Assert.Null(await off.Service.GetPlayerIntroAsync(off.Case.CaseId)); // the master switch

        Assert.Null(await new Rig().Service.GetPlayerIntroAsync("case-that-does-not-exist"));
        Assert.Null(await new Rig().Service.GetPlayerIntroAsync(new Rig().Case.CaseId)); // no cutscene at all
    }

    [Fact]
    public async Task PlaytestMembers_SeeTheApprovedIntroOfAnUnpublishedCase_StillNeverADraftScript()
    {
        var unpublished = new Rig(published: false);
        var draftId = (await unpublished.Service.GenerateAsync(unpublished.Case.CaseId, false, "admin")).Latest!.Id;
        Assert.Null(await unpublished.Service.GetPlayerIntroAsync(unpublished.Case.CaseId, playtest: true)); // not approved yet
        await unpublished.Service.ApproveAsync(unpublished.Case.CaseId, draftId, "admin");

        Assert.Null(await unpublished.Service.GetPlayerIntroAsync(unpublished.Case.CaseId)); // ordinary players: hidden
        var playtest = await unpublished.Service.GetPlayerIntroAsync(unpublished.Case.CaseId, playtest: true);
        Assert.NotNull(playtest);
        Assert.Equal(unpublished.Case.CaseId, playtest!.CaseId);

        var off = new Rig(cutscene: new CutsceneSettings { Enabled = false }, published: false);
        var offId = (await off.Service.GenerateAsync(off.Case.CaseId, false, "admin")).Latest!.Id;
        await off.Service.ApproveAsync(off.Case.CaseId, offId, "admin");
        Assert.Null(await off.Service.GetPlayerIntroAsync(off.Case.CaseId, playtest: true)); // the master switch still wins
    }

    [Fact]
    public void Controllers_RequireTheRightRoles()
    {
        var admin = typeof(AdminCutscenesController).GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single();
        Assert.Equal("ADMIN", admin.Roles);
        Assert.NotEmpty(typeof(CasesController).GetCustomAttributes(typeof(AuthorizeAttribute), true));
    }

    // ---------------------------------------------------------------- editing

    [Fact]
    public async Task Editing_ADraft_ChangesItInPlace_AndRejectsInvalidScripts()
    {
        var rig = new Rig();
        var draft = (await rig.Service.GenerateAsync(rig.Case.CaseId, false, "admin")).Latest!;
        var script = (await rig.Service.GetAdminAsync(rig.Case.CaseId)).Script!;
        script.Pages[0].Panels[0].Beats[0].Text = "Một dòng đã được sửa tay, vẫn đủ ngắn.";
        var saved = await rig.Service.UpdateScriptAsync(rig.Case.CaseId, draft.Id, script, "admin");
        Assert.Equal(1, saved.Versions.Count);
        Assert.Equal("Một dòng đã được sửa tay, vẫn đủ ngắn.", saved.Script!.Pages[0].Panels[0].Beats[0].Text);

        script.Pages[0].Panels[0].Beats[0].Text = new string('x', 91);
        var error = await Assert.ThrowsAsync<ApiException>(() => rig.Service.UpdateScriptAsync(rig.Case.CaseId, draft.Id, script, "admin"));
        Assert.Equal(422, error.StatusCode);
        Assert.Equal("Một dòng đã được sửa tay, vẫn đủ ngắn.", (await rig.Service.GetAdminAsync(rig.Case.CaseId)).Script!.Pages[0].Panels[0].Beats[0].Text);
    }

    [Fact]
    public async Task Editing_AnApprovedScript_StartsANewDraft_AndKeepsTheLiveOneUntilApproved()
    {
        var rig = new Rig();
        var first = (await rig.Service.GenerateAsync(rig.Case.CaseId, false, "admin")).Latest!;
        await rig.Service.ApproveAsync(rig.Case.CaseId, first.Id, "admin");
        var script = (await rig.Service.GetAdminAsync(rig.Case.CaseId)).Script!;
        script.Pages[0].Panels[0].Beats[0].Text = "Bản sửa nằm trong nháp, chưa lên sóng.";
        var after = await rig.Service.UpdateScriptAsync(rig.Case.CaseId, first.Id, script, "admin");
        Assert.Equal(2, after.Versions.Count);
        Assert.Equal(CutsceneStatus.Draft, after.Latest!.Status);
        Assert.NotEqual("Bản sửa nằm trong nháp, chưa lên sóng.",
            (await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId))!.Script.Pages[0].Panels[0].Beats[0].Text);
    }

    [Fact]
    public async Task Approve_RefusesAnInvalidStoredScript()
    {
        var rig = new Rig();
        var draft = (await rig.Service.GenerateAsync(rig.Case.CaseId, false, "admin")).Latest!;
        rig.Store.Rows[draft.Id].ScriptJson = "{\"format\":\"motion-comic-v1\"}";
        var error = await Assert.ThrowsAsync<ApiException>(() => rig.Service.ApproveAsync(rig.Case.CaseId, draft.Id, "admin"));
        Assert.Equal(422, error.StatusCode);
        Assert.Null(await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId));
    }

    [Fact]
    public async Task Update_OfAnotherCasesCutscene_IsNotFound()
    {
        var rig = new Rig();
        var other = CutsceneScriptTests.Load(LoThuoc); other.Status = CaseStatus.Published;
        var otherRig = new Rig(LoThuoc);
        var draft = (await otherRig.Service.GenerateAsync(otherRig.Case.CaseId, false, "admin")).Latest!;
        rig.Store.Rows[draft.Id] = otherRig.Store.Rows[draft.Id];
        var script = (await otherRig.Service.GetAdminAsync(otherRig.Case.CaseId)).Script!;
        var error = await Assert.ThrowsAsync<ApiException>(() => rig.Service.UpdateScriptAsync(rig.Case.CaseId, draft.Id, script, "admin"));
        Assert.Equal(404, error.StatusCode);
    }

    // ---------------------------------------------------------------- seeding

    private static string WriteSeed(string caseId, string json)
    {
        var path = CutsceneService.SeedFilePath(caseId);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, json);
        return path;
    }

    [Fact]
    public async Task Seed_InsertsAnApprovedScriptFromFile_AndNeverOverwrites()
    {
        var rig = new Rig(caseId: SeedTestCaseId);
        var path = WriteSeed(rig.Case.CaseId, JsonSerializer.Serialize(CutsceneMockScriptFactory.Create(rig.Case), CutsceneScriptGenerator.JsonOptions));
        try
        {
            Assert.Equal(new[] { rig.Case.CaseId }, await rig.Service.SeedMissingAsync(new[] { rig.Case }));
            var row = Assert.Single(rig.Store.Rows.Values);
            Assert.Equal(CutsceneStatus.Approved, row.Status);
            Assert.Equal("SEED", row.Source);
            Assert.NotNull(await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId));

            // A second start, and a changed file, leave the stored version alone.
            File.WriteAllText(path, "{}");
            Assert.Empty(await rig.Service.SeedMissingAsync(new[] { rig.Case }));
            Assert.Single(rig.Store.Rows);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task Seed_SkipsAnInvalidFile_WithoutThrowing()
    {
        var rig = new Rig(caseId: SeedTestCaseId);
        var script = CutsceneMockScriptFactory.Create(rig.Case);
        script.Pages[0].Panels[0].Art.Id = "nope";
        var path = WriteSeed(rig.Case.CaseId, JsonSerializer.Serialize(script, CutsceneScriptGenerator.JsonOptions));
        try
        {
            Assert.Empty(await rig.Service.SeedMissingAsync(new[] { rig.Case }));
            Assert.Empty(rig.Store.Rows);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task Seed_WithoutFile_DoesNotWriteAMockDraft()
    {
        var rig = new Rig(mock: true, caseId: SeedTestCaseId);
        Assert.Empty(await rig.Service.SeedMissingAsync(new[] { rig.Case }));
        Assert.Empty(rig.Store.Rows);
    }

    [Fact]
    public async Task Export_ReturnsOnlyTheApprovedScript()
    {
        var rig = new Rig();
        var draft = (await rig.Service.GenerateAsync(rig.Case.CaseId, false, "admin")).Latest!;
        Assert.Null(await rig.Service.ExportApprovedAsync(rig.Case.CaseId));
        await rig.Service.ApproveAsync(rig.Case.CaseId, draft.Id, "admin");
        var json = await rig.Service.ExportApprovedAsync(rig.Case.CaseId);
        Assert.Contains("\"format\": \"motion-comic-v1\"", json);
        Assert.Contains("ẦM!!", json);
    }

    // ---------------------------------------------------------------- startup worker

    [Fact]
    public async Task SeedWorker_WaitsForTheCatalogue_ThenSeedsFromFile()
    {
        var rig = new Rig(caseId: SeedTestCaseId);
        var path = WriteSeed(rig.Case.CaseId, JsonSerializer.Serialize(CutsceneMockScriptFactory.Create(rig.Case), CutsceneScriptGenerator.JsonOptions));
        try
        {
            var services = new Microsoft.Extensions.DependencyInjection.ServiceCollection()
                .AddSingleton<ICaseService>(new StubCases(rig.Case))
                .AddSingleton(rig.Service)
                .BuildServiceProvider();
            var worker = new CutsceneSeedWorker(services.GetRequiredService<Microsoft.Extensions.DependencyInjection.IServiceScopeFactory>(), NullLogger<CutsceneSeedWorker>.Instance);
            Assert.True(await worker.RunPassAsync(CancellationToken.None));
            Assert.NotNull(await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId));
            // Running again changes nothing.
            Assert.True(await worker.RunPassAsync(CancellationToken.None));
            Assert.Single(rig.Store.Rows);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task SeedWorker_ReportsNotReady_WhenNoCaseIsPublishedYet()
    {
        var rig = new Rig(published: false);
        var services = new Microsoft.Extensions.DependencyInjection.ServiceCollection()
            .AddSingleton<ICaseService>(new StubCases(rig.Case))
            .AddSingleton(rig.Service)
            .BuildServiceProvider();
        var worker = new CutsceneSeedWorker(services.GetRequiredService<Microsoft.Extensions.DependencyInjection.IServiceScopeFactory>(), NullLogger<CutsceneSeedWorker>.Instance);
        Assert.False(await worker.RunPassAsync(CancellationToken.None)); // the worker retries later
        Assert.Empty(rig.Store.Rows);
    }

    // ---------------------------------------------------------------- bundled scripts

    [Theory]
    [InlineData(Tram)]
    [InlineData(LoThuoc)]
    public async Task BundledIntroScripts_PassTheSameChecksAsAiScripts_AndSeedAsApproved(string file)
    {
        var rig = new Rig(file);
        var path = CutsceneService.SeedFilePath(rig.Case.CaseId);
        Assert.True(File.Exists(path), $"missing seed script {path}");
        var script = JsonSerializer.Deserialize<MotionComicScript>(File.ReadAllText(path), CutsceneScriptGenerator.JsonOptions);
        var issues = CutsceneScriptValidator.Validate(script, rig.Case);
        Assert.True(issues.Count == 0, string.Join("; ", issues.Select(i => $"{i.Path}: {i.Message}")));
        Assert.InRange(MotionComicRules.EstimateSeconds(script!), MotionComicRules.MinSeconds, MotionComicRules.MaxSeconds);

        Assert.Equal(new[] { rig.Case.CaseId }, await rig.Service.SeedMissingAsync(new[] { rig.Case }));
        Assert.NotNull(await rig.Service.GetPlayerIntroAsync(rig.Case.CaseId));
    }
}
