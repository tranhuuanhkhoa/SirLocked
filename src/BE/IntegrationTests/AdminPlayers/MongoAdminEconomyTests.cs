using System.Text;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Review;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.IntegrationTests.AdminPlayers;

/// <summary>
/// The market desk, stuck operations, hung rooms and reviews against a real (standalone) MongoDB.
/// Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoAdminEconomyTests
{
    private static readonly CurrentUser Admin = AdminPlayersEnv.Admin;
    private const string Rare = "VC-0391";

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static string Code(ApiException error) => ((ApiErrorDetails)error.Errors!).Code;

    private static async Task<MarketItem> GrantAsync(AdminPlayersEnv env, CurrentUser user, string defId = Rare)
    {
        var result = await env.Operations.GrantItemAsync(Admin, user.Id,
            new AdminGrantItemRequest { DefId = defId, Reason = "Quà sự kiện", IdempotencyKey = AdminPlayersEnv.Key() });
        return await env.Store.Items.Find(i => i.Id == result.ItemId).FirstAsync();
    }

    // ------------------------------------------------------------------ indexes

    [Fact]
    public async Task IndexesLiveBesideTheRestOfTheApps_InEitherOrder_AndAreSafeToRepeat()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();

        await env.Db.EnsureIndexesAsync();
        await env.AdminStore.EnsureIndexesAsync();
        await env.Db.EnsureIndexesAsync();

        var names = await (await env.Store.Accounts.Indexes.ListAsync()).ToListAsync();
        Assert.Contains(names, index => index["name"] == "ix_marketAccounts_balance");
        var results = await (await env.Db.GameResults.Indexes.ListAsync()).ToListAsync();
        Assert.Contains(results, index => index["name"] == "ix_gameResults_players_createdAt");
        var reviews = await (await env.Db.Reviews.Indexes.ListAsync()).ToListAsync();
        Assert.Contains(reviews, index => index["name"] == "ix_reviews_createdAt");
    }

    // ------------------------------------------------------------------ removing a listing

    [Fact]
    public async Task RemovingAListing_ReturnsTheItemToTheSeller_AndPaysNobody()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var seller = await env.AddUserAsync();
        var item = await GrantAsync(env, seller);
        var listing = (await env.Market.CreateListingAsync(seller, item.Id, 900)).Listing;
        var balance = (await env.AccountAsync(seller.Id)).Balance;

        var removed = await env.Economy.RemoveListingAsync(Admin, listing.ListingId, "Giá bất thường");

        Assert.Equal(MarketListingStatus.Cancelled, removed.Status);
        var free = await env.Store.Items.Find(i => i.Id == item.Id).FirstAsync();
        Assert.Null(free.LockedBy);
        Assert.Equal(seller.Id, free.OwnerId);
        Assert.Equal(balance, (await env.AccountAsync(seller.Id)).Balance);
        var entry = Assert.Single(await env.AuditEntriesAsync("listing.remove"));
        Assert.Equal("Giá bất thường", entry.Reason);
        Assert.Equal(listing.ListingId, entry.TargetId);
    }

    [Fact]
    public async Task RemovingAListingTwice_IsAConflict_AndAuditedOnce()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var seller = await env.AddUserAsync();
        var item = await GrantAsync(env, seller);
        var listing = (await env.Market.CreateListingAsync(seller, item.Id, 900)).Listing;
        await env.Economy.RemoveListingAsync(Admin, listing.ListingId, "Giá bất thường");

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Economy.RemoveListingAsync(Admin, listing.ListingId, "Giá bất thường"));

        Assert.Equal(409, error.StatusCode);
        Assert.Single(await env.AuditEntriesAsync("listing.remove"));
    }

    [Fact]
    public async Task RemovingAListingNeedsAReason()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var seller = await env.AddUserAsync();
        var item = await GrantAsync(env, seller);
        var listing = (await env.Market.CreateListingAsync(seller, item.Id, 900)).Listing;

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Economy.RemoveListingAsync(Admin, listing.ListingId, " "));

        Assert.Equal(AdminPlayerErrors.ReasonRequired, Code(error));
        Assert.Equal(MarketListingStatus.Active, (await env.Store.Listings.Find(l => l.Id == listing.ListingId).FirstAsync()).Status);
    }

    // ------------------------------------------------------------------ cancelling a buy order

    [Fact]
    public async Task CancellingABuyOrder_ReturnsTheCoinsAndTheSlot()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var buyer = await env.AddUserAsync();
        var start = await env.AccountAsync(buyer.Id);
        var order = (await env.Market.PlaceOrderAsync(buyer, Rare, 300)).Order;
        Assert.Equal(300, (await env.AccountAsync(buyer.Id)).Held);

        var cancelled = await env.Economy.CancelOrderAsync(Admin, order.OrderId, "Lệnh mua giá ảo");

        Assert.Equal(MarketOrderStatus.Cancelled, cancelled.Status);
        var after = await env.AccountAsync(buyer.Id);
        Assert.Equal(start.Balance, after.Balance);
        Assert.Equal(0, after.Held);
        Assert.Equal(start.Slots, after.Slots);
        Assert.Single(await env.AuditEntriesAsync("order.cancel"));
    }

    [Fact]
    public async Task CancellingAnOrderTwice_PaysBackOnce()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var buyer = await env.AddUserAsync();
        var start = (await env.AccountAsync(buyer.Id)).Balance;
        var order = (await env.Market.PlaceOrderAsync(buyer, Rare, 300)).Order;
        await env.Economy.CancelOrderAsync(Admin, order.OrderId, "Lệnh mua giá ảo");

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Economy.CancelOrderAsync(Admin, order.OrderId, "Lệnh mua giá ảo"));

        Assert.Equal(409, error.StatusCode);
        Assert.Equal(start, (await env.AccountAsync(buyer.Id)).Balance);
    }

    // ------------------------------------------------------------------ the desk

    [Fact]
    public async Task ListingsFilterByDefSellerAndPrice_AndFlagOddPrices()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var an = await env.AddUserAsync("An");
        var binh = await env.AddUserAsync("Bình");
        var a = await GrantAsync(env, an);
        var b = await GrantAsync(env, binh);
        var c = await GrantAsync(env, binh, "VC-0405");
        var reference = env.Market.DefDto(Rare).ReferencePrice;
        var odd = reference * 10;
        await env.Market.CreateListingAsync(an, a.Id, odd);
        await env.Market.CreateListingAsync(binh, b.Id, reference);
        await env.Market.CreateListingAsync(binh, c.Id, reference);

        var all = await env.Economy.ListingsAsync(new AdminMarketQuery());
        Assert.Equal(3, all.Total);
        var byDef = await env.Economy.ListingsAsync(new AdminMarketQuery(DefId: Rare));
        Assert.Equal(2, byDef.Total);
        var bySeller = await env.Economy.ListingsAsync(new AdminMarketQuery(User: "Bình"));
        Assert.Equal(2, bySeller.Total);
        Assert.All(bySeller.Items, row => Assert.Equal(binh.Id, row.UserId));
        var byPrice = await env.Economy.ListingsAsync(new AdminMarketQuery(MinPrice: odd));
        Assert.Equal(AdminEconomyRules.PriceHigh, byPrice.Items.Single().PriceFlag);
        Assert.Equal(2, (await env.Economy.ListingsAsync(new AdminMarketQuery(MaxPrice: reference))).Total);
    }

    [Fact]
    public async Task SalesFilter_AndExportAsCsv()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var seller = await env.AddUserAsync("=Người, bán");
        var buyer = await env.AddUserAsync("Người mua");
        var item = await GrantAsync(env, seller);
        var listing = (await env.Market.CreateListingAsync(seller, item.Id, 100)).Listing;
        await env.Market.BuyListingAsync(buyer, listing.ListingId);

        var sales = await env.Economy.SalesAsync(new AdminMarketQuery(User: "Người mua"));
        var row = sales.Items.Single();
        Assert.Equal(100, row.Price);
        Assert.Equal(MarketRules.Fee(100), row.Fee);
        Assert.Equal("Người mua", row.BuyerName);
        Assert.Empty((await env.Economy.SalesAsync(new AdminMarketQuery(DefId: "VC-0405"))).Items);
        Assert.Empty((await env.Economy.SalesAsync(new AdminMarketQuery(To: DateTime.UtcNow.AddDays(-1)))).Items);

        var csv = Encoding.UTF8.GetString(await env.Economy.ExportSalesCsvAsync(new AdminMarketQuery()));
        var lines = csv.TrimStart('﻿').Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(2, lines.Length);
        Assert.StartsWith("at,defId,name,price,fee,sellerId,seller,buyerId,buyer,listingId", lines[0]);
        // A name with a comma stays one field, and cannot run as a formula.
        Assert.Contains("\"'=Người, bán\"", lines[1]);
    }

    [Fact]
    public async Task TradesAreListedNewestFirst()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var an = await env.AddUserAsync("An");
        var binh = await env.AddUserAsync("Bình");
        var item = await GrantAsync(env, an);
        await env.Market.CreateTradeAsync(an, new CreateTradeRequestFixture(binh.Id, item.Id).Build());

        var trades = await env.Economy.TradesAsync(new AdminMarketQuery());

        var trade = trades.Items.Single();
        Assert.Equal("An", trade.FromName);
        Assert.Equal("Bình", trade.ToName);
        Assert.Equal(TradeOfferStatus.Pending, trade.Status);
        Assert.Equal(Rare, trade.FromItems.Single().Id);
    }

    // ------------------------------------------------------------------ the overview

    [Fact]
    public async Task TheOverview_AddsUpCoinsItemsAndFlows()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var seller = await env.AddUserAsync("Người bán");
        var buyer = await env.AddUserAsync("Người mua");
        var rich = await env.AddUserAsync("Đại gia");
        await env.Operations.AdjustCoinsAsync(Admin, rich.Id, new AdminCoinsRequest { Amount = 5000, Reason = "Giải thưởng", IdempotencyKey = AdminPlayersEnv.Key() });
        await env.Operations.AdjustCoinsAsync(Admin, buyer.Id, new AdminCoinsRequest { Amount = -100, Reason = "Phạt", IdempotencyKey = AdminPlayersEnv.Key() });
        var item = await GrantAsync(env, seller);
        var listing = (await env.Market.CreateListingAsync(seller, item.Id, 100)).Listing;
        await env.Market.BuyListingAsync(buyer, listing.ListingId);
        await env.Market.PlaceOrderAsync(buyer, "VC-0405", 50);
        await env.Chests.BuyKeyAsync(rich, "chest_np", AdminPlayersEnv.Key());
        var keyPrice = (await env.Store.ChestPurchases.Find(FilterDefinition<ChestPurchase>.Empty).FirstAsync()).Price;
        await env.Market.GrantGameRewardsAsync(new GameResult { RoomId = "room-1", Players = new List<string> { seller.Id }, Success = true });

        var overview = await env.Economy.OverviewAsync(7);

        var accounts = await env.Store.Accounts.Find(FilterDefinition<MarketAccount>.Empty).ToListAsync();
        Assert.Equal(accounts.Sum(a => a.Balance), overview.CoinsInCirculation);
        Assert.Equal(50, overview.CoinsHeld);
        var items = await env.Store.Items.CountDocumentsAsync(FilterDefinition<MarketItem>.Empty);
        Assert.Equal(items, overview.ItemsByRarity.Sum(row => row.Count));
        Assert.Equal(items, overview.ItemsByCategory.Sum(row => row.Count));
        Assert.Equal(MarketRules.Fee(100), overview.Totals.MarketFees);
        Assert.Equal(keyPrice, overview.Totals.ChestShop);
        Assert.Equal(5000, overview.Totals.AdminIn);
        Assert.Equal(100, overview.Totals.AdminOut);
        Assert.Equal(MarketRules.StarterCoins * 3, overview.Totals.Starter);
        Assert.Equal(MarketRules.WinReward, overview.Totals.GameRewards);
        Assert.Equal(7, overview.Days.Count);
        // Every coin that exists is explained by these flows: it is how a leak would show.
        Assert.Equal(overview.CoinsInCirculation + overview.CoinsHeld, overview.Days.Sum(day => day.Net));
        Assert.Equal("Đại gia", overview.Richest.First().FullName);
        Assert.Equal(30, (await env.Economy.OverviewAsync(30)).Days.Count);
    }

    [Fact]
    public async Task TheDashboardCountsToday()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var fresh = await env.AddUserAsync("Mới");
        await env.AddUserAsync("Cũ", createdAt: DateTime.UtcNow.AddDays(-3));
        await env.Db.GameResults.InsertOneAsync(new GameResult
        {
            Id = ObjectId.GenerateNewId().ToString(), RoomId = "r1", CaseId = "c", Players = new List<string> { fresh.Id },
        });
        await env.Db.GameResults.InsertOneAsync(new GameResult
        {
            Id = ObjectId.GenerateNewId().ToString(), RoomId = "r2", CaseId = "c", Players = new List<string> { fresh.Id }, CreatedAt = DateTime.UtcNow.AddDays(-3),
        });
        await env.Chests.AdminGrantAsync(fresh.Id, "chest_np", 1, 1);
        await env.Chests.OpenAsync(fresh, "chest_np", AdminPlayersEnv.Key());
        await env.Store.PlayerProgress.InsertOneAsync(new PlayerProgress { Id = fresh.Id, AvatarUrl = "https://img.test/a.webp", Avatar = "upload" });

        var dashboard = await env.Economy.DashboardAsync();

        Assert.Equal(1, dashboard.NewPlayersToday);
        Assert.Equal(1, dashboard.GamesToday);
        Assert.Equal(1, dashboard.ChestOpensToday);
        Assert.Equal((await env.Store.Accounts.Find(FilterDefinition<MarketAccount>.Empty).ToListAsync()).Sum(a => a.Balance), dashboard.CoinsInCirculation);
        Assert.Equal(0, dashboard.StuckOperations);
        Assert.Equal(1, dashboard.PendingAvatars);
    }

    // ------------------------------------------------------------------ anomalies

    [Fact]
    public async Task AnomaliesFlagPricesFunnelsAndPairs_AndTouchNothing()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var main = await env.AddUserAsync("Tài khoản chính", createdAt: DateTime.UtcNow.AddYears(-1));
        var fresh = await env.AddUserAsync("Tài khoản mới");
        var friend = await env.AddUserAsync("Bạn", createdAt: DateTime.UtcNow.AddYears(-1));
        var odd = await GrantAsync(env, friend);
        var reference = env.Market.DefDto(Rare).ReferencePrice;
        var listing = (await env.Market.CreateListingAsync(friend, odd.Id, reference * 20)).Listing;
        var now = DateTime.UtcNow;
        await env.Store.Trades.InsertManyAsync(new[]
        {
            Accepted(fresh, main, coins: 500, now),
        }.Concat(Enumerable.Range(0, AdminEconomyRules.RepeatedPairTrades).Select(i =>
            i % 2 == 0 ? Accepted(friend, main, 1, now) : Accepted(main, friend, 1, now))));
        var balance = (await env.AccountAsync(friend.Id)).Balance;

        var anomalies = await env.Economy.AnomaliesAsync();

        var price = anomalies.Prices.Single();
        Assert.Equal(listing.ListingId, price.ListingId);
        Assert.Equal(AdminEconomyRules.PriceHigh, price.Flag);
        var funnel = anomalies.Funnels.Single();
        Assert.Equal(main.Id, funnel.ReceiverId);
        Assert.Equal("Tài khoản chính", funnel.ReceiverName);
        var pair = anomalies.RepeatedPairs.Single();
        Assert.Equal(AdminEconomyRules.RepeatedPairTrades, pair.Trades);
        // Only flagged: the listing is still up and nobody's coins moved.
        Assert.Equal(MarketListingStatus.Active, (await env.Store.Listings.Find(l => l.Id == listing.ListingId).FirstAsync()).Status);
        Assert.Equal(balance, (await env.AccountAsync(friend.Id)).Balance);
    }

    private static TradeOffer Accepted(CurrentUser from, CurrentUser to, long coins, DateTime at) => new()
    {
        Id = MarketStore.NewId(),
        FromUserId = from.Id,
        FromName = from.FullName,
        ToUserId = to.Id,
        ToName = to.FullName,
        FromCoins = coins,
        Status = TradeOfferStatus.Accepted,
        CreatedAt = at,
        UpdatedAt = at,
        RespondedAt = at,
    };

    // ------------------------------------------------------------------ stuck operations

    [Fact]
    public async Task StuckOperations_AreFoundAfterFiveMinutes_AndRecoveryFinishesThem()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        await env.Chests.AdminGrantAsync(user.Id, "chest_np", 1, 1);
        var old = DateTime.UtcNow.AddMinutes(-6);
        var opening = new ChestOpening
        {
            Id = $"{user.Id}:{Guid.NewGuid():N}",
            UserId = user.Id,
            ChestDefId = "chest_np",
            KeyDefId = "key_np",
            RewardDefId = Rare,
            RewardItemId = MarketStore.NewId(),
            CreatedAt = old,
            UpdatedAt = old,
        };
        await env.Store.ChestOpenings.InsertOneAsync(opening);
        var recent = new ChestPurchase
        {
            Id = $"{user.Id}:{Guid.NewGuid():N}",
            UserId = user.Id,
            ChestDefId = "chest_np",
            DefId = "key_np",
            Price = 10,
            ItemId = MarketStore.NewId(),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        await env.Store.ChestPurchases.InsertOneAsync(recent);

        var stuck = await env.Economy.StuckAsync();

        var row = stuck.Items.Single();
        Assert.Equal(AdminEconomyRules.StuckChestOpening, row.Kind);
        Assert.Equal(opening.Id, row.Id);
        Assert.Equal(user.Id, row.UserId);
        Assert.True(row.AgeSeconds >= 300);
        Assert.Equal(1, (await env.Economy.DashboardAsync()).StuckOperations);

        var report = await env.Economy.RecoverAsync(Admin, "Chạy tay sau sự cố");

        Assert.True(report.Resumed >= 1);
        Assert.Empty((await env.Economy.StuckAsync()).Items);
        Assert.Equal(ChestOpeningStates.Done, (await env.Store.ChestOpenings.Find(o => o.Id == opening.Id).FirstAsync()).State);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Id == opening.RewardItemId));
        var entry = Assert.Single(await env.AuditEntriesAsync("economy.recover"));
        Assert.Equal("Chạy tay sau sự cố", entry.Reason);
    }

    [Fact]
    public async Task EveryKindOfStuckOperationIsListed()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var old = DateTime.UtcNow.AddMinutes(-10);
        await env.Store.Listings.InsertOneAsync(new MarketListing { Id = MarketStore.NewId(), SellerId = user.Id, DefId = Rare, ItemId = "i", Price = 5, Status = MarketListingStatus.Opening, CreatedAt = old, UpdatedAt = old });
        await env.Store.Listings.InsertOneAsync(new MarketListing { Id = MarketStore.NewId(), SellerId = user.Id, DefId = Rare, ItemId = "i", Price = 5, Status = MarketListingStatus.Pending, CreatedAt = old, UpdatedAt = old });
        await env.Store.Listings.InsertOneAsync(new MarketListing { Id = MarketStore.NewId(), SellerId = user.Id, DefId = Rare, ItemId = "i", Price = 5, Status = MarketListingStatus.Active, CreatedAt = old, UpdatedAt = old });
        await env.Store.Orders.InsertOneAsync(new MarketBuyOrder { Id = MarketStore.NewId(), BuyerId = user.Id, DefId = Rare, Price = 5, Status = MarketOrderStatus.Pending, CreatedAt = old, UpdatedAt = old });
        await env.Store.Orders.InsertOneAsync(new MarketBuyOrder { Id = MarketStore.NewId(), BuyerId = user.Id, DefId = Rare, Price = 5, Status = MarketOrderStatus.Cancelled, Held = true, Released = false, CreatedAt = old, UpdatedAt = old });
        await env.Store.Orders.InsertOneAsync(new MarketBuyOrder { Id = MarketStore.NewId(), BuyerId = user.Id, DefId = Rare, Price = 5, Status = MarketOrderStatus.Cancelled, Held = true, Released = true, CreatedAt = old, UpdatedAt = old });
        await env.Store.Trades.InsertOneAsync(new TradeOffer { Id = MarketStore.NewId(), FromUserId = user.Id, ToUserId = "x", Status = TradeOfferStatus.Accepting, CreatedAt = old, UpdatedAt = old });
        await env.Store.Txs.InsertOneAsync(new MarketTx { Id = MarketStore.NewId(), Kind = MarketTxKinds.Buy, State = MarketTxStates.RollingBack, BuyerId = user.Id, CreatedAt = old, UpdatedAt = old });
        await env.Store.ChestOpenings.InsertOneAsync(new ChestOpening { Id = $"{user.Id}:a", UserId = user.Id, CreatedAt = old, UpdatedAt = old });
        await env.Store.ChestPurchases.InsertOneAsync(new ChestPurchase { Id = $"{user.Id}:b", UserId = user.Id, CreatedAt = old, UpdatedAt = old });
        await env.Store.XpExchanges.InsertOneAsync(new XpExchange { Id = $"{user.Id}:c", UserId = user.Id, CreatedAt = old, UpdatedAt = old });
        await env.AdminStore.Ops.InsertOneAsync(new AdminPlayerOp { Id = "a:d", Kind = AdminPlayerOpKinds.Coins, TargetUserId = user.Id, CreatedAt = old, UpdatedAt = old });

        var stuck = await env.Economy.StuckAsync();

        Assert.Equal(new Dictionary<string, int>
        {
            [AdminEconomyRules.StuckListing] = 2,
            [AdminEconomyRules.StuckOrder] = 2,
            [AdminEconomyRules.StuckTrade] = 1,
            [AdminEconomyRules.StuckTransaction] = 1,
            [AdminEconomyRules.StuckChestOpening] = 1,
            [AdminEconomyRules.StuckChestPurchase] = 1,
            [AdminEconomyRules.StuckXpExchange] = 1,
            [AdminEconomyRules.StuckAdminOperation] = 1,
        }, stuck.Items.GroupBy(row => row.Kind).ToDictionary(group => group.Key, group => group.Count()));
    }

    [Fact]
    public async Task RecoveryNeedsAReason()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Economy.RecoverAsync(Admin, ""));

        Assert.Equal(AdminPlayerErrors.ReasonRequired, Code(error));
    }

    // ------------------------------------------------------------------ rooms

    private static GameRoom LiveRoom(CurrentUser a, CurrentUser b, bool connected = true) => new()
    {
        Id = ObjectId.GenerateNewId().ToString(),
        RoomCode = RoomService.GenerateRoomCode(),
        CaseId = "case-a",
        HostUserId = a.Id,
        Status = RoomStatus.InProgress,
        Players = new List<RoomPlayer>
        {
            new() { UserId = a.Id, Username = a.FullName, Role = PlayerRole.Investigator, IsReady = true, IsConnected = connected },
            new() { UserId = b.Id, Username = b.FullName, Role = PlayerRole.Interrogator, IsReady = true, IsConnected = connected },
        },
        GameplayState = new GameplayState { Version = 4, GameStatus = GameStatus.InProgress, StartedAt = DateTime.UtcNow.AddHours(-3) },
    };

    private static GameRoom Lobby(CurrentUser host) => new()
    {
        Id = ObjectId.GenerateNewId().ToString(),
        RoomCode = RoomService.GenerateRoomCode(),
        CaseId = "case-a",
        HostUserId = host.Id,
        Status = RoomStatus.Waiting,
        Players = new List<RoomPlayer> { new() { UserId = host.Id, Username = host.FullName, IsConnected = true } },
    };

    [Fact]
    public async Task ClosingAGameInProgress_AbandonsIt_EvenWithAStaleOnlineFlag_AndTellsTheRoom()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var a = await env.AddUserAsync("An");
        var b = await env.AddUserAsync("Bình");
        // Presence was left "online" by a crash, so the disconnect timeout will never fire.
        var room = LiveRoom(a, b, connected: true);
        await env.Db.Rooms.InsertOneAsync(room);

        var closed = await env.Rooms.CloseAsync(Admin, room.Id, "Phòng treo sau sự cố");

        Assert.Equal(RoomStatus.Abandoned, closed.Status);
        var saved = await env.Db.Rooms.Find(r => r.Id == room.Id).FirstAsync();
        Assert.Equal(RoomStatus.Abandoned, saved.Status);
        Assert.Equal(GameStatus.Failed, saved.GameplayState!.GameStatus);
        Assert.NotNull(saved.GameplayState.CompletedAt);
        Assert.Equal(5, saved.GameplayState.Version);
        var push = Assert.Single(env.Notifications.Calls, call => call.Method == "GameStateUpdated");
        Assert.Equal(room.Id, push.Args[0]);
        Assert.Equal(5L, push.Args[1]);
        var entry = Assert.Single(await env.AuditEntriesAsync("room.close"));
        Assert.Equal("Phòng treo sau sự cố", entry.Reason);
        Assert.Equal(room.Id, entry.TargetId);
    }

    [Fact]
    public async Task ClosingALobby_DeletesTheRoom_AndTellsWhoIsInIt()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var host = await env.AddUserAsync("Chủ phòng");
        var room = Lobby(host);
        await env.Db.Rooms.InsertOneAsync(room);

        var closed = await env.Rooms.CloseAsync(Admin, room.Id, "Phòng rác");

        Assert.Equal(RoomStatus.Abandoned, closed.Status);
        Assert.Equal(0, await env.Db.Rooms.CountDocumentsAsync(r => r.Id == room.Id));
        // The lobby page redraws from this push, and a terminal status shows its "room ended" screen.
        var push = Assert.Single(env.Notifications.Calls, call => call.Method == "ReadyUpdated");
        Assert.Equal(RoomStatus.Abandoned, ((SirLocked.Api.DTOs.Room.RoomResponse)push.Args[2]!).Status);
        Assert.Contains(room.RoomCode, (await env.AuditEntriesAsync("room.close")).Single().Before!);
    }

    [Theory]
    [InlineData(RoomStatus.Completed)]
    [InlineData(RoomStatus.Abandoned)]
    public async Task AFinishedRoom_CannotBeClosedAgain(string status)
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var a = await env.AddUserAsync();
        var b = await env.AddUserAsync();
        var room = LiveRoom(a, b);
        room.Status = status;
        await env.Db.Rooms.InsertOneAsync(room);

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Rooms.CloseAsync(Admin, room.Id, "Phòng treo"));

        Assert.Equal(409, error.StatusCode);
        Assert.Equal(RoomService.RoomEndedCode, Code(error));
        Assert.Empty(await env.AuditEntriesAsync("room.close"));
    }

    [Fact]
    public async Task AClosedGameLeavesNoResultAndPaysNoReward()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var a = await env.AddUserAsync();
        var b = await env.AddUserAsync();
        var room = LiveRoom(a, b);
        await env.Db.Rooms.InsertOneAsync(room);
        var start = (await env.AccountAsync(a.Id)).Balance;

        await env.Rooms.CloseAsync(Admin, room.Id, "Phòng treo");

        Assert.Equal(0, await env.Db.GameResults.CountDocumentsAsync(r => r.RoomId == room.Id));
        Assert.Equal(start, (await env.AccountAsync(a.Id)).Balance);
    }

    [Fact]
    public async Task RoomsListsOnlyOpenOnes_AndSaysWhoIsConnected()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var a = await env.AddUserAsync("An");
        var b = await env.AddUserAsync("Bình");
        var live = LiveRoom(a, b, connected: false);
        var lobby = Lobby(a);
        var over = LiveRoom(a, b);
        over.Status = RoomStatus.Completed;
        await env.Db.Rooms.InsertManyAsync(new[] { live, lobby, over });
        await env.Db.Cases.InsertOneAsync(new GameCase { Id = ObjectId.GenerateNewId().ToString(), CaseId = "case-a", Title = "Vụ án A" });

        var all = await env.Rooms.ListAsync(new AdminRoomQuery());
        Assert.Equal(2, all.Total);
        var row = all.Items.Single(r => r.RoomId == live.Id);
        Assert.Equal("Vụ án A", row.CaseTitle);
        Assert.Equal(live.RoomCode, row.RoomCode);
        Assert.Equal(new[] { "An", "Bình" }, row.Players.Select(p => p.Username));
        Assert.All(row.Players, p => Assert.False(p.IsConnected));
        Assert.True(row.LooksHung);
        Assert.NotNull(row.StartedAt);
        Assert.Equal(new[] { lobby.Id }, (await env.Rooms.ListAsync(new AdminRoomQuery(Status: RoomStatus.Waiting))).Items.Select(r => r.RoomId));
        Assert.Equal(new[] { live.Id }, (await env.Rooms.ListAsync(new AdminRoomQuery(Search: live.RoomCode))).Items.Select(r => r.RoomId));
    }

    // ------------------------------------------------------------------ reviews

    private static async Task<CaseReview> ReviewAsync(AdminPlayersEnv env, CurrentUser user, string caseId = "case-a", int rating = 5, string text = "Hay")
    {
        var review = new CaseReview
        {
            Id = ObjectId.GenerateNewId().ToString(),
            CaseId = caseId,
            UserId = user.Id,
            AuthorDisplay = user.FullName,
            Rating = rating,
            ReviewText = text,
        };
        await env.Db.Reviews.InsertOneAsync(review);
        return review;
    }

    [Fact]
    public async Task AHiddenReview_DisappearsForPlayers_FromTheListAndTheAverage()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var bad = await ReviewAsync(env, await env.AddUserAsync("Kẻ phá"), rating: 1, text: "Lời lẽ vi phạm");
        await ReviewAsync(env, await env.AddUserAsync("Người tốt"), rating: 5);

        await env.Reviews.HideAsync(Admin, bad.Id, "Ngôn từ xúc phạm");

        var page = await env.ReviewsForPlayers.GetReviewsAsync("case-a", 1, 10);
        Assert.Equal(1, page.Total);
        Assert.DoesNotContain(page.Items, item => item.Id == bad.Id);
        var summary = await env.ReviewsForPlayers.GetSummaryAsync("case-a");
        Assert.Equal(1, summary.TotalReviews);
        Assert.Equal(5, summary.AvgRating);
        var entry = Assert.Single(await env.AuditEntriesAsync("review.hide"));
        Assert.Equal("Ngôn từ xúc phạm", entry.Reason);
        Assert.Contains("Lời lẽ vi phạm", entry.Before!);
    }

    [Fact]
    public async Task AnUnhiddenReview_ComesBack()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var review = await ReviewAsync(env, await env.AddUserAsync());
        await env.Reviews.HideAsync(Admin, review.Id, "Ngôn từ xúc phạm");

        await env.Reviews.UnhideAsync(Admin, review.Id, "Ẩn nhầm");

        Assert.Equal(1, (await env.ReviewsForPlayers.GetReviewsAsync("case-a", 1, 10)).Total);
        Assert.Single(await env.AuditEntriesAsync("review.unhide"));
    }

    [Fact]
    public async Task EditingAHiddenReview_DoesNotBringItBack()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var review = await ReviewAsync(env, user);
        await env.Db.GameResults.InsertOneAsync(new GameResult
        {
            Id = ObjectId.GenerateNewId().ToString(), RoomId = "r", CaseId = "case-a", Players = new List<string> { user.Id },
        });
        await env.Reviews.HideAsync(Admin, review.Id, "Ngôn từ xúc phạm");

        await env.ReviewsForPlayers.SubmitReviewAsync(user, "case-a", new SubmitReviewDto { Rating = 2, ReviewText = "Sửa lại vẫn xấu" });

        Assert.Equal(0, (await env.ReviewsForPlayers.GetReviewsAsync("case-a", 1, 10)).Total);
    }

    [Fact]
    public async Task DeletingAReview_RemovesIt_AndKeepsACopyInTheAudit()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var review = await ReviewAsync(env, await env.AddUserAsync(), text: "Nội dung cần giữ lại");

        await env.Reviews.DeleteAsync(Admin, review.Id, "Spam");

        Assert.Equal(0, await env.Db.Reviews.CountDocumentsAsync(r => r.Id == review.Id));
        Assert.Contains("Nội dung cần giữ lại", (await env.AuditEntriesAsync("review.delete")).Single().Before!);
    }

    [Fact]
    public async Task ReviewActionsNeedAReason_AndAnExistingReview()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var review = await ReviewAsync(env, await env.AddUserAsync());

        Assert.Equal(AdminPlayerErrors.ReasonRequired, Code(await Assert.ThrowsAsync<ApiException>(() => env.Reviews.HideAsync(Admin, review.Id, ""))));
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => env.Reviews.HideAsync(Admin, ObjectId.GenerateNewId().ToString(), "Vi phạm"))).StatusCode);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => env.Reviews.DeleteAsync(Admin, "not-an-id", "Vi phạm"))).StatusCode);
    }

    [Fact]
    public async Task TheAdminList_ShowsHiddenReviews_FiltersByCase_AndNewestFirst()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var hidden = await ReviewAsync(env, await env.AddUserAsync("Một"), "case-a");
        await Task.Delay(5);
        var shown = await ReviewAsync(env, await env.AddUserAsync("Hai"), "case-a");
        await ReviewAsync(env, await env.AddUserAsync("Ba"), "case-b");
        await env.Reviews.HideAsync(Admin, hidden.Id, "Vi phạm");

        var page = await env.Reviews.ListAsync(new AdminReviewQuery(CaseId: "case-a"));

        Assert.Equal(new[] { shown.Id, hidden.Id }, page.Items.Select(row => row.Id));
        Assert.True(page.Items[1].Hidden);
        Assert.Equal("Vi phạm", page.Items[1].HiddenReason);
        Assert.Equal(new[] { hidden.Id }, (await env.Reviews.ListAsync(new AdminReviewQuery(Hidden: true))).Items.Select(row => row.Id));
        Assert.Equal(3, (await env.Reviews.ListAsync(new AdminReviewQuery())).Total);
    }
}
