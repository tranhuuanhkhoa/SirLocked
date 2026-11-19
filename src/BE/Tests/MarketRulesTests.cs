using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

public class MarketRulesTests
{
    private static readonly DateTime T0 = new(2026, 10, 20, 3, 0, 0, DateTimeKind.Utc);

    // ----- fee math

    [Fact]
    public void Fee_IsFivePercentRoundedHalfUp_WithOneXuMinimum()
    {
        Assert.Equal(0L, MarketRules.Fee(0));
        Assert.Equal(1L, MarketRules.Fee(2));        // 0.1 → 0 → minimum 1
        Assert.Equal(1L, MarketRules.Fee(10));       // 0.5 → 1
        Assert.Equal(1L, MarketRules.Fee(29));       // 1.45 → 1
        Assert.Equal(2L, MarketRules.Fee(30));       // 1.5 → 2
        Assert.Equal(6L, MarketRules.Fee(120));
        Assert.Equal(58L, MarketRules.Fee(1150));    // Market.dc.html sample: 57.5 → 58
        Assert.Equal(50_000L, MarketRules.Fee(1_000_000));
    }

    [Fact]
    public void SellerProceeds_IsPriceMinusFee_AndNeverZeroAtMinimumPrice()
    {
        Assert.Equal(1092L, MarketRules.SellerProceeds(1150));
        Assert.Equal(1L, MarketRules.SellerProceeds(MarketRules.MinPrice));
        for (var price = MarketRules.MinPrice; price < 5000; price += 7)
        {
            Assert.True(MarketRules.SellerProceeds(price) >= 1);
            Assert.Equal(price, MarketRules.SellerProceeds(price) + MarketRules.Fee(price));
        }
    }

    [Fact]
    public void ValidatePrice_AcceptsOnlyTheSupportedRange()
    {
        Assert.Equal(MarketErrors.InvalidPrice, MarketRules.ValidatePrice(-5));
        Assert.Equal(MarketErrors.InvalidPrice, MarketRules.ValidatePrice(1));
        Assert.Null(MarketRules.ValidatePrice(2));
        Assert.Null(MarketRules.ValidatePrice(1_000_000));
        Assert.Equal(MarketErrors.InvalidPrice, MarketRules.ValidatePrice(1_000_001));
    }

    [Fact]
    public void Rewards_PayMoreForAWinThanForALoss()
    {
        Assert.Equal(120L, MarketRules.RewardFor(true));
        Assert.True(MarketRules.RewardFor(true) > MarketRules.RewardFor(false));
        Assert.True(MarketRules.RewardFor(false) > 0);
    }

    // ----- order matching

    [Fact]
    public void MatchPrice_UsesTheRestingSidesPrice()
    {
        // Order rested first → a new listing sells at the order's (higher) price.
        Assert.Equal(250L, MarketRules.MatchPrice(200, T0.AddMinutes(5), 250, T0));
        // Listing rested first → a new order buys at the listing's (lower) price.
        Assert.Equal(200L, MarketRules.MatchPrice(200, T0, 250, T0.AddMinutes(5)));
        Assert.True(MarketRules.Crosses(200, 200));
        Assert.False(MarketRules.Crosses(201, 200));
    }

    [Fact]
    public void SelectBidsFor_TakesBestPriceThenOldest_AndSkipsOwnInactiveAndLowerBids()
    {
        var listing = new MarketListing { Id = "L", SellerId = "seller", DefId = "mag_brass", Price = 200, Status = MarketListingStatus.Active, CreatedAt = T0 };
        var orders = new[]
        {
            Order("o-low", "b1", 150, T0),
            Order("o-own", "seller", 400, T0),
            Order("o-other-type", "b2", 500, T0, defId: "pins_iron"),
            Order("o-inactive", "b3", 450, T0, status: MarketOrderStatus.Pending),
            Order("o-300-new", "b4", 300, T0.AddMinutes(2)),
            Order("o-300-old", "b5", 300, T0.AddMinutes(1)),
            Order("o-200", "b6", 200, T0),
        };
        var picked = MarketRules.SelectBidsFor(listing, orders).Select(o => o.Id).ToList();
        Assert.Equal(new[] { "o-300-old", "o-300-new", "o-200" }, picked);
    }

