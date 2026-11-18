using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// Chợ đồ against a real (standalone) MongoDB: escrow, order matching, trades, rewards, idempotency,
/// crash recovery and — most importantly — that parallel buys/accepts can never duplicate an item or
/// drive a balance negative. Opt-in like the other Mongo tests: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoMarketTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_MONGO_IT";

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable(RunEnvironmentVariable), "true", StringComparison.OrdinalIgnoreCase);

    // ------------------------------------------------------------------ economy basics

    [Fact]
    public async Task StarterGrant_IsGivenOnce_EvenUnderConcurrentFirstAccess()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử Minh");
        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() => env.Market.EnsureAccountAsync(user.Id))));

        var wallet = await env.Market.GetWalletAsync(user.Id);
        Assert.Equal(MarketRules.StarterCoins, wallet.Balance);
        Assert.Equal(3, wallet.ItemCount);
        Assert.Equal(3, wallet.SlotsUsed);
        var inventory = await env.Market.GetInventoryAsync(user.Id);
        Assert.Equal(MarketCatalog.StarterItemIds.OrderBy(id => id), inventory.Items.Select(i => i.Def.Id).OrderBy(id => id));
        Assert.Equal(3, inventory.Items.Select(i => i.ItemId).Distinct().Count());
    }

    [Fact]
    public async Task ListThenBuy_MovesTheItem_ChargesTheBuyer_AndPaysTheSellerMinusFee()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        var item = await env.FirstItemAsync(seller.Id);

        var listed = await env.Market.CreateListingAsync(seller, item.ItemId, 200);
        Assert.Equal(MarketListingStatus.Active, listed.Listing.Status);
        Assert.Equal(10L, listed.Listing.Fee);
        Assert.Equal(190L, listed.Listing.Proceeds);
        var lockedView = (await env.Market.GetInventoryAsync(seller.Id)).Items.Single(i => i.ItemId == item.ItemId);
        Assert.True(lockedView.Locked);
        Assert.Equal("LISTED", lockedView.LockReason);

        var purchase = await env.Market.BuyListingAsync(buyer, listed.Listing.ListingId);
        Assert.Equal(200L, purchase.Sale.Price);
        Assert.Equal(10L, purchase.Sale.Fee);
        Assert.Equal(-200L, purchase.Sale.Net);
        Assert.Equal(300L, purchase.Wallet.Balance);
        Assert.Equal(4, purchase.Wallet.SlotsUsed);

        var sellerWallet = await env.Market.GetWalletAsync(seller.Id);
        Assert.Equal(690L, sellerWallet.Balance);
        Assert.Equal(2, sellerWallet.SlotsUsed);
        var moved = await env.Store.Items.Find(i => i.Id == item.ItemId).FirstAsync();
        Assert.Equal(buyer.Id, moved.OwnerId);
        Assert.Null(moved.LockedBy);
        var listing = await env.Store.Listings.Find(l => l.Id == listed.Listing.ListingId).FirstAsync();
        Assert.Equal(MarketListingStatus.Sold, listing.Status);
        Assert.Single(await env.Store.Sales.Find(FilterDefinition<MarketSale>.Empty).ToListAsync());

        var sellerHistory = (await env.Market.GetMineAsync(seller.Id)).History.Single();
        Assert.Equal("SOLD", sellerHistory.Role);
        Assert.Equal(190L, sellerHistory.Net);
        var detail = await env.Market.GetItemDetailAsync(buyer.Id, item.Def.Id);
        Assert.Equal(1, detail.History.Volume);
        Assert.Equal(200L, detail.History.Line[^1]);
        Assert.Equal(200L, detail.History.Low);
        await env.AssertCoinsConservedAsync(expectedFees: 10);
    }

    [Fact]
    public async Task ParallelBuysOfOneListing_SellItExactlyOnce_AndRefundEveryoneElse()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyers = new List<CurrentUser>();
        for (var i = 0; i < 12; i++) buyers.Add(await env.AddUserAsync($"Người mua {i}"));
        var item = await env.FirstItemAsync(seller.Id);
        var listing = (await env.Market.CreateListingAsync(seller, item.ItemId, 120)).Listing;

        // Twelve buyers, plus the first buyer clicking four extra times, all at once.
        var attempts = buyers.Select(buyer => buyer).Concat(Enumerable.Repeat(buyers[0], 4)).ToList();
        var results = await Task.WhenAll(attempts.Select(buyer => Task.Run(async () =>
        {
            try { return (Ok: true, Code: (string?)null, Buyer: buyer.Id, Sale: (await env.Market.BuyListingAsync(buyer, listing.ListingId)).Sale); }
            catch (ApiException exception) { return (Ok: false, Code: Code(exception), Buyer: buyer.Id, Sale: (SaleDto?)null); }
        })));

        var winners = results.Where(r => r.Ok).ToList();
        Assert.Single(winners);
        Assert.All(results.Where(r => !r.Ok), r => Assert.Equal(MarketErrors.ListingUnavailable, r.Code));
        var owner = (await env.Store.Items.Find(i => i.Id == item.ItemId).FirstAsync()).OwnerId;
        Assert.Equal(winners[0].Buyer, owner);
        Assert.Single(await env.Store.Sales.Find(FilterDefinition<MarketSale>.Empty).ToListAsync());
        foreach (var buyer in buyers)
        {
            var wallet = await env.Market.GetWalletAsync(buyer.Id);
            var won = buyer.Id == owner;
            Assert.Equal(won ? 380L : 500L, wallet.Balance);
            Assert.Equal(won ? 4 : 3, wallet.SlotsUsed);
            Assert.Equal(wallet.SlotsUsed, wallet.ItemCount);
        }
        Assert.Equal(500L + 114L, (await env.Market.GetWalletAsync(seller.Id)).Balance);
        await env.AssertNoDuplicateItemsAsync();
        await env.AssertCoinsConservedAsync(expectedFees: 6);
        Assert.Equal(0, await env.CountOpenTransactionsAsync());
    }

    [Fact]
    public async Task ParallelBuyNowAcrossSeveralListings_SellsEachListingOnce()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var sellers = new List<CurrentUser>();
        for (var i = 0; i < 3; i++) sellers.Add(await env.AddUserAsync($"Người bán {i}"));
        var buyers = new List<CurrentUser>();
        for (var i = 0; i < 7; i++) buyers.Add(await env.AddUserAsync($"Người mua {i}"));
        foreach (var (seller, index) in sellers.Select((s, i) => (s, i)))
        {
            var brass = (await env.Market.GetInventoryAsync(seller.Id)).Items.Single(i => i.Def.Id == "mag_brass");
            await env.Market.CreateListingAsync(seller, brass.ItemId, 100 + index * 10);
        }

        var results = await Task.WhenAll(buyers.Select(buyer => Task.Run(async () =>
        {
            try { await env.Market.BuyLowestAsync(buyer, "mag_brass", 200); return (string?)null; }
            catch (ApiException exception) { return Code(exception); }
        })));

        Assert.Equal(3, results.Count(code => code is null));
        Assert.All(results.Where(code => code is not null), code => Assert.Equal(MarketErrors.NoListingAtPrice, code));
        Assert.Equal(3, (int)await env.Store.Listings.CountDocumentsAsync(l => l.Status == MarketListingStatus.Sold));
        await env.AssertNoDuplicateItemsAsync();
        await env.AssertCoinsConservedAsync(expectedFees: MarketRules.Fee(100) + MarketRules.Fee(110) + MarketRules.Fee(120));
    }

    [Fact]
    public async Task Balance_NeverGoesNegative_AndAFullBagBlocksBuying()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        var items = (await env.Market.GetInventoryAsync(seller.Id)).Items;
        var dear = (await env.Market.CreateListingAsync(seller, items[0].ItemId, 600)).Listing;
        Assert.Equal(MarketErrors.InsufficientFunds, Code(await Throws(() => env.Market.BuyListingAsync(buyer, dear.ListingId))));
        Assert.Equal(500L, (await env.Market.GetWalletAsync(buyer.Id)).Balance);

        // Parallel bids that together exceed the balance: the escrow guard admits only what fits.
        var bids = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(async () =>
        {
            try { await env.Market.PlaceOrderAsync(buyer, "badge_fog", 200); return true; }
            catch (ApiException) { return false; }
        })));
        Assert.Equal(2, bids.Count(ok => ok));
        var wallet = await env.Market.GetWalletAsync(buyer.Id);
        Assert.Equal(100L, wallet.Balance);
        Assert.Equal(400L, wallet.Held);
        Assert.True(wallet.Balance >= 0);

        // Fill the bag to 12 slots (3 starter + 2 reserved by bids + 7 granted), then try to buy.
        for (var i = 0; i < 7; i++) await env.GrantAsync(buyer.Id, "pins_iron", 0);
        Assert.Equal(12, (await env.Market.GetWalletAsync(buyer.Id)).SlotsUsed);
        Assert.Equal(MarketErrors.InventoryFull, Code(await Throws(() => env.GrantAsync(buyer.Id, "pins_iron", 0))));
        await env.GrantAsync(buyer.Id, null, 1000);
        var cheap = (await env.Market.CreateListingAsync(seller, items[1].ItemId, 50)).Listing;
        Assert.Equal(MarketErrors.InventoryFull, Code(await Throws(() => env.Market.BuyListingAsync(buyer, cheap.ListingId))));
        Assert.Equal(1100L, (await env.Market.GetWalletAsync(buyer.Id)).Balance);
    }

    // ------------------------------------------------------------------ buy orders

    [Fact]
    public async Task BuyOrder_HoldsCoinsAndASlot_AndCancelReleasesThemOnce()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var buyer = await env.AddUserAsync("Người mua");
        var placed = await env.Market.PlaceOrderAsync(buyer, "watch_pocket", 200);
        Assert.Equal(MarketOrderStatus.Active, placed.Order.Status);
        Assert.Null(placed.Sale);
        Assert.Equal(300L, placed.Wallet.Balance);
        Assert.Equal(200L, placed.Wallet.Held);
        Assert.Equal(4, placed.Wallet.SlotsUsed);
        Assert.Equal(1, placed.Wallet.ReservedSlots);

        var cancelled = await env.Market.CancelOrderAsync(buyer.Id, placed.Order.OrderId);
        Assert.Equal(MarketOrderStatus.Cancelled, cancelled.Status);
        var wallet = await env.Market.GetWalletAsync(buyer.Id);
        Assert.Equal(500L, wallet.Balance);
        Assert.Equal(0L, wallet.Held);
        Assert.Equal(3, wallet.SlotsUsed);
        Assert.Equal(MarketErrors.OrderUnavailable, Code(await Throws(() => env.Market.CancelOrderAsync(buyer.Id, placed.Order.OrderId))));
        Assert.Equal(500L, (await env.Market.GetWalletAsync(buyer.Id)).Balance);
    }

    [Fact]
    public async Task ListingAtOrBelowTheHighestBid_FillsItAtTheBidPrice()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        var other = await env.AddUserAsync("Người mua khác");
        await env.Market.PlaceOrderAsync(other, "mag_brass", 180);
        var best = await env.Market.PlaceOrderAsync(buyer, "mag_brass", 250);
        var brass = (await env.Market.GetInventoryAsync(seller.Id)).Items.Single(i => i.Def.Id == "mag_brass");

        var listed = await env.Market.CreateListingAsync(seller, brass.ItemId, 200);
        Assert.NotNull(listed.Sale);
        Assert.Equal(250L, listed.Sale!.Price);
        Assert.Equal(MarketListingStatus.Sold, listed.Listing.Status);
        Assert.Equal(500L + 250L - MarketRules.Fee(250), listed.Wallet.Balance);

        var order = await env.Store.Orders.Find(o => o.Id == best.Order.OrderId).FirstAsync();
        Assert.Equal(MarketOrderStatus.Filled, order.Status);
        Assert.Equal(brass.ItemId, order.ItemId);
        var buyerWallet = await env.Market.GetWalletAsync(buyer.Id);
        Assert.Equal(250L, buyerWallet.Balance);
        Assert.Equal(0L, buyerWallet.Held);
        Assert.Equal(4, buyerWallet.ItemCount);
        Assert.Equal(4, buyerWallet.SlotsUsed);
        Assert.Equal(buyer.Id, (await env.Store.Items.Find(i => i.Id == brass.ItemId).FirstAsync()).OwnerId);
        // The lower bid still rests.
        var detail = await env.Market.GetItemDetailAsync(seller.Id, "mag_brass");
        Assert.Equal(180L, detail.HighestBid);
        Assert.Equal(1, detail.BidCount);
        await env.AssertCoinsConservedAsync(expectedFees: MarketRules.Fee(250));
    }

    [Fact]
    public async Task BidAboveTheLowestAsk_BuysAtTheAskPrice_AndReturnsTheChange()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        var brass = (await env.Market.GetInventoryAsync(seller.Id)).Items.Single(i => i.Def.Id == "mag_brass");
        await env.Market.CreateListingAsync(seller, brass.ItemId, 150);

        var placed = await env.Market.PlaceOrderAsync(buyer, "mag_brass", 300);
        Assert.NotNull(placed.Sale);
        Assert.Equal(150L, placed.Sale!.Price);
        Assert.Equal(MarketOrderStatus.Filled, placed.Order.Status);
        Assert.Equal(150L, placed.Order.FilledPrice);
        Assert.Equal(350L, placed.Wallet.Balance);
        Assert.Equal(0L, placed.Wallet.Held);
        Assert.Equal(4, placed.Wallet.SlotsUsed);
        Assert.Equal(500L + 150L - MarketRules.Fee(150), (await env.Market.GetWalletAsync(seller.Id)).Balance);
        await env.AssertCoinsConservedAsync(expectedFees: MarketRules.Fee(150));
    }

    [Fact]
    public async Task BidBelowTheAsk_Rests_AndTheBookShowsBothSides()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        var brass = (await env.Market.GetInventoryAsync(seller.Id)).Items.Single(i => i.Def.Id == "mag_brass");
        await env.Market.CreateListingAsync(seller, brass.ItemId, 300);
        var placed = await env.Market.PlaceOrderAsync(buyer, "mag_brass", 200);
        Assert.Null(placed.Sale);

        var browse = await env.Market.BrowseAsync(null, MarketCategories.Magnifier, null, "price_asc");
        var row = browse.Rows.First();
        Assert.Equal("mag_brass", row.Def.Id);
        Assert.Equal(300L, row.LowestAsk);
        Assert.Equal(200L, row.HighestBid);
        Assert.Equal(1, row.ListedCount);
        Assert.Equal(3, browse.Rows.Count);
        Assert.Equal(3, browse.CategoryCounts[MarketCategories.Magnifier]);
        var search = await env.Market.BrowseAsync("kinh lup", null, new[] { MarketRarities.Legendary }, null);
        Assert.Equal("mag_crystal", Assert.Single(search.Rows).Def.Id);
    }

    [Fact]
    public async Task Browse_CutsTheSortedLedgerIntoPages_AndClampsAPagePastTheEnd()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var all = await env.Market.BrowseAsync(null, MarketCategories.Magnifier, null, "name");
        Assert.Equal(3, all.MatchCount);
        Assert.Equal(1, all.Page);

        var first = await env.Market.BrowseAsync(null, MarketCategories.Magnifier, null, "name", page: 1, pageSize: 2);
        var second = await env.Market.BrowseAsync(null, MarketCategories.Magnifier, null, "name", page: 2, pageSize: 2);
        Assert.Equal(all.Rows.Take(2).Select(r => r.Def.Id), first.Rows.Select(r => r.Def.Id));
        Assert.Equal(all.Rows[2].Def.Id, Assert.Single(second.Rows).Def.Id);
        Assert.Equal((3, 2, 2), (second.MatchCount, second.Page, second.PageSize));
        // The category and "All" counts describe the whole search, not the page.
        Assert.Equal(all.TotalCount, second.TotalCount);
        Assert.Equal(3, second.CategoryCounts[MarketCategories.Magnifier]);

        var past = await env.Market.BrowseAsync(null, MarketCategories.Magnifier, null, "name", page: 9, pageSize: 2);
        Assert.Equal(2, past.Page);
        Assert.Equal(second.Rows.Select(r => r.Def.Id), past.Rows.Select(r => r.Def.Id));

        var none = await env.Market.BrowseAsync("khong co mon nao ten nhu vay", null, null, null, page: 3, pageSize: 2);
        Assert.Empty(none.Rows);
        Assert.Equal((0, 1), (none.MatchCount, none.Page));
    }

    [Fact]
    public async Task ParallelListingsAgainstOneBid_FillItOnce()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var buyer = await env.AddUserAsync("Người mua");
        var sellers = new List<CurrentUser>();
        for (var i = 0; i < 5; i++) sellers.Add(await env.AddUserAsync($"Người bán {i}"));
        await env.Market.PlaceOrderAsync(buyer, "pins_iron", 90);
        var listings = await Task.WhenAll(sellers.Select(seller => Task.Run(async () =>
        {
            var pins = (await env.Market.GetInventoryAsync(seller.Id)).Items.Single(i => i.Def.Id == "pins_iron");
            return await env.Market.CreateListingAsync(seller, pins.ItemId, 60);
        })));
        Assert.Single(listings, l => l.Sale is not null);
        Assert.Equal(4, listings.Count(l => l.Listing.Status == MarketListingStatus.Active));
        var wallet = await env.Market.GetWalletAsync(buyer.Id);
        Assert.Equal(410L, wallet.Balance);
        Assert.Equal(0L, wallet.Held);
        Assert.Equal(4, wallet.ItemCount);
        await env.AssertNoDuplicateItemsAsync();
        await env.AssertCoinsConservedAsync(expectedFees: MarketRules.Fee(90));
    }

    // ------------------------------------------------------------------ locks & equipment

    [Fact]
    public async Task ListedItem_IsLocked_UntilTheListingIsCancelled()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var friend = await env.AddUserAsync("Bạn");
        var item = await env.FirstItemAsync(seller.Id);
        await env.Market.EquipAsync(seller.Id, item.ItemId);
        var listing = (await env.Market.CreateListingAsync(seller, item.ItemId, 300)).Listing;

        Assert.Empty((await env.Market.GetInventoryAsync(seller.Id)).Equipped);
        Assert.Equal(MarketErrors.ItemLocked, Code(await Throws(() => env.Market.CreateListingAsync(seller, item.ItemId, 250))));
        Assert.Equal(MarketErrors.ItemLocked, Code(await Throws(() => env.Market.EquipAsync(seller.Id, item.ItemId))));
        Assert.Equal(MarketErrors.TradeItemUnavailable, Code(await Throws(() => env.Market.CreateTradeAsync(seller,
            new CreateTradeRequest { ToUserId = friend.Id, OfferItemIds = new() { item.ItemId } }))));
        Assert.Equal(MarketErrors.CannotBuyOwn, Code(await Throws(() => env.Market.BuyListingAsync(seller, listing.ListingId))));

        await env.Market.CancelListingAsync(seller.Id, listing.ListingId);
        Assert.Null((await env.Store.Items.Find(i => i.Id == item.ItemId).FirstAsync()).LockedBy);
        Assert.Equal(MarketErrors.ListingUnavailable, Code(await Throws(() => env.Market.CancelListingAsync(seller.Id, listing.ListingId))));
        Assert.Equal(MarketErrors.ListingUnavailable, Code(await Throws(() => env.Market.BuyListingAsync(friend, listing.ListingId))));
        var equipped = await env.Market.EquipAsync(seller.Id, item.ItemId);
        Assert.Equal(item.ItemId, equipped.Equipped[item.Def.Category]);
    }

    [Fact]
    public async Task Equip_KeepsOneItemPerCategory_AndSoldItemsAreNoLongerEquipped()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử Minh");
        var buyer = await env.AddUserAsync("Người mua");
        await env.GrantAsync(user.Id, "mag_crystal", 0);
        var inventory = await env.Market.GetInventoryAsync(user.Id);
        var brass = inventory.Items.Single(i => i.Def.Id == "mag_brass");
        var crystal = inventory.Items.Single(i => i.Def.Id == "mag_crystal");
        var pins = inventory.Items.Single(i => i.Def.Id == "pins_iron");

        await env.Market.EquipAsync(user.Id, brass.ItemId);
        await env.Market.EquipAsync(user.Id, pins.ItemId);
        var after = await env.Market.EquipAsync(user.Id, crystal.ItemId);
        Assert.Equal(crystal.ItemId, after.Equipped[MarketCategories.Magnifier]);
        Assert.Equal(2, after.Equipped.Count);
        Assert.Single(after.Items, i => i.Equipped && i.Def.Category == MarketCategories.Magnifier);
        var shown = await env.Market.GetEquippedAsync(user.Id);
        Assert.Equal(new[] { MarketCategories.Magnifier, MarketCategories.Pins }, shown.Select(e => e.Category));

        var listing = (await env.Market.CreateListingAsync(user, crystal.ItemId, 4000)).Listing;
        await env.GrantAsync(buyer.Id, null, 5000);
        await env.Market.BuyListingAsync(buyer, listing.ListingId);
        var remaining = await env.Market.GetEquippedAsync(user.Id);
        Assert.Equal(new[] { MarketCategories.Pins }, remaining.Select(e => e.Category));
        Assert.Empty(await env.Market.GetEquippedAsync(buyer.Id));
        Assert.Equal(MarketErrors.ItemNotFound, Code(await Throws(() => env.Market.EquipAsync(user.Id, crystal.ItemId))));
    }

    [Fact]
    public async Task BothOutfitsCanBeWornAtOnce_AndAnyoneCanSeeWhichOnes()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử Minh");
        var partner = await env.AddUserAsync("Thám tử Vy");
        await env.GrantAsync(user.Id, SkinCatalog.SherlockWhitechapel, 0);
        await env.GrantAsync(user.Id, SkinCatalog.WatsonWhitechapel, 0);
        var inventory = await env.Market.GetInventoryAsync(user.Id);
        var sherlock = inventory.Items.Single(i => i.Def.Id == SkinCatalog.SherlockWhitechapel);
        var watson = inventory.Items.Single(i => i.Def.Id == SkinCatalog.WatsonWhitechapel);

        await env.Market.EquipAsync(user.Id, sherlock.ItemId);
        var after = await env.Market.EquipAsync(user.Id, watson.ItemId);

        Assert.Equal(sherlock.ItemId, after.Equipped[MarketCategories.SkinSherlock]);
        Assert.Equal(watson.ItemId, after.Equipped[MarketCategories.SkinWatson]);
        var shown = await env.Market.GetEquippedAsync(user.Id);
        Assert.Equal(new[] { MarketCategories.SkinSherlock, MarketCategories.SkinWatson }, shown.Select(e => e.Category));
        Assert.Equal(SkinCatalog.WatsonWhitechapel, shown[1].Def.Id);
        Assert.Equal("/assets/pixel/skins/whitechapel/icon-watson.png", shown[1].Def.Visual?.ImageUrl);
        Assert.Empty(await env.Market.GetEquippedAsync(partner.Id));

        var off = await env.Market.UnequipAsync(user.Id, MarketCategories.SkinSherlock);
        Assert.False(off.Equipped.ContainsKey(MarketCategories.SkinSherlock));
        Assert.Equal(new[] { MarketCategories.SkinWatson }, (await env.Market.GetEquippedAsync(user.Id)).Select(e => e.Category));
    }

    // ------------------------------------------------------------------ trades

    [Fact]
    public async Task AcceptedTrade_SwapsItemsAndCoinsOnBothSides()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var alice = await env.AddUserAsync("Thám tử Minh");
        var bob = await env.AddUserAsync("Thám tử Vy");
        var a = (await env.Market.GetInventoryAsync(alice.Id)).Items;
        var b = (await env.Market.GetInventoryAsync(bob.Id)).Items;
        var mag = a.Single(i => i.Def.Id == "mag_brass");
        var pins = a.Single(i => i.Def.Id == "pins_iron");
        var folder = b.Single(i => i.Def.Id == "folder_kraft");

        var users = await env.Market.SearchUsersAsync(alice.Id, "vy");
        Assert.Equal(bob.Id, Assert.Single(users).UserId);
        var offer = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest
        {
            ToUserId = bob.Id,
            OfferItemIds = new() { mag.ItemId, pins.ItemId },
            OfferCoins = 50,
            RequestItemIds = new() { folder.ItemId },
            RequestCoins = 0,
            Message = "Đổi kính lúp + bộ ghim lấy bìa hồ sơ của bạn nhé?"
        });
        Assert.Equal(TradeOfferStatus.Pending, offer.Status);
        var inbox = await env.Market.GetTradesAsync(bob.Id);
        Assert.Equal(offer.OfferId, Assert.Single(inbox.Incoming).OfferId);
        Assert.All(inbox.Incoming[0].FromItems, item => Assert.True(item.Available));

        var accepted = await env.Market.AcceptTradeAsync(bob, offer.OfferId);
        Assert.Equal(TradeOfferStatus.Accepted, accepted.Status);
        Assert.Equal(bob.Id, (await env.Store.Items.Find(i => i.Id == mag.ItemId).FirstAsync()).OwnerId);
        Assert.Equal(bob.Id, (await env.Store.Items.Find(i => i.Id == pins.ItemId).FirstAsync()).OwnerId);
        Assert.Equal(alice.Id, (await env.Store.Items.Find(i => i.Id == folder.ItemId).FirstAsync()).OwnerId);
        var aliceWallet = await env.Market.GetWalletAsync(alice.Id);
        var bobWallet = await env.Market.GetWalletAsync(bob.Id);
        Assert.Equal(450L, aliceWallet.Balance);
        Assert.Equal(550L, bobWallet.Balance);
        Assert.Equal(2, aliceWallet.SlotsUsed);
        Assert.Equal(4, bobWallet.SlotsUsed);
        Assert.Equal(aliceWallet.SlotsUsed, aliceWallet.ItemCount);
        Assert.Equal(bobWallet.SlotsUsed, bobWallet.ItemCount);
        Assert.Equal(MarketErrors.TradeClosed, Code(await Throws(() => env.Market.AcceptTradeAsync(bob, offer.OfferId))));
        Assert.Equal(0, (int)await env.Store.Items.CountDocumentsAsync(i => i.LockedBy != null));
        await env.AssertCoinsConservedAsync(expectedFees: 0);
    }

    [Fact]
    public async Task WithTradeCoinsOff_OffersCarryItemsOnly_AndAnOldCoinOfferCanOnlyBeDeclined()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var alice = await env.AddUserAsync("Alice");
        var bob = await env.AddUserAsync("Bob");
        var mag = await env.FirstItemAsync(alice.Id);
        var bobItem = await env.FirstItemAsync(bob.Id);
        // Made while coins could still be traded.
        var old = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferItemIds = new() { mag.ItemId }, RequestCoins = 100 });
        var itemsOnly = env.ItemsOnly();

        Assert.Equal(MarketErrors.TradeCoinsNotAllowed, Code(await Throws(() =>
            itemsOnly.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferCoins = 10 }))));
        Assert.Equal(MarketErrors.TradeCoinsNotAllowed, Code(await Throws(() =>
            itemsOnly.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferItemIds = new() { mag.ItemId }, RequestCoins = 1 }))));
        Assert.Equal(MarketErrors.TradeEmpty, Code(await Throws(() =>
            itemsOnly.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id }))));
        Assert.Equal(MarketErrors.TradeCoinsNotAllowed, Code(await Throws(() =>
            itemsOnly.CounterTradeAsync(bob, old.OfferId, new TradeTermsRequest { RequestItemIds = new() { mag.ItemId }, OfferCoins = 5 }))));
        Assert.Equal(MarketErrors.TradeCoinsNotAllowed, Code(await Throws(() => itemsOnly.AcceptTradeAsync(bob, old.OfferId))));
        Assert.Equal(TradeOfferStatus.Pending, (await env.Store.Trades.Find(t => t.Id == old.OfferId).FirstAsync()).Status);
        Assert.False((await itemsOnly.GetTradesAsync(bob.Id)).CoinsAllowed);
        Assert.True((await env.Market.GetTradesAsync(bob.Id)).CoinsAllowed);

        // Items for items still goes through, and no coin moves.
        var swap = await itemsOnly.CreateTradeAsync(alice, new CreateTradeRequest
        {
            ToUserId = bob.Id, OfferItemIds = new() { mag.ItemId }, RequestItemIds = new() { bobItem.ItemId },
        });
        await itemsOnly.AcceptTradeAsync(bob, swap.OfferId);
        Assert.Equal(bob.Id, (await env.Store.Items.Find(i => i.Id == mag.ItemId).FirstAsync()).OwnerId);
        Assert.Equal(alice.Id, (await env.Store.Items.Find(i => i.Id == bobItem.ItemId).FirstAsync()).OwnerId);
        Assert.Equal(500L, (await env.Market.GetWalletAsync(alice.Id)).Balance);
        Assert.Equal(500L, (await env.Market.GetWalletAsync(bob.Id)).Balance);

        // The old coin offer can still be closed.
        await itemsOnly.DeclineTradeAsync(bob.Id, old.OfferId);
        Assert.Equal(TradeOfferStatus.Declined, (await env.Store.Trades.Find(t => t.Id == old.OfferId).FirstAsync()).Status);
        await env.AssertCoinsConservedAsync(expectedFees: 0);
    }

    [Fact]
    public async Task TradeIsRevalidatedAtAccept_ListedItemMakesItFail_WithoutMovingAnything()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var alice = await env.AddUserAsync("Alice");
        var bob = await env.AddUserAsync("Bob");
        var mag = await env.FirstItemAsync(alice.Id);
        var offer = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferItemIds = new() { mag.ItemId }, RequestCoins = 100 });
        var listing = (await env.Market.CreateListingAsync(alice, mag.ItemId, 999)).Listing;

        Assert.Equal(MarketErrors.TradeItemUnavailable, Code(await Throws(() => env.Market.AcceptTradeAsync(bob, offer.OfferId))));
        var stored = await env.Store.Trades.Find(t => t.Id == offer.OfferId).FirstAsync();
        Assert.Equal(TradeOfferStatus.Failed, stored.Status);
        var item = await env.Store.Items.Find(i => i.Id == mag.ItemId).FirstAsync();
        Assert.Equal(alice.Id, item.OwnerId);
        Assert.Equal("listing:" + listing.ListingId, item.LockedBy);
        Assert.Equal(500L, (await env.Market.GetWalletAsync(bob.Id)).Balance);
        Assert.Equal(500L, (await env.Market.GetWalletAsync(alice.Id)).Balance);
    }

    [Fact]
    public async Task RecipientWithoutTheRequestedCoins_GetsAnError_AndTheOfferStaysOpen()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var alice = await env.AddUserAsync("Alice");
        var bob = await env.AddUserAsync("Bob");
        var mag = await env.FirstItemAsync(alice.Id);
        var offer = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferItemIds = new() { mag.ItemId }, RequestCoins = 800 });

        Assert.Equal(MarketErrors.TradeRecipientFunds, Code(await Throws(() => env.Market.AcceptTradeAsync(bob, offer.OfferId))));
        Assert.Equal(TradeOfferStatus.Pending, (await env.Store.Trades.Find(t => t.Id == offer.OfferId).FirstAsync()).Status);
        Assert.Null((await env.Store.Items.Find(i => i.Id == mag.ItemId).FirstAsync()).LockedBy);
        Assert.Equal(500L, (await env.Market.GetWalletAsync(bob.Id)).Balance);
        Assert.Equal(3, (await env.Market.GetWalletAsync(alice.Id)).SlotsUsed);

        await env.GrantAsync(bob.Id, null, 300);
        var accepted = await env.Market.AcceptTradeAsync(bob, offer.OfferId);
        Assert.Equal(TradeOfferStatus.Accepted, accepted.Status);
        Assert.Equal(1300L, (await env.Market.GetWalletAsync(alice.Id)).Balance);
        Assert.Equal(0L, (await env.Market.GetWalletAsync(bob.Id)).Balance);
    }

    [Fact]
    public async Task ParallelAccepts_OfTheSameOffer_SettleItOnce()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var alice = await env.AddUserAsync("Alice");
        var bob = await env.AddUserAsync("Bob");
        var mag = await env.FirstItemAsync(alice.Id);
        var offer = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferItemIds = new() { mag.ItemId }, RequestCoins = 100 });

        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(async () =>
        {
            try { await env.Market.AcceptTradeAsync(bob, offer.OfferId); return (string?)null; }
            catch (ApiException exception) { return Code(exception); }
        })));
        Assert.Single(results, code => code is null);
        Assert.All(results.Where(code => code is not null), code => Assert.Equal(MarketErrors.TradeClosed, code));
        Assert.Equal(600L, (await env.Market.GetWalletAsync(alice.Id)).Balance);
        Assert.Equal(400L, (await env.Market.GetWalletAsync(bob.Id)).Balance);
        Assert.Equal(bob.Id, (await env.Store.Items.Find(i => i.Id == mag.ItemId).FirstAsync()).OwnerId);
        await env.AssertNoDuplicateItemsAsync();
    }

    [Fact]
    public async Task TwoOffersForTheSameItem_AcceptedAtOnce_OnlyOneWins()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var alice = await env.AddUserAsync("Alice");
        var bob = await env.AddUserAsync("Bob");
        var carol = await env.AddUserAsync("Carol");
        var mag = await env.FirstItemAsync(alice.Id);
        var toBob = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferItemIds = new() { mag.ItemId }, RequestCoins = 100 });
        var toCarol = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = carol.Id, OfferItemIds = new() { mag.ItemId }, RequestCoins = 150 });

        var results = await Task.WhenAll(
            Task.Run(async () => { try { await env.Market.AcceptTradeAsync(bob, toBob.OfferId); return (string?)null; } catch (ApiException e) { return Code(e); } }),
            Task.Run(async () => { try { await env.Market.AcceptTradeAsync(carol, toCarol.OfferId); return (string?)null; } catch (ApiException e) { return Code(e); } }));
        Assert.Single(results, code => code is null);
        Assert.Single(results, code => code == MarketErrors.TradeItemUnavailable);
        var owner = (await env.Store.Items.Find(i => i.Id == mag.ItemId).FirstAsync()).OwnerId;
        Assert.True(owner == bob.Id || owner == carol.Id);
        var paid = owner == bob.Id ? 100L : 150L;
        Assert.Equal(500L + paid, (await env.Market.GetWalletAsync(alice.Id)).Balance);
        await env.AssertNoDuplicateItemsAsync();
        await env.AssertCoinsConservedAsync(expectedFees: 0);
    }

    [Fact]
    public async Task CounterOffer_ClosesTheOriginal_AndCanBeAccepted()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var alice = await env.AddUserAsync("Alice");
        var bob = await env.AddUserAsync("Bob");
        var mag = await env.FirstItemAsync(alice.Id);
        var bobFolder = (await env.Market.GetInventoryAsync(bob.Id)).Items.Single(i => i.Def.Id == "folder_kraft");
        var offer = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferItemIds = new() { mag.ItemId }, RequestCoins = 200 });

        var counter = await env.Market.CounterTradeAsync(bob, offer.OfferId, new TradeTermsRequest
        {
            OfferItemIds = new() { bobFolder.ItemId },
            RequestItemIds = new() { mag.ItemId },
            Message = "Mình đổi bìa hồ sơ thay vì xu nhé"
        });
        Assert.Equal(offer.OfferId, counter.ParentId);
        Assert.Equal(alice.Id, counter.To.UserId);
        Assert.Equal(TradeOfferStatus.Countered, (await env.Store.Trades.Find(t => t.Id == offer.OfferId).FirstAsync()).Status);
        Assert.Equal(MarketErrors.TradeClosed, Code(await Throws(() => env.Market.AcceptTradeAsync(bob, offer.OfferId))));
        Assert.Equal(MarketErrors.TradeNotFound, Code(await Throws(() => env.Market.AcceptTradeAsync(bob, counter.OfferId))));

        var accepted = await env.Market.AcceptTradeAsync(alice, counter.OfferId);
        Assert.Equal(TradeOfferStatus.Accepted, accepted.Status);
        Assert.Equal(bob.Id, (await env.Store.Items.Find(i => i.Id == mag.ItemId).FirstAsync()).OwnerId);
        Assert.Equal(alice.Id, (await env.Store.Items.Find(i => i.Id == bobFolder.ItemId).FirstAsync()).OwnerId);

        var declined = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferCoins = 10 });
        Assert.Equal(TradeOfferStatus.Declined, (await env.Market.DeclineTradeAsync(bob.Id, declined.OfferId)).Status);
        var cancelled = await env.Market.CreateTradeAsync(alice, new CreateTradeRequest { ToUserId = bob.Id, OfferCoins = 10 });
        Assert.Equal(MarketErrors.TradeNotFound, Code(await Throws(() => env.Market.CancelTradeAsync(bob.Id, cancelled.OfferId))));
        Assert.Equal(TradeOfferStatus.Cancelled, (await env.Market.CancelTradeAsync(alice.Id, cancelled.OfferId)).Status);
    }

    [Fact]
    public async Task UnverifiedDetective_CanLookAround_ButCannotMoveCoinsOrItems()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var fresh = await env.AddUserAsync("Chưa xác minh", verified: false);
        var other = await env.AddUserAsync("Đã xác minh");
        var item = await env.FirstItemAsync(fresh.Id);
        var listing = (await env.Market.CreateListingAsync(other, (await env.FirstItemAsync(other.Id)).ItemId, 100)).Listing;

        Assert.Equal(MarketErrors.EmailNotVerified, Code(await Throws(() => env.Market.CreateListingAsync(fresh, item.ItemId, 100))));
        Assert.Equal(MarketErrors.EmailNotVerified, Code(await Throws(() => env.Market.BuyListingAsync(fresh, listing.ListingId))));
        Assert.Equal(MarketErrors.EmailNotVerified, Code(await Throws(() => env.Market.PlaceOrderAsync(fresh, "mag_brass", 50))));
        Assert.Equal(MarketErrors.EmailNotVerified, Code(await Throws(() => env.Market.CreateTradeAsync(fresh,
            new CreateTradeRequest { ToUserId = other.Id, OfferItemIds = new() { item.ItemId } }))));
        var offer = await env.Market.CreateTradeAsync(other, new CreateTradeRequest { ToUserId = fresh.Id, OfferCoins = 10 });
        Assert.Equal(MarketErrors.EmailNotVerified, Code(await Throws(() => env.Market.AcceptTradeAsync(fresh, offer.OfferId))));
        Assert.Equal(500L, (await env.Market.GetWalletAsync(fresh.Id)).Balance);
        Assert.NotNull(await env.Market.GetItemDetailAsync(fresh.Id, "mag_brass"));
    }

    // ------------------------------------------------------------------ rewards, idempotency, recovery

    [Fact]
    public async Task GameRewards_ArePaidOncePerPlayerPerRoom_WinMoreThanLoss()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var a = await env.AddUserAsync("A");
        var b = await env.AddUserAsync("B");
        var win = new GameResult { RoomId = "room-win", Players = new() { a.Id, b.Id }, Success = true };
        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => Task.Run(() => env.Market.GrantGameRewardsAsync(win))));
        await env.Market.GrantGameRewardsAsync(win);
        Assert.Equal(500L + 120L, (await env.Market.GetWalletAsync(a.Id)).Balance);
        Assert.Equal(500L + 120L, (await env.Market.GetWalletAsync(b.Id)).Balance);

        await env.Market.GrantGameRewardsAsync(new GameResult { RoomId = "room-loss", Players = new() { a.Id }, Success = false });
        Assert.Equal(500L + 120L + 30L, (await env.Market.GetWalletAsync(a.Id)).Balance);
        var reward = await env.Market.GetRewardAsync(a.Id, "room-win");
        Assert.NotNull(reward);
        Assert.True(reward!.Won && reward.Applied && reward.Amount == 120);
        Assert.Null(await env.Market.GetRewardAsync(b.Id, "room-loss"));
    }

    [Fact]
    public async Task GameResultStore_WiredLikeProgram_PaysTheRewardThroughTheHook_Once()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var a = await env.AddUserAsync("A");
        var b = await env.AddUserAsync("B");
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(env.Db);
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<IGameResultStore, MongoGameResultStore>();   // as in Program.cs
        services.AddScoped<ILeaderboardService, LeaderboardService>();  // the weekly chest reads the week's challenge
        services.AddScoped<IWeeklyService, WeeklyService>();
        services.AddMarket();
        await using var provider = services.BuildServiceProvider();

        for (var attempt = 0; attempt < 3; attempt++)
        {
            using var scope = provider.CreateScope();
            var store = scope.ServiceProvider.GetRequiredService<IGameResultStore>();
            await store.UpsertAsync(new GameResult
            {
                RoomId = "room-hook", CaseId = "case-hook", Players = new() { a.Id, b.Id }, Success = attempt == 0, CreatedAt = DateTime.UtcNow
            });
        }
        // The first materialization decides the reward (a win); re-materializing never pays again.
        Assert.Equal(620L, (await env.Market.GetWalletAsync(a.Id)).Balance);
        Assert.Equal(620L, (await env.Market.GetWalletAsync(b.Id)).Balance);
        Assert.Equal(2, (int)await env.Store.Rewards.CountDocumentsAsync(FilterDefinition<MarketReward>.Empty));
    }

    [Fact]
    public async Task RepeatedRequestId_ReturnsTheFirstResult_WithoutBuyingTwice()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        var items = (await env.Market.GetInventoryAsync(seller.Id)).Items;
        await env.Market.CreateListingAsync(seller, items[0].ItemId, 100);
        await env.Market.CreateListingAsync(seller, items[1].ItemId, 100);

        var first = await env.Market.IdempotentAsync(buyer.Id, "req-buy-0001", () => env.Market.BuyListingAsync(buyer,
            env.Store.Listings.Find(l => l.ItemId == items[0].ItemId).First().Id));
        var second = await env.Market.IdempotentAsync(buyer.Id, "req-buy-0001", () => env.Market.BuyListingAsync(buyer,
            env.Store.Listings.Find(l => l.ItemId == items[1].ItemId).First().Id));
        Assert.Equal(first.Sale.SaleId, second.Sale.SaleId);
        Assert.Equal(400L, (await env.Market.GetWalletAsync(buyer.Id)).Balance);
        Assert.Equal(MarketErrors.InvalidRequestId, Code(await Throws(() => env.Market.IdempotentAsync(buyer.Id, "bad id!", () => Task.FromResult(1)))));
        // A failed request can be retried with the same id.
        Assert.Equal(MarketErrors.UnknownItemType, Code(await Throws(() => env.Market.IdempotentAsync(buyer.Id, "req-buy-0002",
            () => env.Market.BuyLowestAsync(buyer, "nope", 100)))));
        var retried = await env.Market.IdempotentAsync(buyer.Id, "req-buy-0002", () => env.Market.BuyLowestAsync(buyer, items[1].Def.Id, 100));
        Assert.Equal(300L, retried.Wallet.Balance);
        Assert.Equal(5, retried.Wallet.ItemCount);
        Assert.Equal(2, (int)await env.Store.Sales.CountDocumentsAsync(FilterDefinition<MarketSale>.Empty));
    }

    [Fact]
    public async Task Recovery_FinishesABuyInterruptedAfterPayment_AndRefundsOneInterruptedBeforeTheClaim()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        var rival = await env.AddUserAsync("Đối thủ");
        await env.Market.EnsureAccountAsync(buyer.Id);
        await env.Market.EnsureAccountAsync(rival.Id);
        var items = (await env.Market.GetInventoryAsync(seller.Id)).Items;
        var created = await env.Market.CreateListingAsync(seller, items[0].ItemId, 200);
        var listing = await env.Store.Listings.Find(l => l.Id == created.Listing.ListingId).FirstAsync();

        // Crash #1: the buyer paid (step 1 written) but the process died before claiming the listing.
        var tx = await env.InsertBuyTxAsync(listing, buyer.Id, funded: true);
        await env.Store.ApplyWalletAsync(buyer.Id, $"tx:{tx.Id}:debit", -200, slotDelta: 1);
        Assert.Equal(300L, (await env.Store.FindAccountAsync(buyer.Id))!.Balance);
        var report = await env.Market.RecoverAsync(TimeSpan.Zero);
        Assert.True(report.Transactions >= 1);
        Assert.Equal(buyer.Id, (await env.Store.Items.Find(i => i.Id == listing.ItemId).FirstAsync()).OwnerId);
        Assert.Equal(MarketTxStates.Done, (await env.Store.Txs.Find(t => t.Id == tx.Id).FirstAsync()).State);
        Assert.Equal(690L, (await env.Market.GetWalletAsync(seller.Id)).Balance);
        Assert.Equal(300L, (await env.Market.GetWalletAsync(buyer.Id)).Balance);

        // Crash #2: a rival paid for the same (now sold) listing; recovery must refund, not sell twice.
        var lateTx = await env.InsertBuyTxAsync(listing, rival.Id, funded: true);
        await env.Store.ApplyWalletAsync(rival.Id, $"tx:{lateTx.Id}:debit", -200, slotDelta: 1);
        await env.Market.RecoverAsync(TimeSpan.Zero);
        Assert.Equal(MarketTxStates.Failed, (await env.Store.Txs.Find(t => t.Id == lateTx.Id).FirstAsync()).State);
        var rivalWallet = await env.Market.GetWalletAsync(rival.Id);
        Assert.Equal(500L, rivalWallet.Balance);
        Assert.Equal(3, rivalWallet.SlotsUsed);
        await env.AssertNoDuplicateItemsAsync();
        await env.AssertCoinsConservedAsync(expectedFees: 10);
    }

    [Fact]
    public async Task Recovery_ReleasesHalfOpenOrdersAndListings_AndPaysMissedRewards()
    {
        if (!Enabled) return;
        await using var env = await MarketEnv.CreateAsync();
        var user = await env.AddUserAsync("Người chơi");
        await env.Market.EnsureAccountAsync(user.Id);
        var item = await env.FirstItemAsync(user.Id);

        // An order whose escrow was taken right before a crash (still OPENING).
        var orderId = MarketStore.NewId();
        await env.Store.Orders.InsertOneAsync(new MarketBuyOrder
        {
            Id = orderId, BuyerId = user.Id, DefId = "badge_fog", Price = 150, Status = MarketOrderStatus.Opening,
            CreatedAt = DateTime.UtcNow.AddMinutes(-5), UpdatedAt = DateTime.UtcNow.AddMinutes(-5)
        });
        await env.Store.ApplyWalletAsync(user.Id, $"order:{orderId}:hold", -150, heldDelta: 150, slotDelta: 1);
        // A listing that locked its item but never became ACTIVE.
        var listingId = MarketStore.NewId();
        await env.Store.Listings.InsertOneAsync(new MarketListing
        {
            Id = listingId, SellerId = user.Id, ItemId = item.ItemId, DefId = item.Def.Id, Price = 99,
            Status = MarketListingStatus.Opening, CreatedAt = DateTime.UtcNow.AddMinutes(-5), UpdatedAt = DateTime.UtcNow.AddMinutes(-5)
        });
        await env.Store.LockItemAsync(item.ItemId, user.Id, "listing:" + listingId);
        // A finished game whose reward hook never ran.
        await env.Db.GameResults.InsertOneAsync(new GameResult
        {
            RoomId = "room-missed", CaseId = "case", Players = new() { user.Id }, Success = true, CreatedAt = DateTime.UtcNow.AddMinutes(-2)
        });

        await env.Market.RecoverAsync(TimeSpan.FromSeconds(1));
        var wallet = await env.Market.GetWalletAsync(user.Id);
        Assert.Equal(500L + 120L, wallet.Balance);
        Assert.Equal(0L, wallet.Held);
        Assert.Equal(3, wallet.SlotsUsed);
        Assert.Equal(MarketOrderStatus.Cancelled, (await env.Store.Orders.Find(o => o.Id == orderId).FirstAsync()).Status);
        Assert.Equal(MarketListingStatus.Cancelled, (await env.Store.Listings.Find(l => l.Id == listingId).FirstAsync()).Status);
        Assert.Null((await env.Store.Items.Find(i => i.Id == item.ItemId).FirstAsync()).LockedBy);
        // Running the sweep again changes nothing.
        await env.Market.RecoverAsync(TimeSpan.FromSeconds(1));
        Assert.Equal(620L, (await env.Market.GetWalletAsync(user.Id)).Balance);
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
        throw new InvalidOperationException("Expected an ApiException.");
    }

    private sealed class MarketEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private MarketEnv(MongoDbSettings settings)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db);
            Market = new MarketService(Store, NullLogger<MarketService>.Instance);
        }

        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public MarketService Market { get; }

        /// <summary>The same store with Market:TradeCoins off.</summary>
        public MarketService ItemsOnly() => new(Store, NullLogger<MarketService>.Instance, null,
            Options.Create(new MarketSettings { TradeCoins = false }));

        public static async Task<MarketEnv> CreateAsync()
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_market_{Guid.NewGuid():N}"
            };
            if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
                || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                    server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
                throw new InvalidOperationException("Market integration tests need a loopback MongoDB and a temporary database.");
            var env = new MarketEnv(settings);
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
            return new CurrentUser(user.Id, name, UserRole.Player);
        }

        public async Task<InventoryItemDto> FirstItemAsync(string userId) =>
            (await Market.GetInventoryAsync(userId)).Items.First(item => !item.Locked);

        public async Task<MarketTx> InsertBuyTxAsync(MarketListing listing, string buyerId, bool funded)
        {
            var tx = new MarketTx
            {
                Id = MarketStore.NewId(),
                Kind = MarketTxKinds.Buy,
                State = MarketTxStates.Pending,
                BuyerId = buyerId,
                SellerId = listing.SellerId,
                ListingId = listing.Id,
                ItemId = listing.ItemId,
                DefId = listing.DefId,
                Price = listing.Price,
                Fee = MarketRules.Fee(listing.Price),
                Reserved = listing.Price,
                Funded = funded,
                CreatedAt = DateTime.UtcNow.AddMinutes(-1),
                UpdatedAt = DateTime.UtcNow.AddMinutes(-1)
            };
            await Store.Txs.InsertOneAsync(tx);
            return tx;
        }

        public async Task<int> CountOpenTransactionsAsync() =>
            (int)await Store.Txs.CountDocumentsAsync(t => t.State == MarketTxStates.Pending || t.State == MarketTxStates.RollingBack);

        private long _grantedCoins;

        /// <summary>Admin grant that is remembered so <see cref="AssertCoinsConservedAsync"/> can account for it.</summary>
        public async Task<WalletDto> GrantAsync(string userId, string? defId, long coins)
        {
            var wallet = await Market.AdminGrantAsync(userId, defId, coins);
            Interlocked.Add(ref _grantedCoins, coins);
            return wallet;
        }

        /// <summary>Every coin ever created (starter, grants, rewards) is in a wallet, held by an order, or was taken as a fee.</summary>
        public async Task AssertCoinsConservedAsync(long expectedFees)
        {
            var accounts = await Store.Accounts.Find(FilterDefinition<MarketAccount>.Empty).ToListAsync();
            Assert.All(accounts, account =>
            {
                Assert.True(account.Balance >= 0, $"negative balance for {account.Id}");
                Assert.True(account.Held >= 0, $"negative held coins for {account.Id}");
                Assert.True(account.Slots <= MarketRules.InventorySlots, $"slot cap exceeded for {account.Id}");
            });
            var rewards = (await Store.Rewards.Find(r => r.Applied).ToListAsync()).Sum(r => r.Amount);
            var fees = (await Store.Sales.Find(FilterDefinition<MarketSale>.Empty).ToListAsync()).Sum(s => s.Fee);
            Assert.Equal(expectedFees, fees);
            var created = accounts.Count * MarketRules.StarterCoins + Interlocked.Read(ref _grantedCoins) + rewards;
            Assert.Equal(created - fees, accounts.Sum(account => account.Balance + account.Held));
        }

        public async Task AssertNoDuplicateItemsAsync()
        {
            var items = await Store.Items.Find(FilterDefinition<MarketItem>.Empty).ToListAsync();
            Assert.Equal(items.Count, items.Select(i => i.Id).Distinct().Count());
            var accounts = await Store.Accounts.Find(FilterDefinition<MarketAccount>.Empty).ToListAsync();
            var openOrders = await Store.Orders.Find(o => o.Held && !o.Released
                && (o.Status == MarketOrderStatus.Active || o.Status == MarketOrderStatus.Pending)).ToListAsync();
            foreach (var account in accounts)
            {
                var owned = items.Count(i => i.OwnerId == account.Id);
                var reserved = openOrders.Count(o => o.BuyerId == account.Id);
                Assert.Equal(owned + reserved, account.Slots);
            }
        }

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
