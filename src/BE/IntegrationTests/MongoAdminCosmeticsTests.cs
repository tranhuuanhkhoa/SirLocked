using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The cosmetics admin area against a real (standalone) MongoDB, read back through the same services players use.
/// Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoAdminCosmeticsTests
{
    private static readonly CurrentUser Admin = new("admin-1", "Yến", UserRole.Admin);
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private const string Picture = "/assets/cosmetics/vien-dong.webp";
    private const string Rare = "VC-0391"; // Đèn bão
    private const string Epic = "VC-0405"; // Huy hiệu sở

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    private static AdminCosmeticCreateRequest PaintedFrame(string name = "Hắc Long", bool tradable = true, string rarity = MarketRarities.Rare) => new(
        MarketCategories.Frame, name, null, null, null, rarity, tradable, null,
        new AdminCosmeticVisualRequest(Picture, "painted", Json("""
            { "hole": { "x": 124, "y": 130, "r": 78 }, "live": { "aura": ["120,200,255", 0.3], "spark": ["255,255,255", 3] }, "sheen": { "rgb": "255,236,180", "a": 0.4, "period": 8 } }
            """)),
        null);

    private static AdminCosmeticCreateRequest StyledTitle(string name = "Hắc Long Thám Tử") => new(
        MarketCategories.Title, name, "Black Dragon Sleuth", null, null, MarketRarities.Mystery, false, null,
        new AdminCosmeticVisualRequest(null, "style", Json("""{ "style": "kimlong" }""")),
        null);

    private static AdminCosmeticCreateRequest TemplateEntrance(string name = "Hắc Long Giáng Thế") => new(
        MarketCategories.Entrance, name, null, "Rồng đen lượn qua mây.", null, MarketRarities.Legendary, true, null,
        new AdminCosmeticVisualRequest(null, "kim-long", Json("""{ "imageUrl": "/assets/cosmetics/rong-bay.webp", "tint": "120,200,255", "duration": 9 }""")),
        null);

    private static AdminCosmeticAcquisitionRequest Level(int level) => new("level", level, null, null, "Thưởng mới");

    // ------------------------------------------------------------------ creating

    [Fact]
    public async Task ACreatedFrameIsStoredWithItsVisualAndReachesPlayersPages()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();

        var created = await env.Admin.CreateAsync(Admin, PaintedFrame());

        Assert.Equal("frame_hac-long", created.Id);
        Assert.Equal("painted", created.Visual.Template);
        Assert.Equal(1, created.Version);
        Assert.Equal(0, created.Owners);
        Assert.Equal("admin", created.Acquisition.Mode);

        var stored = await env.Raw("catalogItems").Find(new BsonDocument("_id", created.Id)).SingleAsync();
        Assert.Equal("painted", stored["visual"]["template"].AsString);
        Assert.Equal(78, stored["visual"]["params"]["hole"]["r"].ToDouble());
        Assert.Equal(BsonNull.Value, stored["visual"]["builtinId"]);

        var catalog = await env.Admin.PublicCatalogAsync();
        var entry = Assert.Single(catalog.Items, item => item.Id == created.Id);
        var json = JsonSerializer.SerializeToElement(entry.Visual, Web);
        Assert.Equal(Picture, json.GetProperty("imageUrl").GetString());
        Assert.Equal(78, json.GetProperty("params").GetProperty("hole").GetProperty("r").GetDouble());
        Assert.Equal("120,200,255", json.GetProperty("params").GetProperty("live").GetProperty("aura")[0].GetString());
    }

    [Fact]
    public async Task TwoItemsWithOneNameGetDifferentIds()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();

        var first = await env.Admin.CreateAsync(Admin, PaintedFrame());
        var second = await env.Admin.CreateAsync(Admin, PaintedFrame());

        Assert.Equal("frame_hac-long", first.Id);
        Assert.Equal("frame_hac-long-2", second.Id);
    }

    [Fact]
    public async Task ABrokenVisualIsNotSaved()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var before = await env.Catalog.Items.CountDocumentsAsync(FilterDefinition<CatalogItem>.Empty);
        var broken = PaintedFrame() with { Visual = new AdminCosmeticVisualRequest(Picture, "painted", Json("""{ "hole": { "x": 1, "y": 1, "r": 0 } }""")) };

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.CreateAsync(Admin, broken));

        Assert.Equal(400, error.StatusCode);
        Assert.Equal(AdminCosmeticCodes.HoleInvalid, ((ApiErrorDetails)error.Errors!).Code);
        Assert.Equal(before, await env.Catalog.Items.CountDocumentsAsync(FilterDefinition<CatalogItem>.Empty));
        Assert.Equal(0, await env.AuditCountAsync("item.create"));
    }

    [Fact]
    public async Task ATitleAndAnEntranceAreCreatedFromTheirTemplates()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();

        var title = await env.Admin.CreateAsync(Admin, StyledTitle());
        var entrance = await env.Admin.CreateAsync(Admin, TemplateEntrance());

        Assert.Equal("title_hac-long-tham-tu", title.Id);
        Assert.Equal("Black Dragon Sleuth", title.NameEn);
        Assert.Equal("kimlong", JsonSerializer.SerializeToElement(title.Visual, Web).GetProperty("params").GetProperty("style").GetString());
        Assert.Equal("entrance_hac-long-giang-the", entrance.Id);
        Assert.Equal("Rồng đen lượn qua mây.", entrance.DisplayDescription);
    }

    [Fact]
    public async Task ATitlePaintedFromAPictureAndAFlipbookEntranceReachPlayers()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var paintedTitle = new AdminCosmeticCreateRequest(
            MarketCategories.Title, "Cú Đêm Phố Cổ", "Old Town Night Owl", null, null, MarketRarities.Epic, true, null,
            new AdminCosmeticVisualRequest(Picture, "painted", Json("""
                { "size": { "w": 640, "h": 160 }, "box": { "x": 0.18, "y": 0.3, "w": 0.64, "h": 0.42 }, "color": "255,236,190", "glow": "255,200,90" }
                """)),
            null);
        var flipbook = new AdminCosmeticCreateRequest(
            MarketCategories.Entrance, "Cú Đêm Bay Về", null, "Một bầy cú sà xuống quanh bạn.", null, MarketRarities.Legendary, true, null,
            new AdminCosmeticVisualRequest(null, "flipbook", Json($$"""
                { "sheetUrl": "{{Picture}}", "cols": 4, "rows": 2, "frames": 8, "fps": 12, "place": "drop", "blend": "add", "duration": 6 }
                """)),
            null);

        var title = await env.Admin.CreateAsync(Admin, paintedTitle);
        var entrance = await env.Admin.CreateAsync(Admin, flipbook);

        var catalog = await env.Admin.PublicCatalogAsync();
        var titleVisual = JsonSerializer.SerializeToElement(catalog.Items.Single(item => item.Id == title.Id).Visual, Web);
        Assert.Equal("painted", titleVisual.GetProperty("template").GetString());
        Assert.Equal(Picture, titleVisual.GetProperty("imageUrl").GetString());
        Assert.Equal(0.64, titleVisual.GetProperty("params").GetProperty("box").GetProperty("w").GetDouble());
        Assert.Equal(640, titleVisual.GetProperty("params").GetProperty("size").GetProperty("w").GetDouble());
        var entranceVisual = JsonSerializer.SerializeToElement(catalog.Items.Single(item => item.Id == entrance.Id).Visual, Web);
        Assert.Equal("flipbook", entranceVisual.GetProperty("template").GetString());
        Assert.Equal(Picture, entranceVisual.GetProperty("params").GetProperty("sheetUrl").GetString());
        Assert.Equal("drop", entranceVisual.GetProperty("params").GetProperty("place").GetString());
    }

    [Fact]
    public async Task AdminsCannotCreateAnythingElseHere()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.CreateAsync(Admin, PaintedFrame() with { Category = MarketCategories.Curio }));

        Assert.Equal(AdminCosmeticCodes.NotCosmetic, ((ApiErrorDetails)error.Errors!).Code);
    }

    // ------------------------------------------------------------------ editing

    [Fact]
    public async Task EditingAShippedItemKeepsItsDrawing()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var current = await env.Admin.GetAsync("frame_kimlong");

        var saved = await env.Admin.UpdateAsync(Admin, "frame_kimlong", new AdminCosmeticUpdateRequest(
            current.Version, "Kim Long Mới", "New Golden Dragon", "", "", current.Rarity, current.Tradable, current.ReferencePrice,
            new AdminCosmeticVisualRequest(null, "builtin-clone", Json("""{ "base": "dong" }""")), "Đổi tên"));

        Assert.Equal("Kim Long Mới", saved.Name);
        Assert.Equal(current.Version + 1, saved.Version);
        Assert.Equal("kimlong", saved.Visual.BuiltinId);
        Assert.Null(saved.Visual.Template);
        Assert.Equal("Kim Long Mới", env.Provider.Current.Find("frame_kimlong")!.Name);
    }

    [Fact]
    public async Task AnEditFromAnOldCopyIsRefused()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var created = await env.Admin.CreateAsync(Admin, PaintedFrame());
        await env.Admin.UpdateAsync(Admin, created.Id, Update(created, name: "Lần một"));

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.UpdateAsync(Admin, created.Id, Update(created, name: "Lần hai")));

        Assert.Equal(AdminCosmeticCodes.VersionConflict, ((ApiErrorDetails)error.Errors!).Code);
        Assert.Equal("Lần một", (await env.Admin.GetAsync(created.Id)).Name);
    }

    private static AdminCosmeticUpdateRequest Update(AdminCosmeticDto item, string? name = null, bool? tradable = null, string? rarity = null, long? price = null) => new(
        item.Version, name ?? item.Name, item.NameEn, item.Description, item.DescriptionEn, rarity ?? item.Rarity, tradable ?? item.Tradable, price ?? item.ReferencePrice,
        new AdminCosmeticVisualRequest(item.Visual.ImageUrl, item.Visual.Template, JsonSerializer.SerializeToElement(item.Visual.Params, Web)), "Sửa thử");

    // ------------------------------------------------------------------ level rewards

    [Fact]
    public async Task ANewLevelRewardReachesThoseAlreadyPastItExactlyOnce()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        var below = await env.AddUserAsync("Mới vào nghề");
        await env.SetLevelAsync(player.Id, 12);
        await env.SetLevelAsync(below.Id, 4);
        Assert.DoesNotContain((await env.Progress.GetMeAsync(player.Id)).Owned, item => item.DefId == "frame_hac-long");

        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());
        await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));

        // Opening the profile twice, and at once from two tabs, leaves one copy.
        await Task.WhenAll(env.Progress.GetMeAsync(player.Id), env.Progress.GetMeAsync(player.Id));
        var me = await env.Progress.GetMeAsync(player.Id);
        var granted = Assert.Single(me.Owned, item => item.DefId == frame.Id);
        Assert.Equal(MarketItemSources.Level, granted.Source);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.OwnerId == player.Id && i.DefId == frame.Id));

        Assert.DoesNotContain((await env.Progress.GetMeAsync(below.Id)).Owned, item => item.DefId == frame.Id);
        Assert.Equal(1, (await env.Admin.GetAsync(frame.Id)).Owners);
    }

    [Fact]
    public async Task ReachingTheLevelByExchangeGrantsTheRewardAndAnnouncesIt()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        await env.SetLevelAsync(player.Id, 4, xp: 300);
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());
        await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));
        await env.Market.AdminGrantAsync(player.Id, Epic, 0);
        var item = (await env.Progress.GetMeAsync(player.Id)).Exchangeable.Single();

        var result = await env.Progress.ExchangeAsync(player, new[] { item.ItemId }, Guid.NewGuid().ToString());

        Assert.True(result.Level >= 5);
        Assert.Contains(frame.Id, result.NewFrameDefIds);
        Assert.Contains((await env.Progress.GetMeAsync(player.Id)).Owned, owned => owned.DefId == frame.Id);
    }

    [Fact]
    public async Task ALevelRewardIsNeverTradable()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        await env.SetLevelAsync(player.Id, 6);
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame(tradable: true));

        var saved = await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));

        Assert.False(saved.Tradable);
        Assert.Equal("level", saved.Acquisition.Mode);
        Assert.Equal(5, saved.Acquisition.Level);

        var refused = await Assert.ThrowsAsync<ApiException>(() => env.Admin.UpdateAsync(Admin, frame.Id, Update(saved, tradable: true)));
        Assert.Equal(AdminCosmeticCodes.EarnedNotTradable, ((ApiErrorDetails)refused.Errors!).Code);

        var copy = (await env.Progress.GetMeAsync(player.Id)).Owned.Single(item => item.DefId == frame.Id);
        var unsold = await Assert.ThrowsAsync<ApiException>(() => env.Market.CreateListingAsync(player, copy.ItemId, 500));
        Assert.Equal(MarketErrors.ItemNotTradable, ((ApiErrorDetails)unsold.Errors!).Code);
        Assert.Empty((await env.Progress.GetMeAsync(player.Id)).Exchangeable);
    }

    [Fact]
    public async Task MovingARewardToAnotherLevelLeavesOneEntry()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());

        await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));
        var saved = await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(15));

        Assert.Equal(15, saved.Acquisition.Level);
        var reward = Assert.Single(env.Provider.Current.LevelRewards, r => r.DefId == frame.Id);
        Assert.Equal(15, reward.Level);
    }

    [Fact]
    public async Task AnItemWithOpenMarketOrdersCannotStopBeingTradable()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var seller = await env.AddUserAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());
        await env.Market.AdminGrantAsync(seller.Id, frame.Id, 0);
        var copy = await env.Store.Items.Find(i => i.OwnerId == seller.Id && i.DefId == frame.Id).SingleAsync();
        await env.Market.CreateListingAsync(seller, copy.Id, 500);

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5)));

        Assert.Equal(AdminCosmeticCodes.OpenOrders, ((ApiErrorDetails)error.Errors!).Code);
        Assert.Empty(env.Provider.Current.LevelRewards.Where(r => r.DefId == frame.Id));
    }

    [Fact]
    public async Task EarnedCopiesStopAnItemFromBecomingTradable()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        await env.SetLevelAsync(player.Id, 6);
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());
        await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));
        await env.Progress.GetMeAsync(player.Id);
        var loose = await env.Admin.SetAcquisitionAsync(Admin, frame.Id, new AdminCosmeticAcquisitionRequest("admin", null, null, null, "Đổi cách nhận"));

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.UpdateAsync(Admin, frame.Id, Update(loose, tradable: true)));

        Assert.Equal(AdminCosmeticCodes.EarnedCopiesExist, ((ApiErrorDetails)error.Errors!).Code);
    }

    // ------------------------------------------------------------------ what a failure half way leaves

    [Fact]
    public async Task ARewardNeverReachesPlayersWhileItsItemCanStillBeTraded()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        await env.SetLevelAsync(player.Id, 6);
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame(tradable: true));
        await env.RefuseWritesAsync("catalogItems");

        await Assert.ThrowsAnyAsync<Exception>(() => env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5)));
        await env.AllowWritesAsync("catalogItems");
        await env.Provider.RefreshAsync();

        // Had the reward been written first, this player could burn the copy for XP and get it back, again and again.
        Assert.DoesNotContain(env.Provider.Current.LevelRewards, reward => reward.DefId == frame.Id);
        Assert.DoesNotContain((await env.Progress.GetMeAsync(player.Id)).Owned, item => item.DefId == frame.Id);

        var saved = await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));
        Assert.False(saved.Tradable);
        Assert.Equal(5, saved.Acquisition.Level);
    }

    [Fact]
    public async Task AFailureHalfWayStillTellsTheCatalogWhatWasSaved()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame(tradable: true));
        await env.RefuseWritesAsync("levelRewards");

        await Assert.ThrowsAnyAsync<Exception>(() => env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5)));

        Assert.False(env.Provider.Current.Find(frame.Id)!.Tradable);
        await env.AllowWritesAsync("levelRewards");
        Assert.Equal(5, (await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5))).Acquisition.Level);
    }

    [Fact]
    public async Task ChangingHowAnItemIsObtainedNeedsAReasonAndRecordsTheTradableFlip()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame(tradable: true));

        var noReason = await Assert.ThrowsAsync<ApiException>(() =>
            env.Admin.SetAcquisitionAsync(Admin, frame.Id, new AdminCosmeticAcquisitionRequest("level", 5, null, null, "  ")));
        Assert.Equal(AdminCosmeticCodes.ReasonRequired, ((ApiErrorDetails)noReason.Errors!).Code);
        Assert.True((await env.Admin.GetAsync(frame.Id)).Tradable);

        await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));

        var entry = (await env.Audit.QueryAsync(new AdminAuditQuery(Action: "item.acquisition"))).Items.Single();
        Assert.True(entry.Before!.Value.GetProperty("tradable").GetBoolean());
        Assert.False(entry.After!.Value.GetProperty("tradable").GetBoolean());
        Assert.Equal("Thưởng mới", entry.Reason);
    }

    [Fact]
    public async Task ChangingWhetherAnItemTradesNeedsAReason()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame(tradable: true));
        var request = Update(frame, tradable: false) with { Reason = null };

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.UpdateAsync(Admin, frame.Id, request));

        Assert.Equal(AdminCosmeticCodes.ReasonRequired, ((ApiErrorDetails)error.Errors!).Code);
        Assert.False((await env.Admin.UpdateAsync(Admin, frame.Id, Update(frame, tradable: false))).Tradable);
    }

    // ------------------------------------------------------------------ achievements

    [Fact]
    public async Task ANewAchievementIsGrantedWhenItsCountIsReached()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        await env.AddGameResultAsync(player.Id, success: true);
        await env.AddGameResultAsync(player.Id, success: true);
        var title = await env.Admin.CreateAsync(Admin, StyledTitle());

        var saved = await env.Admin.SetAcquisitionAsync(Admin, title.Id, new AdminCosmeticAcquisitionRequest("achievement", null, "Won", 3, "Thành tích mới"));

        Assert.Equal("achievement", saved.Acquisition.Mode);
        Assert.Equal("Won", saved.Acquisition.Metric);
        Assert.False(saved.Tradable);
        var progress = (await env.Progress.GetMeAsync(player.Id)).Achievements.Single(a => a.TitleDefId == title.Id);
        Assert.Equal(2, progress.Count);
        Assert.False(progress.Earned);

        await env.AddGameResultAsync(player.Id, success: true);
        var me = await env.Progress.GetMeAsync(player.Id);
        Assert.True(me.Achievements.Single(a => a.TitleDefId == title.Id).Earned);
        var copy = Assert.Single(me.Owned, item => item.DefId == title.Id);
        Assert.Equal(MarketItemSources.Achievement, copy.Source);
        await env.Progress.GetMeAsync(player.Id);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.OwnerId == player.Id && i.DefId == title.Id));
    }

    [Fact]
    public async Task AnAchievementTheGameCannotCountIsRefused()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var title = await env.Admin.CreateAsync(Admin, StyledTitle());

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            env.Admin.SetAcquisitionAsync(Admin, title.Id, new AdminCosmeticAcquisitionRequest("achievement", null, "Nothing", 3, "Đổi cách nhận")));

        Assert.Equal(AdminCosmeticCodes.MetricUnknown, ((ApiErrorDetails)error.Errors!).Code);
    }

    [Fact]
    public async Task SwitchingToAnotherWayRemovesTheOldOne()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var title = await env.Admin.CreateAsync(Admin, StyledTitle());

        await env.Admin.SetAcquisitionAsync(Admin, title.Id, Level(5));
        await env.Admin.SetAcquisitionAsync(Admin, title.Id, new AdminCosmeticAcquisitionRequest("achievement", null, "Played", 2, "Đổi cách nhận"));
        Assert.DoesNotContain(env.Provider.Current.LevelRewards, r => r.DefId == title.Id);
        Assert.Contains(env.Provider.Current.Achievements, a => a.TitleDefId == title.Id);

        var free = await env.Admin.SetAcquisitionAsync(Admin, title.Id, new AdminCosmeticAcquisitionRequest("admin", null, null, null, "Đổi cách nhận"));
        Assert.Equal("admin", free.Acquisition.Mode);
        Assert.DoesNotContain(env.Provider.Current.Achievements, a => a.TitleDefId == title.Id);
    }

    // ------------------------------------------------------------------ defaults

    [Fact]
    public async Task EachGroupHasAtMostOneDefault()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        var first = await env.Admin.CreateAsync(Admin, StyledTitle("Danh Một"));
        var second = await env.Admin.CreateAsync(Admin, StyledTitle("Danh Hai"));

        await env.Admin.SetAcquisitionAsync(Admin, first.Id, new AdminCosmeticAcquisitionRequest("default", null, null, null, "Đổi cách nhận"));
        Assert.Equal(first.Id, (await env.Progress.GetMeAsync(player.Id)).TitleDefId);
        await env.Admin.SetAcquisitionAsync(Admin, second.Id, new AdminCosmeticAcquisitionRequest("default", null, null, null, "Đổi cách nhận"));

        var page = await env.Admin.ListAsync();
        Assert.Equal(second.Id, Assert.Single(page.Items, item => item.Category == MarketCategories.Title && item.Acquisition.Mode == "default").Id);
        Assert.Equal(second.Id, page.Defaults.Title);
        Assert.Equal(second.Id, (await env.Progress.GetMeAsync(player.Id)).TitleDefId);
        Assert.Equal(second.Id, (await env.Progress.GetCosmeticsAsync(new[] { player.Id }))[player.Id].TitleDefId);
        Assert.Equal(CosmeticCatalog.DefaultEntranceDefId, page.Defaults.Entrance);
    }

    [Fact]
    public async Task ADefaultFrameIsWornByWhoeverWearsNone()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        Assert.Null((await env.Progress.GetMeAsync(player.Id)).FrameDefId);
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());

        var saved = await env.Admin.SetAcquisitionAsync(Admin, frame.Id, new AdminCosmeticAcquisitionRequest("default", null, null, null, "Đổi cách nhận"));

        Assert.False(saved.Tradable);
        Assert.Equal(frame.Id, (await env.Progress.GetMeAsync(player.Id)).FrameDefId);
        await env.Admin.SetAcquisitionAsync(Admin, frame.Id, new AdminCosmeticAcquisitionRequest("admin", null, null, null, "Đổi cách nhận"));
        Assert.Null((await env.Progress.GetMeAsync(player.Id)).FrameDefId);
    }

    [Fact]
    public async Task TheGroupsThatMustHaveADefaultKeepOne()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            env.Admin.SetAcquisitionAsync(Admin, CosmeticCatalog.DefaultTitleDefId, new AdminCosmeticAcquisitionRequest("admin", null, null, null, "Đổi cách nhận")));

        Assert.Equal(AdminCosmeticCodes.DefaultRequired, ((ApiErrorDetails)error.Errors!).Code);

        var other = await env.Admin.CreateAsync(Admin, StyledTitle());
        await env.Admin.SetAcquisitionAsync(Admin, other.Id, new AdminCosmeticAcquisitionRequest("default", null, null, null, "Đổi cách nhận"));
        await env.Admin.SetAcquisitionAsync(Admin, other.Id, new AdminCosmeticAcquisitionRequest("admin", null, null, null, "Đổi cách nhận"));
        Assert.Equal(CosmeticCatalog.DefaultTitleDefId, (await env.Admin.ListAsync()).Defaults.Title);
    }

    [Fact]
    public async Task ADefaultCannotBeRetiredOrDeleted()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var title = await env.Admin.CreateAsync(Admin, StyledTitle());
        await env.Admin.SetAcquisitionAsync(Admin, title.Id, new AdminCosmeticAcquisitionRequest("default", null, null, null, "Đổi cách nhận"));

        var retire = await Assert.ThrowsAsync<ApiException>(() => env.Admin.SetRetiredAsync(Admin, title.Id, new AdminCosmeticRetireRequest(true, "Dọn")));
        var delete = await Assert.ThrowsAsync<ApiException>(() => env.Admin.DeleteAsync(Admin, title.Id, "Dọn"));

        Assert.Equal(AdminCosmeticCodes.DefaultCannotRetire, ((ApiErrorDetails)retire.Errors!).Code);
        Assert.Equal(AdminCosmeticCodes.DefaultCannotRetire, ((ApiErrorDetails)delete.Errors!).Code);
    }

    [Fact]
    public async Task TheDefaultsInCodeCanBeTheFallbackAtAnyMomentSoTheyStayFit()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var other = await env.Admin.CreateAsync(Admin, StyledTitle());
        await env.Admin.SetAcquisitionAsync(Admin, other.Id, new AdminCosmeticAcquisitionRequest("default", null, null, null, "Đổi cách nhận"));
        var inCode = await env.Admin.GetAsync(CosmeticCatalog.DefaultTitleDefId);

        var retire = await Assert.ThrowsAsync<ApiException>(() => env.Admin.SetRetiredAsync(Admin, inCode.Id, new AdminCosmeticRetireRequest(true, "Dọn")));
        var trade = await Assert.ThrowsAsync<ApiException>(() => env.Admin.UpdateAsync(Admin, inCode.Id, Update(inCode, tradable: true)));

        Assert.Equal(AdminCosmeticCodes.DefaultCannotRetire, ((ApiErrorDetails)retire.Errors!).Code);
        Assert.Equal(AdminCosmeticCodes.EarnedNotTradable, ((ApiErrorDetails)trade.Errors!).Code);
    }

    // ------------------------------------------------------------------ retire

    [Fact]
    public async Task BringingAnItemBackMustNotBreakAChest()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var chest = await env.Catalog.Chests.Find(c => c.Id == "chest_np").SingleAsync();
        var items = await env.Catalog.Items.Find(i => chest.Pool.Contains(i.Id) && i.Rarity == MarketRarities.Legendary).ToListAsync();
        var valuable = items.First(item => CosmeticCatalog.IsCosmetic(item.Category));
        // Retired long ago, at a price this chest could not afford to pay out.
        await env.Catalog.Items.UpdateOneAsync(i => i.Id == valuable.Id, Builders<CatalogItem>.Update.Set(i => i.Retired, true).Set(i => i.ReferencePrice, 1_000_000));
        env.Provider.Invalidate();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.SetRetiredAsync(Admin, valuable.Id, new AdminCosmeticRetireRequest(false, "Mở lại")));

        Assert.Equal(CatalogRuleCodes.ExpectedValueTooHigh, ((ApiErrorDetails)error.Errors!).Code);
        Assert.True((await env.Admin.GetAsync(valuable.Id)).Retired);
    }

    [Fact]
    public async Task RetiringLeavesWhatIsWornOnThePlayer()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());
        await env.Market.AdminGrantAsync(player.Id, frame.Id, 0);
        var copy = await env.Store.Items.Find(i => i.OwnerId == player.Id && i.DefId == frame.Id).SingleAsync();
        await env.Market.EquipAsync(player.Id, copy.Id);

        var saved = await env.Admin.SetRetiredAsync(Admin, frame.Id, new AdminCosmeticRetireRequest(true, "Hết mùa"));

        Assert.True(saved.Retired);
        Assert.Equal(frame.Id, (await env.Progress.GetMeAsync(player.Id)).FrameDefId);
        Assert.Equal(frame.Id, (await env.Progress.GetCosmeticsAsync(new[] { player.Id }))[player.Id].FrameDefId);
        Assert.DoesNotContain(env.Market.GetCatalog(), def => def.Id == frame.Id);
        // Whoever wears it in a lobby still needs its drawing.
        Assert.Contains((await env.Admin.PublicCatalogAsync()).Items, item => item.Id == frame.Id && item.Retired);
    }

    [Fact]
    public async Task ARetiredRewardIsNoLongerHandedOutAndComesBackWithItsPlace()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        await env.SetLevelAsync(player.Id, 6);
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());
        await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));
        await env.Admin.SetRetiredAsync(Admin, frame.Id, new AdminCosmeticRetireRequest(true, "Tạm dừng"));

        Assert.DoesNotContain((await env.Progress.GetMeAsync(player.Id)).Owned, item => item.DefId == frame.Id);

        await env.Admin.SetRetiredAsync(Admin, frame.Id, new AdminCosmeticRetireRequest(false, "Mở lại"));
        Assert.Contains((await env.Progress.GetMeAsync(player.Id)).Owned, item => item.DefId == frame.Id);
    }

    [Fact]
    public async Task RetiringTheLastItemOfARarityInAChestIsRefused()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var chest = await env.Catalog.Chests.Find(c => c.Id == "chest_np").SingleAsync();
        var mystery = await env.Catalog.Items.Find(i => chest.Pool.Contains(i.Id) && i.Rarity == MarketRarities.Mystery).ToListAsync();
        Assert.NotEmpty(mystery);
        var keep = mystery.First(item => CosmeticCatalog.IsCosmetic(item.Category)).Id;
        // Leave a single mystery item in this chest, then try to retire it.
        await env.Catalog.Chests.UpdateOneAsync(c => c.Id == chest.Id,
            Builders<CatalogChest>.Update.Set(c => c.Pool, chest.Pool.Where(id => id == keep || mystery.All(m => m.Id != id)).ToList()));
        env.Provider.Invalidate();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.SetRetiredAsync(Admin, keep, new AdminCosmeticRetireRequest(true, "Dọn")));

        Assert.Equal(CatalogRuleCodes.RarityEmpty, ((ApiErrorDetails)error.Errors!).Code);
        Assert.Contains(chest.Name, error.Message);
        Assert.False((await env.Admin.GetAsync(keep)).Retired);
    }

    [Fact]
    public async Task RetiringNeedsAReason()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.SetRetiredAsync(Admin, frame.Id, new AdminCosmeticRetireRequest(true, "  ")));

        Assert.Equal(AdminCosmeticCodes.ReasonRequired, ((ApiErrorDetails)error.Errors!).Code);
    }

    // ------------------------------------------------------------------ delete

    [Fact]
    public async Task OnlyAnUnownedItemMadeHereCanBeDeleted()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        var kept = await env.Admin.CreateAsync(Admin, PaintedFrame("Giữ Lại"));
        var unwanted = await env.Admin.CreateAsync(Admin, PaintedFrame("Bỏ Đi"));
        await env.Market.AdminGrantAsync(player.Id, kept.Id, 0);

        var owned = await Assert.ThrowsAsync<ApiException>(() => env.Admin.DeleteAsync(Admin, kept.Id, "Dọn"));
        var shipped = await Assert.ThrowsAsync<ApiException>(() => env.Admin.DeleteAsync(Admin, "frame_dong", "Dọn"));
        Assert.Equal(CatalogRuleCodes.DefinitionOwned, ((ApiErrorDetails)owned.Errors!).Code);
        Assert.Equal(AdminCosmeticCodes.BuiltinCannotBeDeleted, ((ApiErrorDetails)shipped.Errors!).Code);

        await env.Admin.DeleteAsync(Admin, unwanted.Id, "Tạo nhầm");

        Assert.Null(env.Provider.Current.Find(unwanted.Id));
        Assert.Equal(1, await env.AuditCountAsync("item.delete"));
    }

    [Fact]
    public async Task OpenBuyOrdersKeepAnItemFromBeingDeleted()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var buyer = await env.AddUserAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());
        await env.Market.AdminGrantAsync(buyer.Id, null, 1000);
        await env.Market.PlaceOrderAsync(buyer, frame.Id, 500);

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.DeleteAsync(Admin, frame.Id, "Dọn"));

        Assert.Equal(AdminCosmeticCodes.OpenOrders, ((ApiErrorDetails)error.Errors!).Code);
        Assert.NotNull(env.Provider.Current.Find(frame.Id));
    }

    [Fact]
    public async Task ARewardMustBeFreedBeforeDeleting()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());
        await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.DeleteAsync(Admin, frame.Id, "Dọn"));

        Assert.Equal(CatalogRuleCodes.DefinitionInUse, ((ApiErrorDetails)error.Errors!).Code);
    }

    // ------------------------------------------------------------------ grant

    [Fact]
    public async Task GrantingGivesOneCopyAndIsRecorded()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync("Thám tử Nhận Quà");
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());

        var found = await env.Admin.SearchPlayersAsync("nhận quà");
        Assert.Equal(player.Id, Assert.Single(found).Id);

        var result = await env.Admin.GrantAsync(Admin, frame.Id, new AdminCosmeticGrantRequest(player.Id, "Quà sự kiện"));

        Assert.Equal(frame.Id, result.DefId);
        var copy = Assert.Single((await env.Progress.GetMeAsync(player.Id)).Owned, item => item.DefId == frame.Id);
        Assert.Equal(MarketItemSources.Grant, copy.Source);
        var again = await Assert.ThrowsAsync<ApiException>(() => env.Admin.GrantAsync(Admin, frame.Id, new AdminCosmeticGrantRequest(player.Id, "Lần nữa")));
        Assert.Equal(AdminCosmeticCodes.AlreadyOwned, ((ApiErrorDetails)again.Errors!).Code);

        var audit = (await env.Audit.QueryAsync(new AdminAuditQuery(Action: "player.grant"))).Items.Single();
        Assert.Equal(player.Id, audit.TargetId);
        Assert.Equal("Quà sự kiện", audit.Reason);
        Assert.Equal(frame.Id, audit.After!.Value.GetProperty("defId").GetString());
    }

    [Fact]
    public async Task GrantingWhatCanNeverLeaveTheBagTakesNoSlot()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame(tradable: false));
        var before = await env.Market.GetWalletAsync(player.Id);

        var result = await env.Admin.GrantAsync(Admin, frame.Id, new AdminCosmeticGrantRequest(player.Id, "Quà sự kiện"));

        Assert.Equal(before.SlotsUsed, result.SlotsUsed);
        Assert.Equal(before.SlotsUsed, (await env.Market.GetWalletAsync(player.Id)).SlotsUsed);
        Assert.Contains((await env.Progress.GetMeAsync(player.Id)).Owned, item => item.DefId == frame.Id);
        var again = await Assert.ThrowsAsync<ApiException>(() => env.Admin.GrantAsync(Admin, frame.Id, new AdminCosmeticGrantRequest(player.Id, "Lần nữa")));
        Assert.Equal(AdminCosmeticCodes.AlreadyOwned, ((ApiErrorDetails)again.Errors!).Code);
        var nobody = await Assert.ThrowsAsync<ApiException>(() => env.Admin.GrantAsync(Admin, frame.Id, new AdminCosmeticGrantRequest(ObjectId.GenerateNewId().ToString(), "Quà")));
        Assert.Equal(404, nobody.StatusCode);
    }

    [Fact]
    public async Task SearchTreatsItsTextAsText()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        await env.AddUserAsync("Ai đó");

        Assert.Empty(await env.Admin.SearchPlayersAsync(".*"));
        Assert.Empty(await env.Admin.SearchPlayersAsync("   "));
    }

    [Fact]
    public async Task GrantingNeedsAnExistingPlayerAndAReason()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame());
        var player = await env.AddUserAsync();

        var noReason = await Assert.ThrowsAsync<ApiException>(() => env.Admin.GrantAsync(Admin, frame.Id, new AdminCosmeticGrantRequest(player.Id, "")));
        var noPlayer = await Assert.ThrowsAsync<ApiException>(() => env.Admin.GrantAsync(Admin, frame.Id, new AdminCosmeticGrantRequest(ObjectId.GenerateNewId().ToString(), "Quà")));

        Assert.Equal(AdminCosmeticCodes.ReasonRequired, ((ApiErrorDetails)noReason.Errors!).Code);
        Assert.Equal(404, noPlayer.StatusCode);
        Assert.Equal(0, await env.AuditCountAsync("player.grant"));
    }

    // ------------------------------------------------------------------ XP rates

    [Fact]
    public async Task NewXpRatesPayOnTheNextExchange()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        await env.Market.AdminGrantAsync(player.Id, Rare, 0);
        await env.Market.AdminGrantAsync(player.Id, Epic, 0);

        var saved = await env.Admin.SetXpAsync(Admin, new AdminXpSettingsRequest(70, 900, "Cân bằng lại"));

        Assert.Equal(70, saved.RareXp);
        var me = await env.Progress.GetMeAsync(player.Id);
        Assert.Equal(70, me.Exchangeable.Single(item => item.Def.Id == Rare).Xp);
        Assert.Equal(900, me.Exchangeable.Single(item => item.Def.Id == Epic).Xp);

        var result = await env.Progress.ExchangeAsync(player, new[] { me.Exchangeable.Single(item => item.Def.Id == Rare).ItemId }, Guid.NewGuid().ToString());
        Assert.Equal(70, result.XpGained);

        var catalog = await env.Admin.PublicCatalogAsync();
        Assert.Equal(70, catalog.RareXp);
        Assert.Equal(900, catalog.EpicXp);

        var audit = (await env.Audit.QueryAsync(new AdminAuditQuery(TargetType: "gameSettings"))).Items.Single();
        Assert.Equal(150, audit.Before!.Value.GetProperty("rareXp").GetInt64());
        Assert.Equal(70, audit.After!.Value.GetProperty("rareXp").GetInt64());
        Assert.Equal("Cân bằng lại", audit.Reason);
    }

    [Fact]
    public async Task XpRatesAreChecked()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Admin.SetXpAsync(Admin, new AdminXpSettingsRequest(0, 600, "Thử")));
        var noReason = await Assert.ThrowsAsync<ApiException>(() => env.Admin.SetXpAsync(Admin, new AdminXpSettingsRequest(100, 600, null)));

        Assert.Equal(AdminCosmeticCodes.XpInvalid, ((ApiErrorDetails)error.Errors!).Code);
        Assert.Equal(AdminCosmeticCodes.ReasonRequired, ((ApiErrorDetails)noReason.Errors!).Code);
        Assert.Equal(150, env.Provider.Current.RareXp);
    }

    // ------------------------------------------------------------------ audit and the page

    [Fact]
    public async Task EveryWriteIsRecordedWithBeforeAndAfter()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();

        var frame = await env.Admin.CreateAsync(Admin, PaintedFrame() with { Reason = "Tạo mới" });
        await env.Admin.UpdateAsync(Admin, frame.Id, Update(frame, name: "Tên Khác"));
        await env.Admin.SetAcquisitionAsync(Admin, frame.Id, Level(5));
        await env.Admin.SetRetiredAsync(Admin, frame.Id, new AdminCosmeticRetireRequest(true, "Hết mùa"));
        await env.Admin.SetRetiredAsync(Admin, frame.Id, new AdminCosmeticRetireRequest(false, "Mở lại"));

        var page = await env.Audit.QueryAsync(new AdminAuditQuery(TargetType: "catalogItem", TargetId: frame.Id));
        Assert.Equal(
            new[] { "item.unretire", "item.retire", "item.acquisition", "item.update", "item.create" },
            page.Items.Select(entry => entry.Action));
        Assert.All(page.Items, entry => Assert.Equal(Admin.Id, entry.AdminId));

        var update = page.Items.Single(entry => entry.Action == "item.update");
        Assert.Equal("Hắc Long", update.Before!.Value.GetProperty("name").GetString());
        Assert.Equal("Tên Khác", update.After!.Value.GetProperty("name").GetString());
        Assert.Equal("Tạo mới", page.Items.Single(entry => entry.Action == "item.create").Reason);
        var acquisition = page.Items.Single(entry => entry.Action == "item.acquisition");
        Assert.Equal("admin", acquisition.Before!.Value.GetProperty("mode").GetString());
        Assert.Equal("level", acquisition.After!.Value.GetProperty("mode").GetString());
    }

    [Fact]
    public async Task ThePageListsEveryCosmeticWithItsOwnersAndHowItIsObtained()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var player = await env.AddUserAsync();
        await env.Market.AdminGrantAsync(player.Id, "frame_kimlong", 0);
        await env.Market.AdminGrantAsync(player.Id, "frame_kimlong", 0);

        var page = await env.Admin.ListAsync();

        Assert.Equal(CosmeticCatalog.ItemDefs.Count, page.Items.Count);
        Assert.All(page.Items, item => Assert.True(CosmeticCatalog.IsCosmetic(item.Category)));
        // Owners, not copies.
        Assert.Equal(1, page.Items.Single(item => item.Id == "frame_kimlong").Owners);
        var dong = page.Items.Single(item => item.Id == "frame_dong");
        Assert.Equal("level", dong.Acquisition.Mode);
        Assert.Equal(10, dong.Acquisition.Level);
        var kimLong = page.Items.Single(item => item.Id == "frame_kimlong");
        Assert.Equal("chest_nb", Assert.Single(kimLong.Acquisition.Chests).Id);
        Assert.Equal("default", page.Items.Single(item => item.Id == CosmeticCatalog.DefaultTitleDefId).Acquisition.Mode);
        var khachQuen = page.Items.Single(item => item.Id == "title_khach-quen");
        Assert.Equal("achievement", khachQuen.Acquisition.Mode);
        Assert.Equal(AchievementMetrics.Played, khachQuen.Acquisition.Metric);
        Assert.Equal(AchievementMetrics.All, page.Metrics);
        Assert.Equal(ProgressRules.MaxLevel, page.MaxLevel);
    }

    [Fact]
    public async Task UnknownIdsAndOtherCategoriesAreNotFound()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();

        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => env.Admin.GetAsync("frame_nothing"))).StatusCode);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => env.Admin.GetAsync(Rare))).StatusCode);
    }

    [Fact]
    public async Task AMalformedDocumentCostsOnlyThatDocument()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        await env.Raw("catalogItems").InsertOneAsync(new BsonDocument { ["_id"] = "frame_hong", ["category"] = "FRAME", ["rarity"] = "RARE", ["referencePrice"] = "nhiều" });

        var page = await env.Admin.ListAsync();

        Assert.DoesNotContain(page.Items, item => item.Id == "frame_hong");
        Assert.Contains(page.Problems, problem => problem.Contains("frame_hong"));
    }

    [Fact]
    public async Task TheDefaultsSurviveAFreshStore()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var title = await env.Admin.CreateAsync(Admin, StyledTitle());
        await env.Admin.SetAcquisitionAsync(Admin, title.Id, new AdminCosmeticAcquisitionRequest("default", null, null, null, "Đổi cách nhận"));

        var fresh = new CosmeticDefaultsStore(env.Catalog, NullLogger<CosmeticDefaultsStore>.Instance);

        Assert.Equal(title.Id, (await fresh.GetAsync()).Title);
        var stored = await env.Raw("gameSettings").Find(new BsonDocument("_id", CosmeticDefaultsDocument.DocumentId)).SingleAsync();
        Assert.Equal(title.Id, stored["title"].AsString);
        // The other settings read their own document, so a new one beside them changes nothing for them.
        Assert.Equal(150, env.Provider.Current.RareXp);
    }

    // ------------------------------------------------------------------ environment

    private sealed class Env : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private Env(MongoDbSettings settings)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db);
            Catalog = new CatalogStore(Db);
            Seeder = new CatalogSeeder(Catalog, Options.Create(new ChestSettings()), NullLogger<CatalogSeeder>.Instance);
            Provider = new CatalogProvider(Catalog, Options.Create(new ChestSettings()), NullLogger<CatalogProvider>.Instance);
            Audit = new AdminAuditService(Catalog);
            Defaults = new CosmeticDefaultsStore(Catalog, NullLogger<CosmeticDefaultsStore>.Instance);
            Market = new MarketService(Store, NullLogger<MarketService>.Instance, Provider);
            Progress = new ProgressService(Store, Market, NullLogger<ProgressService>.Instance, null, Provider, Defaults);
            Admin = new AdminCosmeticsService(Catalog, Store, Market, Provider, Defaults, Audit);
        }

        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public CatalogStore Catalog { get; }
        public CatalogSeeder Seeder { get; }
        public CatalogProvider Provider { get; }
        public AdminAuditService Audit { get; }
        public CosmeticDefaultsStore Defaults { get; }
        public MarketService Market { get; }
        public ProgressService Progress { get; }
        public AdminCosmeticsService Admin { get; }

        public IMongoCollection<BsonDocument> Raw(string name) => Db.Database.GetCollection<BsonDocument>(name);

        public static async Task<Env> CreateAsync()
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_cosmetics_{Guid.NewGuid():N}"
            };
            TestMongoSafetyGuard.EnsureSafe(settings);
            var env = new Env(settings);
            await env.Db.PingAsync();
            await env.Store.EnsureIndexesAsync();
            await env.Seeder.SeedAsync();
            await env.Provider.RefreshAsync();
            return env;
        }

        public async Task<CurrentUser> AddUserAsync(string name = "Thám tử")
        {
            var user = new User
            {
                Id = ObjectId.GenerateNewId().ToString(),
                FullName = name,
                Email = $"{Guid.NewGuid():N}@tests.invalid",
                Status = UserStatus.Active,
                IsEmailVerified = true
            };
            await Db.Users.InsertOneAsync(user);
            await Market.EnsureAccountAsync(user.Id);
            return new CurrentUser(user.Id, name, UserRole.Player);
        }

        public Task SetLevelAsync(string userId, int level, int xp = 0) =>
            Store.PlayerProgress.UpdateOneAsync(p => p.Id == userId,
                Builders<PlayerProgress>.Update
                    .Set(p => p.Level, level)
                    .Set(p => p.Xp, xp)
                    .SetOnInsert(p => p.Avatar, CosmeticCatalog.DefaultAvatar)
                    .SetOnInsert(p => p.CreatedAt, DateTime.UtcNow)
                    .Set(p => p.UpdatedAt, DateTime.UtcNow),
                new UpdateOptions { IsUpsert = true });

        public Task AddGameResultAsync(string userId, bool success) =>
            Db.GameResults.InsertOneAsync(new GameResult
            {
                Id = ObjectId.GenerateNewId().ToString(),
                RoomId = ObjectId.GenerateNewId().ToString(),
                CaseId = "case",
                Players = new List<string> { userId },
                Success = success,
                CreatedAt = new DateTime(2026, 11, 3, 5, 0, 0, DateTimeKind.Utc)
            });

        /// <summary>Makes every write to a collection fail, as a dropped connection or a full disk would.</summary>
        public Task RefuseWritesAsync(string collection) => Db.Database.RunCommandAsync<BsonDocument>(new BsonDocument
        {
            ["collMod"] = collection,
            ["validator"] = new BsonDocument("fieldThatNeverExists", 1),
            ["validationLevel"] = "strict",
            ["validationAction"] = "error",
        });

        public Task AllowWritesAsync(string collection) => Db.Database.RunCommandAsync<BsonDocument>(new BsonDocument
        {
            ["collMod"] = collection,
            ["validator"] = new BsonDocument(),
            ["validationLevel"] = "off",
        });

        public Task<long> AuditCountAsync(string action) => Catalog.Audit.CountDocumentsAsync(entry => entry.Action == action);

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
