using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// Mở hòm against a real (standalone) MongoDB: the result is decided by the server and stored before
/// anything is spent, retries return it unchanged, parallel opens can never spend one key twice and an
/// interrupted opening is finished by the recovery sweep. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoChestTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_MONGO_IT";
    private const string Seal = "chest_np";
    private const string SealKey = "key_np";

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable(RunEnvironmentVariable), "true", StringComparison.OrdinalIgnoreCase);

    private static string NewKey() => Guid.NewGuid().ToString();

    // ------------------------------------------------------------------ opening

    [Fact]
    public async Task Open_SpendsOneChestAndOneKey_AndGivesTheItemTheServerRolled()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync(new ScriptedRandom(9999, 0));
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 2, 2);
        Assert.Equal(7, (await env.Market.GetWalletAsync(user.Id)).SlotsUsed);

        var result = await env.Chests.OpenAsync(user, Seal, NewKey());

        // Ticket 9999 is the Mystery pool of Hòm Niêm Phong: Đồng hồ 2:17.
        Assert.Equal("VC-0217", result.Item.Id);
        Assert.Equal(MarketRarities.Mystery, result.Item.Rarity);
        Assert.Equal(Seal, result.ChestId);
        Assert.Equal(1, result.ChestCount);
        Assert.Equal(1, result.KeyCount);
        Assert.Equal(6, result.Wallet.SlotsUsed);
        Assert.Equal(6, result.Wallet.ItemCount);

        var reward = await env.Store.Items.Find(i => i.Id == result.ItemId).FirstAsync();
        Assert.Equal(user.Id, reward.OwnerId);
        Assert.Equal("VC-0217", reward.DefId);
        Assert.Equal(MarketItemSources.Chest, reward.Source);
        Assert.Null(reward.LockedBy);
        var opening = await env.Store.ChestOpenings.Find(o => o.UserId == user.Id).SingleAsync();
        Assert.Equal(ChestOpeningStates.Done, opening.State);
        Assert.Equal("VC-0217", opening.RewardDefId);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Open_WithTheSameKey_ReturnsTheSameResult_AndSpendsNothingMore()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync(new CryptoChestRandom());
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 3, 3);
        var key = NewKey();

        var first = await env.Chests.OpenAsync(user, Seal, key);
        var again = await env.Chests.OpenAsync(user, Seal, key);
        var third = await env.Chests.OpenAsync(user, Seal, key);

        Assert.Equal(first.ItemId, again.ItemId);
        Assert.Equal(first.Item.Id, again.Item.Id);
        Assert.Equal(first.ItemId, third.ItemId);
        Assert.Equal(2, third.ChestCount);
        Assert.Equal(2, third.KeyCount);
        Assert.Equal(1, (int)await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Chest));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Open_WithoutAKey_FailsWithKeyNone_AndSpendsNothing()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 0);

        var error = await Throws(() => env.Chests.OpenAsync(user, Seal, NewKey()));

        Assert.Equal(ChestErrors.KeyNone, Code(error));
        Assert.Equal(409, error.StatusCode);
        var list = await env.Chests.ListAsync(user.Id);
        Assert.Equal(1, list.Chests.Single(c => c.Id == Seal).ChestCount);
        Assert.Equal(0, await env.Store.ChestOpenings.CountDocumentsAsync(FilterDefinition<ChestOpening>.Empty));
    }

    [Fact]
    public async Task Open_WithoutAChest_FailsWithChestNone_AndSpendsNothing()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 0, 1);

        var error = await Throws(() => env.Chests.OpenAsync(user, Seal, NewKey()));

        Assert.Equal(ChestErrors.ChestNone, Code(error));
        Assert.Equal(1, (await env.Chests.ListAsync(user.Id)).Chests.Single(c => c.Id == Seal).KeyCount);
    }

    [Fact]
    public async Task AKeyOfAnotherChestType_DoesNotOpenThisChest()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 0);
        await env.GrantAsync(user.Id, "chest_nb", 0, 1);

        Assert.Equal(ChestErrors.KeyNone, Code(await Throws(() => env.Chests.OpenAsync(user, Seal, NewKey()))));
    }

    [Fact]
    public async Task Open_WithAFullBag_StillWorks_BecauseItFreesASlot()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 5, 4);
        Assert.Equal(MarketRules.InventorySlots, (await env.Market.GetWalletAsync(user.Id)).SlotsUsed);

        var result = await env.Chests.OpenAsync(user, Seal, NewKey());

        Assert.Equal(MarketRules.InventorySlots - 1, result.Wallet.SlotsUsed);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task ParallelOpens_WithOneKey_ExactlyOneSucceeds()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync(new CryptoChestRandom());
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 6, 1);

        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(async () =>
        {
            try { await env.Chests.OpenAsync(user, Seal, NewKey()); return (string?)null; }
            catch (ApiException exception) { return Code(exception); }
        })));

        Assert.Single(results, code => code is null);
        Assert.All(results.Where(code => code is not null), code => Assert.Equal(ChestErrors.KeyNone, code));
        var list = (await env.Chests.ListAsync(user.Id)).Chests.Single(c => c.Id == Seal);
        Assert.Equal(5, list.ChestCount);
        Assert.Equal(0, list.KeyCount);
        Assert.Equal(1, (int)await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Chest));
        Assert.Equal(0, (int)await env.Store.Items.CountDocumentsAsync(i => i.LockedBy != null));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task ParallelOpens_WithTheSameIdempotencyKey_SpendOnce()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync(new CryptoChestRandom());
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 3, 3);
        var key = NewKey();

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(async () =>
        {
            try { return (Code: (string?)null, ItemId: (await env.Chests.OpenAsync(user, Seal, key)).ItemId); }
            catch (ApiException exception) { return (Code: Code(exception), ItemId: (string?)null); }
        })));

        Assert.Single(results.Where(r => r.ItemId is not null).Select(r => r.ItemId).Distinct());
        Assert.All(results.Where(r => r.Code is not null), r => Assert.Equal(ChestErrors.InProgress, r.Code));
        var list = (await env.Chests.ListAsync(user.Id)).Chests.Single(c => c.Id == Seal);
        Assert.Equal(2, list.ChestCount);
        Assert.Equal(2, list.KeyCount);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task ChestOrKey_ListedOnTheMarket_CannotBeUsedToOpen()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);
        var inventory = (await env.Market.GetInventoryAsync(user.Id)).Items;

        var chestItem = inventory.Single(i => i.Def.Id == Seal);
        var listed = await env.Market.CreateListingAsync(user, chestItem.ItemId, 200);
        Assert.Equal(ChestErrors.ChestNone, Code(await Throws(() => env.Chests.OpenAsync(user, Seal, NewKey()))));
        Assert.Equal(0, (await env.Chests.ListAsync(user.Id)).Chests.Single(c => c.Id == Seal).ChestCount);
        await env.Market.CancelListingAsync(user.Id, listed.Listing.ListingId);

        var keyItem = inventory.Single(i => i.Def.Id == SealKey);
        await env.Market.CreateListingAsync(user, keyItem.ItemId, 200);
        Assert.Equal(ChestErrors.KeyNone, Code(await Throws(() => env.Chests.OpenAsync(user, Seal, NewKey()))));

        // The failed attempts left the listed key exactly as it was, and freed the chest again.
        var freshKey = await env.Store.Items.Find(i => i.Id == keyItem.ItemId).FirstAsync();
        Assert.StartsWith(MarketService.ListingLockPrefix, freshKey.LockedBy);
        Assert.Null((await env.Store.Items.Find(i => i.Id == chestItem.ItemId).FirstAsync()).LockedBy);
    }

    [Fact]
    public async Task ARaceLostAfterTheOpeningWasRecorded_ReleasesTheChest_AndAnsweringAgainGivesTheSameError()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 0);
        var opening = env.NewOpening(user.Id, "VC-0388", DateTime.UtcNow);
        await env.Store.ChestOpenings.InsertOneAsync(opening);

        await env.Chests.AdvanceOpeningAsync(opening, CancellationToken.None);

        var stored = await env.Store.ChestOpenings.Find(o => o.Id == opening.Id).FirstAsync();
        Assert.Equal(ChestOpeningStates.Failed, stored.State);
        Assert.Equal(ChestErrors.KeyNone, stored.Error);
        Assert.Equal(0, (int)await env.Store.Items.CountDocumentsAsync(i => i.LockedBy != null));
        var replay = await Throws(() => env.Chests.OpenAsync(user, Seal, ChestEnv.RequestPart(opening.Id)));
        Assert.Equal(ChestErrors.KeyNone, Code(replay));
    }

    [Fact]
    public async Task AKeyReusedForADifferentChest_IsRejected()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);
        await env.GrantAsync(user.Id, "chest_nb", 1, 1);
        var key = NewKey();
        await env.Chests.OpenAsync(user, Seal, key);

        var error = await Throws(() => env.Chests.OpenAsync(user, "chest_nb", key));

        Assert.Equal(MarketErrors.InvalidRequestId, Code(error));
        Assert.Equal(1, (await env.Chests.ListAsync(user.Id)).Chests.Single(c => c.Id == "chest_nb").ChestCount);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("short")]
    [InlineData("has spaces in it!")]
    public async Task Open_NeedsAWellFormedIdempotencyKey(string? key)
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);

        var error = await Throws(() => env.Chests.OpenAsync(user, Seal, key));

        Assert.Equal(400, error.StatusCode);
        Assert.Equal(MarketErrors.InvalidRequestId, Code(error));
    }

    [Fact]
    public async Task UnknownChest_IsNotFound()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        var error = await Throws(() => env.Chests.OpenAsync(user, "chest_nope", NewKey()));
        Assert.Equal(404, error.StatusCode);
    }

    [Fact]
    public async Task UnverifiedDetectives_CannotBuyOrOpen()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Chưa xác minh", verified: false);
        await env.GrantAsync(user.Id, Seal, 1, 1);

        Assert.Equal(MarketErrors.EmailNotVerified, Code(await Throws(() => env.Chests.OpenAsync(user, Seal, NewKey()))));
        Assert.Equal(MarketErrors.EmailNotVerified, Code(await Throws(() => env.Chests.BuyKeyAsync(user, Seal, NewKey()))));
    }

    // ------------------------------------------------------------------ the rolled item on the market

    [Fact]
    public async Task TheRewardBehavesLikeAnyOtherItem_ItCanBeListedAndBought_ButNotEquipped()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync(new ScriptedRandom(0, 0));
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        await env.GrantAsync(seller.Id, Seal, 1, 1);
        var opened = await env.Chests.OpenAsync(seller, Seal, NewKey());

        var view = (await env.Market.GetInventoryAsync(seller.Id)).Items.Single(i => i.ItemId == opened.ItemId);
        Assert.Equal(MarketItemSources.Chest, view.Source);
        Assert.Equal(MarketCategories.Curio, view.Def.Category);
        Assert.False(string.IsNullOrEmpty(view.Def.IconKey));
        Assert.Equal(MarketErrors.NotEquippable, Code(await Throws(() => env.Market.EquipAsync(seller.Id, opened.ItemId))));

        var listed = await env.Market.CreateListingAsync(seller, opened.ItemId, 100);
        var purchase = await env.Market.BuyListingAsync(buyer, listed.Listing.ListingId);

        Assert.Equal(opened.Item.Id, purchase.Sale.Def.Id);
        Assert.Equal(buyer.Id, (await env.Store.Items.Find(i => i.Id == opened.ItemId).FirstAsync()).OwnerId);
        var browse = await env.Market.BrowseAsync(null, MarketCategories.Curio, new[] { MarketRarities.Mystery }, "rarity");
        Assert.Equal(3, browse.Rows.Count);
        Assert.Equal(3, browse.CategoryCounts[MarketCategories.Curio]);
    }

    [Fact]
    public async Task ChestsAndKeys_CanBeListedAndBoughtOnTheMarket_ThenOpenedByTheBuyer()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        await env.GrantAsync(seller.Id, Seal, 1, 1);
        foreach (var item in (await env.Market.GetInventoryAsync(seller.Id)).Items.Where(i => i.Def.Id is Seal or SealKey))
        {
            var listed = await env.Market.CreateListingAsync(seller, item.ItemId, 50);
            await env.Market.BuyListingAsync(buyer, listed.Listing.ListingId);
        }

        var opened = await env.Chests.OpenAsync(buyer, Seal, NewKey());

        Assert.Equal(buyer.Id, (await env.Store.Items.Find(i => i.Id == opened.ItemId).FirstAsync()).OwnerId);
    }

    // ------------------------------------------------------------------ buying

    [Fact]
    public async Task BuyKey_ChargesTheConfiguredPrice_AndGivesOneKey()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        var price = new ChestSettings().PriceOf(Seal);

        var result = await env.Chests.BuyKeyAsync(user, Seal, NewKey());

        Assert.Equal(MarketRules.StarterCoins - price.Key, result.Wallet.Balance);
        Assert.Equal(1, result.KeyCount);
        Assert.Equal(0, result.ChestCount);
        Assert.Equal(SealKey, (await env.Store.Items.Find(i => i.Id == result.ItemId).FirstAsync()).DefId);
        Assert.Equal(MarketItemSources.Shop, (await env.Store.Items.Find(i => i.Id == result.ItemId).FirstAsync()).Source);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task BuyChest_ChargesTheConfiguredPrice_AndGivesOneChest()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        var price = new ChestSettings().PriceOf(Seal);

        var result = await env.Chests.BuyChestAsync(user, Seal, NewKey());

        Assert.Equal(MarketRules.StarterCoins - price.Chest, result.Wallet.Balance);
        Assert.Equal(1, result.ChestCount);
        Assert.Equal(0, result.KeyCount);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task BuyKey_WithoutEnoughCoins_FailsWithFunds_AndChangesNothing()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Market.EnsureAccountAsync(user.Id);
        await env.Store.Accounts.UpdateOneAsync(a => a.Id == user.Id, Builders<MarketAccount>.Update.Set(a => a.Balance, 5L));

        var error = await Throws(() => env.Chests.BuyKeyAsync(user, Seal, NewKey()));

        Assert.Equal(ChestErrors.Funds, Code(error));
        var wallet = await env.Market.GetWalletAsync(user.Id);
        Assert.Equal(5L, wallet.Balance);
        Assert.Equal(3, wallet.SlotsUsed);
        Assert.Equal(0, await env.Store.ChestPurchases.CountDocumentsAsync(FilterDefinition<ChestPurchase>.Empty));
    }

    [Fact]
    public async Task ParallelPurchases_NeverOverspend()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        var price = new ChestSettings().PriceOf(Seal).Key;
        var affordable = (int)(MarketRules.StarterCoins / price);

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(async () =>
        {
            try { await env.Chests.BuyKeyAsync(user, Seal, NewKey()); return (string?)null; }
            catch (ApiException exception) { return Code(exception); }
        })));

        Assert.Equal(affordable, results.Count(code => code is null));
        Assert.All(results.Where(code => code is not null), code => Assert.Equal(ChestErrors.Funds, code));
        var wallet = await env.Market.GetWalletAsync(user.Id);
        Assert.Equal(MarketRules.StarterCoins - affordable * price, wallet.Balance);
        Assert.True(wallet.Balance >= 0);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task BuyKey_WithAFullBag_FailsWithSlotsFull_AndKeepsTheCoins()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 5, 4);

        var error = await Throws(() => env.Chests.BuyKeyAsync(user, Seal, NewKey()));

        Assert.Equal(ChestErrors.SlotsFull, Code(error));
        Assert.Equal(MarketRules.StarterCoins, (await env.Market.GetWalletAsync(user.Id)).Balance);
    }

    [Fact]
    public async Task BuyKey_RetriedWithTheSameKey_ChargesOnce_EvenInParallel()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        var price = new ChestSettings().PriceOf(Seal).Key;
        var key = NewKey();

        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(async () =>
        {
            try { return (Code: (string?)null, ItemId: (await env.Chests.BuyKeyAsync(user, Seal, key)).ItemId); }
            catch (ApiException exception) { return (Code: Code(exception), ItemId: (string?)null); }
        })));
        var final = await env.Chests.BuyKeyAsync(user, Seal, key);

        Assert.All(results.Where(r => r.Code is not null), r => Assert.Equal(ChestErrors.InProgress, r.Code));
        Assert.All(results.Where(r => r.ItemId is not null), r => Assert.Equal(final.ItemId, r.ItemId));
        Assert.Equal(MarketRules.StarterCoins - price, final.Wallet.Balance);
        Assert.Equal(1, final.KeyCount);
        await env.AssertSlotsMatchItemsAsync();
    }

    // ------------------------------------------------------------------ recovery

    [Fact]
    public async Task Recovery_FinishesAnOpeningThatDiedBeforeTakingAnything_WithTheStoredResult()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);
        var opening = env.NewOpening(user.Id, "VC-0430", DateTime.UtcNow.AddMinutes(-2));
        await env.Store.ChestOpenings.InsertOneAsync(opening);

        var report = await env.Chests.RecoverAsync(TimeSpan.FromSeconds(30));

        Assert.Equal(1, report.Openings);
        var stored = await env.Store.ChestOpenings.Find(o => o.Id == opening.Id).FirstAsync();
        Assert.Equal(ChestOpeningStates.Done, stored.State);
        Assert.Equal("VC-0430", (await env.Store.Items.Find(i => i.Id == opening.RewardItemId).FirstAsync()).DefId);
        var list = (await env.Chests.ListAsync(user.Id)).Chests.Single(c => c.Id == Seal);
        Assert.Equal(0, list.ChestCount);
        Assert.Equal(0, list.KeyCount);
        await env.AssertSlotsMatchItemsAsync();

        var replay = await env.Chests.OpenAsync(user, Seal, ChestEnv.RequestPart(opening.Id));
        Assert.Equal(opening.RewardItemId, replay.ItemId);
    }

    [Fact]
    public async Task Recovery_FinishesAnOpeningThatDiedHoldingOnlyTheChestLock()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 2, 1);
        var opening = env.NewOpening(user.Id, "VC-0388", DateTime.UtcNow.AddMinutes(-2));
        await env.Store.ChestOpenings.InsertOneAsync(opening);
        var chest = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.DefId == Seal).FirstAsync();
        await env.Store.LockItemAsync(chest.Id, user.Id, ChestService.OpeningLock(opening.Id));

        await env.Chests.RecoverAsync(TimeSpan.FromSeconds(30));

        // The chest it had already locked is the one spent; the second chest stays free.
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == chest.Id));
        Assert.Equal(1, (await env.Chests.ListAsync(user.Id)).Chests.Single(c => c.Id == Seal).ChestCount);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Recovery_RollsForward_AfterTheCommitPoint_WithoutPayingOrChargingTwice()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);
        var opening = env.NewOpening(user.Id, "VC-0388", DateTime.UtcNow.AddMinutes(-2));
        var items = await env.Store.Items.Find(i => i.OwnerId == user.Id && (i.DefId == Seal || i.DefId == SealKey)).ToListAsync();
        foreach (var item in items) await env.Store.LockItemAsync(item.Id, user.Id, ChestService.OpeningLock(opening.Id));
        opening.Committed = true;
        opening.ChestItemId = items.Single(i => i.DefId == Seal).Id;
        opening.KeyItemId = items.Single(i => i.DefId == SealKey).Id;
        await env.Store.ChestOpenings.InsertOneAsync(opening);
        // Crash after spending the chest and creating the reward, before the wallet step.
        await env.Store.Items.DeleteOneAsync(i => i.Id == opening.ChestItemId);
        await env.Store.Items.InsertOneAsync(new MarketItem
        {
            Id = opening.RewardItemId, OwnerId = user.Id, DefId = opening.RewardDefId, Source = MarketItemSources.Chest, AcquiredAt = DateTime.UtcNow
        });

        await env.Chests.RecoverAsync(TimeSpan.FromSeconds(30));
        await env.Chests.RecoverAsync(TimeSpan.Zero);

        Assert.Equal(ChestOpeningStates.Done, (await env.Store.ChestOpenings.Find(o => o.Id == opening.Id).FirstAsync()).State);
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == opening.KeyItemId));
        Assert.Equal(4, (await env.Market.GetWalletAsync(user.Id)).SlotsUsed);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Recovery_RollsBack_WhenTheKeyIsNoLongerThere_AndFreesTheChest()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 0);
        var opening = env.NewOpening(user.Id, "VC-0388", DateTime.UtcNow.AddMinutes(-2));
        await env.Store.ChestOpenings.InsertOneAsync(opening);
        var chest = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.DefId == Seal).FirstAsync();
        await env.Store.LockItemAsync(chest.Id, user.Id, ChestService.OpeningLock(opening.Id));

        await env.Chests.RecoverAsync(TimeSpan.FromSeconds(30));

        var stored = await env.Store.ChestOpenings.Find(o => o.Id == opening.Id).FirstAsync();
        Assert.Equal(ChestOpeningStates.Failed, stored.State);
        Assert.Equal(ChestErrors.KeyNone, stored.Error);
        Assert.Null((await env.Store.Items.Find(i => i.Id == chest.Id).FirstAsync()).LockedBy);
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == opening.RewardItemId));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Recovery_FinishesAnInterruptedRollback()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);
        var opening = env.NewOpening(user.Id, "VC-0388", DateTime.UtcNow.AddMinutes(-2));
        opening.State = ChestOpeningStates.RollingBack;
        opening.Error = ChestErrors.KeyNone;
        await env.Store.ChestOpenings.InsertOneAsync(opening);
        var chest = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.DefId == Seal).FirstAsync();
        await env.Store.LockItemAsync(chest.Id, user.Id, ChestService.OpeningLock(opening.Id));

        await env.Chests.RecoverAsync(TimeSpan.FromSeconds(30));

        Assert.Equal(ChestOpeningStates.Failed, (await env.Store.ChestOpenings.Find(o => o.Id == opening.Id).FirstAsync()).State);
        Assert.Null((await env.Store.Items.Find(i => i.Id == chest.Id).FirstAsync()).LockedBy);
    }

    [Fact]
    public async Task Recovery_LeavesFreshOpeningsAlone()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 1, 1);
        var opening = env.NewOpening(user.Id, "VC-0388", DateTime.UtcNow);
        await env.Store.ChestOpenings.InsertOneAsync(opening);

        var report = await env.Chests.RecoverAsync(TimeSpan.FromSeconds(30));

        Assert.Equal(0, report.Total);
        Assert.Equal(ChestOpeningStates.Pending, (await env.Store.ChestOpenings.Find(o => o.Id == opening.Id).FirstAsync()).State);
        var replay = await Throws(() => env.Chests.OpenAsync(user, Seal, ChestEnv.RequestPart(opening.Id)));
        Assert.Equal(ChestErrors.InProgress, Code(replay));
    }

    [Fact]
    public async Task Recovery_CompletesAPurchaseThatDiedAfterCharging_WithoutChargingAgain()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Market.EnsureAccountAsync(user.Id);
        var price = new ChestSettings().PriceOf(Seal).Key;
        var purchase = env.NewPurchase(user.Id, SealKey, price, DateTime.UtcNow.AddMinutes(-2));
        await env.Store.ChestPurchases.InsertOneAsync(purchase);
        Assert.Equal(WalletWrite.Applied, await env.Store.ApplyWalletAsync(user.Id, ChestService.PurchaseOpKey(purchase.Id), -price, slotDelta: 1));

        var report = await env.Chests.RecoverAsync(TimeSpan.FromSeconds(30));

        Assert.Equal(1, report.Purchases);
        Assert.Equal(ChestOpeningStates.Done, (await env.Store.ChestPurchases.Find(p => p.Id == purchase.Id).FirstAsync()).State);
        Assert.Equal(SealKey, (await env.Store.Items.Find(i => i.Id == purchase.ItemId).FirstAsync()).DefId);
        Assert.Equal(MarketRules.StarterCoins - price, (await env.Market.GetWalletAsync(user.Id)).Balance);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Recovery_FailsAPurchaseThatCanNoLongerBePaid_WithoutGivingAnything()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Market.EnsureAccountAsync(user.Id);
        await env.Store.Accounts.UpdateOneAsync(a => a.Id == user.Id, Builders<MarketAccount>.Update.Set(a => a.Balance, 1L));
        var purchase = env.NewPurchase(user.Id, SealKey, 180, DateTime.UtcNow.AddMinutes(-2));
        await env.Store.ChestPurchases.InsertOneAsync(purchase);

        await env.Chests.RecoverAsync(TimeSpan.FromSeconds(30));

        var stored = await env.Store.ChestPurchases.Find(p => p.Id == purchase.Id).FirstAsync();
        Assert.Equal(ChestOpeningStates.Failed, stored.State);
        Assert.Equal(ChestErrors.Funds, stored.Error);
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == purchase.ItemId));
        Assert.Equal(1L, (await env.Market.GetWalletAsync(user.Id)).Balance);
    }

    // ------------------------------------------------------------------ read model & admin

    [Fact]
    public async Task List_ShowsThreeChests_FreeCountsPricesContentsAndPublicOdds()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(user.Id, Seal, 2, 1);

        var list = await env.Chests.ListAsync(user.Id);

        Assert.Equal(3, list.Chests.Count);
        var seal = list.Chests.Single(c => c.Id == Seal);
        Assert.Equal("Hòm Niêm Phong", seal.Name);
        Assert.Equal(new ChestSettings().PriceOf(Seal).Key, seal.KeyPrice);
        Assert.Equal(new ChestSettings().PriceOf(Seal).Chest, seal.ChestPrice);
        Assert.Equal(2, seal.ChestCount);
        Assert.Equal(1, seal.KeyCount);
        Assert.Equal(24, seal.Contents.Count);
        Assert.All(seal.Contents, def => Assert.False(string.IsNullOrEmpty(def.IconKey)));
        Assert.Equal(5, list.Odds.Count);
        Assert.Equal(100m, list.Odds.Sum(odd => odd.Percent));
        Assert.Equal(MarketRules.StarterCoins, list.Wallet.Balance);
    }

    [Fact]
    public async Task AdminGrant_GivesChestsAndKeys_WithGrantSource_AndRespectsTheBag()
    {
        if (!Enabled) return;
        await using var env = await ChestEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử");
        await env.Market.EnsureAccountAsync(user.Id);

        var wallet = await env.Chests.AdminGrantAsync(user.Id, Seal, 2, 3);

        Assert.Equal(8, wallet.SlotsUsed);
        var granted = await env.Store.Items.Find(i => i.OwnerId == user.Id && (i.DefId == Seal || i.DefId == SealKey)).ToListAsync();
        Assert.Equal(5, granted.Count);
        Assert.All(granted, item => Assert.Equal(MarketItemSources.Grant, item.Source));

        Assert.Equal(ChestErrors.SlotsFull, Code(await Throws(() => env.Chests.AdminGrantAsync(user.Id, Seal, 5, 0))));
        Assert.Equal(8, (await env.Market.GetWalletAsync(user.Id)).SlotsUsed);
        Assert.Equal(MarketErrors.UserNotFound, Code(await Throws(() => env.Chests.AdminGrantAsync(ObjectId.GenerateNewId().ToString(), Seal, 1, 0))));
        Assert.Equal(400, (await Throws(() => env.Chests.AdminGrantAsync(user.Id, Seal, 0, 0))).StatusCode);
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

    private sealed class ScriptedRandom : IChestRandom
    {
        private readonly Queue<int> _values;
        public ScriptedRandom(params int[] values) => _values = new Queue<int>(values);
        public int NextInt(int exclusiveMax) => _values.Count > 0 ? _values.Dequeue() : 0;
    }

    private sealed class ChestEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private ChestEnv(MongoDbSettings settings, IChestRandom random)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db);
            Market = new MarketService(Store, NullLogger<MarketService>.Instance);
            Chests = new ChestService(Store, Market, random, Options.Create(new ChestSettings()), NullLogger<ChestService>.Instance);
        }

        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public MarketService Market { get; }
        public ChestService Chests { get; }

        public static async Task<ChestEnv> CreateAsync(IChestRandom? random = null)
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_chest_{Guid.NewGuid():N}"
            };
            if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
                || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                    server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
                throw new InvalidOperationException("Chest integration tests need a loopback MongoDB and a temporary database.");
            var env = new ChestEnv(settings, random ?? new ScriptedRandom());
            await env.Db.PingAsync();
            await env.Store.EnsureIndexesAsync();
            return env;
        }

        public async Task<CurrentUser> AddUserAsync(string name, bool verified = true)
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

        public async Task GrantAsync(string userId, string chestId, int chests, int keys)
        {
            var chest = ChestCatalog.Find(chestId)!;
            for (var i = 0; i < chests; i++) await Market.AdminGrantAsync(userId, chest.Id, 0);
            for (var i = 0; i < keys; i++) await Market.AdminGrantAsync(userId, chest.KeyDefId, 0);
        }

        public ChestOpening NewOpening(string userId, string rewardDefId, DateTime at) => new()
        {
            Id = $"{userId}:{Guid.NewGuid():N}",
            UserId = userId,
            ChestDefId = Seal,
            KeyDefId = SealKey,
            RewardDefId = rewardDefId,
            RewardItemId = MarketStore.NewId(),
            State = ChestOpeningStates.Pending,
            CreatedAt = at,
            UpdatedAt = at
        };

        public ChestPurchase NewPurchase(string userId, string defId, long price, DateTime at) => new()
        {
            Id = $"{userId}:{Guid.NewGuid():N}",
            UserId = userId,
            ChestDefId = Seal,
            DefId = defId,
            Price = price,
            ItemId = MarketStore.NewId(),
            State = ChestOpeningStates.Pending,
            CreatedAt = at,
            UpdatedAt = at
        };

        public static string RequestPart(string operationId) => operationId[(operationId.IndexOf(':') + 1)..];

        public async Task AssertSlotsMatchItemsAsync()
        {
            var items = await Store.Items.Find(FilterDefinition<MarketItem>.Empty).ToListAsync();
            Assert.Equal(items.Count, items.Select(i => i.Id).Distinct().Count());
            foreach (var account in await Store.Accounts.Find(FilterDefinition<MarketAccount>.Empty).ToListAsync())
            {
                Assert.Equal(items.Count(i => i.OwnerId == account.Id), account.Slots);
                Assert.True(account.Slots <= MarketRules.InventorySlots, $"slot cap exceeded for {account.Id}");
                Assert.True(account.Balance >= 0, $"negative balance for {account.Id}");
            }
        }

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
