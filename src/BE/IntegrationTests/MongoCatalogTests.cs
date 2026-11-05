using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
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
/// The catalog in a real (standalone) MongoDB: the seed, the provider, and the player flows reading through them.
/// Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoCatalogTests
{
    private const string Seal = "chest_np";
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static string NewKey() => Guid.NewGuid().ToString();

    // ------------------------------------------------------------------ seed

    [Fact]
    public async Task SeedingAnEmptyDatabaseCreatesEverything()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();

        var report = await env.Seeder.SeedAsync();

        Assert.Equal(0, report.FromVersion);
        Assert.Equal(CatalogSeedData.CurrentVersion, report.ToVersion);
        Assert.Equal(MarketCatalog.All.Count, await env.Catalog.Items.CountDocumentsAsync(FilterDefinition<CatalogItem>.Empty));
        Assert.Equal(3, await env.Catalog.Chests.CountDocumentsAsync(FilterDefinition<CatalogChest>.Empty));
        Assert.Equal(CosmeticCatalog.LevelRewards.Count, await env.Catalog.LevelRewards.CountDocumentsAsync(FilterDefinition<CatalogLevelReward>.Empty));
        Assert.Equal(AchievementRules.Catalog.Count, await env.Catalog.Achievements.CountDocumentsAsync(FilterDefinition<CatalogAchievement>.Empty));

        var progress = await env.Raw("gameSettings").Find(new BsonDocument("_id", "progress")).SingleAsync();
        Assert.Equal(150, progress["rareXp"].ToInt64());
        Assert.Equal(600, progress["epicXp"].ToInt64());
        var seedState = await env.Raw("gameSettings").Find(new BsonDocument("_id", "catalogSeed")).SingleAsync();
        Assert.Equal(CatalogSeedData.CurrentVersion, seedState["seedVersion"].ToInt32());
    }

    [Fact]
    public async Task DocumentsHaveTheAgreedShape()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.Seeder.SeedAsync();

        var frame = await env.Raw("catalogItems").Find(new BsonDocument("_id", "frame_kimlong")).SingleAsync();
        Assert.Equal("FRAME", frame["category"].AsString);
        Assert.Equal("kimlong", frame["visual"]["builtinId"].AsString);
        Assert.Equal(BsonNull.Value, frame["visual"]["template"]);
        Assert.Equal(BsonNull.Value, frame["visual"]["imageUrl"]);
        Assert.Equal(new BsonDocument(), frame["visual"]["params"]);
        Assert.False(frame["retired"].AsBoolean);
        Assert.Equal(1, frame["version"].ToInt32());

        var chest = await env.Raw("chests").Find(new BsonDocument("_id", Seal)).SingleAsync();
        Assert.Equal("key_np", chest["keyDefId"].AsString);
        Assert.Equal("seal", chest["look"]["template"].AsString);
        Assert.Equal(120, chest["prices"]["chest"].ToInt64());
        Assert.Equal(180, chest["prices"]["key"].ToInt64());
        Assert.Equal(7992, chest["dropWeights"]["COMMON"].ToInt32());
        Assert.Contains("VC-0217", chest["pool"].AsBsonArray.Select(id => id.AsString));
        Assert.Contains("frame_thach", chest["pool"].AsBsonArray.Select(id => id.AsString));
        Assert.True(chest["active"].AsBoolean);

        var reward = await env.Raw("levelRewards").Find(new BsonDocument("level", 10)).SingleAsync();
        Assert.Equal("frame_dong", reward["defId"].AsString);

        var achievement = await env.Raw("achievements").Find(new BsonDocument("_id", "title_huyet-kiem")).SingleAsync();
        Assert.Equal("Won", achievement["metric"].AsString);
        Assert.Equal(50, achievement["target"].ToInt32());
    }

    [Fact]
    public async Task SeedingTwiceChangesNothing()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.Seeder.SeedAsync();
        var before = await env.DumpAsync();

        var second = await env.Seeder.SeedAsync();

        Assert.Equal(0, second.Inserted);
        Assert.Equal(before, await env.DumpAsync());
    }

    [Fact]
    public async Task ReseedingNeverOverwritesWhatAnAdminEdited()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.Seeder.SeedAsync();
        await env.Catalog.Items.UpdateOneAsync(i => i.Id == "VC-0217",
            Builders<CatalogItem>.Update.Set(i => i.Name, "Đồng hồ đã sửa").Set(i => i.UpdatedBy, "yen").Inc(i => i.Version, 1));
        await env.Catalog.Chests.UpdateOneAsync(c => c.Id == Seal,
            Builders<CatalogChest>.Update.Set(c => c.Prices.Key, 777L));
        await env.Catalog.ProgressSettings.UpdateOneAsync(new BsonDocument("_id", "progress"),
            Builders<ProgressSettingsDocument>.Update.Set(p => p.RareXp, 999L));
        var edited = await env.DumpAsync();

        // Pretend a newer build ships a new seed batch: the batch runs again, and only fills gaps.
        await env.ForgetSeedAsync();
        var report = await env.Seeder.SeedAsync();

        Assert.Equal(0, report.Inserted);
        var after = await env.DumpAsync();
        Assert.Equal(edited, after);
        Assert.Equal("Đồng hồ đã sửa", (await env.Catalog.Items.Find(i => i.Id == "VC-0217").SingleAsync()).Name);
    }

    [Fact]
    public async Task ANewSeedVersionFillsOnlyWhatIsMissing()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.Seeder.SeedAsync();
        await env.Catalog.Items.DeleteOneAsync(i => i.Id == "VC-0388");
        await env.ForgetSeedAsync();

        var report = await env.Seeder.SeedAsync();

        Assert.Equal(1, report.Inserted);
        Assert.NotNull(await env.Catalog.Items.Find(i => i.Id == "VC-0388").FirstOrDefaultAsync());
    }

    [Fact]
    public async Task WhatAnAdminDeletedStaysDeletedAtTheNextStart()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.Seeder.SeedAsync();
        await env.Catalog.LevelRewards.DeleteOneAsync(r => r.Id == CatalogLevelReward.IdOf(10, "frame_dong"));

        var report = await env.Seeder.SeedAsync();

        Assert.Equal(0, report.Inserted);
        Assert.Equal(0, await env.Catalog.LevelRewards.CountDocumentsAsync(r => r.DefId == "frame_dong"));
    }

    [Fact]
    public async Task AnInterruptedSeedFinishesOnTheNextRun()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.Seeder.SeedAsync();
        await env.Catalog.Chests.DeleteManyAsync(FilterDefinition<CatalogChest>.Empty);
        await env.Catalog.Achievements.DeleteManyAsync(FilterDefinition<CatalogAchievement>.Empty);
        await env.ForgetSeedAsync();

        await env.Seeder.SeedAsync();

        Assert.Equal(3, await env.Catalog.Chests.CountDocumentsAsync(FilterDefinition<CatalogChest>.Empty));
        Assert.Equal(AchievementRules.Catalog.Count, await env.Catalog.Achievements.CountDocumentsAsync(FilterDefinition<CatalogAchievement>.Empty));
    }

    [Fact]
    public async Task SeedingFromTwoProcessesAtOnceDoesNotFailOrDuplicate()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();

        await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => env.NewSeeder().SeedAsync()));

        Assert.Equal(MarketCatalog.All.Count, await env.Catalog.Items.CountDocumentsAsync(FilterDefinition<CatalogItem>.Empty));
        Assert.Equal(3, await env.Catalog.Chests.CountDocumentsAsync(FilterDefinition<CatalogChest>.Empty));
    }

    [Fact]
    public async Task SeedPricesComeFromConfiguration()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        var settings = new ChestSettings();
        settings.Prices[Seal] = new ChestPrice { Chest = 5000, Key = 6000 };

        await new CatalogSeeder(env.Catalog, Options.Create(settings), NullLogger<CatalogSeeder>.Instance).SeedAsync();

        var chest = await env.Catalog.Chests.Find(c => c.Id == Seal).SingleAsync();
        Assert.Equal(5000, chest.Prices.Chest);
        Assert.Equal(6000, chest.Prices.Key);
    }

    [Fact]
    public async Task TheIndexesExist()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.Seeder.SeedAsync();

        Assert.Contains("ix_catalogItems_category_rarity", await env.IndexNamesAsync("catalogItems"));
        Assert.Contains("ux_chests_keyDefId", await env.IndexNamesAsync("chests"));
        Assert.Contains("ix_levelRewards_level", await env.IndexNamesAsync("levelRewards"));
        Assert.Contains("ix_adminAudit_target_at", await env.IndexNamesAsync("adminAudit"));
        Assert.Contains("ix_adminAudit_admin_at", await env.IndexNamesAsync("adminAudit"));
    }

    // ------------------------------------------------------------------ provider

    [Fact]
    public async Task TheStoredCatalogReadsBackAsTheSeed()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var seed = CatalogSeedData.ToSnapshot(new ChestSettings());
        var stored = env.Provider.Current;

        Assert.Equal(Describe(seed), Describe(stored));
    }

    private static string Describe(CatalogSnapshot snapshot) => JsonSerializer.Serialize(new
    {
        All = snapshot.All.Select(MarketService.ToDefDto),
        Chests = snapshot.Chests.Select(chest => new
        {
            chest.Id, chest.KeyDefId, chest.Name, chest.NameEn, chest.Subtitle, chest.SubtitleEn, chest.KeyName, chest.KeyNameEn,
            chest.IconKey, chest.KeyIconKey, chest.Prices, chest.Active,
            Rates = chest.DropRates,
            Items = chest.Items.Select(def => def.Id),
        }),
        snapshot.LevelRewards,
        Achievements = snapshot.Achievements.Select(a => new { a.TitleDefId, a.Target, a.Metric, a.Countable }),
        snapshot.RareXp,
        snapshot.EpicXp,
        snapshot.Problems,
    }, Web);

    [Fact]
    public async Task TheCacheIgnoresAWriteUntilInvalidated()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        await env.Catalog.Items.UpdateOneAsync(i => i.Id == "VC-0217", Builders<CatalogItem>.Update.Set(i => i.Name, "Tên mới"));

        Assert.Equal("Đồng hồ 2:17", env.Provider.Current.Find("VC-0217")!.Name);

        env.Provider.Invalidate();

        Assert.Equal("Tên mới", env.Provider.Current.Find("VC-0217")!.Name);
    }

    [Fact]
    public async Task RefreshPicksUpAWriteFromAnotherProcess()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        await env.Catalog.Chests.UpdateOneAsync(c => c.Id == Seal, Builders<CatalogChest>.Update.Set(c => c.Prices.Key, 555L));

        await env.Provider.RefreshAsync();

        Assert.Equal(555, env.Provider.Current.FindChest(Seal)!.Prices.Key);
    }

    [Fact]
    public async Task AWriteDuringALoadStillReachesTheNextRead()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();

        // Many writer/reader rounds racing a background refresh: after Invalidate, a read must never serve the older value.
        for (var round = 0; round < 25; round++)
        {
            var name = $"Lần {round}";
            var refresh = env.Provider.RefreshAsync();
            await env.Catalog.Items.UpdateOneAsync(i => i.Id == "VC-0217", Builders<CatalogItem>.Update.Set(i => i.Name, name));
            env.Provider.Invalidate();

            Assert.Equal(name, env.Provider.Current.Find("VC-0217")!.Name);
            await refresh;
            Assert.Equal(name, env.Provider.Current.Find("VC-0217")!.Name);
        }
    }

    [Fact]
    public async Task BeforeTheFirstLoadTheSeedAnswers()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();

        Assert.Equal(MarketCatalog.All.Count, env.Provider.Current.All.Count);
    }

    [Fact]
    public async Task WhenTheDatabaseIsGoneTheLastGoodCatalogKeepsAnswering()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var unreachable = new MongoDbContext(Options.Create(new MongoDbSettings
        {
            ConnectionString = "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=100&connectTimeoutMS=100",
            DatabaseName = "sirlocked_it_unreachable",
        }));
        var provider = new CatalogProvider(new CatalogStore(unreachable), Options.Create(new ChestSettings()), NullLogger<CatalogProvider>.Instance);
        var before = provider.Current;

        provider.Invalidate();

        Assert.Same(before, provider.Current);
        await Assert.ThrowsAnyAsync<Exception>(() => provider.RefreshAsync());
        Assert.Same(before, provider.Current);
    }

    [Fact]
    public async Task AMalformedDocumentCannotTakeTheCatalogDown()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        await env.Raw("catalogItems").InsertOneAsync(new BsonDocument { ["_id"] = "broken", ["referencePrice"] = "not a number" });
        await env.Raw("chests").UpdateOneAsync(new BsonDocument("_id", "chest_nb"), new BsonDocument("$set", new BsonDocument("pool", BsonNull.Value)));

        env.Provider.Invalidate();
        var current = env.Provider.Current;

        // The bad document is left out and named; everything else is served, and later edits still apply.
        Assert.Null(current.Find("broken"));
        Assert.Contains(current.Problems, problem => problem.Contains("broken", StringComparison.Ordinal));
        Assert.NotNull(current.Find("VC-0217"));
        await env.EditItemAsync("VC-0217", Builders<CatalogItem>.Update.Set(i => i.Name, "Vẫn sửa được"));
        Assert.Equal("Vẫn sửa được", env.Provider.Current.Find("VC-0217")!.Name);
    }

    [Fact]
    public async Task AMalformedDocumentCannotStopTheNextStart()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        await env.Raw("catalogItems").InsertOneAsync(new BsonDocument { ["_id"] = "broken", ["referencePrice"] = "not a number" });
        await env.Raw("chests").UpdateOneAsync(new BsonDocument("_id", "chest_nb"), new BsonDocument("$set", new BsonDocument("pool", BsonNull.Value)));
        await env.Raw("gameSettings").ReplaceOneAsync(new BsonDocument("_id", "progress"), new BsonDocument { ["_id"] = "progress", ["rareXp"] = "many" });

        // What Program.cs does at startup, in a new process.
        await env.NewSeeder().SeedAsync();
        var restarted = new CatalogProvider(env.Catalog, Options.Create(new ChestSettings()), NullLogger<CatalogProvider>.Instance);
        await restarted.RefreshAsync();

        Assert.NotNull(restarted.Current.Find("VC-0217"));
        Assert.Equal(ProgressRules.RareXp, restarted.Current.RareXp);
        Assert.Contains(restarted.Current.Problems, problem => problem.Contains("progress", StringComparison.Ordinal));
    }

    [Fact]
    public async Task AChestWithoutAValidPriceIsNotGivenAway()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.EditChestAsync(Seal, Builders<CatalogChest>.Update.Set(c => c.Prices.Key, 0L));
        var before = await env.Market.GetWalletAsync(user.Id);

        var exception = await Assert.ThrowsAsync<ApiException>(() => env.Chests.BuyKeyAsync(user, Seal, NewKey()));

        Assert.Equal(409, exception.StatusCode);
        var after = await env.Market.GetWalletAsync(user.Id);
        Assert.Equal(before.Balance, after.Balance);
        Assert.Equal(before.SlotsUsed, after.SlotsUsed);
        Assert.Equal(0, await env.Store.ChestPurchases.CountDocumentsAsync(p => p.UserId == user.Id));
    }

    // ------------------------------------------------------------------ player flows read the stored catalog

    [Fact]
    public async Task ThePlayerApisAnswerExactlyAsBeforeExceptForVisual()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Market.AdminGrantAsync(user.Id, "frame_thach", 0);

        // The same services over the same data, once on the static seed (the old behaviour) and once on the database.
        var chestsBefore = await env.StaticChests.ListAsync(user.Id);
        var chestsAfter = await env.Chests.ListAsync(user.Id);
        Assert.Equal(WithoutVisual(chestsBefore), WithoutVisual(chestsAfter));

        var catalogBefore = env.StaticMarket.GetCatalog();
        var catalogAfter = env.Market.GetCatalog();
        Assert.Equal(WithoutVisual(catalogBefore), WithoutVisual(catalogAfter));

        var progressBefore = await env.StaticProgress.GetMeAsync(user.Id);
        var progressAfter = await env.Progress.GetMeAsync(user.Id);
        Assert.Equal(WithoutVisual(progressBefore), WithoutVisual(progressAfter));

        Assert.All(catalogAfter, def => Assert.NotNull(def.Visual));
    }

    /// <summary>Serialized the way the API does, minus the one field it is allowed to add.</summary>
    private static string WithoutVisual(object dto)
    {
        var node = JsonSerializer.SerializeToNode(dto, Web)!;
        Strip(node);
        return node.ToJsonString();

        static void Strip(JsonNode? current)
        {
            if (current is JsonObject obj)
            {
                obj.Remove("visual");
                foreach (var pair in obj) Strip(pair.Value);
            }
            else if (current is JsonArray array)
            {
                foreach (var entry in array) Strip(entry);
            }
        }
    }

    [Fact]
    public async Task TheShopChargesTheStoredPrice()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Market.AdminGrantAsync(user.Id, null, 1000);
        await env.EditChestAsync(Seal, Builders<CatalogChest>.Update.Set(c => c.Prices.Key, 333L).Set(c => c.Prices.Chest, 222L));
        var start = (await env.Market.GetWalletAsync(user.Id)).Balance;

        var list = await env.Chests.ListAsync(user.Id);
        var dto = list.Chests.Single(c => c.Id == Seal);
        Assert.Equal(333, dto.KeyPrice);
        Assert.Equal(222, dto.ChestPrice);

        await env.Chests.BuyKeyAsync(user, Seal, NewKey());
        Assert.Equal(start - 333, (await env.Market.GetWalletAsync(user.Id)).Balance);
    }

    [Fact]
    public async Task AnOpeningUsesTheStoredPoolAndTheChestsOwnTable()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);
        var common = await env.Catalog.Items.Find(i => i.Id == "mag_brass").SingleAsync();
        Assert.Equal(MarketRarities.Common, common.Rarity);
        // A chest paying only gear, by its own table: every ticket lands on Common.
        await env.EditChestAsync(Seal, Builders<CatalogChest>.Update
            .Set(c => c.Pool, new List<string> { "mag_brass" })
            .Set(c => c.DropWeights, new Dictionary<string, int> { [MarketRarities.Common] = 10_000 }));
        env.Random.Next(9999, 0);

        var result = await env.Chests.OpenAsync(user, Seal, NewKey());

        Assert.Equal("mag_brass", result.Item.Id);
    }

    [Fact]
    public async Task ARetiredItemStopsDroppingButItsOwnerKeepsUsingIt()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Market.AdminGrantAsync(user.Id, "frame_thach", 0);
        var owned = (await env.Market.GetInventoryAsync(user.Id)).Items.Single(i => i.Def.Id == "frame_thach");

        await env.EditItemAsync("frame_thach", Builders<CatalogItem>.Update.Set(i => i.Retired, true));

        var list = await env.Chests.ListAsync(user.Id);
        Assert.DoesNotContain(list.Chests.Single(c => c.Id == Seal).Contents, def => def.Id == "frame_thach");
        Assert.DoesNotContain(env.Market.GetCatalog(), def => def.Id == "frame_thach");

        // The owner still sees it, wears it and can sell it.
        var inventory = await env.Market.EquipAsync(user.Id, owned.ItemId);
        Assert.Contains(inventory.Items, i => i.Def.Id == "frame_thach" && i.Def.Name == "Thạch Phù");
        Assert.Equal("frame_thach", (await env.Progress.GetMeAsync(user.Id)).FrameDefId);
        await env.Market.UnequipAsync(user.Id, MarketCategories.Frame);
        var listing = await env.Market.CreateListingAsync(user, owned.ItemId, 500);
        Assert.Equal("frame_thach", listing.Listing.Def.Id);
    }

    [Fact]
    public async Task ARetiredItemLeavesTheMarketOnlyOnceNoOneOffersIt()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Market.AdminGrantAsync(user.Id, "frame_thach", 0);
        var owned = (await env.Market.GetInventoryAsync(user.Id)).Items.Single(i => i.Def.Id == "frame_thach");
        var listing = await env.Market.CreateListingAsync(user, owned.ItemId, 500);
        await env.EditItemAsync("frame_thach", Builders<CatalogItem>.Update.Set(i => i.Retired, true));

        Assert.Contains((await env.Market.BrowseAsync(null, null, null, null)).Rows, row => row.Def.Id == "frame_thach");

        await env.Market.CancelListingAsync(user.Id, listing.Listing.ListingId);

        Assert.DoesNotContain((await env.Market.BrowseAsync(null, null, null, null)).Rows, row => row.Def.Id == "frame_thach");
    }

    [Fact]
    public async Task AnOpeningInProgressKeepsItsRewardAfterThePoolChanges()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);
        var key = NewKey();
        var id = $"{user.Id}:{key}";
        var old = env.Store.Now.AddMinutes(-5);
        // An opening that crashed after rolling VC-0217, before anything was spent.
        await env.Store.ChestOpenings.InsertOneAsync(new ChestOpening
        {
            Id = id,
            UserId = user.Id,
            ChestDefId = Seal,
            KeyDefId = "key_np",
            RewardDefId = "VC-0217",
            RewardItemId = MarketStore.NewId(),
            CreatedAt = old,
            UpdatedAt = old,
        });

        // The admin then takes that item out of the chest and retires it.
        await env.EditChestAsync(Seal, Builders<CatalogChest>.Update.Pull(c => c.Pool, "VC-0217"));
        await env.EditItemAsync("VC-0217", Builders<CatalogItem>.Update.Set(i => i.Retired, true));

        await env.Chests.RecoverAsync(TimeSpan.FromSeconds(1));
        var retried = await env.Chests.OpenAsync(user, Seal, key);

        Assert.Equal("VC-0217", retried.Item.Id);
        Assert.Equal("Đồng hồ 2:17", retried.Item.Name);
        Assert.Single((await env.Market.GetInventoryAsync(user.Id)).Items, i => i.Def.Id == "VC-0217");
    }

    [Fact]
    public async Task ExchangePaysTheStoredXpRates()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Market.AdminGrantAsync(user.Id, "VC-0391", 0);
        await env.Catalog.ProgressSettings.UpdateOneAsync(new BsonDocument("_id", "progress"),
            Builders<ProgressSettingsDocument>.Update.Set(p => p.RareXp, 170L));
        env.Provider.Invalidate();

        var me = await env.Progress.GetMeAsync(user.Id);
        var item = Assert.Single(me.Exchangeable);
        Assert.Equal(170, item.Xp);

        var result = await env.Progress.ExchangeAsync(user, new[] { item.ItemId }, NewKey());

        Assert.Equal(170, result.XpGained);
    }

    [Fact]
    public async Task LevelRewardsComeFromTheStoredList()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Progress.GetMeAsync(user.Id);
        await env.Catalog.LevelRewards.InsertOneAsync(new CatalogLevelReward { Id = CatalogLevelReward.IdOf(2, "title_an-si"), Level = 2, DefId = "title_an-si" });
        env.Provider.Invalidate();
        await env.Market.AdminGrantAsync(user.Id, "VC-0405", 0);
        var item = (await env.Progress.GetMeAsync(user.Id)).Exchangeable.Single();

        var result = await env.Progress.ExchangeAsync(user, new[] { item.ItemId }, NewKey());

        Assert.True(result.Level >= 2);
        Assert.Contains("title_an-si", result.NewTitleDefIds);
    }

    [Fact]
    public async Task AchievementsComeFromTheStoredList()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        // Having the 2:17 watch is one of the counts; make that earn a different title.
        await env.Market.AdminGrantAsync(user.Id, AchievementRules.Watch217DefId, 0);
        await env.Catalog.Achievements.DeleteOneAsync(a => a.TitleDefId == "title_giu-gio");
        await env.Catalog.Achievements.InsertOneAsync(new CatalogAchievement
        {
            TitleDefId = "title_an-si",
            Metric = AchievementMetrics.OwnsWatch217,
            Target = 1,
            SortOrder = 99,
        });
        env.Provider.Invalidate();

        var me = await env.Progress.GetMeAsync(user.Id);

        Assert.Contains(me.Achievements, a => a.TitleDefId == "title_an-si" && a.Earned);
        Assert.DoesNotContain(me.Achievements, a => a.TitleDefId == "title_giu-gio");
        Assert.Contains(me.Owned, o => o.DefId == "title_an-si" && o.Source == MarketItemSources.Achievement);
    }

    [Fact]
    public async Task AChestSwitchedOffLeavesTheListButStaysOpenableByIdempotentRetry()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.SeedAndLoadAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);
        await env.EditChestAsync(Seal, Builders<CatalogChest>.Update.Set(c => c.Active, false));

        var list = await env.Chests.ListAsync(user.Id);
        Assert.DoesNotContain(list.Chests, c => c.Id == Seal);

        var opened = await env.Chests.OpenAsync(user, Seal, NewKey());
        Assert.Equal(Seal, opened.ChestId);
    }

    // ------------------------------------------------------------------ audit

    [Fact]
    public async Task AnAuditEntryRecordsWhoDidWhatAndTheChange()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        await env.Catalog.EnsureIndexesAsync();
        var admin = new CurrentUser("admin-1", "Yến", UserRole.Admin);
        var before = await SeededItem("VC-0217");
        var after = await SeededItem("VC-0217");
        after.Name = "Tên mới";

        await env.Audit.LogAsync(admin, "item.update", "catalogItem", "VC-0217", before, after, "  đổi tên  ");

        var entry = await env.Catalog.Audit.Find(FilterDefinition<AdminAuditEntry>.Empty).SingleAsync();
        Assert.Equal("admin-1", entry.AdminId);
        Assert.Equal("Yến", entry.AdminName);
        Assert.Equal("item.update", entry.Action);
        Assert.Equal("catalogItem", entry.TargetType);
        Assert.Equal("VC-0217", entry.TargetId);
        Assert.Equal("đổi tên", entry.Reason);
        Assert.True(entry.At > DateTime.UtcNow.AddMinutes(-1));

        var page = await env.Audit.QueryAsync(new AdminAuditQuery(TargetId: "VC-0217"));
        var dto = Assert.Single(page.Items);
        Assert.Equal("Đồng hồ 2:17", dto.Before!.Value.GetProperty("name").GetString());
        Assert.Equal("Tên mới", dto.After!.Value.GetProperty("name").GetString());
        Assert.Equal("watch", dto.After!.Value.GetProperty("visual").GetProperty("iconKey").GetString());

        static Task<CatalogItem> SeededItem(string id) =>
            Task.FromResult(CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow).Items.Single(item => item.Id == id));
    }

    [Fact]
    public async Task AuditAcceptsAnyShapeOfBeforeAndAfter()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        var admin = new CurrentUser("a", "A", UserRole.Admin);

        await env.Audit.LogAsync(admin, "x", "t", "anonymous", null, new { price = 5, tags = new[] { "a" } });
        await env.Audit.LogAsync(admin, "x", "t", "bson", new BsonDocument("k", 1), null);
        await env.Audit.LogAsync(admin, "x", "t", "dict", new Dictionary<string, int> { ["k"] = 2 }, null);
        await env.Audit.LogAsync(admin, "x", "t", "dto", new SirLocked.Api.DTOs.Admin.AdminAssetDto("u", 1, 2), null);
        await env.Audit.LogAsync(admin, "x", "t", "json", JsonDocument.Parse("{\"k\":3}").RootElement, null);
        await env.Audit.LogAsync(admin, "x", "t", "number", 7, null);

        var rows = (await env.Audit.QueryAsync(new AdminAuditQuery(TargetType: "t"))).Items.ToDictionary(row => row.TargetId);
        Assert.Null(rows["anonymous"].Before);
        Assert.Equal(5, rows["anonymous"].After!.Value.GetProperty("price").GetInt32());
        Assert.Equal(1, rows["bson"].Before!.Value.GetProperty("k").GetInt32());
        Assert.Equal(2, rows["dict"].Before!.Value.GetProperty("k").GetInt32());
        Assert.Equal("u", rows["dto"].Before!.Value.GetProperty("url").GetString());
        Assert.Equal(3, rows["json"].Before!.Value.GetProperty("k").GetInt32());
        Assert.Equal(7, rows["number"].Before!.Value.GetInt32());
    }

    [Fact]
    public async Task AuditFiltersAndPagesNewestFirst()
    {
        if (!Enabled) return;
        await using var env = await CatalogEnv.CreateAsync();
        var yen = new CurrentUser("yen", "Yến", UserRole.Admin);
        var minh = new CurrentUser("minh", "Minh", UserRole.Admin);
        for (var i = 0; i < 5; i++) await env.Audit.LogAsync(yen, "item.update", "catalogItem", $"item-{i}", null, null);
        await env.Audit.LogAsync(minh, "chest.update", "chest", Seal, null, null);

        Assert.Equal(6, (await env.Audit.QueryAsync(new AdminAuditQuery())).Total);
        Assert.Equal(5, (await env.Audit.QueryAsync(new AdminAuditQuery(TargetType: "catalogItem"))).Total);
        Assert.Equal(1, (await env.Audit.QueryAsync(new AdminAuditQuery(TargetId: "item-3"))).Total);
        Assert.Equal(1, (await env.Audit.QueryAsync(new AdminAuditQuery(AdminId: "minh"))).Total);
        Assert.Equal(1, (await env.Audit.QueryAsync(new AdminAuditQuery(Action: "chest.update"))).Total);
        Assert.Equal(0, (await env.Audit.QueryAsync(new AdminAuditQuery(To: DateTime.UtcNow.AddDays(-1)))).Total);
        Assert.Equal(6, (await env.Audit.QueryAsync(new AdminAuditQuery(From: DateTime.UtcNow.AddDays(-1)))).Total);

        var first = await env.Audit.QueryAsync(new AdminAuditQuery(TargetType: "catalogItem", Page: 1, PageSize: 2));
        var second = await env.Audit.QueryAsync(new AdminAuditQuery(TargetType: "catalogItem", Page: 2, PageSize: 2));
        var last = await env.Audit.QueryAsync(new AdminAuditQuery(TargetType: "catalogItem", Page: 3, PageSize: 2));
        Assert.Equal(new[] { "item-4", "item-3" }, first.Items.Select(row => row.TargetId));
        Assert.Equal(new[] { "item-2", "item-1" }, second.Items.Select(row => row.TargetId));
        Assert.Equal(new[] { "item-0" }, last.Items.Select(row => row.TargetId));
        Assert.Equal(5, first.Total);

        var clamped = await env.Audit.QueryAsync(new AdminAuditQuery(Page: -3, PageSize: 100_000));
        Assert.Equal(1, clamped.Page);
        Assert.Equal(AdminAuditService.MaxPageSize, clamped.PageSize);
    }

    // ------------------------------------------------------------------ environment

    private sealed class SettableRandom : IChestRandom
    {
        private readonly Queue<int> _values = new();

        public void Next(params int[] values)
        {
            foreach (var value in values) _values.Enqueue(value);
        }

        public int NextInt(int exclusiveMax) => _values.Count > 0 ? _values.Dequeue() : 0;
    }

    private sealed class CatalogEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private CatalogEnv(MongoDbSettings settings)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db);
            Catalog = new CatalogStore(Db);
            Seeder = NewSeeder();
            Provider = new CatalogProvider(Catalog, Options.Create(new ChestSettings()), NullLogger<CatalogProvider>.Instance);
            Audit = new AdminAuditService(Catalog);
            Random = new SettableRandom();
            Market = new MarketService(Store, NullLogger<MarketService>.Instance, Provider);
            Chests = new ChestService(Store, Market, Random, Options.Create(new ChestSettings()), NullLogger<ChestService>.Instance, Provider);
            Progress = new ProgressService(Store, Market, NullLogger<ProgressService>.Instance, null, Provider);
            StaticMarket = new MarketService(Store, NullLogger<MarketService>.Instance);
            StaticChests = new ChestService(Store, StaticMarket, Random, Options.Create(new ChestSettings()), NullLogger<ChestService>.Instance);
            StaticProgress = new ProgressService(Store, StaticMarket, NullLogger<ProgressService>.Instance);
        }

        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public CatalogStore Catalog { get; }
        public CatalogSeeder Seeder { get; }
        public CatalogProvider Provider { get; }
        public AdminAuditService Audit { get; }
        public SettableRandom Random { get; }
        public MarketService Market { get; }
        public ChestService Chests { get; }
        public ProgressService Progress { get; }
        public MarketService StaticMarket { get; }
        public ChestService StaticChests { get; }
        public ProgressService StaticProgress { get; }

        public CatalogSeeder NewSeeder() => new(Catalog, Options.Create(new ChestSettings()), NullLogger<CatalogSeeder>.Instance);

        public IMongoCollection<BsonDocument> Raw(string name) => Db.Database.GetCollection<BsonDocument>(name);

        public static async Task<CatalogEnv> CreateAsync()
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_catalog_{Guid.NewGuid():N}"
            };
            TestMongoSafetyGuard.EnsureSafe(settings);
            var env = new CatalogEnv(settings);
            await env.Db.PingAsync();
            await env.Store.EnsureIndexesAsync();
            return env;
        }

        public async Task SeedAndLoadAsync()
        {
            await Seeder.SeedAsync();
            await Provider.RefreshAsync();
        }

        public Task ForgetSeedAsync() => Raw("gameSettings").DeleteOneAsync(new BsonDocument("_id", CatalogSeedState.DocumentId));

        public async Task EditItemAsync(string id, UpdateDefinition<CatalogItem> update)
        {
            await Catalog.Items.UpdateOneAsync(i => i.Id == id, update);
            Provider.Invalidate();
        }

        public async Task EditChestAsync(string id, UpdateDefinition<CatalogChest> update)
        {
            await Catalog.Chests.UpdateOneAsync(c => c.Id == id, update);
            Provider.Invalidate();
        }

        public async Task<string> DumpAsync()
        {
            var parts = new List<string>();
            foreach (var name in new[] { "catalogItems", "chests", "levelRewards", "achievements" })
            {
                var docs = await Raw(name).Find(FilterDefinition<BsonDocument>.Empty).Sort(new BsonDocument("_id", 1)).ToListAsync();
                parts.Add($"{name}:{docs.ToJson()}");
            }
            var progress = await Raw("gameSettings").Find(new BsonDocument("_id", ProgressSettingsDocument.DocumentId)).FirstOrDefaultAsync();
            parts.Add(progress?.ToJson() ?? "no-progress");
            return string.Join("\n", parts);
        }

        public async Task<List<string>> IndexNamesAsync(string collection)
        {
            var indexes = await (await Raw(collection).Indexes.ListAsync()).ToListAsync();
            return indexes.Select(index => index["name"].AsString).ToList();
        }

        public async Task<CurrentUser> AddUserAsync(string name)
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

        public async Task GrantAsync(string userId, string chestId, int chests, int keys)
        {
            var chest = Provider.Current.FindChest(chestId)!;
            for (var i = 0; i < chests; i++) await Market.AdminGrantAsync(userId, chest.Id, 0);
            for (var i = 0; i < keys; i++) await Market.AdminGrantAsync(userId, chest.KeyDefId, 0);
        }

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