    [Fact]
    public void SelectAsksFor_TakesCheapestThenOldest_AndSkipsOwnAndDearerListings()
    {
        var order = Order("O", "buyer", 300, T0);
        var listings = new[]
        {
            Listing("l-own", "buyer", 100, T0),
            Listing("l-dear", "s1", 301, T0),
            Listing("l-250", "s2", 250, T0),
            Listing("l-120-new", "s3", 120, T0.AddMinutes(3)),
            Listing("l-120-old", "s4", 120, T0.AddMinutes(1)),
            Listing("l-sold", "s5", 50, T0, status: MarketListingStatus.Sold),
        };
        var picked = MarketRules.SelectAsksFor(order, listings).Select(l => l.Id).ToList();
        Assert.Equal(new[] { "l-120-old", "l-120-new", "l-250" }, picked);
    }

    // ----- escrow / slots

    [Fact]
    public void Slots_AreReservedBeforeAndReleasedAfterATransfer()
    {
        Assert.Equal(2, MarketRules.ReservePart(2));
        Assert.Equal(0, MarketRules.ReservePart(-1));
        Assert.Equal(-1, MarketRules.ReleasePart(-1));
        Assert.Equal(0, MarketRules.ReleasePart(3));
        Assert.True(MarketRules.HasRoom(11, 1));
        Assert.False(MarketRules.HasRoom(12, 1));
        Assert.True(MarketRules.HasRoom(12, 0));
        Assert.True(MarketRules.HasRoom(12, -2));
        Assert.False(MarketRules.HasRoom(10, 3));
    }

    // ----- trade validation

    [Fact]
    public void TradeDraft_RejectsSelfEmptyOversizedDuplicateAndInvalidCoins()
    {
        Assert.Equal(MarketErrors.TradeSelf, MarketRules.ValidateTradeDraft(Draft(to: "a")));
        Assert.Equal(MarketErrors.TradeSelf, MarketRules.ValidateTradeDraft(Draft(to: " ")));
        Assert.Equal(MarketErrors.TradeEmpty, MarketRules.ValidateTradeDraft(Draft()));
        Assert.Equal(MarketErrors.TradeTooManyItems,
            MarketRules.ValidateTradeDraft(Draft(offer: Enumerable.Range(0, 7).Select(i => $"i{i}").ToArray())));
        Assert.Equal(MarketErrors.TradeInvalidCoins, MarketRules.ValidateTradeDraft(Draft(offerCoins: -1)));
        Assert.Equal(MarketErrors.TradeInvalidCoins, MarketRules.ValidateTradeDraft(Draft(requestCoins: 1_000_001)));
        Assert.Equal(MarketErrors.TradeDuplicateItem, MarketRules.ValidateTradeDraft(Draft(offer: new[] { "x", "x" })));
        Assert.Equal(MarketErrors.TradeDuplicateItem, MarketRules.ValidateTradeDraft(Draft(offer: new[] { "x" }, request: new[] { "x" })));
        Assert.Equal(MarketErrors.TradeDuplicateItem, MarketRules.ValidateTradeDraft(Draft(offer: new[] { "" })));
        Assert.Equal(MarketErrors.TradeMessageTooLong,
            MarketRules.ValidateTradeDraft(Draft(offer: new[] { "x" }, message: new string('a', MarketRules.MaxTradeMessageLength + 1))));
    }

    [Fact]
    public void TradeDraft_WithCoinsOff_RefusesAnyCoins_AndNeedsAnItem()
    {
        Assert.Equal(MarketErrors.TradeCoinsNotAllowed, MarketRules.ValidateTradeDraft(Draft(requestCoins: 100), allowCoins: false));
        Assert.Equal(MarketErrors.TradeCoinsNotAllowed,
            MarketRules.ValidateTradeDraft(Draft(offer: new[] { "a1" }, offerCoins: 1), allowCoins: false));
        Assert.Equal(MarketErrors.TradeEmpty, MarketRules.ValidateTradeDraft(Draft(), allowCoins: false));
        Assert.Null(MarketRules.ValidateTradeDraft(Draft(offer: new[] { "a1" }, request: new[] { "b1" }), allowCoins: false));
        Assert.Null(MarketRules.ValidateTradeDraft(Draft(offer: new[] { "a1" }), allowCoins: false));
    }

    [Fact]
    public void TradeDraft_AcceptsGiftsRequestsAndSwaps()
    {
        Assert.Null(MarketRules.ValidateTradeDraft(Draft(offer: new[] { "a1" })));
        Assert.Null(MarketRules.ValidateTradeDraft(Draft(requestCoins: 100)));
        Assert.Null(MarketRules.ValidateTradeDraft(Draft(offer: new[] { "a1", "a2" }, offerCoins: 50, request: new[] { "b1" },
            message: "Đổi kính lúp + bộ ghim lấy đồng hồ của bạn nhé?")));
    }

