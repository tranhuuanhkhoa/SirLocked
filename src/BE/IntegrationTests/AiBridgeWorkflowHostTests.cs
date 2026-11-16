using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;
using Xunit;
using Xunit.Abstractions;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The whole Claude bridge through the real HTTP pipeline and MongoDB: a test "bot" plays Claude with the
/// deterministic mock answers the server exposes outside Production.
/// </summary>
public sealed class AiBridgeWorkflowHostTests(ITestOutputHelper output)
{
    private const string AdminId = "507f1f77bcf86cd799439021";
    private const string VipId = "507f1f77bcf86cd799439022";
    private const string PlayerId = "507f1f77bcf86cd799439023";
    private const string BridgeKey = "integration-bridge-key-0123456789abcdef0123";
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static bool Enabled => string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true",
        StringComparison.OrdinalIgnoreCase);

    // ---------------------------------------------------------------- authentication

    [Fact]
    public async Task BridgeKey_Missing_Wrong_Configured_AndKeptApartFromJwt()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/bridge/ping")).StatusCode);

        using var wrong = factory.CreateClient();
        wrong.DefaultRequestHeaders.Add("X-Bridge-Key", BridgeKey + "x");
        Assert.Equal(HttpStatusCode.Unauthorized, (await wrong.GetAsync("/api/bridge/ping")).StatusCode);

        using var bot = Bot(factory);
        Assert.Equal(HttpStatusCode.OK, (await bot.GetAsync("/api/bridge/ping")).StatusCode);

        // An admin identity without the key cannot use the bridge...
        using var admin = User(factory, AdminId, UserRole.Admin);
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("/api/bridge/requests")).StatusCode);
        // ...and the key opens no admin API.
        Assert.Equal(HttpStatusCode.Unauthorized, (await bot.GetAsync("/api/admin/ai-cases")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await bot.PutAsJsonAsync("/api/admin/ai-cases/settings", new { vipWeeklyOrderLimit = 9 })).StatusCode);

        await using var unconfigured = new BridgeFactory(key: string.Empty);
        using var unconfiguredBot = Bot(unconfigured);
        var response = await unconfiguredBot.GetAsync("/api/bridge/ping");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("BRIDGE_NOT_CONFIGURED", await response.Content.ReadAsStringAsync());
    }

    // ---------------------------------------------------------------- full order through the bridge

    [Fact]
    public async Task FullOrder_RunsThroughTheBridgeWithMockAnswers_ToAnUnpublishedImport()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var admin = User(factory, AdminId, UserRole.Admin);
        using var bot = Bot(factory);

        var created = await admin.PostAsJsonAsync("/api/admin/ai-cases", new GenerateAiCaseRequest
        {
            Prompt = "A stopped pocket watch on a rainy night.",
            GenerationPreset = AiGenerationPresets.ShortDemo,
            Language = "en",
            Order = new AiCaseOrder { World = AiCaseWorlds.HangDuongVictorian, Weather = "RAIN", TimeOfDay = "NIGHT" }
        });
        Assert.Equal(HttpStatusCode.Accepted, created.StatusCode);
        var draft = (await created.Content.ReadFromJsonAsync<ApiResponse<AiDraftResponse>>(Web))!.Data!;
        Assert.Equal(AiOrderStatuses.QueuedForClaude, draft.OrderStatus);

        var ready = await RunBotAsync(factory, admin, bot, draft.DraftId, GateApprover.Admin);
        Assert.Equal(AiDraftStatus.ReadyToPublish, ready.Status);
        Assert.Equal(AiOrderStatuses.Submitted, ready.OrderStatus);
        Assert.Contains(ready.OrderStatusHistory, change => change.Status == AiOrderStatuses.ClaudeWorking);
        Assert.Contains(ready.OrderStatusHistory, change => change.Status == AiOrderStatuses.AwaitingGate);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
            var requests = await db.AiBridgeRequests.Find(item => item.OwnerId == draft.DraftId).ToListAsync();
            Assert.NotEmpty(requests);
            // Every replay found its earlier answers: nothing went stale and nothing was asked twice.
            Assert.DoesNotContain(requests, item => item.Status == AiBridgeStatuses.Stale);
            Assert.All(requests, item => Assert.Equal(AiBridgeStatuses.Accepted, item.Status));
            Assert.Equal(requests.Count, requests.Select(item => item.RequestKey).Distinct().Count());
            Assert.Contains(requests, item => item.Kind == AiBridgeKinds.Assets);
            output.WriteLine($"{requests.Count} bridge requests: " + string.Join(", ", requests.Select(item => item.Step)));
            var stored = await db.AiCaseDrafts.Find(item => item.Id == draft.DraftId).SingleAsync();
            var attempts = stored.GenerationAttempts.Where(item => item.Model == ClaudeBridgeTextProvider.ProviderName).ToList();
            Assert.Equal(attempts.Count, attempts.Select(item => item.ResponseId).Distinct().Count()); // each answer recorded once
            Assert.Contains("CREATOR ORDER", requests.First(item => item.Kind == AiBridgeKinds.Json).Prompt);
        }

        // VUAN-6B: a new order makes a pixel case in the shape of "Tram hong ngoc mat tich".
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
            var stored = await db.AiCaseDrafts.Find(item => item.Id == draft.DraftId).SingleAsync();
            Assert.Equal(AiVisualPipelines.PixelV1, stored.VisualPipeline);
            Assert.Equal(0, stored.AssetPlan!.EstimatedGenerations);
            var pixelCase = JsonSerializer.Deserialize<GameCase>(stored.GeneratedJson, Web)!;
            Assert.True(CaseCatalogRules.IsPixel(pixelCase));
            var tram = JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", "case-pixel-tram-hong-ngoc-vi.json")), Web)!;
            var reference = tram.Stages.SelectMany(stage => stage.Scenes).Select(scene => scene.Runtime!.Render!)
                .GroupBy(render => render.Projection).ToDictionary(group => group.Key, group => group.First());
            var scenes = pixelCase.Stages.SelectMany(stage => stage.Scenes).ToList();
            Assert.Contains(scenes, scene => scene.Runtime!.Render!.Projection == SceneRenderModes.TopDown);
            foreach (var scene in scenes)
            {
                var render = scene.Runtime!.Render!;
                var expected = reference[render.Projection];
                Assert.Equal((2048, 2048), (scene.Runtime.Width, scene.Runtime.Height));
                Assert.Equal((expected.NativeWidth, expected.PixelScale, expected.CameraZoom, expected.ActorScale, expected.WalkSpeed, expected.InteractRadius),
                    (render.NativeWidth, render.PixelScale, render.CameraZoom, render.ActorScale, render.WalkSpeed, render.InteractRadius));
                Assert.Equal((16, 128, 128), (render.WalkGrid!.CellSize, render.WalkGrid.Cols, render.WalkGrid.Rows));
                Assert.All(scene.Runtime.ItemPlacements, placement => Assert.Equal(string.Empty, placement.Asset));
                Assert.All(scene.Runtime.CharacterPlacements, placement => Assert.Equal(128 * render.ActorScale, placement.Size.Width));
                Assert.NotNull(scene.Runtime.Audio?.Music);
                Assert.Equal(render.Projection == SceneRenderModes.TopDown ? "RAIN" : null, scene.Runtime.Weather?.Type);
            }
            Assert.All(pixelCase.Characters.Where(character => scenes.Any(scene => scene.CharacterIds.Contains(character.CharacterId))), character =>
            {
                var sheet = character.Presentation!.SpriteSheet!;
                Assert.Equal((128, 128, 9, 6, 0.5), (sheet.FrameWidth, sheet.FrameHeight, sheet.FrameCount, sheet.Fps, sheet.AnchorX));
                Assert.NotNull(character.Voice?.Blip);
            });
            Assert.Contains(pixelCase.CoverImageUrl, scenes.Select(scene => scene.BackgroundUrl));
            var sizes = AiCaseService.LatestUploads(stored).Values.Select(upload => (upload.SlotId.Split(':')[0], upload.Width, upload.Height)).Distinct().ToList();
            Assert.Contains(("character-sprite", 1152, 128), sizes);
            Assert.Contains(("character-portrait", 288, 288), sizes);
            Assert.All(sizes.Where(size => size.Item1 == "background"), size => Assert.Equal((512, 512), (size.Width, size.Height)));
        }

        // Player view for the blind detective: no solution field anywhere.
        var view = await GetData<JsonObject>(bot, $"/api/bridge/drafts/{draft.DraftId}/player-view");
        var names = new List<string>();
        CollectNames(view, names);
        Assert.DoesNotContain(names, name => AiPlayerViewBuilder.ForbiddenPropertyNames.Contains(name));

        // The bot's report is stored for the admin.
        var report = await bot.PutAsJsonAsync($"/api/bridge/drafts/{draft.DraftId}/report", new { markdown = "# report\n5/5 lớp đạt" });
        Assert.Equal(HttpStatusCode.OK, report.StatusCode);
        var withReport = await GetData<AiDraftResponse>(admin, $"/api/admin/ai-cases/{draft.DraftId}");
        Assert.Contains("5/5 lớp đạt", withReport.BridgeReport);

        // Import for the playtest: stored as a draft case, invisible to players, never published.
        var imported = await bot.PostAsync($"/api/bridge/drafts/{draft.DraftId}/import", null);
        Assert.Equal(HttpStatusCode.OK, imported.StatusCode);
        var caseId = (await imported.Content.ReadFromJsonAsync<ApiResponse<JsonObject>>(Web))!.Data!["caseId"]!.GetValue<string>();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
            Assert.Equal(CaseStatus.Draft, (await db.Cases.Find(item => item.CaseId == caseId).SingleAsync()).Status);
        }
        using var player = User(factory, PlayerId, UserRole.Player);
        var published = await GetData<List<JsonObject>>(player, "/api/cases/published");
        Assert.DoesNotContain(published, item => item["caseId"]?.GetValue<string>() == caseId);
        Assert.Equal(HttpStatusCode.NotFound, (await player.GetAsync($"/api/cases/{caseId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bot.PostAsync($"/api/bridge/drafts/{draft.DraftId}/publish", null)).StatusCode);
        Assert.Equal(AiDraftStatus.Imported, (await GetData<AiDraftResponse>(admin, $"/api/admin/ai-cases/{draft.DraftId}")).Status);

        // The studio's local playtest reads the whole imported case, solution and server metadata included.
        var caseJson = await GetData<JsonObject>(bot, $"/api/bridge/drafts/{draft.DraftId}/case-json");
        Assert.Equal("IMPORTED", caseJson["source"]!.GetValue<string>());
        Assert.Equal(caseId, caseJson["caseId"]!.GetValue<string>());
        Assert.False(string.IsNullOrWhiteSpace(caseJson["caseJson"]!["finalLogic"]!["culpritId"]!.GetValue<string>()));
        Assert.Equal(AiGenerationPresets.ShortDemo, caseJson["caseJson"]!["generationPreset"]!.GetValue<string>());
        // The key alone opens it; a player token does not.
        Assert.Equal(HttpStatusCode.Unauthorized, (await player.GetAsync($"/api/bridge/drafts/{draft.DraftId}/case-json")).StatusCode);
    }

    [Fact]
    public async Task FastMode_BotPassesStoryLogicAndLayout_ButNeverTheTruthGate()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var admin = User(factory, AdminId, UserRole.Admin);
        using var bot = Bot(factory);

        var full = await CreateAsync(admin, AiCaseReviewModes.Full);
        await WaitForAsync(admin, bot, full, AiDraftStatus.StoryAwaitingApproval);
        var refused = await bot.PostAsJsonAsync($"/api/bridge/drafts/{full}/approve-gate", new { gate = "STORY" });
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode); // full review: every gate is a person's

        var fast = await CreateAsync(admin, AiCaseReviewModes.Fast);
        var ready = await RunBotAsync(factory, admin, bot, fast, GateApprover.BotWhereAllowed);
        Assert.Equal(AiDraftStatus.ReadyToPublish, ready.Status);
    }

    // ---------------------------------------------------------------- VIP orders and the audit log

    [Fact]
    public async Task VipOrder_IsInvisibleToTheBotUntilApproved_AndApprovalAndRejectionAreAudited()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var admin = User(factory, AdminId, UserRole.Admin);
        using var vip = User(factory, VipId, UserRole.Vip);
        using var bot = Bot(factory);

        var order = await vip.PostAsJsonAsync("/api/admin/ai-cases", new GenerateAiCaseRequest
        {
            GenerationPreset = AiGenerationPresets.ShortDemo, Language = "vi",
            Order = new AiCaseOrder { ReviewMode = "FAST", PixelLabCap = 100 }
        });
        Assert.Equal(HttpStatusCode.Accepted, order.StatusCode);
        var draft = (await order.Content.ReadFromJsonAsync<ApiResponse<AiDraftResponse>>(Web))!.Data!;
        Assert.Equal(AiOrderStatuses.AwaitingOwnerApproval, draft.OrderStatus);
        Assert.Equal((AiCaseReviewModes.Full, 30), (draft.Order!.ReviewMode, draft.Order.PixelLabCap));

        await Task.Delay(2500); // a worker cycle passes: still nothing for the bot
        Assert.DoesNotContain(await PendingAsync(bot), item => item["draftId"]?.GetValue<string>() == draft.DraftId);
        Assert.Equal(HttpStatusCode.Forbidden, (await bot.GetAsync($"/api/bridge/drafts/{draft.DraftId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await vip.PostAsync($"/api/admin/ai-cases/{draft.DraftId}/approve-order", null)).StatusCode);

        var approved = await admin.PostAsync($"/api/admin/ai-cases/{draft.DraftId}/approve-order", null);
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (!(await PendingAsync(bot)).Any(item => item["draftId"]?.GetValue<string>() == draft.DraftId))
        {
            Assert.True(DateTime.UtcNow < deadline, "The approved VIP order never reached the bot.");
            await Task.Delay(200);
        }

        var second = (await (await vip.PostAsJsonAsync("/api/admin/ai-cases", new GenerateAiCaseRequest
        {
            GenerationPreset = AiGenerationPresets.ShortDemo
        })).Content.ReadFromJsonAsync<ApiResponse<AiDraftResponse>>(Web))!.Data!;
        var rejected = await admin.PostAsJsonAsync($"/api/admin/ai-cases/{second.DraftId}/reject-order", new { reason = "Trùng ý tưởng." });
        Assert.Equal(HttpStatusCode.OK, rejected.StatusCode);
        var rejectedDraft = await GetData<AiDraftResponse>(vip, $"/api/admin/ai-cases/{second.DraftId}");
        Assert.Equal((AiOrderStatuses.Rejected, "Trùng ý tưởng."), (rejectedDraft.OrderStatus, rejectedDraft.OrderRejectReason));

        using var scope = factory.Services.CreateScope();
        var audit = scope.ServiceProvider.GetRequiredService<IAdminAudit>();
        var approveLog = Assert.Single((await audit.QueryAsync(new AdminAuditQuery(TargetId: draft.DraftId, Action: "ai-order.approve"))).Items);
        Assert.Equal(AdminId, approveLog.AdminId);
        var rejectLog = Assert.Single((await audit.QueryAsync(new AdminAuditQuery(TargetId: second.DraftId, Action: "ai-order.reject"))).Items);
        Assert.Equal("Trùng ý tưởng.", rejectLog.Reason);

        var settings = await admin.PutAsJsonAsync("/api/admin/ai-cases/settings", new { vipWeeklyOrderLimit = 5 });
        Assert.Equal(HttpStatusCode.OK, settings.StatusCode);
        Assert.Equal(5, (await GetData<JsonObject>(admin, "/api/admin/ai-cases/settings"))["vipWeeklyOrderLimit"]!.GetValue<int>());
        Assert.Equal(HttpStatusCode.Forbidden, (await vip.GetAsync("/api/admin/ai-cases/settings")).StatusCode);
        Assert.Single((await audit.QueryAsync(new AdminAuditQuery(Action: "ai-settings.update"))).Items);
    }

    // ---------------------------------------------------------------- schema check, library, cutscene

    [Fact]
    public async Task WrongAnswer_IsRefusedWithPaths_AndTheRequestStaysOpenForAFix()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var admin = User(factory, AdminId, UserRole.Admin);
        using var bot = Bot(factory);
        var draftId = await CreateAsync(admin, AiCaseReviewModes.Full);

        var request = await WaitForRequestAsync(bot, draftId);
        var taken = await TakeAsync(bot, request);
        Assert.False(string.IsNullOrWhiteSpace(taken["prompt"]!.GetValue<string>()));
        Assert.NotNull(taken["schema"]);
        Assert.NotNull(taken["order"]);

        var wrong = await Submit(bot, request, new JsonObject { ["title"] = 5 });
        Assert.False(wrong["accepted"]!.GetValue<bool>());
        var errors = wrong["errors"]!.AsArray().Select(item => item!.GetValue<string>()).ToList();
        Assert.Contains(errors, error => error.StartsWith("$.title:", StringComparison.Ordinal));
        Assert.Contains(errors, error => error.StartsWith("$:", StringComparison.Ordinal));
        using (var scope = factory.Services.CreateScope())
        {
            var stored = await scope.ServiceProvider.GetRequiredService<MongoDbContext>().AiBridgeRequests
                .Find(item => item.Id == request).SingleAsync();
            Assert.Equal(AiBridgeStatuses.Rejected, stored.Status);
        }
        var fixedAnswer = await Submit(bot, request, JsonNode.Parse(taken["devMockResponse"]!.GetValue<string>())!);
        Assert.True(fixedAnswer["accepted"]!.GetValue<bool>());
        await WaitForAsync(admin, bot, draftId, AiDraftStatus.StoryAwaitingApproval);
    }

    [Fact]
    public async Task Library_UpsertTwiceNeverDuplicates_AndFiltersByWorldAndKind()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var bot = Bot(factory);
        using var vip = User(factory, VipId, UserRole.Vip);
        var items = new
        {
            items = new object[]
            {
                new { key = "map-ben-cang", kind = "OUTDOOR_MAP", world = "HANG_DUONG_VICTORIAN", url = "/assets/library/map-ben-cang.webp", tags = new[] { "port", "night" }, nameVi = "Bến cảng" },
                new { key = "room-nha-tra", kind = "INTERIOR", world = "TAISHO_JAPAN", url = "https://res.cloudinary.com/demo/room.webp", nameVi = "Nhà trà" },
                new { key = "all-item-chia-khoa", kind = "ITEM", world = "ALL", url = "/assets/library/key.webp", nameVi = "Chìa khóa" },
                new { key = "v-map-ben-cang-dem", kind = "OUTDOOR_MAP", world = "HANG_DUONG_VICTORIAN", url = "/assets/library/v.webp", parentKey = "map-ben-cang", variant = "night", source = "VARIANT" }
            }
        };
        var first = await bot.PutAsJsonAsync("/api/bridge/library", items);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var again = await GetUpsert(await bot.PutAsJsonAsync("/api/bridge/library", items));
        Assert.Equal((4, 0, 0, 4), (again.Received, again.Inserted, again.Updated, again.Unchanged));

        var victorianMaps = await GetData<List<JsonObject>>(vip, "/api/admin/ai-cases/library?world=HANG_DUONG_VICTORIAN&kind=OUTDOOR_MAP");
        Assert.Equal(["map-ben-cang", "v-map-ben-cang-dem"], victorianMaps.Select(item => item["key"]!.GetValue<string>()).Order());
        var taisho = await GetData<List<JsonObject>>(vip, "/api/admin/ai-cases/library?world=TAISHO_JAPAN");
        Assert.Equal(["all-item-chia-khoa", "room-nha-tra"], taisho.Select(item => item["key"]!.GetValue<string>()).Order());
        var bad = await bot.PutAsJsonAsync("/api/bridge/library", new { items = new[] { new { key = "x", kind = "SPACESHIP", url = "/assets/x.webp" } } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        using var scope = factory.Services.CreateScope();
        Assert.Equal(4, await scope.ServiceProvider.GetRequiredService<MongoDbContext>().AssetLibrary
            .CountDocumentsAsync(FilterDefinition<AssetLibraryEntry>.Empty));
    }

    [Fact]
    public async Task LibraryFiles_AreStoredByKeyAndRole_AndRetiredEntriesStayOffTheOrderForm()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var bot = Bot(factory);
        using var vip = User(factory, VipId, UserRole.Vip);

        var ping = await GetData<JsonObject>(bot, "/api/bridge/ping");
        Assert.True(ping["assetStorage"]!.GetValue<bool>()); // local storage outside Production

        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
        async Task<HttpResponseMessage> Upload(string key, string role, byte[] bytes, string contentType = "image/png")
        {
            using var form = new MultipartFormDataContent();
            form.Add(new StringContent(key), "key");
            form.Add(new StringContent(role), "role");
            var file = new ByteArrayContent(bytes);
            file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            form.Add(file, "file", "picture.png");
            return await bot.PostAsync("/api/bridge/library/files", form);
        }
        var stored = await Upload("it-npc-thu-nghiem", "portrait", png);
        Assert.Equal(HttpStatusCode.OK, stored.StatusCode);
        var storedFile = (await stored.Content.ReadFromJsonAsync<ApiResponse<JsonObject>>(Web))!.Data!;
        var url = storedFile["url"]!.GetValue<string>();
        Assert.StartsWith("/assets/ai-generated/bridge/library/it-npc-thu-nghiem/portrait-", url);
        Assert.Equal((1, 1, true), (storedFile["width"]!.GetValue<int>(), storedFile["height"]!.GetValue<int>(), storedFile["hasAlpha"]!.GetValue<bool>()));
        // Same bytes, same address: re-sending a picture never makes a second copy.
        var again = (await (await Upload("it-npc-thu-nghiem", "portrait", png)).Content.ReadFromJsonAsync<ApiResponse<JsonObject>>(Web))!.Data!;
        Assert.Equal(url, again["url"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.BadRequest, (await Upload("it-npc-thu-nghiem", "Bad Role!", png)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Upload("it npc", "main", png)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Upload("it-npc-thu-nghiem", "main", "not a picture"u8.ToArray())).StatusCode);

        var items = new
        {
            items = new object[]
            {
                new
                {
                    key = "it-npc-thu-nghiem", kind = "NPC", world = "HANG_DUONG_VICTORIAN", url, prompt = "Victorian sailor",
                    files = new Dictionary<string, string> { ["portrait"] = url, ["idle"] = url }, pixelLabJobId = "job-1"
                },
                new { key = "all-item-trang-giay-trang", kind = "ITEM", world = "ALL", url, retired = true, nameVi = "Trang giấy trắng" }
            }
        };
        Assert.Equal(HttpStatusCode.OK, (await bot.PutAsJsonAsync("/api/bridge/library", items)).StatusCode);
        var unchanged = await GetUpsert(await bot.PutAsJsonAsync("/api/bridge/library", items));
        Assert.Equal((2, 0, 0, 2), (unchanged.Received, unchanged.Inserted, unchanged.Updated, unchanged.Unchanged));

        var studio = await GetData<List<JsonObject>>(bot, "/api/bridge/library");
        var npc = Assert.Single(studio, item => item["key"]!.GetValue<string>() == "it-npc-thu-nghiem");
        Assert.Equal(url, npc["files"]!["portrait"]!.GetValue<string>());
        Assert.Equal("Victorian sailor", npc["prompt"]!.GetValue<string>());
        Assert.True(Assert.Single(studio, item => item["key"]!.GetValue<string>() == "all-item-trang-giay-trang")["retired"]!.GetValue<bool>());
        var form = await GetData<List<JsonObject>>(vip, "/api/admin/ai-cases/library");
        Assert.DoesNotContain(form, item => item["key"]!.GetValue<string>() == "all-item-trang-giay-trang");
        Assert.Contains(form, item => item["key"]!.GetValue<string>() == "it-npc-thu-nghiem");
        Assert.Single(await GetData<List<JsonObject>>(bot, "/api/bridge/library?includeRetired=false"));

        var badFile = await bot.PutAsJsonAsync("/api/bridge/library", new
        {
            items = new[] { new { key = "x-1", kind = "ITEM", url, files = new Dictionary<string, string> { ["main"] = "http://evil.example/x.png" } } }
        });
        Assert.Equal(HttpStatusCode.BadRequest, badFile.StatusCode);
    }

    [Fact]
    public async Task Cutscene_GoesThroughTheSameBridgeQueue()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var admin = User(factory, AdminId, UserRole.Admin);
        using var bot = Bot(factory);
        string caseId;
        using (var scope = factory.Services.CreateScope())
        {
            var json = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", "case-pixel-tram-hong-ngoc-vi.json"));
            using var document = JsonDocument.Parse(json);
            caseId = (await scope.ServiceProvider.GetRequiredService<ICaseService>().ImportJsonAsync(document.RootElement, overwrite: true)).CaseId;
        }

        var generate = await admin.PostAsJsonAsync($"/api/admin/cases/{caseId}/cutscene/generate", new { regenerate = false });
        Assert.Equal(HttpStatusCode.OK, generate.StatusCode);
        var waiting = (await generate.Content.ReadFromJsonAsync<ApiResponse<JsonObject>>(Web))!.Data!;
        Assert.NotNull(waiting["claudeRequest"]);
        Assert.Empty(waiting["versions"]!.AsArray());
        // Asking again continues the same run instead of queueing a second request.
        await admin.PostAsJsonAsync($"/api/admin/cases/{caseId}/cutscene/generate", new { regenerate = false });

        var pending = (await PendingAsync(bot)).Where(item => item["ownerType"]!.GetValue<string>() == AiBridgeOwnerTypes.Cutscene).ToList();
        var request = Assert.Single(pending);
        Assert.Equal(caseId, request["caseId"]!.GetValue<string>());
        var taken = await TakeAsync(bot, request["requestId"]!.GetValue<string>());
        var answer = await Submit(bot, request["requestId"]!.GetValue<string>(), JsonNode.Parse(taken["devMockResponse"]!.GetValue<string>())!);
        Assert.True(answer["accepted"]!.GetValue<bool>());
        Assert.Equal("SAVED", answer["next"]!["cutscene"]!.GetValue<string>());

        var cutscene = await GetData<JsonObject>(admin, $"/api/admin/cases/{caseId}/cutscene");
        Assert.Null(cutscene["claudeRequest"]);
        Assert.Equal("CLAUDE", cutscene["latest"]!["source"]!.GetValue<string>());
        Assert.Equal(ClaudeBridgeTextProvider.ProviderName, cutscene["latest"]!["model"]!.GetValue<string>());
    }

    // ---------------------------------------------------------------- old drafts, provider idempotency

    [Fact]
    public async Task LegacyDraftInProgress_ParksForClaude_WithoutFailingOrRetrying()
    {
        if (!Enabled) return;
        var factory = new BridgeFactory();
        await using (factory)
        {
            // The app's camelCase BSON conventions must be registered before documents are written by hand.
            System.Runtime.CompilerServices.RuntimeHelpers.RunClassConstructor(typeof(MongoDbContext).TypeHandle);
            // A draft left GENERATING_STORY by the OpenAI build, from before queue fields existed.
            var legacy = new AiCaseDraft
            {
                Id = ObjectId.GenerateNewId().ToString(), CreatedByUserId = AdminId, CreatedByRole = UserRole.Admin,
                Status = AiDraftStatus.GeneratingStory, Provider = "OpenAI", Prompt = "An old draft.",
                Settings = AiCaseService.CreateNewDraftSettings(new GenerateAiCaseRequest { GenerationPreset = AiGenerationPresets.ShortDemo }),
                StoryDiversity = AiStoryDiversityPolicy.Create(AiCaseTypes.Random, "legacy-seed"),
                LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim
            };
            var document = legacy.ToBsonDocument();
            foreach (var field in new[] { "workflowVersion", "queueState", "queuedOperation", "orderStatus", "orderStatusHistory", "order" })
                document.Remove(field);
            await factory.RawDatabase().GetCollection<BsonDocument>("aiCaseDrafts").InsertOneAsync(document);
            await factory.RawDatabase().GetCollection<User>("users").InsertOneAsync(new User
            {
                Id = AdminId, FullName = "Admin", Email = $"{AdminId}@bridge.test", Role = UserRole.Admin,
                Status = UserStatus.Active, IsEmailVerified = true
            });

            using var admin = User(factory, AdminId, UserRole.Admin); // starts the host: backfill, then the worker
            var deadline = DateTime.UtcNow.AddSeconds(30);
            AiCaseDraft stored;
            while (true)
            {
                using var scope = factory.Services.CreateScope();
                stored = await scope.ServiceProvider.GetRequiredService<MongoDbContext>().AiCaseDrafts
                    .Find(item => item.Id == legacy.Id).SingleAsync();
                if (stored.QueueState == AiQueueStates.AwaitingClaude) break;
                Assert.True(DateTime.UtcNow < deadline, $"Legacy draft stayed {stored.Status}/{stored.QueueState}.");
                await Task.Delay(150);
            }
            Assert.Equal(AiDraftStatus.GeneratingStory, stored.Status); // not failed
            Assert.Equal(string.Empty, stored.LastGenerationErrorCode); // not an error
            Assert.Equal(1, stored.QueueAttemptCount); // not retried
            Assert.Null(stored.NextAttemptAt);
            Assert.NotNull(stored.ClaudeWait);
            Assert.Equal("CreateStoryPreview", stored.ClaudeWait!.Step);
            Assert.False(string.IsNullOrWhiteSpace(stored.GenerationRunId));
            var runId = stored.GenerationRunId;
            Assert.Equal(AiOrderStatuses.QueuedForClaude, (await GetData<AiDraftResponse>(admin, $"/api/admin/ai-cases/{legacy.Id}")).OrderStatus);

            await Task.Delay(1500);
            using (var scope = factory.Services.CreateScope())
            {
                var again = await scope.ServiceProvider.GetRequiredService<MongoDbContext>().AiCaseDrafts
                    .Find(item => item.Id == legacy.Id).SingleAsync();
                Assert.Equal((AiQueueStates.AwaitingClaude, 1), (again.QueueState, again.QueueAttemptCount)); // no backoff loop
            }

            using var bot = Bot(factory);
            var taken = await TakeAsync(bot, stored.ClaudeWait.RequestId);
            await Submit(bot, stored.ClaudeWait.RequestId, JsonNode.Parse(taken["devMockResponse"]!.GetValue<string>())!);
            await WaitForAsync(admin, bot, legacy.Id, AiDraftStatus.StoryAwaitingApproval);
            using (var scope = factory.Services.CreateScope())
            {
                var request = await scope.ServiceProvider.GetRequiredService<MongoDbContext>().AiBridgeRequests
                    .Find(item => item.Id == stored.ClaudeWait.RequestId).SingleAsync();
                Assert.Equal(runId, request.GenerationRunId); // the resumed run kept its id and found the answer
                Assert.Equal(AiBridgeStatuses.Accepted, request.Status);
            }
        }
    }

    [Fact]
    public async Task Provider_IsIdempotent_ParksThenAnswers_AndRetiresAChangedPrompt()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        using var _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        var draftId = ObjectId.GenerateNewId().ToString();
        await db.AiCaseDrafts.InsertOneAsync(new AiCaseDraft { Id = draftId, Status = AiDraftStatus.GeneratingStory });
        IAiTextProvider NewRun() => ActivatorUtilities.CreateInstance<ClaudeBridgeTextProvider>(scope.ServiceProvider);
        var request = new AiTextRequest
        {
            OwnerId = draftId, GenerationRunId = "run-1", Step = "CreateStoryPreview", AttemptNumber = 1,
            SchemaVersion = AiGenerationSchemaVersions.StoryPreview, Schema = AiStrictSchemaProvider.StoryPreviewSchema(),
            Prompt = "Write the preview. {\"createdAt\":\"2026-11-16T10:00:00Z\"}"
        };

        var first = await Assert.ThrowsAsync<AiAwaitingClaudeException>(() => NewRun().GenerateJsonAsync(request));
        var replay = await Assert.ThrowsAsync<AiAwaitingClaudeException>(() => NewRun().GenerateJsonAsync(
            request with { Prompt = "Write the preview. {\"createdAt\":\"2026-11-16T10:09:59Z\"}" }));
        Assert.Equal(first.RequestId, replay.RequestId); // same key, same request; timestamps are not content
        Assert.Equal(1, await db.AiBridgeRequests.CountDocumentsAsync(item => item.OwnerId == draftId));

        var store = scope.ServiceProvider.GetRequiredService<AiBridgeRequestStore>();
        var answer = AiCaseMockFactory.MockJsonResponse("CreateStoryPreview", AiGenerationSchemaVersions.StoryPreview);
        await store.SubmitAsync(first.RequestId, answer);
        Assert.Equal(answer, await NewRun().GenerateJsonAsync(request));
        Assert.Equal(answer, await NewRun().GenerateJsonAsync(request));
        var draft = await db.AiCaseDrafts.Find(item => item.Id == draftId).SingleAsync();
        Assert.Single(draft.GenerationAttempts); // recorded once however often the run replays

        // The second call of the same step in one execution is a different question.
        var sameRun = NewRun();
        Assert.Equal(answer, await sameRun.GenerateJsonAsync(request));
        await Assert.ThrowsAsync<AiAwaitingClaudeException>(() => sameRun.GenerateJsonAsync(request));

        // A changed prompt retires the answered request and asks again, with a warning on the draft log.
        var changed = await Assert.ThrowsAsync<AiAwaitingClaudeException>(() =>
            NewRun().GenerateJsonAsync(request with { Prompt = "A different preview prompt." }));
        Assert.NotEqual(first.RequestId, changed.RequestId);
        Assert.Equal(AiBridgeStatuses.Stale, (await db.AiBridgeRequests.Find(item => item.Id == first.RequestId).SingleAsync()).Status);
        Assert.Equal(1, await db.AiGenerationLogs.CountDocumentsAsync(item => item.DraftId == draftId && item.Status == "STALE"));

        // A cancelled draft closes its open requests.
        await store.CancelOwnerAsync(AiBridgeOwnerTypes.CaseDraft, draftId);
        Assert.Equal(AiBridgeStatuses.Cancelled, (await db.AiBridgeRequests.Find(item => item.Id == changed.RequestId).SingleAsync()).Status);
    }

    // ---------------------------------------------------------------- the test bot

    private enum GateApprover { Admin, BotWhereAllowed }

    private async Task<AiDraftResponse> RunBotAsync(
        BridgeFactory factory, HttpClient admin, HttpClient bot, string draftId, GateApprover approver)
    {
        var deadline = DateTime.UtcNow.AddSeconds(180);
        var answered = 0;
        while (DateTime.UtcNow < deadline)
        {
            var draft = await GetData<AiDraftResponse>(admin, $"/api/admin/ai-cases/{draftId}");
            var idle = draft.QueueState is AiQueueStates.None or "";
            if (idle && draft.Status == AiDraftStatus.ReadyToPublish) return draft;
            if (idle && draft.Status is AiDraftStatus.GeneratedInvalid or AiDraftStatus.CaseTruthInvalid or AiDraftStatus.Cancelled)
                throw new Xunit.Sdk.XunitException(
                    $"Draft ended {draft.Status} ({draft.FailurePhase}): {string.Join(" | ", draft.ValidationErrors.Concat(draft.TruthValidationReport).Take(10))}");
            if (idle)
            {
                await ApproveGateAsync(admin, bot, draft, approver);
                await Task.Delay(100);
                continue;
            }
            foreach (var request in (await PendingAsync(bot)).Where(item => item["draftId"]?.GetValue<string>() == draftId))
            {
                var requestId = request["requestId"]!.GetValue<string>();
                if (request["kind"]!.GetValue<string>() == AiBridgeKinds.Assets)
                {
                    await TakeAsync(bot, requestId);
                    await EnsurePixelPlanAsync(bot, draftId);
                    await UploadRequestedImagesAsync(bot, draftId);
                    var complete = await bot.PostAsync($"/api/bridge/drafts/{draftId}/assets/complete", null);
                    var body = await complete.Content.ReadAsStringAsync();
                    Assert.True(complete.IsSuccessStatusCode && body.Contains("\"accepted\":true"), body);
                }
                else
                {
                    var taken = await TakeAsync(bot, requestId);
                    var mock = taken["devMockResponse"]?.GetValue<string>()
                        ?? throw new Xunit.Sdk.XunitException($"No mock answer for {taken["step"]}.");
                    var result = await Submit(bot, requestId, JsonNode.Parse(mock)!);
                    Assert.True(result["accepted"]!.GetValue<bool>(),
                        $"{taken["step"]} mock refused: {result["errors"]?.ToJsonString()}");
                }
                answered++;
            }
            await Task.Delay(100);
        }
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
            var draft = await db.AiCaseDrafts.Find(item => item.Id == draftId).SingleAsync();
            var requests = await db.AiBridgeRequests.Find(item => item.OwnerId == draftId).SortBy(item => item.CreatedAt).ToListAsync();
            output.WriteLine($"draft {draft.Status}/{draft.QueueState} wait={draft.ClaudeWait?.Step} run={draft.GenerationRunId}");
            foreach (var group in requests.GroupBy(item => (item.Step, item.Status)))
                output.WriteLine($"  {group.Key.Step} {group.Key.Status} x{group.Count()} runs={string.Join(',', group.Select(item => item.GenerationRunId[..6]).Distinct())} attempts={string.Join(',', group.Select(item => item.AttemptNumber).Distinct())} ordinals={string.Join(',', group.Select(item => item.CallOrdinal).Distinct())}");
            var logs = await db.AiGenerationLogs.Find(item => item.DraftId == draftId && item.Status == "STALE").Limit(5).ToListAsync();
            foreach (var log in logs) output.WriteLine($"  STALE {log.Step}: {log.Response}");
        }
        throw new TimeoutException($"Draft {draftId} did not finish after {answered} answers.");
    }

    private static async Task ApproveGateAsync(HttpClient admin, HttpClient bot, AiDraftResponse draft, GateApprover approver)
    {
        var (adminRoute, gate) = draft.Status switch
        {
            AiDraftStatus.StoryAwaitingApproval => ("approve", "STORY"),
            AiDraftStatus.CaseTruthAwaitingApproval => ("approve-truth", "TRUTH"),
            AiDraftStatus.FullLogicAwaitingApproval => ("approve-full-logic", "LOGIC"),
            AiDraftStatus.SceneLayoutAwaitingApproval => ("approve-scene-layout", "LAYOUT"),
            _ => (string.Empty, string.Empty)
        };
        if (adminRoute.Length == 0) return;
        if (approver == GateApprover.BotWhereAllowed)
        {
            var botTry = await bot.PostAsJsonAsync($"/api/bridge/drafts/{draft.DraftId}/approve-gate", new { gate });
            if (gate == "TRUTH")
            {
                Assert.Equal(HttpStatusCode.Forbidden, botTry.StatusCode); // never the truth gate
            }
            else
            {
                Assert.Equal(HttpStatusCode.OK, botTry.StatusCode);
                return;
            }
        }
        var response = await admin.PostAsync($"/api/admin/ai-cases/{draft.DraftId}/{adminRoute}", null);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Pixel drafts (VUAN-6B): uploads wait for an asset plan within pixelLabCap. The test bot first checks the guards
    /// (no plan, all-new plan over the cap), then declares a library-only plan (0 PixelLab generations).
    /// </summary>
    private static async Task EnsurePixelPlanAsync(HttpClient bot, string draftId)
    {
        var needed = await GetData<JsonObject>(bot, $"/api/bridge/drafts/{draftId}/assets-needed");
        if (needed["pixel"] is not JsonObject pixel || pixel["planAccepted"]!.GetValue<bool>()) return;

        var firstSlot = needed["slots"]!.AsArray().Select(item => item!.AsObject()).First(item => item["requestedNow"]!.GetValue<bool>());
        using (var early = new MultipartFormDataContent())
        {
            early.Add(new StringContent(firstSlot["slotId"]!.GetValue<string>()), "slotId");
            var picture = new ByteArrayContent(TestImages.Png(true, firstSlot["width"]!.GetValue<int>(), firstSlot["height"]!.GetValue<int>()));
            picture.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            early.Add(picture, "file", "slot.png");
            var refused = await bot.PostAsync($"/api/bridge/drafts/{draftId}/assets", early);
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
            Assert.Contains("AI_ASSET_PLAN_REQUIRED", await refused.Content.ReadAsStringAsync());
        }

        // Everything new is far over the default cap of 60: refused with the number of generations it needs.
        var overCap = await bot.PutAsJsonAsync($"/api/bridge/drafts/{draftId}/asset-plan", new { choices = Array.Empty<object>() });
        var overCapBody = await overCap.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.Conflict, overCap.StatusCode);
        Assert.Contains("AI_PIXELLAB_CAP_EXCEEDED", overCapBody);
        Assert.Contains("PixelLab generations but this order allows", overCapBody);

        var keys = new Dictionary<string, string>
        {
            ["OUTDOOR_MAP"] = "it-pixel-map", ["INTERIOR"] = "it-pixel-room", ["NPC"] = "it-pixel-npc", ["ITEM"] = "it-pixel-item"
        };
        var library = await bot.PutAsJsonAsync("/api/bridge/library", new
        {
            items = keys.Select(pair => new { key = pair.Value, kind = pair.Key, world = "HANG_DUONG_VICTORIAN", url = $"/assets/library/{pair.Value}.webp" })
        });
        Assert.True(library.IsSuccessStatusCode, await library.Content.ReadAsStringAsync());
        var choices = pixel["subjects"]!.AsArray().Select(item => new
        {
            subject = item!["subject"]!.GetValue<string>(),
            source = "LIBRARY",
            libraryKey = keys[item["libraryKind"]!.GetValue<string>()]
        }).ToList();
        var accepted = await bot.PutAsJsonAsync($"/api/bridge/drafts/{draftId}/asset-plan", new { choices });
        var acceptedBody = await accepted.Content.ReadAsStringAsync();
        Assert.True(accepted.IsSuccessStatusCode, acceptedBody);
        var plan = JsonNode.Parse(acceptedBody)!["data"]!;
        Assert.Equal(0, plan["estimatedGenerations"]!.GetValue<int>());
        Assert.Empty(plan["plan"]!["requests"]!.AsArray());
    }

    private static async Task UploadRequestedImagesAsync(HttpClient bot, string draftId)
    {
        var needed = await GetData<JsonObject>(bot, $"/api/bridge/drafts/{draftId}/assets-needed");
        foreach (var slot in needed["slots"]!.AsArray().Select(item => item!.AsObject())
                     .Where(item => item["requestedNow"]!.GetValue<bool>()))
        {
            var transparent = slot["transparent"]!.GetValue<bool>();
            using var form = new MultipartFormDataContent();
            form.Add(new StringContent(slot["slotId"]!.GetValue<string>()), "slotId");
            // Pixel slots take exact sizes (512 scenes, 1152x128 idle sheets, 288 portraits, 64 icons).
            var file = new ByteArrayContent(needed["pixel"] is JsonObject
                ? TestImages.Png(transparent || slot["kind"]!.GetValue<string>() != "background", slot["width"]!.GetValue<int>(), slot["height"]!.GetValue<int>())
                : TestImages.Png(transparent));
            file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            form.Add(file, "file", "slot.png");
            var upload = await bot.PostAsync($"/api/bridge/drafts/{draftId}/assets", form);
            Assert.True(upload.IsSuccessStatusCode, await upload.Content.ReadAsStringAsync());
        }
    }

    private static async Task<string> CreateAsync(HttpClient admin, string reviewMode)
    {
        var created = await admin.PostAsJsonAsync("/api/admin/ai-cases", new GenerateAiCaseRequest
        {
            GenerationPreset = AiGenerationPresets.ShortDemo, Language = "en",
            Order = new AiCaseOrder { ReviewMode = reviewMode }
        });
        Assert.Equal(HttpStatusCode.Accepted, created.StatusCode);
        return (await created.Content.ReadFromJsonAsync<ApiResponse<AiDraftResponse>>(Web))!.Data!.DraftId;
    }

    private static async Task WaitForAsync(HttpClient admin, HttpClient bot, string draftId, string status)
    {
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (DateTime.UtcNow < deadline)
        {
            var draft = await GetData<AiDraftResponse>(admin, $"/api/admin/ai-cases/{draftId}");
            if (draft.Status == status && draft.QueueState is AiQueueStates.None or "") return;
            foreach (var request in (await PendingAsync(bot)).Where(item => item["draftId"]?.GetValue<string>() == draftId
                         && item["kind"]!.GetValue<string>() == AiBridgeKinds.Json))
            {
                var requestId = request["requestId"]!.GetValue<string>();
                var taken = await TakeAsync(bot, requestId);
                await Submit(bot, requestId, JsonNode.Parse(taken["devMockResponse"]!.GetValue<string>())!);
            }
            await Task.Delay(100);
        }
        throw new TimeoutException($"Draft {draftId} did not reach {status}.");
    }

    private static async Task<string> WaitForRequestAsync(HttpClient bot, string draftId)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            var request = (await PendingAsync(bot)).FirstOrDefault(item => item["draftId"]?.GetValue<string>() == draftId);
            if (request is not null) return request["requestId"]!.GetValue<string>();
            await Task.Delay(100);
        }
        throw new TimeoutException("No bridge request appeared.");
    }

    private static Task<List<JsonObject>> PendingAsync(HttpClient bot) => GetData<List<JsonObject>>(bot, "/api/bridge/requests?status=PENDING");

    private static async Task<JsonObject> TakeAsync(HttpClient bot, string requestId)
    {
        var response = await bot.PostAsync($"/api/bridge/requests/{requestId}/take", null);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<ApiResponse<JsonObject>>(Web))!.Data!;
    }

    private static async Task<JsonObject> Submit(HttpClient bot, string requestId, JsonNode answer)
    {
        var response = await bot.PostAsync($"/api/bridge/requests/{requestId}/submit",
            new StringContent(answer.ToJsonString(), System.Text.Encoding.UTF8, "application/json"));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<ApiResponse<JsonObject>>(Web))!.Data!;
    }

    private static async Task<AssetLibraryUpsertResult> GetUpsert(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<ApiResponse<AssetLibraryUpsertResult>>(Web))!.Data!;
    }

    private static async Task<T> GetData<T>(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        Assert.True(response.IsSuccessStatusCode, $"{url}: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<ApiResponse<T>>(Web))!.Data!;
    }

    private static void CollectNames(JsonNode? node, List<string> names)
    {
        if (node is JsonObject obj)
            foreach (var (name, child) in obj) { names.Add(name); CollectNames(child, names); }
        else if (node is JsonArray array)
            foreach (var child in array) CollectNames(child, names);
    }

    private static HttpClient Bot(BridgeFactory factory)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("X-Bridge-Key", BridgeKey);
        return client;
    }

    private static HttpClient User(BridgeFactory factory, string userId, string role)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("X-Test-UserId", userId);
        client.DefaultRequestHeaders.Add("X-Test-Role", role);
        return client;
    }

    private static async Task SeedUsersAsync(BridgeFactory factory)
    {
        using var _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        foreach (var (id, role) in new[] { (AdminId, UserRole.Admin), (VipId, UserRole.Vip), (PlayerId, UserRole.Player) })
            await db.Users.InsertOneAsync(new User
            {
                Id = id, FullName = role, Email = $"{id}@bridge.test", Role = role, Status = UserStatus.Active, IsEmailVerified = true
            });
    }

    private sealed class BridgeFactory(string key = BridgeKey) : WebApplicationFactory<Program>
    {
        private readonly string _connectionString =
            Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
            ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000";
        private readonly string _databaseName = $"sirlocked_it_{Guid.NewGuid():N}";

        public IMongoDatabase RawDatabase()
        {
            TestMongoSafetyGuard.EnsureSafe(new MongoDbSettings { ConnectionString = _connectionString, DatabaseName = _databaseName });
            return new MongoClient(_connectionString).GetDatabase(_databaseName);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            TestMongoSafetyGuard.EnsureSafe(new MongoDbSettings { ConnectionString = _connectionString, DatabaseName = _databaseName });
            builder.UseEnvironment("Testing");
            builder.ConfigureLogging(logging => logging.ClearProviders());
            builder.ConfigureAppConfiguration((_, configuration) =>
            {
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["MongoDb:ConnectionString"] = _connectionString,
                    ["MongoDb:DatabaseName"] = _databaseName,
                    ["AiGeneration:MockAiResponses"] = "false",
                    ["Bridge:Key"] = key,
                    ["Bridge:ExposeMockResponses"] = "true",
                    ["Bridge:AllowLocalAssetStorage"] = "true",
                    ["Bridge:RateLimitPerMinute"] = "5000",
                    ["CaseCatalog:PixelOnly"] = "false",
                    ["CaseCatalog:SeedPixelOnStartup"] = "false",
                    ["Cutscene:AutoApprove"] = "false",
                    ["Jwt:Secret"] = "integration-test-secret-with-at-least-32-characters",
                    ["Google:ClientId"] = "integration-test-google-client",
                    ["Google:ClientSecret"] = "integration-test-google-secret",
                    ["Email:SmtpHost"] = "127.0.0.1",
                    ["Email:SmtpPort"] = "1",
                    ["Email:SenderEmail"] = "integration@example.invalid",
                    ["Email:Username"] = "integration-only",
                    ["Email:Password"] = "unused-integration-placeholder",
                    ["Email:FrontendUrl"] = "http://127.0.0.1:5173"
                });
            });
            builder.ConfigureTestServices(services =>
            {
                services.AddDataProtection().UseEphemeralDataProtectionProvider();
                services.RemoveAll<IEmailService>();
                services.AddSingleton<IEmailService, NoEmail>();
                services.PostConfigure<GoogleOptions>(GoogleDefaults.AuthenticationScheme, options =>
                {
                    options.ClientId = "integration-test-google-client";
                    options.ClientSecret = "integration-test-google-secret";
                });
                services.AddAuthentication(options =>
                    {
                        options.DefaultAuthenticateScheme = HeaderAuth.SchemeName;
                        options.DefaultChallengeScheme = HeaderAuth.SchemeName;
                    })
                    .AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.SchemeName, _ => { });
            });
        }

        public override async ValueTask DisposeAsync()
        {
            await base.DisposeAsync();
            TestMongoSafetyGuard.EnsureSafe(new MongoDbSettings { ConnectionString = _connectionString, DatabaseName = _databaseName });
            await new MongoClient(_connectionString).DropDatabaseAsync(_databaseName);
            // Images stored locally during the test live under the frontend's ignored ai-generated folder.
            var bridgeAssets = FindBridgeAssetsFolder();
            if (bridgeAssets is not null && Directory.Exists(bridgeAssets))
            {
                foreach (var folder in Directory.GetDirectories(bridgeAssets))
                {
                    try { Directory.Delete(folder, recursive: true); }
                    catch (IOException) { }
                }
            }
        }

        private static string? FindBridgeAssetsFolder()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "src", "FE", "public", "assets", "ai-generated", "bridge");
                if (Directory.Exists(Path.Combine(directory.FullName, "src", "FE"))) return candidate;
                directory = directory.Parent;
            }
            return null;
        }
    }

    private sealed class NoEmail : IEmailService
    {
        public Task SendVerificationEmailAsync(string toEmail, string fullName, string token) => Task.CompletedTask;
        public Task SendPasswordResetEmailAsync(string toEmail, string fullName, string token) => Task.CompletedTask;
    }

    /// <summary>Authenticates only requests that carry X-Test-UserId; everything else stays anonymous.</summary>
    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string SchemeName = "BridgeIntegrationTest";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var userId = Request.Headers["X-Test-UserId"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(userId)) return Task.FromResult(AuthenticateResult.NoResult());
            var role = Request.Headers["X-Test-Role"].FirstOrDefault() ?? UserRole.Player;
            var identity = new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, userId), new Claim(ClaimTypes.Name, role), new Claim(ClaimTypes.Role, role)],
                SchemeName);
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
        }
    }
}

internal static class TestImages
{
    public static byte[] Png(bool transparent, int width = 64, int height = 36)
    {
        using var image = new SixLabors.ImageSharp.Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(width, height);
        image.ProcessPixelRows(rows =>
        {
            for (var y = 0; y < rows.Height; y++)
            {
                var row = rows.GetRowSpan(y);
                for (var x = 0; x < row.Length; x++)
                    row[x] = new SixLabors.ImageSharp.PixelFormats.Rgba32((byte)(x * 3), (byte)(y * 5), 120,
                        transparent && (x < 4 || y < 4) ? (byte)0 : (byte)255);
            }
        });
        using var stream = new MemoryStream();
        SixLabors.ImageSharp.ImageExtensions.SaveAsPng(image, stream);
        return stream.ToArray();
    }
}
