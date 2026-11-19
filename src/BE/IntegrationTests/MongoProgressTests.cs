using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Market;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// Hồ sơ thám tử against a real (standalone) MongoDB: exchanging items for XP is exactly-once under retries and
/// races, earned cosmetics are granted once and stay out of the market, cosmetics reach the lobby from the server,
/// and an entrance is announced once per arrival. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoProgressTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_MONGO_IT";
    private const string Rare = "VC-0391";      // Đèn bão
    private const string Rare2 = "VC-0419";     // Mũ thợ săn
    private const string Epic = "VC-0405";      // Huy hiệu sở
    private const string Common = "VC-0388";    // Sổ tay da bò
    private const string Legendary = "VC-0430"; // Trâm hồng ngọc
    private const string Seal = "chest_np";

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable(RunEnvironmentVariable), "true", StringComparison.OrdinalIgnoreCase);

    private static string NewKey() => Guid.NewGuid().ToString();

    // ------------------------------------------------------------------ reads

    [Fact]
    public async Task ANewDetective_StartsAtLevelOne_WithTheDefaults_AndNoEarnedItems()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();

        var me = await env.Progress.GetMeAsync(user.Id);

        Assert.Equal(1, me.Level);
        Assert.Equal(0, me.Xp);
        Assert.Equal(200, me.XpToNext);
        Assert.False(me.IsMaxLevel);
        Assert.Equal(CosmeticCatalog.DefaultAvatar, me.Avatar);
        Assert.Null(me.FrameDefId);
        Assert.Equal(CosmeticCatalog.DefaultTitleDefId, me.TitleDefId);
        Assert.Equal(CosmeticCatalog.DefaultEntranceDefId, me.EntranceDefId);
        Assert.Empty(me.Owned);
        Assert.Empty(me.Exchangeable);
    }

    [Fact]
    public async Task Exchangeable_ListsOnlyFreeRareAndEpicItems_WithTheirValue()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var rare = await env.GiveAsync(user.Id, Rare);
        var epic = await env.GiveAsync(user.Id, Epic);
        var listed = await env.GiveAsync(user.Id, Rare2);
        await env.Market.CreateListingAsync(user, listed, 500);
        var worn = await env.GiveAsync(user.Id, "mag_ebony");
        await env.Market.EquipAsync(user.Id, worn);
        await env.GiveAsync(user.Id, Common);
        await env.GiveAsync(user.Id, Legendary);

        var me = await env.Progress.GetMeAsync(user.Id);

        Assert.Equal(new[] { (rare, 150L), (epic, 600L) }.OrderBy(x => x.Item1), me.Exchangeable.Select(x => (x.ItemId, x.Xp)).OrderBy(x => x.ItemId));
    }

    // ------------------------------------------------------------------ exchange

    [Fact]
    public async Task Exchange_BurnsTheItems_AddsTheXp_AndFreesTheirSlots()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var rare = await env.GiveAsync(user.Id, Rare);
        var epic = await env.GiveAsync(user.Id, Epic);
        var slotsBefore = (await env.Market.GetWalletAsync(user.Id)).SlotsUsed;

        var result = await env.Progress.ExchangeAsync(user, new[] { rare, epic }, NewKey());

        // 750 XP: 200 + 240 + 280 → level 4 with 30.
        Assert.Equal(750, result.XpGained);
        Assert.Equal(4, result.Level);
        Assert.Equal(30, result.Xp);
        Assert.Equal(320, result.XpToNext);
        Assert.Empty(result.NewFrameDefIds);
        Assert.Equal(slotsBefore - 2, result.Wallet.SlotsUsed);
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == rare || i.Id == epic));
        var journal = await env.Store.XpExchanges.Find(e => e.UserId == user.Id).SingleAsync();
        Assert.Equal(ChestOpeningStates.Done, journal.State);
    }

    [Fact]
    public async Task Exchange_RepeatedWithTheSameKey_ChangesNothing_AndAnswersTheSame()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var rare = await env.GiveAsync(user.Id, Rare);
        var key = NewKey();

        var first = await env.Progress.ExchangeAsync(user, new[] { rare }, key);
        var again = await env.Progress.ExchangeAsync(user, new[] { rare }, key);

        Assert.Equal(first.Level, again.Level);
        Assert.Equal(first.Xp, again.Xp);
        Assert.Equal(first.XpGained, again.XpGained);
        Assert.Equal(150, (await env.Progress.GetMeAsync(user.Id)).Xp);
    }

    [Fact]
    public async Task Exchange_RepeatedWithTheSameKey_InParallel_PaysOnce()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var epic = await env.GiveAsync(user.Id, Epic);
        var key = NewKey();

        var outcomes = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Attempt(() => env.Progress.ExchangeAsync(user, new[] { epic }, key))));

        Assert.Contains(outcomes, outcome => outcome is null);
        Assert.All(outcomes.Where(outcome => outcome is not null), outcome => Assert.Equal(ChestErrors.InProgress, outcome));
        await env.SettleAsync();
        var me = await env.Progress.GetMeAsync(user.Id);
        // 600 XP once: 200 + 240 → level 3 with 160.
        Assert.Equal(3, me.Level);
        Assert.Equal(160, me.Xp);
    }

    [Fact]
    public async Task AKeyReusedForDifferentItems_IsRejected()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var one = await env.GiveAsync(user.Id, Rare);
        var two = await env.GiveAsync(user.Id, Rare2);
        var key = NewKey();
        await env.Progress.ExchangeAsync(user, new[] { one }, key);

        var error = await Throws(() => env.Progress.ExchangeAsync(user, new[] { two }, key));

        Assert.Equal(MarketErrors.InvalidRequestId, Code(error));
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Id == two));
    }

    [Theory]
    [InlineData(Common)]
    [InlineData(Legendary)]
    [InlineData("VC-0217")]
    [InlineData("chest_np")]
    [InlineData("key_np")]
    public async Task Exchange_RefusesItemsOfTheWrongKind_AndChangesNothing(string defId)
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, defId);

        var error = await Throws(() => env.Progress.ExchangeAsync(user, new[] { item }, NewKey()));

        Assert.Equal(ProgressErrors.ItemNotExchangeable, Code(error));
        await env.AssertUntouchedAsync(user.Id, item);
    }

    [Fact]
    public async Task Exchange_RefusesAnEarnedFrame_SoLevelRewardsCannotBeFarmed()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        await env.SetLevelAsync(user.Id, 20);
        await env.Progress.GetMeAsync(user.Id);
        var silver = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.DefId == "frame_bac").SingleAsync();

        var error = await Throws(() => env.Progress.ExchangeAsync(user, new[] { silver.Id }, NewKey()));

        Assert.Equal(ProgressErrors.ItemNotExchangeable, Code(error));
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Id == silver.Id));
    }

    [Fact]
    public async Task Exchange_RefusesAnItemOnTheMarket()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, Rare);
        await env.Market.CreateListingAsync(user, item, 500);

        var error = await Throws(() => env.Progress.ExchangeAsync(user, new[] { item }, NewKey()));

        Assert.Equal(ProgressErrors.ItemLocked, Code(error));
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Id == item));
    }

    [Fact]
    public async Task Exchange_RefusesAnEquippedItem()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, "frame_thach");
        await env.Market.EquipAsync(user.Id, item);

        var error = await Throws(() => env.Progress.ExchangeAsync(user, new[] { item }, NewKey()));

        Assert.Equal(ProgressErrors.ItemEquipped, Code(error));
        await env.AssertUntouchedAsync(user.Id, item);
    }

    [Fact]
    public async Task Exchange_RefusesSomeoneElsesItem()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var thief = await env.AddUserAsync();
        var owner = await env.AddUserAsync();
        var item = await env.GiveAsync(owner.Id, Epic);

        var error = await Throws(() => env.Progress.ExchangeAsync(thief, new[] { item }, NewKey()));

        Assert.Equal(404, error.StatusCode);
        Assert.Equal(ProgressErrors.ItemNotFound, Code(error));
        Assert.Equal(owner.Id, (await env.Store.Items.Find(i => i.Id == item).SingleAsync()).OwnerId);
        Assert.Equal(0, (await env.Progress.GetMeAsync(thief.Id)).Xp);
    }

    [Fact]
    public async Task Exchange_IsAllOrNothing_WhenOneItemOfTheBatchIsBad()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var good = await env.GiveAsync(user.Id, Epic);
        var bad = await env.GiveAsync(user.Id, Common);

        await Throws(() => env.Progress.ExchangeAsync(user, new[] { good, bad }, NewKey()));

        await env.AssertUntouchedAsync(user.Id, good);
        await env.AssertUntouchedAsync(user.Id, bad);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("short")]
    [InlineData("has spaces in it")]
    public async Task Exchange_NeedsAWellFormedKey(string? key)
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, Rare);

        var error = await Throws(() => env.Progress.ExchangeAsync(user, new[] { item }, key));

        Assert.Equal(MarketErrors.InvalidRequestId, Code(error));
    }

    [Fact]
    public async Task Exchange_NeedsAtLeastOneItem_AndNoDuplicates()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, Epic);

        Assert.Equal(ProgressErrors.NoItems, Code(await Throws(() => env.Progress.ExchangeAsync(user, Array.Empty<string>(), NewKey()))));

        // The same id twice must not pay twice.
        var result = await env.Progress.ExchangeAsync(user, new[] { item, item }, NewKey());
        Assert.Equal(600, result.XpGained);
    }

    [Fact]
    public async Task Exchange_NeedsAVerifiedEmail()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync(verified: false);
        var item = await env.GiveAsync(user.Id, Rare);

        Assert.Equal(MarketErrors.EmailNotVerified, Code(await Throws(() => env.Progress.ExchangeAsync(user, new[] { item }, NewKey()))));
    }

    [Fact]
    public async Task TwoParallelExchangesOfOneItem_OnlyOneWins()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, Epic);

        var outcomes = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Attempt(() => env.Progress.ExchangeAsync(user, new[] { item }, NewKey()))));

        Assert.Single(outcomes, outcome => outcome is null);
        Assert.All(outcomes.Where(outcome => outcome is not null), outcome =>
            Assert.Contains(outcome, new[] { ProgressErrors.ItemLocked, ProgressErrors.ItemNotFound }));
        await env.SettleAsync();
        var me = await env.Progress.GetMeAsync(user.Id);
        Assert.Equal(3, me.Level);
        Assert.Equal(160, me.Xp);
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == item));
    }

    [Fact]
    public async Task ParallelExchangesOfDifferentItems_AddUp()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var items = new List<string>();
        for (var i = 0; i < 6; i++) items.Add(await env.GiveAsync(user.Id, Rare));

        var outcomes = await Task.WhenAll(items.Select(item => Attempt(() => env.Progress.ExchangeAsync(user, new[] { item }, NewKey()))));

        Assert.All(outcomes, Assert.Null);
        var me = await env.Progress.GetMeAsync(user.Id);
        // 900 XP: 200 + 240 + 280 → level 4 with 180.
        Assert.Equal(4, me.Level);
        Assert.Equal(180, me.Xp);
    }

    // ------------------------------------------------------------------ levels & rewards

    [Fact]
    public async Task CrossingAMilestone_GrantsItsFrame_Once_WithTheLevelSource()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        await env.SetLevelAsync(user.Id, 9, xp: 500);
        var item = await env.GiveAsync(user.Id, Rare);

        var result = await env.Progress.ExchangeAsync(user, new[] { item }, NewKey());

        Assert.Equal(10, result.Level);
        Assert.Equal(new[] { "frame_dong" }, result.NewFrameDefIds);
        var frame = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.DefId == "frame_dong").SingleAsync();
        Assert.Equal(MarketItemSources.Level, frame.Source);

        await env.Progress.GetMeAsync(user.Id);
        await env.Progress.GetMeAsync(user.Id);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.OwnerId == user.Id && i.DefId == "frame_dong"));
    }

    [Fact]
    public async Task ReachingLevelThirty_GrantsTheFrameAndTheLevelTitle_PlusAnythingBelowThatWasMissing()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        await env.SetLevelAsync(user.Id, 29, xp: 1300);
        var item = await env.GiveAsync(user.Id, Rare);

        var result = await env.Progress.ExchangeAsync(user, new[] { item }, NewKey());

        Assert.Equal(30, result.Level);
        Assert.Contains("frame_ngoc", result.NewFrameDefIds);
        Assert.Equal(new[] { "title_van-tay" }, result.NewTitleDefIds);
        // Everything below is granted as well, in case a detective got here some other way.
        var earned = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.Source == MarketItemSources.Level).ToListAsync();
        Assert.Equal(new[] { "frame_bac", "frame_dong", "frame_ngoc", "title_van-tay" }, earned.Select(i => i.DefId).OrderBy(id => id, StringComparer.Ordinal));
    }

    [Fact]
    public async Task ClimbingAllTheWayToFifty_GrantsEveryLevelReward_ExactlyOnce_AndThenStops()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var frames = new List<string>();
        var batches = 0;
        while ((await env.Progress.GetMeAsync(user.Id)).Level < ProgressRules.MaxLevel)
        {
            // The bag holds 12, so the climb has to go through many exchanges, like a real player's.
            var batch = new List<string>();
            while (batch.Count < 12 && (await env.Market.GetWalletAsync(user.Id)).SlotsUsed < MarketRules.InventorySlots)
                batch.Add(await env.GiveAsync(user.Id, Epic));
            if (batch.Count == 0) throw new InvalidOperationException("The bag is full of something else.");
            var result = await env.Progress.ExchangeAsync(user, batch, NewKey());
            frames.AddRange(result.NewFrameDefIds);
            Assert.True(++batches < 50);
        }

        Assert.Equal(new[] { "frame_dong", "frame_bac", "frame_ngoc", "frame_vang", "frame_truong" }, frames);
        var me = await env.Progress.GetMeAsync(user.Id);
        Assert.True(me.IsMaxLevel);
        Assert.Equal(0, me.Xp);
        Assert.Equal(7, await env.Store.Items.CountDocumentsAsync(i => i.OwnerId == user.Id && i.Source == MarketItemSources.Level));
        Assert.Empty(me.Exchangeable.Where(item => item.Def.Tradable == false));

        var leftover = await env.GiveAsync(user.Id, Epic);
        Assert.Equal(ProgressErrors.MaxLevel, Code(await Throws(() => env.Progress.ExchangeAsync(user, new[] { leftover }, NewKey()))));
        await env.AssertUntouchedAsync(user.Id, leftover);
    }

    [Fact]
    public async Task EarnedCosmetics_TakeNoBagSlot_SoAFullBagStillGetsThem()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        await env.SetLevelAsync(user.Id, 9, xp: 500);
        var item = await env.GiveAsync(user.Id, Rare);
        while ((await env.Market.GetWalletAsync(user.Id)).SlotsUsed < MarketRules.InventorySlots)
            await env.GiveAsync(user.Id, Common);

        await env.Progress.ExchangeAsync(user, new[] { item }, NewKey());

        var wallet = await env.Market.GetWalletAsync(user.Id);
        Assert.Equal(MarketRules.InventorySlots - 1, wallet.SlotsUsed);
        Assert.Equal(MarketRules.InventorySlots - 1, wallet.ItemCount);
        var bag = await env.Market.GetInventoryAsync(user.Id);
        Assert.DoesNotContain(bag.Items, entry => entry.Def.Id == "frame_dong");
        Assert.Contains((await env.Progress.GetMeAsync(user.Id)).Owned, entry => entry.DefId == "frame_dong");
    }

    // ------------------------------------------------------------------ recovery

    [Fact]
    public async Task Recovery_FinishesAnExchangeThatDiedBeforeLockingAnything()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, Epic);
        await env.Store.XpExchanges.InsertOneAsync(env.NewExchange(user.Id, new[] { item }, 600));

        var report = await env.Progress.RecoverAsync(TimeSpan.Zero);

        Assert.Equal(1, report);
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == item));
        Assert.Equal(160, (await env.Progress.GetMeAsync(user.Id)).Xp);
    }

    [Fact]
    public async Task Recovery_RollsForward_AfterTheCommitPoint_WithoutPayingTwice()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, Rare);
        await env.Progress.ExchangeAsync(user, new[] { item }, NewKey());
        // As if the process died right after paying: the journal never reached DONE.
        await env.Store.XpExchanges.UpdateOneAsync(e => e.UserId == user.Id, Builders<XpExchange>.Update.Set(e => e.State, ChestOpeningStates.Pending));

        Assert.Equal(1, await env.Progress.RecoverAsync(TimeSpan.Zero));

        Assert.Equal(150, (await env.Progress.GetMeAsync(user.Id)).Xp);
        Assert.Equal(ChestOpeningStates.Done, (await env.Store.XpExchanges.Find(e => e.UserId == user.Id).SingleAsync()).State);
    }

    [Fact]
    public async Task Recovery_RollsBack_WhenAnItemWasEquippedMeanwhile_AndFreesTheLocks()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var keep = await env.GiveAsync(user.Id, "frame_thach");
        var other = await env.GiveAsync(user.Id, Rare);
        await env.Market.EquipAsync(user.Id, keep);
        await env.Store.XpExchanges.InsertOneAsync(env.NewExchange(user.Id, new[] { keep, other }, 300));

        Assert.Equal(1, await env.Progress.RecoverAsync(TimeSpan.Zero));

        var journal = await env.Store.XpExchanges.Find(e => e.UserId == user.Id).SingleAsync();
        Assert.Equal(ChestOpeningStates.Failed, journal.State);
        await env.AssertUntouchedAsync(user.Id, keep);
        await env.AssertUntouchedAsync(user.Id, other);
    }

    [Fact]
    public async Task Recovery_LeavesFreshExchangesAlone()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, Epic);
        await env.Store.XpExchanges.InsertOneAsync(env.NewExchange(user.Id, new[] { item }, 600));

        Assert.Equal(0, await env.Progress.RecoverAsync(TimeSpan.FromMinutes(5)));
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Id == item));
    }

    [Fact]
    public async Task TheMarketSweep_DoesNotFreeAnItemAnExchangeHolds()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, Epic);
        var exchange = env.NewExchange(user.Id, new[] { item }, 600);
        await env.Store.XpExchanges.InsertOneAsync(exchange);
        var lockKey = MarketService.XpLockPrefix + exchange.Id;
        Assert.True(await env.Store.LockItemAsync(item, user.Id, lockKey));

        await env.Market.RecoverAsync(TimeSpan.Zero);

        Assert.Equal(lockKey, (await env.Store.Items.Find(i => i.Id == item).SingleAsync()).LockedBy);
        var view = (await env.Market.GetInventoryAsync(user.Id)).Items.Single(i => i.ItemId == item);
        Assert.Equal("EXCHANGING", view.LockReason);
    }

    // ------------------------------------------------------------------ market rules

    [Theory]
    [InlineData("frame_dong")]
    [InlineData("title_van-tay")]
    [InlineData("title_khach-quen")]
    public async Task TheMarket_RefusesToListWhatWasEarned(string defId)
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveEarnedAsync(user.Id, defId);

        var error = await Throws(() => env.Market.CreateListingAsync(user, item, 500));

        Assert.Equal(MarketErrors.ItemNotTradable, Code(error));
        Assert.Null((await env.Store.Items.Find(i => i.Id == item).SingleAsync()).LockedBy);
        Assert.Equal(0, await env.Store.Listings.CountDocumentsAsync(l => l.ItemId == item));
    }

    [Fact]
    public async Task ATradeOffer_CannotOfferOrAskForWhatWasEarned()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var one = await env.AddUserAsync();
        var two = await env.AddUserAsync();
        var mine = await env.GiveEarnedAsync(one.Id, "frame_dong");
        var theirs = await env.GiveEarnedAsync(two.Id, "frame_dong");

        var offering = await Throws(() => env.Market.CreateTradeAsync(one, new CreateTradeRequest
        {
            ToUserId = two.Id, OfferItemIds = new List<string> { mine }, RequestCoins = 10
        }));
        var asking = await Throws(() => env.Market.CreateTradeAsync(one, new CreateTradeRequest
        {
            ToUserId = two.Id, RequestItemIds = new List<string> { theirs }, OfferCoins = 10
        }));

        Assert.Equal(MarketErrors.ItemNotTradable, Code(offering));
        Assert.Equal(MarketErrors.ItemNotTradable, Code(asking));
    }

    [Theory]
    [InlineData("frame_dong")]
    [InlineData("title_tan-binh")]
    [InlineData("entrance_lang-le")]
    public async Task NobodyCanBidOrBuy_WhatCannotBeSold(string defId)
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();

        Assert.Equal(MarketErrors.ItemNotTradable, Code(await Throws(() => env.Market.PlaceOrderAsync(user, defId, 100))));
        Assert.Equal(MarketErrors.ItemNotTradable, Code(await Throws(() => env.Market.BuyLowestAsync(user, defId, 100))));
    }

    [Fact]
    public async Task TheMarketBrowse_ShowsChestCosmetics_ButNotEarnedOnes()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();

        var browse = await env.Market.BrowseAsync(null, MarketCategories.Frame, null, "name");

        Assert.Equal(11, browse.Rows.Count);
        Assert.Contains(browse.Rows, row => row.Def.Id == "frame_kimlong");
        Assert.DoesNotContain(browse.Rows, row => row.Def.Id == "frame_dong");
    }

    [Fact]
    public async Task AChestCosmetic_CanBeSold_AndWorksForTheBuyer()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var seller = await env.AddUserAsync();
        var buyer = await env.AddUserAsync();
        var frame = await env.GiveAsync(seller.Id, "frame_kimlong");
        await env.Market.EquipAsync(seller.Id, frame);

        var listed = await env.Market.CreateListingAsync(seller, frame, 100);
        await env.Market.BuyListingAsync(buyer, listed.Listing.ListingId);
        await env.Market.EquipAsync(buyer.Id, frame);

        Assert.Null((await env.Progress.GetMeAsync(seller.Id)).FrameDefId);
        Assert.Equal("frame_kimlong", (await env.Progress.GetMeAsync(buyer.Id)).FrameDefId);
    }

    // ------------------------------------------------------------------ equipping

    [Theory]
    [InlineData("frame_thach", MarketCategories.Frame)]
    [InlineData("title_san-manh-moi", MarketCategories.Title)]
    [InlineData("entrance_anh-trang", MarketCategories.Entrance)]
    public async Task EachCosmeticKind_CanBeEquipped_AndTakenOff(string defId, string category)
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await env.GiveAsync(user.Id, defId);

        await env.Market.EquipAsync(user.Id, item);

        var worn = await env.Progress.GetMeAsync(user.Id);
        Assert.Equal(defId, category switch
        {
            MarketCategories.Frame => worn.FrameDefId,
            MarketCategories.Title => worn.TitleDefId,
            _ => worn.EntranceDefId
        });
        Assert.Contains(worn.Owned, owned => owned.ItemId == item && owned.Equipped);

        await env.Market.UnequipAsync(user.Id, category);

        var plain = await env.Progress.GetMeAsync(user.Id);
        Assert.Null(plain.FrameDefId);
        Assert.Equal(CosmeticCatalog.DefaultTitleDefId, plain.TitleDefId);
        Assert.Equal(CosmeticCatalog.DefaultEntranceDefId, plain.EntranceDefId);
    }

    [Fact]
    public async Task EachCategory_HoldsOneItem()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var one = await env.GiveAsync(user.Id, "frame_thach");
        var two = await env.GiveAsync(user.Id, "frame_mac");

        await env.Market.EquipAsync(user.Id, one);
        await env.Market.EquipAsync(user.Id, two);

        var me = await env.Progress.GetMeAsync(user.Id);
        Assert.Equal("frame_mac", me.FrameDefId);
        Assert.Single(me.Owned, owned => owned.Equipped);
    }

    [Fact]
    public async Task AnEarnedFrame_CanBeEquipped()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        await env.SetLevelAsync(user.Id, 10);
        var me = await env.Progress.GetMeAsync(user.Id);

        await env.Market.EquipAsync(user.Id, me.Owned.Single(owned => owned.DefId == "frame_dong").ItemId);

        Assert.Equal("frame_dong", (await env.Progress.GetMeAsync(user.Id)).FrameDefId);
    }

    // ------------------------------------------------------------------ achievements

    [Fact]
    public async Task PlayingTenCases_EarnsItsTitle_Once_WhenTheProfileOpens()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        for (var i = 0; i < 9; i++) await env.AddResultAsync(user.Id, success: false);

        var before = await env.Progress.GetMeAsync(user.Id);
        Assert.DoesNotContain(before.Owned, owned => owned.DefId == "title_khach-quen");
        Assert.Equal(9, before.Achievements.Single(a => a.TitleDefId == "title_khach-quen").Count);

        await env.AddResultAsync(user.Id, success: false);
        var after = await env.Progress.GetMeAsync(user.Id);
        await env.Progress.GetMeAsync(user.Id);

        var title = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.DefId == "title_khach-quen").SingleAsync();
        Assert.Equal(MarketItemSources.Achievement, title.Source);
        Assert.True(after.Achievements.Single(a => a.TitleDefId == "title_khach-quen").Earned);
    }

    [Fact]
    public async Task AWinAtMidnight_AndWithoutHints_AreCounted_ButATeamHintIsNot()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        // Past midnight in Vietnam; the room used a lead hint, so only the midnight title is earned.
        await env.AddResultAsync(user.Id, success: true, at: new DateTime(2026, 11, 2, 17, 30, 0, DateTimeKind.Utc), leadHints: 1);

        var me = await env.Progress.GetMeAsync(user.Id);

        Assert.Contains(me.Owned, owned => owned.DefId == "title_bach-nguyet");
        Assert.DoesNotContain(me.Owned, owned => owned.DefId == "title_doc-dau-vet");

        await env.AddResultAsync(user.Id, success: true, at: new DateTime(2026, 11, 3, 5, 0, 0, DateTimeKind.Utc));
        Assert.Contains((await env.Progress.GetMeAsync(user.Id)).Owned, owned => owned.DefId == "title_doc-dau-vet");
    }

    [Fact]
    public async Task ALoss_IsNotAWin()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        await env.AddResultAsync(user.Id, success: false, at: new DateTime(2026, 11, 2, 17, 30, 0, DateTimeKind.Utc));

        var me = await env.Progress.GetMeAsync(user.Id);

        Assert.DoesNotContain(me.Owned, owned => owned.DefId is "title_bach-nguyet" or "title_doc-dau-vet");
    }

    [Fact]
    public async Task CluesAndStatements_AreCountedForWhoFoundThem()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var finder = await env.AddUserAsync();
        var partner = await env.AddUserAsync();
        await env.AddRoomAsync(finder.Id, partner.Id, clues: 100, statements: 50);

        var found = await env.Progress.GetMeAsync(finder.Id);
        var other = await env.Progress.GetMeAsync(partner.Id);

        Assert.Contains(found.Owned, owned => owned.DefId == "title_mat-tinh");
        Assert.Contains(found.Owned, owned => owned.DefId == "title_ghi-chep");
        Assert.Empty(other.Owned);
        Assert.Equal(0, other.Achievements.Single(a => a.TitleDefId == "title_mat-tinh").Count);
    }

    [Fact]
    public async Task OwningTheWatch_EarnsTheKeeperTitle_AndItStaysAfterTheWatchIsSold()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        var buyer = await env.AddUserAsync();
        var watch = await env.GiveAsync(user.Id, AchievementRules.Watch217DefId);
        Assert.Contains((await env.Progress.GetMeAsync(user.Id)).Owned, owned => owned.DefId == "title_giu-gio");

        var listed = await env.Market.CreateListingAsync(user, watch, 100);
        await env.Market.BuyListingAsync(buyer, listed.Listing.ListingId);

        Assert.Contains((await env.Progress.GetMeAsync(user.Id)).Owned, owned => owned.DefId == "title_giu-gio");
    }

    [Fact]
    public async Task LockPuzzles_ShowAsNotCountable_AndNeverGrant()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();

        var me = await env.Progress.GetMeAsync(user.Id);

        var lockTitle = me.Achievements.Single(a => a.TitleDefId == "title_tho-khoa");
        Assert.False(lockTitle.Countable);
        Assert.False(lockTitle.Earned);
    }

    [Fact]
    public async Task FinishingAGame_GrantsAchievements_ThroughTheRewardHook_WithoutOpeningTheProfile()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();
        for (var i = 0; i < 9; i++) await env.AddResultAsync(user.Id, success: false);
        var last = await env.AddResultAsync(user.Id, success: true, at: new DateTime(2026, 11, 3, 5, 0, 0, DateTimeKind.Utc));
        var drops = new WeeklyDropService(env.Store, env.Market, new WeeklyService(env.Db, new LeaderboardService(env.Db)),
            new CryptoChestRandom(), Options.Create(new WeeklyChallengeSettings()), NullLogger<WeeklyDropService>.Instance);
        var hook = new MarketGameRewardHook(env.Market, env.Progress, drops, NullLogger<MarketGameRewardHook>.Instance);

        await hook.OnGameResultPersistedAsync(last);
        await hook.OnGameResultPersistedAsync(last);

        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.OwnerId == user.Id && i.DefId == "title_khach-quen"));
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.OwnerId == user.Id && i.DefId == "title_doc-dau-vet"));
    }

    // ------------------------------------------------------------------ chests

    [Theory]
    [InlineData(1, "title_long-phung")]
    [InlineData(2, "title_thien-menh")]
    public async Task OpeningAChest_CanGiveACosmetic_WithTheChestSource(int poolIndex, string defId)
    {
        if (!Enabled) return;
        // Ticket 9999 is the Mystery pool of Hòm Niêm Phong; its first entry is the watch, then the cosmetics.
        await using var env = await Env.CreateAsync(new ScriptedRandom(9999, poolIndex));
        var user = await env.AddUserAsync();
        await env.GiveAsync(user.Id, Seal);
        await env.GiveAsync(user.Id, "key_np");

        var opened = await env.Chests.OpenAsync(user, Seal, NewKey());

        Assert.Equal(defId, opened.Item.Id);
        Assert.Equal(MarketCategories.Title, opened.Item.Category);
        var item = await env.Store.Items.Find(i => i.Id == opened.ItemId).SingleAsync();
        Assert.Equal(MarketItemSources.Chest, item.Source);

        await env.Market.EquipAsync(user.Id, opened.ItemId);
        Assert.Equal(defId, (await env.Progress.GetMeAsync(user.Id)).TitleDefId);
    }

    [Fact]
    public async Task TheChestList_ShowsCuriosAndCosmetics()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();

        var list = await env.Chests.ListAsync(user.Id);

        var bank = list.Chests.Single(chest => chest.Id == "chest_nb");
        Assert.Contains(bank.Contents, def => def.Id == "frame_kimlong");
        Assert.Contains(bank.Contents, def => def.Id == "NB-1199");
        Assert.DoesNotContain(bank.Contents, def => def.Id == "frame_phuong");
    }

    // ------------------------------------------------------------------ avatars

    [Theory]
    [InlineData("nu")]
    [InlineData("kiem")]
    [InlineData("qua")]
    [InlineData("nonla")]
    public async Task APresetAvatar_IsRemembered(string avatar)
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();

        var me = await env.Progress.SetAvatarAsync(user.Id, avatar);

        Assert.Equal(avatar, me.Avatar);
        Assert.Equal(avatar, (await env.Progress.GetMeAsync(user.Id)).Avatar);
    }

    [Theory]
    [InlineData("hacker")]
    [InlineData("upload")]
    [InlineData("")]
    public async Task AnUnknownAvatar_IsRefused(string avatar)
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var user = await env.AddUserAsync();

        Assert.Equal(ProgressErrors.UnknownAvatar, Code(await Throws(() => env.Progress.SetAvatarAsync(user.Id, avatar))));
    }

    [Fact]
    public async Task AnUploadedAvatar_IsStoredAsASquare_AndTheUrlComesFromTheHost()
    {
        if (!Enabled) return;
        var storage = new FakeAvatarStorage(available: true);
        await using var env = await Env.CreateAsync(avatars: storage);
        var user = await env.AddUserAsync();
        using var image = new Image<Rgba32>(640, 360, new Rgba32(10, 20, 200));
        using var stream = new MemoryStream();
        await image.SaveAsPngAsync(stream);

        var me = await env.Progress.UploadAvatarAsync(user.Id, stream.ToArray());

        Assert.True(me.CanUploadAvatar);
        Assert.Equal("upload", me.Avatar);
        Assert.Equal(storage.Url, me.AvatarUrl);
        var stored = Image.Identify(storage.Last!);
        Assert.Equal(256, stored.Width);
        Assert.Equal(256, stored.Height);

        // Choosing a preset again drops back to it, and the upload stays available as a choice.
        var back = await env.Progress.SetAvatarAsync(user.Id, "qua");
        Assert.Equal("qua", back.Avatar);
        Assert.Equal(storage.Url, back.AvatarUrl);
        var chosen = await env.Progress.SetAvatarAsync(user.Id, "upload");
        Assert.Equal("upload", chosen.Avatar);
    }

    [Fact]
    public async Task WithoutAnImageHost_UploadsAreRefused_AndTheFlagIsOff()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync(avatars: new FakeAvatarStorage(available: false));
        var user = await env.AddUserAsync();

        Assert.False((await env.Progress.GetMeAsync(user.Id)).CanUploadAvatar);
        var error = await Throws(() => env.Progress.UploadAvatarAsync(user.Id, new byte[] { 1, 2, 3 }));
        Assert.Equal(AvatarErrors.Unavailable, Code(error));
    }

    // ------------------------------------------------------------------ lobby

    [Fact]
    public async Task TheLobbyDto_CarriesEachPlayersCosmetics_FromTheServer()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync("Chủ phòng");
        var guest = await env.AddUserAsync("Khách");
        await env.SetLevelAsync(guest.Id, 20, xp: 5);
        await env.Progress.SetAvatarAsync(guest.Id, "kiem");
        var me = await env.Progress.GetMeAsync(guest.Id);
        await env.Market.EquipAsync(guest.Id, me.Owned.Single(owned => owned.DefId == "frame_bac").ItemId);
        await env.Market.EquipAsync(guest.Id, await env.GiveAsync(guest.Id, "title_san-manh-moi"));
        await env.Market.EquipAsync(guest.Id, await env.GiveAsync(guest.Id, "entrance_anh-trang"));
        var room = await env.AddLobbyAsync(host, guest);

        var response = await env.Rooms.GetAsync(host.Id, room.Id);

        var seen = response.Players.Single(p => p.UserId == guest.Id);
        Assert.Equal(20, seen.Level);
        Assert.Equal("kiem", seen.Avatar);
        Assert.Equal("frame_bac", seen.FrameDefId);
        Assert.Equal("title_san-manh-moi", seen.TitleDefId);
        Assert.Equal("entrance_anh-trang", seen.EntranceDefId);

        var plain = response.Players.Single(p => p.UserId == host.Id);
        Assert.Equal(1, plain.Level);
        Assert.Equal(CosmeticCatalog.DefaultAvatar, plain.Avatar);
        Assert.Null(plain.FrameDefId);
        Assert.Equal(CosmeticCatalog.DefaultTitleDefId, plain.TitleDefId);
        Assert.Equal(CosmeticCatalog.DefaultEntranceDefId, plain.EntranceDefId);
    }

    [Fact]
    public async Task TheLobbyDto_IgnoresAnEquippedItemNoLongerOwned()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var frame = await env.GiveAsync(guest.Id, "frame_thach");
        await env.Market.EquipAsync(guest.Id, frame);
        await env.Store.Items.UpdateOneAsync(i => i.Id == frame, Builders<MarketItem>.Update.Set(i => i.OwnerId, host.Id));
        var room = await env.AddLobbyAsync(host, guest);

        var response = await env.Rooms.GetAsync(host.Id, room.Id);

        Assert.Null(response.Players.Single(p => p.UserId == guest.Id).FrameDefId);
    }

    [Fact]
    public async Task AnEntrance_IsAnnouncedOncePerArrival_WithTheCosmeticsOfThatPlayer()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync("Chủ phòng");
        var guest = await env.AddUserAsync("Khách");
        var effect = await env.GiveAsync(guest.Id, "entrance_kim-long");
        await env.Market.EquipAsync(guest.Id, effect);
        var room = await env.AddLobbyAsync(host, guest);

        Assert.True(await env.Entrances.AnnounceAsync(room.Id, guest.Id));
        Assert.False(await env.Entrances.AnnounceAsync(room.Id, guest.Id)); // a refresh or a reconnect plays nothing

        var entrance = Assert.Single(env.Notifier.Entrances);
        Assert.Equal(room.Id, entrance.RoomId);
        Assert.Equal(guest.Id, entrance.UserId);
        Assert.Equal("Khách", entrance.Username);
        Assert.Equal("entrance_kim-long", entrance.EntranceDefId);
    }

    [Fact]
    public async Task ParallelConnections_OfOnePlayer_AnnounceOnce()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var room = await env.AddLobbyAsync(host, guest);

        var outcomes = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => env.Entrances.AnnounceAsync(room.Id, guest.Id)));

        Assert.Single(outcomes, announced => announced);
        Assert.Single(env.Notifier.Entrances);
    }

    [Fact]
    public async Task EachPlayer_HasTheirOwnEntrance()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var room = await env.AddLobbyAsync(host, guest);

        Assert.True(await env.Entrances.AnnounceAsync(room.Id, host.Id));
        Assert.True(await env.Entrances.AnnounceAsync(room.Id, guest.Id));

        Assert.Equal(2, env.Notifier.Entrances.Count);
    }

    [Theory]
    [InlineData(RoomStatus.InProgress)]
    [InlineData(RoomStatus.Completed)]
    public async Task NoEntrance_OnceTheGameHasStarted(string status)
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var room = await env.AddLobbyAsync(host, guest, status);

        Assert.False(await env.Entrances.AnnounceAsync(room.Id, guest.Id));
        Assert.Empty(env.Notifier.Entrances);
    }

    [Fact]
    public async Task NoEntrance_ForSomeoneOutsideTheRoom()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var stranger = await env.AddUserAsync();
        var room = await env.AddLobbyAsync(host, guest);

        Assert.False(await env.Entrances.AnnounceAsync(room.Id, stranger.Id));
        Assert.Empty(env.Notifier.Entrances);
    }

    // ------------------------------------------------------------------ lobby outfits

    private const string SherlockOutfit = SkinCatalog.SherlockWhitechapel;
    private const string WatsonOutfit = SkinCatalog.WatsonWhitechapel;

    [Fact]
    public async Task TheLobbyDto_CarriesTheOutfitsEachPlayerWears()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        await env.Market.EquipAsync(guest.Id, await env.GiveAsync(guest.Id, WatsonOutfit));
        await env.Market.EquipAsync(guest.Id, await env.GiveAsync(guest.Id, SherlockOutfit));
        var room = await env.AddLobbyAsync(host, guest);

        var response = await env.Rooms.GetAsync(host.Id, room.Id);

        Assert.Equal(new[] { SherlockOutfit, WatsonOutfit }, response.Players.Single(p => p.UserId == guest.Id).SkinDefIds);
        Assert.Empty(response.Players.Single(p => p.UserId == host.Id).SkinDefIds);
    }

    [Fact]
    public async Task TheLobbyDto_LeavesOutAnOutfitThatIsForSale()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var outfit = await env.GiveAsync(guest.Id, SherlockOutfit);
        await env.Market.EquipAsync(guest.Id, outfit);
        await env.Store.Items.UpdateOneAsync(i => i.Id == outfit, Builders<MarketItem>.Update.Set(i => i.LockedBy, "listing:x"));
        var room = await env.AddLobbyAsync(host, guest);

        var response = await env.Rooms.GetAsync(host.Id, room.Id);

        Assert.Empty(response.Players.Single(p => p.UserId == guest.Id).SkinDefIds);
    }

    [Fact]
    public async Task WearingAnOutfitInTheLobby_PutsItOnAndTellsTheRoom()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var outfit = await env.GiveAsync(guest.Id, SherlockOutfit);
        var room = await env.AddLobbyAsync(host, guest);
        await env.Rooms.SelectRoleAsync(guest, room.Id, PlayerRole.Interrogator);
        await env.Rooms.SetReadyAsync(guest, room.Id, true);

        var response = await env.Outfits.WearAsync(guest, room.Id, MarketCategories.SkinSherlock, outfit);

        var seen = response.Players.Single(p => p.UserId == guest.Id);
        Assert.Equal(new[] { SherlockOutfit }, seen.SkinDefIds);
        Assert.True(seen.IsReady); // a change of clothes keeps the player ready
        var equipped = await env.Market.GetEquippedAsync(guest.Id);
        Assert.Contains(equipped, e => e.Category == MarketCategories.SkinSherlock && e.ItemId == outfit);
        var told = env.Notifier.RoleUpdates.Last();
        Assert.Equal(room.Id, told.RoomId);
        Assert.Equal(guest.Id, told.UserId);
        Assert.Equal(new[] { SherlockOutfit }, told.Room.Players.Single(p => p.UserId == guest.Id).SkinDefIds);
    }

    [Fact]
    public async Task WearingNothing_GoesBackToTheNormalLook()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        await env.Market.EquipAsync(guest.Id, await env.GiveAsync(guest.Id, SherlockOutfit));
        await env.Market.EquipAsync(guest.Id, await env.GiveAsync(guest.Id, WatsonOutfit));
        var room = await env.AddLobbyAsync(host, guest);

        var response = await env.Outfits.WearAsync(guest, room.Id, MarketCategories.SkinSherlock, null);

        Assert.Equal(new[] { WatsonOutfit }, response.Players.Single(p => p.UserId == guest.Id).SkinDefIds);
        Assert.DoesNotContain(await env.Market.GetEquippedAsync(guest.Id), e => e.Category == MarketCategories.SkinSherlock);
        Assert.Single(env.Notifier.RoleUpdates);
    }

    [Fact]
    public async Task AnItemThatIsNotThisDetectivesOutfit_IsRefused()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var watson = await env.GiveAsync(guest.Id, WatsonOutfit);
        var frame = await env.GiveAsync(guest.Id, "frame_thach");
        var room = await env.AddLobbyAsync(host, guest);

        var wrongDetective = await Throws(() => env.Outfits.WearAsync(guest, room.Id, MarketCategories.SkinSherlock, watson));
        var notAnOutfit = await Throws(() => env.Outfits.WearAsync(guest, room.Id, MarketCategories.SkinSherlock, frame));
        var notAnOutfitSlot = await Throws(() => env.Outfits.WearAsync(guest, room.Id, MarketCategories.Frame, frame));

        Assert.Equal(409, wrongDetective.StatusCode);
        Assert.Equal(LobbyOutfitService.WrongOutfitCode, Code(wrongDetective));
        Assert.Equal(409, notAnOutfit.StatusCode);
        Assert.Equal(400, notAnOutfitSlot.StatusCode);
        Assert.Empty(await env.Market.GetEquippedAsync(guest.Id));
        Assert.Empty(env.Notifier.RoleUpdates);
    }

    [Fact]
    public async Task SomeoneElsesOutfit_IsRefused()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var hostsOutfit = await env.GiveAsync(host.Id, SherlockOutfit);
        var room = await env.AddLobbyAsync(host, guest);

        var error = await Throws(() => env.Outfits.WearAsync(guest, room.Id, MarketCategories.SkinSherlock, hostsOutfit));

        Assert.Equal(404, error.StatusCode);
        Assert.Empty(await env.Market.GetEquippedAsync(guest.Id));
        Assert.Empty(await env.Market.GetEquippedAsync(host.Id));
    }

    [Fact]
    public async Task AnOutfitForSale_CannotBeWorn()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var outfit = await env.GiveAsync(guest.Id, SherlockOutfit);
        await env.Store.Items.UpdateOneAsync(i => i.Id == outfit, Builders<MarketItem>.Update.Set(i => i.LockedBy, "listing:x"));
        var room = await env.AddLobbyAsync(host, guest);

        var error = await Throws(() => env.Outfits.WearAsync(guest, room.Id, MarketCategories.SkinSherlock, outfit));

        Assert.Equal(409, error.StatusCode);
        Assert.Equal(MarketErrors.ItemLocked, Code(error));
        Assert.Empty(env.Notifier.RoleUpdates);
    }

    [Fact]
    public async Task SomeoneOutsideTheRoom_CannotChangeOutfitThere()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var stranger = await env.AddUserAsync();
        var outfit = await env.GiveAsync(stranger.Id, SherlockOutfit);
        var room = await env.AddLobbyAsync(host, guest);

        var error = await Throws(() => env.Outfits.WearAsync(stranger, room.Id, MarketCategories.SkinSherlock, outfit));

        Assert.Equal(403, error.StatusCode);
        Assert.Empty(await env.Market.GetEquippedAsync(stranger.Id));
        Assert.Empty(env.Notifier.RoleUpdates);
    }

    [Theory]
    [InlineData(RoomStatus.InProgress, null)]
    [InlineData(RoomStatus.Completed, RoomService.RoomEndedCode)]
    [InlineData(RoomStatus.Abandoned, RoomService.RoomEndedCode)]
    public async Task OnceTheGameHasStarted_TheOutfitStaysAsItWas(string status, string? code)
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var outfit = await env.GiveAsync(guest.Id, SherlockOutfit);
        var room = await env.AddLobbyAsync(host, guest, status);

        var error = await Throws(() => env.Outfits.WearAsync(guest, room.Id, MarketCategories.SkinSherlock, outfit));

        Assert.Equal(409, error.StatusCode);
        Assert.Equal(code, Code(error)); // ROOM_ENDED lets the lobby show its closed-room page, as every other lobby action does
        Assert.Empty(await env.Market.GetEquippedAsync(guest.Id));
        Assert.Empty(env.Notifier.RoleUpdates);
    }

    [Fact]
    public async Task ARoomWhereBothAreReady_StillTakesAChangeOfClothes()
    {
        if (!Enabled) return;
        await using var env = await Env.CreateAsync();
        var host = await env.AddUserAsync();
        var guest = await env.AddUserAsync();
        var outfit = await env.GiveAsync(guest.Id, WatsonOutfit);
        var room = await env.AddLobbyAsync(host, guest, RoomStatus.Ready);

        var response = await env.Outfits.WearAsync(guest, room.Id, MarketCategories.SkinWatson, outfit);

        Assert.Equal(new[] { WatsonOutfit }, response.Players.Single(p => p.UserId == guest.Id).SkinDefIds);
        Assert.Equal(RoomStatus.Ready, response.Status);
    }

    // ------------------------------------------------------------------ helpers

    private static string? Code(ApiException exception) => (exception.Errors as ApiErrorDetails)?.Code;

    private static async Task<ApiException> Throws(Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (ApiException exception)
        {
            return exception;
        }
        throw new Xunit.Sdk.XunitException("Expected an ApiException.");
    }

    /// <summary>The error code of a failed attempt, or null when it succeeded.</summary>
    private static async Task<string?> Attempt(Func<Task> action)
    {
        try
        {
            await action();
            return null;
        }
        catch (ApiException exception)
        {
            return Code(exception);
        }
    }

    private sealed class ScriptedRandom : IChestRandom
    {
        private readonly Queue<int> _values;
        public ScriptedRandom(params int[] values) => _values = new Queue<int>(values);
        public int NextInt(int exclusiveMax) => _values.Count > 0 ? _values.Dequeue() : 0;
    }

    private sealed class FakeAvatarStorage : IAvatarStorage
    {
        public FakeAvatarStorage(bool available) => IsAvailable = available;
        public bool IsAvailable { get; }
        public string Url { get; } = "https://res.cloudinary.com/test/image/upload/v1/avatars/a.webp";
        public byte[]? Last { get; private set; }

        public Task<string> UploadAsync(string userId, byte[] webp, CancellationToken ct = default)
        {
            Last = webp;
            return Task.FromResult(Url);
        }
    }

    private sealed class RecordingNotifier : IGameNotifier
    {
        private readonly System.Collections.Concurrent.ConcurrentQueue<PlayerEntranceDto> _entrances = new();
        public IReadOnlyList<PlayerEntranceDto> Entrances => _entrances.ToList();
        private readonly System.Collections.Concurrent.ConcurrentQueue<(string RoomId, string UserId, RoomResponse Room)> _roles = new();
        public IReadOnlyList<(string RoomId, string UserId, RoomResponse Room)> RoleUpdates => _roles.ToList();

        public Task PlayerEntrance(string roomId, PlayerEntranceDto entrance)
        {
            _entrances.Enqueue(entrance);
            return Task.CompletedTask;
        }

        public Task PlayerJoined(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task PlayerLeft(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task RolesUpdated(string roomId, string userId, RoomResponse room)
        {
            _roles.Enqueue((roomId, userId, room));
            return Task.CompletedTask;
        }
        public Task ReadyUpdated(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task GameStarted(string roomId, RoomResponse room) => Task.CompletedTask;
        public Task GameStateUpdated(string roomId, long version) => Task.CompletedTask;
        public Task ItemFound(string roomId, string itemId, string userId, long version) => Task.CompletedTask;
        public Task ClueUnlocked(string roomId, string clueId, string? sourceId, string userId, long version) => Task.CompletedTask;
        public Task DialogueAnswered(string roomId, string dialogueId, string userId, long version) => Task.CompletedTask;
        public Task EvidencePresented(string roomId, string dialogueId, string evidenceId, string userId, long version) => Task.CompletedTask;
        public Task InvestigationUpdate(string roomId, SirLocked.Api.DTOs.Investigation.InvestigationUpdateDto update) => Task.CompletedTask;
        public Task SceneChanged(string roomId, string previousSceneId, string currentSceneId, string userId, long version) => Task.CompletedTask;
        public Task StageChanged(string roomId, string previousStageId, string currentStageId, string previousSceneId, string currentSceneId, bool isFinalStageCompleted, string userId, long version) => Task.CompletedTask;
        public Task GameCompleted(string roomId, SirLocked.Api.DTOs.Submission.GameResultResponse result) => Task.CompletedTask;
        public Task SystemMessage(string roomId, string message) => Task.CompletedTask;
    }

    private sealed class Env : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private Env(MongoDbSettings settings, IChestRandom random, IAvatarStorage? avatars)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db);
            Market = new MarketService(Store, NullLogger<MarketService>.Instance);
            Chests = new ChestService(Store, Market, random, Options.Create(new ChestSettings()), NullLogger<ChestService>.Instance);
            Progress = new ProgressService(Store, Market, NullLogger<ProgressService>.Instance, avatars);
            Notifier = new RecordingNotifier();
            Rooms = new RoomService(Db, new StubCases(), Notifier, cosmetics: Progress);
            Entrances = new LobbyEntranceService(Db, Progress, Notifier);
            Outfits = new LobbyOutfitService(Store, Market, Rooms, Notifier);
        }

        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public MarketService Market { get; }
        public ChestService Chests { get; }
        public ProgressService Progress { get; }
        public RecordingNotifier Notifier { get; }
        public RoomService Rooms { get; }
        public LobbyEntranceService Entrances { get; }
        public LobbyOutfitService Outfits { get; }

        public static async Task<Env> CreateAsync(IChestRandom? random = null, IAvatarStorage? avatars = null)
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_progress_{Guid.NewGuid():N}"
            };
            if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
                || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                    server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
                throw new InvalidOperationException("Progress integration tests need a loopback MongoDB and a temporary database.");
            var env = new Env(settings, random ?? new ScriptedRandom(), avatars);
            await env.Db.PingAsync();
            await env.Store.EnsureIndexesAsync();
            return env;
        }

        public async Task<CurrentUser> AddUserAsync(string name = "Thám tử", bool verified = true)
        {
            var user = new User
            {
                Id = ObjectId.GenerateNewId().ToString(),
                FullName = name,
                Email = $"{Guid.NewGuid():N}@tests.invalid",
                Status = UserStatus.Active,
                IsEmailVerified = verified
            };
            await Db.Users.InsertOneAsync(user);
            await Market.EnsureAccountAsync(user.Id);
            return new CurrentUser(user.Id, name, UserRole.Player);
        }

        /// <summary>One item in the bag, as an operator grant would create it, taking a slot.</summary>
        public async Task<string> GiveAsync(string userId, string defId)
        {
            var existing = (await Store.Items.Find(i => i.OwnerId == userId).Project(i => i.Id).ToListAsync()).ToHashSet();
            await Market.AdminGrantAsync(userId, defId, 0);
            var fresh = await Store.Items.Find(i => i.OwnerId == userId && i.DefId == defId).Project(i => i.Id).ToListAsync();
            return fresh.Single(id => !existing.Contains(id));
        }

        /// <summary>An item the way a level or achievement grant creates it: no bag slot, not for sale.</summary>
        public async Task<string> GiveEarnedAsync(string userId, string defId)
        {
            var item = new MarketItem
            {
                Id = MarketStore.NewId(),
                OwnerId = userId,
                DefId = defId,
                Source = MarketItemSources.Level,
                AcquiredAt = DateTime.UtcNow
            };
            await Store.Items.InsertOneAsync(item);
            return item.Id;
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

        public XpExchange NewExchange(string userId, IReadOnlyList<string> itemIds, long xp)
        {
            var at = Store.Now.AddMinutes(-1);
            return new XpExchange
            {
                Id = $"{userId}:{Guid.NewGuid():N}",
                UserId = userId,
                ItemIds = itemIds.ToList(),
                Xp = xp,
                State = ChestOpeningStates.Pending,
                CreatedAt = at,
                UpdatedAt = at
            };
        }

        /// <summary>A request that lost a race can answer while the winner is still writing; wait for every journal to end.</summary>
        public async Task SettleAsync()
        {
            for (var i = 0; i < 100; i++)
            {
                var open = await Store.XpExchanges.CountDocumentsAsync(e => e.State == ChestOpeningStates.Pending || e.State == ChestOpeningStates.RollingBack);
                if (open == 0) return;
                await Task.Delay(50);
            }
            throw new Xunit.Sdk.XunitException("An exchange never finished.");
        }

        public async Task AssertUntouchedAsync(string userId, string itemId)
        {
            var item = await Store.Items.Find(i => i.Id == itemId).SingleAsync();
            Assert.Equal(userId, item.OwnerId);
            Assert.Null(item.LockedBy);
            var me = await Progress.GetMeAsync(userId);
            Assert.True(me.Xp == 0, $"expected no XP, found {me.Xp}");
        }

        public async Task<GameResult> AddResultAsync(string userId, bool success, DateTime? at = null, int leadHints = 0)
        {
            var roomId = ObjectId.GenerateNewId().ToString();
            await Db.Rooms.InsertOneAsync(new GameRoom
            {
                Id = roomId,
                RoomCode = roomId[^6..].ToUpperInvariant(),
                CaseId = "case",
                HostUserId = userId,
                Status = RoomStatus.Completed,
                Players = new List<RoomPlayer> { new() { UserId = userId, Username = "x" } },
                GameplayState = new GameplayState { LeadHintCount = leadHints }
            });
            var result = new GameResult
            {
                Id = ObjectId.GenerateNewId().ToString(),
                RoomId = roomId,
                CaseId = "case",
                Players = new List<string> { userId },
                Success = success,
                CreatedAt = at ?? new DateTime(2026, 11, 3, 5, 0, 0, DateTimeKind.Utc)
            };
            await Db.GameResults.InsertOneAsync(result);
            return result;
        }

        public async Task AddRoomAsync(string finderId, string partnerId, int clues, int statements)
        {
            var roomId = ObjectId.GenerateNewId().ToString();
            await Db.Rooms.InsertOneAsync(new GameRoom
            {
                Id = roomId,
                RoomCode = roomId[^6..].ToUpperInvariant(),
                CaseId = "case",
                HostUserId = finderId,
                Status = RoomStatus.Completed,
                Players = new List<RoomPlayer> { new() { UserId = finderId, Username = "x" }, new() { UserId = partnerId, Username = "y" } },
                GameplayState = new GameplayState
                {
                    ClueDiscoveries = Enumerable.Range(0, clues).Select(i => new ClueDiscoveryRecord { ClueId = $"c{i}", DiscoveredByUserId = finderId }).ToList(),
                    TestimonyDiscoveries = Enumerable.Range(0, statements).Select(i => new TestimonyDiscoveryRecord { TestimonyFragmentId = $"t{i}", DiscoveredByUserId = finderId }).ToList(),
                }
            });
        }

        public async Task<GameRoom> AddLobbyAsync(CurrentUser host, CurrentUser guest, string status = RoomStatus.Waiting)
        {
            var roomId = ObjectId.GenerateNewId().ToString();
            var room = new GameRoom
            {
                Id = roomId,
                RoomCode = roomId[^6..].ToUpperInvariant(),
                CaseId = "case",
                HostUserId = host.Id,
                Status = status,
                Players = new List<RoomPlayer>
                {
                    new() { UserId = host.Id, Username = host.FullName },
                    new() { UserId = guest.Id, Username = guest.FullName }
                }
            };
            await Db.Rooms.InsertOneAsync(room);
            return room;
        }

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }

    private sealed class StubCases : ICaseService
    {
        private static readonly GameCase Case = new() { CaseId = "case", Title = "Vụ án thử" };
        public Task<GameCase> GetCaseAsync(string caseId) => Task.FromResult(Case);
        public Task<GameCase?> FindCaseAsync(string caseId) => Task.FromResult<GameCase?>(Case);
        public Task<List<SirLocked.Api.DTOs.Case.CaseSummaryResponse>> GetPublishedAsync() => throw new NotSupportedException();
        public Task<SirLocked.Api.DTOs.Case.CasePublicDetailResponse> GetPublicDetailAsync(string caseId) => throw new NotSupportedException();
        public Task<List<SirLocked.Api.DTOs.Case.CaseSummaryResponse>> GetAllForAdminAsync() => throw new NotSupportedException();
        public SirLocked.Api.DTOs.Case.CaseValidationResponse ValidateJson(System.Text.Json.JsonElement caseJson) => throw new NotSupportedException();
        public Task<SirLocked.Api.DTOs.Case.CaseSummaryResponse> ImportJsonAsync(System.Text.Json.JsonElement caseJson, bool overwrite, bool preserveServerMetadata = false) => throw new NotSupportedException();
        public Task<SirLocked.Api.DTOs.Case.CaseSummaryResponse> PublishAsync(string caseId) => throw new NotSupportedException();
        public Task<SirLocked.Api.DTOs.Case.CaseSummaryResponse> UnpublishAsync(string caseId) => throw new NotSupportedException();
        public Task<SirLocked.Api.DTOs.Case.CaseSummaryResponse> SeedSampleAsync(bool publish) => throw new NotSupportedException();
        public Task<List<SirLocked.Api.DTOs.Case.CaseSummaryResponse>> SeedDemoAsync() => throw new NotSupportedException();
        public Task<List<SirLocked.Api.DTOs.Case.CaseSummaryResponse>> SeedCrackDemoAsync() => throw new NotSupportedException();
        public Task<List<SirLocked.Api.DTOs.Case.CaseSummaryResponse>> SeedPointClickDemoAsync() => throw new NotSupportedException();
        public Task<List<SirLocked.Api.DTOs.Case.CaseSummaryResponse>> SeedPixelDemoAsync() => throw new NotSupportedException();
        public GameCase ParseCase(System.Text.Json.JsonElement caseJson) => throw new NotSupportedException();
        public GameCase ParseCase(string caseJson) => throw new NotSupportedException();
    }
}