    [Fact]
    public void TradeItems_MustStillBelongToTheirSideAndBeUnlocked()
    {
        var items = new Dictionary<string, MarketItem>
        {
            ["a1"] = new() { Id = "a1", OwnerId = "a" },
            ["a2"] = new() { Id = "a2", OwnerId = "a", LockedBy = "listing:L1" },
            ["b1"] = new() { Id = "b1", OwnerId = "b" },
            ["b2"] = new() { Id = "b2", OwnerId = "b", LockedBy = "tx:T1" },
        };
        Assert.Null(MarketRules.ValidateTradeItems(new[] { "a1" }, new[] { "b1" }, "a", "b", items));
        Assert.Equal(MarketErrors.TradeItemUnavailable, MarketRules.ValidateTradeItems(new[] { "a2" }, Array.Empty<string>(), "a", "b", items));
        Assert.Equal(MarketErrors.TradeItemUnavailable, MarketRules.ValidateTradeItems(new[] { "b1" }, Array.Empty<string>(), "a", "b", items));
        Assert.Equal(MarketErrors.TradeItemUnavailable, MarketRules.ValidateTradeItems(Array.Empty<string>(), new[] { "gone" }, "a", "b", items));
        Assert.Equal(MarketErrors.TradeItemUnavailable, MarketRules.ValidateTradeItems(Array.Empty<string>(), new[] { "b2" }, "a", "b", items));
        // The accepting transaction's own lock is fine.
        Assert.Null(MarketRules.ValidateTradeItems(Array.Empty<string>(), new[] { "b2" }, "a", "b", items, allowedLock: "tx:T1"));
    }

    [Fact]
    public void TradeBalances_CheckCoinsAndSlotsOnBothSides()
    {
        var from = new MarketAccount { Id = "a", Balance = 100, Slots = 11 };
        var to = new MarketAccount { Id = "b", Balance = 40, Slots = 12 };
        Assert.Equal(MarketErrors.TradeSenderFunds, MarketRules.ValidateTradeBalances(from, to, 0, 0, 101, 0));
        Assert.Equal(MarketErrors.TradeSenderInventory, MarketRules.ValidateTradeBalances(from, to, 0, 2, 0, 0));
        Assert.Equal(MarketErrors.TradeRecipientFunds, MarketRules.ValidateTradeBalances(from, to, 1, 1, 0, 41));
        Assert.Equal(MarketErrors.TradeRecipientInventory, MarketRules.ValidateTradeBalances(from, to, 1, 0, 0, 0));
        // A 1-for-1 swap needs no free slot even with a full bag.
        Assert.Null(MarketRules.ValidateTradeBalances(from, to, 1, 1, 100, 40));
        Assert.True(MarketRules.IsRecipientSideFailure(MarketErrors.TradeRecipientFunds));
        Assert.True(MarketRules.IsRecipientSideFailure(MarketErrors.TradeRecipientInventory));
        Assert.False(MarketRules.IsRecipientSideFailure(MarketErrors.TradeSenderFunds));
        Assert.False(MarketRules.IsRecipientSideFailure(MarketErrors.TradeItemUnavailable));
    }

    [Fact]
    public void Messages_AreTrimmedAndStrippedOfControlCharacters()
    {
        Assert.Equal(string.Empty, MarketRules.SanitizeMessage(null));
        Assert.Equal("Đổi nhé bạn", MarketRules.SanitizeMessage("  Đổi nhé\nbạn \u0007 "));
    }

    // ----- price history

    [Fact]
    public void History_AveragesPerDay_CarriesForward_AndReportsLowHighChange()
    {
        var now = new DateTime(2026, 10, 25, 5, 0, 0, DateTimeKind.Utc);   // 12:00 on 25/10 in Vietnam
        var sales = new (DateTime, long)[]
        {
            (now.AddDays(-40), 9999),                 // outside the 30-day window
            (now.AddDays(-9), 100), (now.AddDays(-9), 140),
            (now.AddDays(-5), 130),
            (now.AddHours(-1), 150),
        };
        var history = MarketRules.BuildHistory(MarketRules.AggregateDaily(sales), now, 10);
        Assert.Equal(10, history.Line.Count);
        Assert.Equal(120L, history.Line[0]);            // (100 + 140) / 2, nine days ago
        Assert.Equal(120L, history.Line[3]);            // carried forward
        Assert.Equal(130L, history.Line[4]);
        Assert.Equal(150L, history.Line[9]);
        Assert.Equal(100L, history.Low);
        Assert.Equal(150L, history.High);
        Assert.Equal(25, history.ChangePercent);        // 120 → 150
        Assert.Equal(4, history.Volume);
        Assert.Equal(2, history.Days[0].Volume);
    }

