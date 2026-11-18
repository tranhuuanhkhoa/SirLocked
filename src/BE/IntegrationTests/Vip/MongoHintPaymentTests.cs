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
using SirLocked.Api.Services;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Vip;
using Xunit;

namespace SirLocked.IntegrationTests.Vip;

/// <summary>
/// Paid hints of VUAN-7 part G against a real MongoDB: level 1 free, level 2 an ad or 20 coins, level 3 50 coins, each
/// paid level a share of the score; one payment per room and hint however often or concurrently it is asked; ads only
/// count once watched to the end. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoHintPaymentTests
{
    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    [Fact]
    public async Task LevelOne_IsFree_AndPaidLevelsAskForAPaymentWithTheirPrice()
    {
        if (!Enabled) return;
        await using var env = await HintEnv.CreateAsync();
        var (user, room) = await env.PlayerInRoomAsync(100);

        var free = await env.Hints().AuthorizeAsync(user, room, "hint-a-1", 1, HintPayment.None);
        var ask = await Assert.ThrowsAsync<ApiException>(() => env.Hints().AuthorizeAsync(user, room, "hint-a-2", 2, HintPayment.None));

        Assert.Equal((HintPaidWith.Free, 0L, 0), (free.PaidWith, free.PriceXu, free.PenaltyPercent));
        Assert.Equal(402, ask.StatusCode);
        var details = System.Text.Json.JsonSerializer.Serialize(ask.Errors);
        Assert.Contains("\"priceXu\":20", details);
        Assert.Contains("\"adAvailable\":false", details);
        Assert.Contains("\"penaltyPercent\":5", details);
    }

    [Fact]
    public async Task Coins_PayOnce_BonusFirst_ThePartnerSeesItFree_AndTheCaseEarnsIt()
    {
        if (!Enabled) return;
        await using var env = await HintEnv.CreateAsync();
        var (payer, room) = await env.PlayerInRoomAsync(100, bonus: 10);
        var partner = await env.JoinAsync(room, 100);

        var paid = await env.Hints().AuthorizeAsync(payer, room, "hint-a-2", 2, new HintPayment("XU", null));
        var again = await env.Hints().AuthorizeAsync(payer, room, "hint-a-2", 2, new HintPayment("XU", null));
        var seen = await env.Hints().AuthorizeAsync(partner, room, "hint-a-2", 2, HintPayment.None);

        Assert.Equal((HintPaidWith.Coins, 20L, 5), (paid.PaidWith, paid.PriceXu, paid.PenaltyPercent));
        Assert.Equal(paid.PaidWith, again.PaidWith);
        Assert.Equal((HintPaidWith.Free, 0L, 5), (seen.PaidWith, seen.PriceXu, seen.PenaltyPercent)); // free, but still a hint
        var account = await env.AccountAsync(payer.Id);
        Assert.Equal((90L, 0L), (account.Balance, account.BonusBalance)); // 10 bonus + 10 ordinary
        Assert.Equal(100, (await env.AccountAsync(partner.Id)).Balance);
        var revenue = Assert.Single(await env.Hints().Revenue.Find(FilterDefinition<CaseRevenueEvent>.Empty).ToListAsync());
        Assert.Equal((room.CaseId, CaseRevenueKinds.HintCoins, 20L, payer.Id), (revenue.CaseId, revenue.Kind, revenue.Xu, revenue.UserId));
    }

    [Fact]
    public async Task NotEnoughCoins_ChargesNothing_AndRecordsNothing()
    {
        if (!Enabled) return;
        await using var env = await HintEnv.CreateAsync();
        var (user, room) = await env.PlayerInRoomAsync(49);

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Hints().AuthorizeAsync(user, room, "hint-a-3", 3, new HintPayment("XU", null)));

        Assert.Contains(HintPaymentService.InsufficientCoins, System.Text.Json.JsonSerializer.Serialize(error.Errors));
        Assert.Equal(49, (await env.AccountAsync(user.Id)).Balance);
        Assert.Equal(0, await env.Hints().Purchases.CountDocumentsAsync(FilterDefinition<HintPurchase>.Empty));
        Assert.Equal(0, await env.Hints().Revenue.CountDocumentsAsync(FilterDefinition<CaseRevenueEvent>.Empty));
    }

    [Fact]
    public async Task TwoDetectivesBuyingTheSameHintAtOnce_PayOnceBetweenThem()
    {
        if (!Enabled) return;
        await using var env = await HintEnv.CreateAsync();
        var (first, room) = await env.PlayerInRoomAsync(500);
        var second = await env.JoinAsync(room, 500);

        var attempts = await Task.WhenAll(Enumerable.Range(0, 6).Select(index => Task.Run(async () =>
        {
            try
            {
                await env.Hints().AuthorizeAsync(index % 2 == 0 ? first : second, room, "hint-b-3", 3, new HintPayment("XU", null));
                return true;
            }
            catch (ApiException)
            {
                return false; // "your partner is paying right now": retry later and get it for free
            }
        })));

        Assert.Contains(true, attempts);
        var spent = 1000 - (await env.AccountAsync(first.Id)).Balance - (await env.AccountAsync(second.Id)).Balance;
        Assert.Equal(50, spent);
        Assert.Single(await env.Hints().Revenue.Find(FilterDefinition<CaseRevenueEvent>.Empty).ToListAsync());
    }

    [Fact]
    public async Task ARewardedAd_OpensLevelTwo_OnlyOnceWatchedToTheEnd_AndOnlyOnce()
    {
        if (!Enabled) return;
        await using var env = await HintEnv.CreateAsync(adsOn: true);
        var (user, room) = await env.PlayerInRoomAsync(0);
        var hints = env.Hints();

        var ask = await Assert.ThrowsAsync<ApiException>(() => hints.AuthorizeAsync(user, room, "hint-c-2", 2, HintPayment.None));
        Assert.Contains("\"adAvailable\":true", System.Text.Json.JsonSerializer.Serialize(ask.Errors));
        var ticket = await hints.IssueAdTicketAsync(user, room);
        // Not watched yet, or "watched" in under five seconds: no hint.
        await Assert.ThrowsAsync<ApiException>(() => hints.AuthorizeAsync(user, room, "hint-c-2", 2, new HintPayment("AD", ticket.Id)));
        await Assert.ThrowsAsync<ApiException>(() => hints.MarkViewedAsync(user, room.Id, ticket.Id));
        env.Clock.Advance(TimeSpan.FromSeconds(30));
        await hints.MarkViewedAsync(user, room.Id, ticket.Id);

        var opened = await hints.AuthorizeAsync(user, room, "hint-c-2", 2, new HintPayment("AD", ticket.Id));
        var reused = await Assert.ThrowsAsync<ApiException>(() => hints.AuthorizeAsync(user, room, "hint-d-2", 2, new HintPayment("AD", ticket.Id)));

        Assert.Equal((HintPaidWith.Ad, 5), (opened.PaidWith, opened.PenaltyPercent));
        Assert.Equal(409, reused.StatusCode);
        var revenue = Assert.Single(await hints.Revenue.Find(FilterDefinition<CaseRevenueEvent>.Empty).ToListAsync());
        Assert.Equal((CaseRevenueKinds.AdView, 53L, 0L), (revenue.Kind, revenue.Vnd, revenue.Xu));
        // Level 3 is never paid by an ad.
        await Assert.ThrowsAsync<ApiException>(() => hints.AuthorizeAsync(user, room, "hint-c-3", 3, new HintPayment("AD", ticket.Id)));
    }

    [Fact]
    public async Task WithoutAds_LevelTwoIsCoinsOnly()
    {
        if (!Enabled) return;
        await using var env = await HintEnv.CreateAsync(adsOn: false);
        var (user, room) = await env.PlayerInRoomAsync(100);

        await Assert.ThrowsAsync<ApiException>(() => env.Hints().IssueAdTicketAsync(user, room));
        var error = await Assert.ThrowsAsync<ApiException>(() => env.Hints().AuthorizeAsync(user, room, "hint-e-2", 2, new HintPayment("AD", "x")));
        Assert.Equal(400, error.StatusCode);
    }

    [Fact]
    public async Task VipPlayers_OpenLevelTwoFree_WhenTheSettingIsOn()
    {
        if (!Enabled) return;
        await using var env = await HintEnv.CreateAsync();
        var hintSettings = await env.Settings.GetHintsAsync();
        hintSettings.VipFreeLevel2 = true;
        await env.Settings.SaveHintsAsync(hintSettings, "admin");
        var (vip, room) = await env.PlayerInRoomAsync(0, role: UserRole.Vip);

        var opened = await env.Hints().AuthorizeAsync(vip, room, "hint-f-2", 2, HintPayment.None);

        Assert.Equal((HintPaidWith.VipFree, 0L, 5), (opened.PaidWith, opened.PriceXu, opened.PenaltyPercent));
        await Assert.ThrowsAsync<ApiException>(() => env.Hints().AuthorizeAsync(vip, room, "hint-f-3", 3, HintPayment.None));
    }

    [Fact]
    public async Task TutorialAndPlaytestRooms_NeverCharge()
    {
        if (!Enabled) return;
        await using var env = await HintEnv.CreateAsync();
        var (user, room) = await env.PlayerInRoomAsync(0);
        room.Mode = TutorialRules.RoomMode;
        var tutorial = await env.Hints().AuthorizeAsync(user, room, "hint-g-3", 3, HintPayment.None);
        room.Mode = string.Empty;
        room.Playtest = new RoomPlaytest();
        var playtest = await env.Hints().AuthorizeAsync(user, room, "hint-g-2", 2, HintPayment.None);

        Assert.Equal(HintPaidWith.Free, tutorial.PaidWith);
        Assert.Equal(HintPaidWith.Free, playtest.PaidWith);
    }

    [Fact]
    public void PaidHints_TakeTheirShareOfTheScore_AtMostSixtyPercent()
    {
        var gameCase = new GameCase();
        var state = new GameplayState();
        var clean = GameplayV2Rules.BuildScoreSummary(gameCase, state, accusationSucceeded: true);
        state.HintUsages.Add(new HintUsageRecord { HintKey = "a", Tier = 2, PenaltyPercent = 5 });
        state.HintUsages.Add(new HintUsageRecord { HintKey = "b", Tier = 3, PenaltyPercent = 15 });
        var hinted = GameplayV2Rules.BuildScoreSummary(gameCase, state, accusationSucceeded: true);
        for (var i = 0; i < 10; i++) state.HintUsages.Add(new HintUsageRecord { HintKey = $"c{i}", Tier = 3, PenaltyPercent = 15 });
        var many = GameplayV2Rules.BuildScoreSummary(gameCase, state, accusationSucceeded: true);

        Assert.Equal((int)Math.Round(clean.TotalScore * 0.20, MidpointRounding.AwayFromZero), hinted.PaidHintPenalty);
        Assert.Equal(clean.TotalScore - hinted.PaidHintPenalty, hinted.TotalScore);
        Assert.Equal((int)Math.Round(clean.TotalScore * 0.60, MidpointRounding.AwayFromZero), many.PaidHintPenalty);
    }

    // ------------------------------------------------------------------ environment

    internal sealed class ManualClock : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now += by;
    }

    private sealed class HintEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;
        private readonly bool _adsOn;

        private HintEnv(MongoDbSettings settings, bool adsOn)
        {
            _database = settings.DatabaseName;
            _adsOn = adsOn;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db);
            Market = new MarketService(Store, NullLogger<MarketService>.Instance);
            Wallet = new CoinWalletService(Store, Market, NullLogger<CoinWalletService>.Instance);
            Settings = new VipSettingsStore(Db);
        }

        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public MarketService Market { get; }
        public CoinWalletService Wallet { get; }
        public VipSettingsStore Settings { get; }
        public ManualClock Clock { get; } = new();

        public HintPaymentService Hints() => new(Db, Wallet, Settings,
            Options.Create(new AdsSettings { Enabled = _adsOn, PublisherId = _adsOn ? "ca-pub-0000000000000000" : string.Empty }), Clock);

        public static async Task<HintEnv> CreateAsync(bool adsOn = false)
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_hint_{Guid.NewGuid():N}"
            };
            if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
                || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                    server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
                throw new InvalidOperationException("Hint payment tests need a loopback MongoDB and a temporary database.");
            var env = new HintEnv(settings, adsOn);
            await env.Db.PingAsync();
            await env.Store.EnsureIndexesAsync();
            await env.Hints().EnsureIndexesAsync();
            return env;
        }

        public async Task<(CurrentUser User, GameRoom Room)> PlayerInRoomAsync(long coins, long bonus = 0, string role = UserRole.Player)
        {
            var room = new GameRoom { Id = ObjectId.GenerateNewId().ToString(), CaseId = "case-hints" };
            await Db.Rooms.InsertOneAsync(room);
            var user = await JoinAsync(room, coins, bonus, role);
            return (user, room);
        }

        public async Task<CurrentUser> JoinAsync(GameRoom room, long coins, long bonus = 0, string role = UserRole.Player)
        {
            var id = ObjectId.GenerateNewId().ToString();
            await Market.EnsureAccountAsync(id);
            await Store.Accounts.UpdateOneAsync(account => account.Id == id,
                Builders<MarketAccount>.Update.Set(account => account.Balance, coins).Set(account => account.BonusBalance, bonus));
            room.Players.Add(new RoomPlayer { UserId = id });
            return new CurrentUser(id, "Thám tử", role);
        }

        public Task<MarketAccount> AccountAsync(string userId) => Store.Accounts.Find(a => a.Id == userId).SingleAsync();

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