    [Fact]
    public void History_WithoutSales_IsEmpty_AndUsesVietnamDays()
    {
        var now = new DateTime(2026, 10, 25, 5, 0, 0, DateTimeKind.Utc);
        var empty = MarketRules.BuildHistory(Array.Empty<DailyAggregate>(), now, 30);
        Assert.Equal(30, empty.Days.Count);
        Assert.True(empty.Line.All(value => value is null));
        Assert.Null(empty.Low);
        Assert.Null(empty.ChangePercent);
        Assert.Equal(0, empty.Volume);

        // 18:00 UTC on the 24th is already the 25th in Vietnam (UTC+7).
        Assert.Equal(new DateOnly(2026, 10, 25), MarketRules.MarketDay(new DateTime(2026, 10, 24, 18, 0, 0, DateTimeKind.Utc)));
        Assert.Equal(new DateOnly(2026, 10, 24), MarketRules.MarketDay(new DateTime(2026, 10, 24, 16, 59, 0, DateTimeKind.Utc)));
        var start = MarketRules.WindowStartUtc(now, 1);
        Assert.Equal(new DateTime(2026, 10, 24, 17, 0, 0, DateTimeKind.Utc), start);
    }

    // ----- catalog & search

    [Fact]
    public void Catalog_CoversEveryCategoryAndRarity_WithUniqueIdsAndCommonStarterItems()
    {
        Assert.Equal(MarketCatalog.All.Count, MarketCatalog.All.Select(def => def.Id).Distinct().Count());
        Assert.All(MarketCategories.All, category => Assert.Contains(MarketCatalog.All, def => def.Category == category));
        Assert.All(MarketRarities.All, rarity => Assert.Contains(MarketCatalog.All, def => def.Rarity == rarity));
        Assert.All(MarketCatalog.All, def =>
        {
            Assert.True(MarketCategories.IsValid(def.Category));
            Assert.True(MarketRarities.IsValid(def.Rarity));
            Assert.True(def.Name.Length > 0 && def.Description.Length > 0);
            Assert.True(MarketRules.ValidatePrice(def.ReferencePrice) is null);
        });
        Assert.All(MarketCatalog.StarterItemIds, id => Assert.Equal(MarketRarities.Common, MarketCatalog.Find(id)!.Rarity));
        Assert.Equal("Kính lúp Pha lê", MarketCatalog.Find("mag_crystal")!.Name);
        Assert.Null(MarketCatalog.Find("nope"));
    }

    [Fact]
    public void Search_IgnoresCaseAndVietnameseDiacritics()
    {
        Assert.Equal("kinh lup", MarketRules.NormalizeSearch("  Kính   Lúp "));
        Assert.Equal("dong ho qua quyt", MarketRules.NormalizeSearch("Đồng hồ quả quýt"));
        Assert.True(MarketRules.MatchesSearch(MarketCatalog.Find("watch_pocket")!, MarketRules.NormalizeSearch("dong ho")));
        Assert.True(MarketRules.MatchesSearch(MarketCatalog.Find("watch_pocket")!, MarketRules.NormalizeSearch("pocket")));
        Assert.False(MarketRules.MatchesSearch(MarketCatalog.Find("watch_pocket")!, MarketRules.NormalizeSearch("kính")));
    }

    [Fact]
    public void StarterItemIds_AreDeterministicAndDistinct()
    {
        var first = MarketService.StarterItemId("650000000000000000000001", 0);
        Assert.Equal(first, MarketService.StarterItemId("650000000000000000000001", 0));
        Assert.Equal(24, first.Length);
        Assert.True(first.All(Uri.IsHexDigit));
        Assert.False(first == MarketService.StarterItemId("650000000000000000000001", 1));
        Assert.False(first == MarketService.StarterItemId("650000000000000000000002", 0));
    }

    // ----- helpers

    private static MarketBuyOrder Order(string id, string buyer, long price, DateTime at,
        string defId = "mag_brass", string status = MarketOrderStatus.Active) =>
        new() { Id = id, BuyerId = buyer, DefId = defId, Price = price, CreatedAt = at, Status = status };

    private static MarketListing Listing(string id, string seller, long price, DateTime at,
        string defId = "mag_brass", string status = MarketListingStatus.Active) =>
        new() { Id = id, SellerId = seller, DefId = defId, Price = price, CreatedAt = at, Status = status };

    private static TradeDraft Draft(
        string to = "b", string[]? offer = null, long offerCoins = 0, string[]? request = null, long requestCoins = 0,
        string? message = null) =>
        new("a", to, offer ?? Array.Empty<string>(), offerCoins, request ?? Array.Empty<string>(), requestCoins, message);
}
