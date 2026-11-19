using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Vip;
using Xunit;

namespace SirLocked.IntegrationTests.Vip;

/// <summary>
/// Author rewards of VUAN-7 part H against a real MongoDB: 30% of what the case earns, held seven days, capped per month,
/// never from the author's own plays, new accounts, one-case accounts, rushed games or shared devices; tier bonuses once;
/// admins hold, release and revoke. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoAuthorRewardTests
{
    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    [Fact]
    public async Task TheAuthorGetsThirtyPercent_HeldSevenDays_ThenAsBonusCoins()
    {
        if (!Enabled) return;
        await using var env = await AuthorEnv.CreateAsync();
        var author = await env.UserAsync(daysOld: 30);
        await env.CaseAsync("case-a", author);
        var player = await env.VeteranAsync();
        await env.PaidHintAsync("case-a", player, xu: 50);
        await env.PaidHintAsync("case-a", player, xu: 20);
        await env.AdViewAsync("case-a", player, vnd: 530); // 53 xu worth

        Assert.Equal(1, await env.Rewards.ShareAsync());
        var payout = await env.Rewards.Payouts.Find(item => item.AuthorUserId == author).SingleAsync();
        Assert.Equal((AuthorPayoutStates.Held, 36L, 70L, 530L), (payout.State, payout.Xu, payout.SourceXu, payout.SourceVnd)); // 30% of 123
        Assert.Equal(0, await env.Rewards.PayDueAsync()); // still held
        env.Clock.Advance(TimeSpan.FromDays(7) + TimeSpan.FromMinutes(1));
        Assert.Equal(1, await env.Rewards.PayDueAsync());

        var account = await env.AccountAsync(author);
        Assert.Equal((36L, 0L), (account.BonusBalance, account.Balance));
        Assert.Equal(AuthorPayoutStates.Paid, (await env.Rewards.Payouts.Find(item => item.Id == payout.Id).SingleAsync()).State);
        Assert.Equal(0, await env.Rewards.ShareAsync()); // every event was counted once
        Assert.Equal(0, await env.Rewards.PayDueAsync());
    }

    [Fact]
    public async Task FraudulentRevenue_DoesNotCount_AndEachEventSaysWhy()
    {
        if (!Enabled) return;
        await using var env = await AuthorEnv.CreateAsync();
        var author = await env.UserAsync(daysOld: 30);
        await env.CaseAsync("case-b", author, estimatedMinutes: 40);
        await env.PlayOtherCaseAsync(author);
        var fresh = await env.UserAsync(daysOld: 2);
        await env.PlayOtherCaseAsync(fresh);
        var oneCase = await env.UserAsync(daysOld: 30);
        var rushed = await env.VeteranAsync();
        var twinA = await env.VeteranAsync(networkKey: "same-home");
        var twinB = await env.VeteranAsync(networkKey: "same-home");

        await env.PaidHintAsync("case-b", author, 50);
        await env.PaidHintAsync("case-b", fresh, 50);
        await env.PaidHintAsync("case-b", oneCase, 50);
        await env.PaidHintAsync("case-b", rushed, 50, playedMinutes: 10);
        await env.PaidHintAsync("case-b", twinA, 50);
        await env.PaidHintAsync("case-b", twinB, 50);

        await env.Rewards.ShareAsync();

        var reasons = (await env.Rewards.Revenue.Find(FilterDefinition<CaseRevenueEvent>.Empty).ToListAsync())
            .ToDictionary(item => item.UserId, item => (item.ShareEligible, item.ShareReason));
        Assert.Equal((false, "OWN_CASE"), reasons[author]);
        Assert.Equal((false, "ACCOUNT_TOO_NEW"), reasons[fresh]);
        Assert.Equal((false, "NO_OTHER_CASE"), reasons[oneCase]);
        Assert.Equal((false, "GAME_TOO_SHORT"), reasons[rushed]);
        Assert.Equal((true, ""), reasons[twinA]);
        Assert.Equal((false, "SHARED_DEVICE_OR_IP"), reasons[twinB]);
        Assert.Equal(15, (await env.Rewards.Payouts.Find(item => item.AuthorUserId == author).SingleAsync()).Xu); // 30% of 50
    }

    [Fact]
    public async Task RevenueOfAGameStillRunning_Waits_ThenCounts()
    {
        if (!Enabled) return;
        await using var env = await AuthorEnv.CreateAsync();
        var author = await env.UserAsync(daysOld: 30);
        await env.CaseAsync("case-c", author);
        var player = await env.VeteranAsync();
        var room = await env.PaidHintAsync("case-c", player, 100, finished: false);

        Assert.Equal(0, await env.Rewards.ShareAsync());
        Assert.Null((await env.Rewards.Revenue.Find(FilterDefinition<CaseRevenueEvent>.Empty).SingleAsync()).ShareBatchId);
        await env.FinishAsync(room, minutes: 60);
        Assert.Equal(1, await env.Rewards.ShareAsync());
    }

    [Fact]
    public async Task TheMonthlyCap_ClipsPayouts()
    {
        if (!Enabled) return;
        await using var env = await AuthorEnv.CreateAsync();
        var rules = await env.Settings.GetAuthorsAsync();
        rules.MonthlyCapXu = 100;
        await env.Settings.SaveAuthorsAsync(rules, "admin");
        var author = await env.UserAsync(daysOld: 30);
        await env.CaseAsync("case-d", author);
        var player = await env.VeteranAsync();
        await env.PaidHintAsync("case-d", player, 1000);
        await env.Rewards.ShareAsync();
        await env.PaidHintAsync("case-d", player, 1000);
        await env.Rewards.ShareAsync();

        var payouts = await env.Rewards.Payouts.Find(item => item.AuthorUserId == author).SortBy(item => item.CreatedAt).ToListAsync();
        Assert.Equal((100L, 200L), (payouts[0].Xu, payouts[0].ClippedXu));
        Assert.Equal((0L, 300L), (payouts[1].Xu, payouts[1].ClippedXu));
    }

    [Fact]
    public async Task Admins_HoldReleaseAndRevoke_AndARevokedPaidPayoutTakesBackOnlyBonusCoinsLeft()
    {
        if (!Enabled) return;
        await using var env = await AuthorEnv.CreateAsync();
        var author = await env.UserAsync(daysOld: 30);
        await env.CaseAsync("case-e", author);
        var player = await env.VeteranAsync();
        await env.PaidHintAsync("case-e", player, 1000); // 300 xu
        await env.Rewards.ShareAsync();
        var payout = await env.Rewards.Payouts.Find(item => item.AuthorUserId == author).SingleAsync();

        await env.Rewards.HoldAsync(payout.Id, "admin", "kiểm tra");
        env.Clock.Advance(TimeSpan.FromDays(8));
        Assert.Equal(0, await env.Rewards.PayDueAsync()); // on hold: not paid
        await env.Rewards.ReleaseAsync(payout.Id, "admin");
        Assert.Equal(1, await env.Rewards.PayDueAsync());
        // The author spent 200 of the 300 bonus coins on a chest.
        await env.Store.Accounts.UpdateOneAsync(item => item.Id == author, Builders<MarketAccount>.Update.Inc(item => item.BonusBalance, -200));

        var revoked = await env.Rewards.RevokeAsync(payout.Id, "admin", "gian lận");

        Assert.Equal((AuthorPayoutStates.Revoked, 100L), (revoked.State, revoked.RevokedXu));
        Assert.Equal(0, (await env.AccountAsync(author)).BonusBalance);
        Assert.Equal(revoked.State, (await env.Rewards.RevokeAsync(payout.Id, "admin", "again")).State); // idempotent
    }

    [Fact]
    public async Task Tiers_FollowCountedCompletionsAndVisibleRatings_AndPayTheirBonusOnce()
    {
        if (!Enabled) return;
        await using var env = await AuthorEnv.CreateAsync();
        var rules = await env.Settings.GetAuthorsAsync();
        rules.SilverCompletions = 2;
        rules.GoldCompletions = 3;
        await env.Settings.SaveAuthorsAsync(rules, "admin");
        var author = await env.UserAsync(daysOld: 30);
        await env.CaseAsync("case-f", author);
        var players = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            var player = await env.VeteranAsync();
            players.Add(player);
            await env.CompleteAsync("case-f", player);
        }
        await env.CompleteAsync("case-f", author); // the author's own play never counts
        await env.ReviewAsync("case-f", players[0], 5);
        await env.ReviewAsync("case-f", players[1], 4); // 90% on average
        await env.ReviewAsync("case-f", players[2], 1, hidden: true); // hidden: not counted

        await env.Rewards.RefreshStatsAsync();
        await env.Rewards.RefreshStatsAsync();

        var stats = await env.Rewards.Stats.Find(item => item.Id == author).SingleAsync();
        Assert.Equal((AuthorTiers.Gold, 3, 90), (stats.Tier, stats.BestCompletions, stats.BestRatingPercent));
        var tiers = await env.Rewards.Payouts.Find(item => item.AuthorUserId == author && item.Kind == AuthorPayoutKinds.Tier).ToListAsync();
        Assert.Equal(new[] { (AuthorTiers.Gold, 5_000L), (AuthorTiers.Silver, 1_500L) },
            tiers.Select(item => (item.Tier, item.Xu)).OrderBy(item => item.Tier, StringComparer.Ordinal));

        var badges = new AuthorBadgeReader(env.Db);
        var cards = await badges.FillAsync(new List<CaseSummaryResponse> { new() { CaseId = "case-f", AuthorUserId = author, Status = CaseStatus.Published } });
        Assert.Equal((AuthorTiers.Gold, "Tác giả 1"), (cards[0].AuthorTier, cards[0].AuthorName));
    }

    // ------------------------------------------------------------------ environment

    private sealed class AuthorEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;
        private int _users;

        private AuthorEnv(MongoDbSettings settings)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db);
            Market = new MarketService(Store, NullLogger<MarketService>.Instance);
            Wallet = new CoinWalletService(Store, Market, NullLogger<CoinWalletService>.Instance);
            Settings = new VipSettingsStore(Db);
            Rewards = new AuthorRewardService(Db, Wallet, Settings, NullLogger<AuthorRewardService>.Instance, Clock);
        }

        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public MarketService Market { get; }
        public CoinWalletService Wallet { get; }
        public VipSettingsStore Settings { get; }
        public AuthorRewardService Rewards { get; }
        public MongoHintPaymentTests.ManualClock Clock { get; } = new();

        public static async Task<AuthorEnv> CreateAsync()
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_author_{Guid.NewGuid():N}"
            };
            if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
                || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                    server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
                throw new InvalidOperationException("Author reward tests need a loopback MongoDB and a temporary database.");
            var env = new AuthorEnv(settings);
            await env.Db.PingAsync();
            await env.Store.EnsureIndexesAsync();
            await env.Rewards.EnsureIndexesAsync();
            return env;
        }

        public async Task<string> UserAsync(int daysOld, string? networkKey = null)
        {
            var id = ObjectId.GenerateNewId().ToString();
            _users++;
            await Db.Users.InsertOneAsync(new User
            {
                Id = id, FullName = $"Tác giả {_users}", Email = $"{id}@tests.invalid", Status = UserStatus.Active,
                IsEmailVerified = true, CreatedAt = Clock.GetUtcNow().UtcDateTime.AddDays(-daysOld)
            });
            await Market.EnsureAccountAsync(id);
            await Store.Accounts.UpdateOneAsync(item => item.Id == id, Builders<MarketAccount>.Update.Set(item => item.Balance, 0));
            if (networkKey is not null) await Rewards.RecordNetworkKeyAsync(id, networkKey);
            else await Rewards.RecordNetworkKeyAsync(id, $"own-{id}");
            return id;
        }

        /// <summary>A month-old account that already played another case.</summary>
        public async Task<string> VeteranAsync(string? networkKey = null)
        {
            var id = await UserAsync(30, networkKey);
            await PlayOtherCaseAsync(id);
            return id;
        }

        public Task PlayOtherCaseAsync(string userId) => Db.GameResults.InsertOneAsync(new GameResult
        {
            Id = ObjectId.GenerateNewId().ToString(), RoomId = "other-room", CaseId = "another-case",
            Players = [userId], CreatedAt = Clock.GetUtcNow().UtcDateTime.AddDays(-1)
        });

        public Task CaseAsync(string caseId, string author, int estimatedMinutes = 30) => Db.Cases.InsertOneAsync(new GameCase
        {
            Id = ObjectId.GenerateNewId().ToString(), CaseId = caseId, AuthorUserId = author,
            Status = CaseStatus.Published, EstimatedMinutes = estimatedMinutes
        });

        public async Task<string> RoomAsync(string caseId, string player, int playedMinutes, bool finished)
        {
            var now = Clock.GetUtcNow().UtcDateTime;
            var room = new GameRoom
            {
                Id = ObjectId.GenerateNewId().ToString(), CaseId = caseId,
                Players = [new RoomPlayer { UserId = player }],
                GameplayState = new GameplayState { StartedAt = now.AddMinutes(-playedMinutes), CompletedAt = finished ? now : null }
            };
            await Db.Rooms.InsertOneAsync(room);
            return room.Id;
        }

        public Task FinishAsync(string roomId, int minutes)
        {
            var now = Clock.GetUtcNow().UtcDateTime;
            return Db.Rooms.UpdateOneAsync(item => item.Id == roomId, Builders<GameRoom>.Update
                .Set(item => item.GameplayState!.StartedAt, now.AddMinutes(-minutes))
                .Set(item => item.GameplayState!.CompletedAt, now));
        }

        public async Task<string> PaidHintAsync(string caseId, string player, long xu, int playedMinutes = 60, bool finished = true)
        {
            Clock.Advance(TimeSpan.FromSeconds(1)); // events in a clear order
            var roomId = await RoomAsync(caseId, player, playedMinutes, finished);
            await Rewards.Revenue.InsertOneAsync(new CaseRevenueEvent
            {
                Id = ObjectId.GenerateNewId().ToString(), CaseId = caseId, RoomId = roomId, UserId = player,
                Kind = CaseRevenueKinds.HintCoins, Xu = xu, At = Clock.GetUtcNow().UtcDateTime
            });
            return roomId;
        }

        public async Task AdViewAsync(string caseId, string player, long vnd)
        {
            Clock.Advance(TimeSpan.FromSeconds(1));
            var roomId = await RoomAsync(caseId, player, 60, finished: true);
            await Rewards.Revenue.InsertOneAsync(new CaseRevenueEvent
            {
                Id = ObjectId.GenerateNewId().ToString(), CaseId = caseId, RoomId = roomId, UserId = player,
                Kind = CaseRevenueKinds.AdView, Vnd = vnd, At = Clock.GetUtcNow().UtcDateTime
            });
        }

        public async Task CompleteAsync(string caseId, string player)
        {
            var roomId = await RoomAsync(caseId, player, 60, finished: true);
            await Db.GameResults.InsertOneAsync(new GameResult
            {
                Id = ObjectId.GenerateNewId().ToString(), RoomId = roomId, CaseId = caseId, Players = [player],
                CreatedAt = Clock.GetUtcNow().UtcDateTime
            });
        }

        public Task ReviewAsync(string caseId, string player, int rating, bool hidden = false) => Db.Reviews.InsertOneAsync(new CaseReview
        {
            Id = ObjectId.GenerateNewId().ToString(), CaseId = caseId, UserId = player, Rating = rating, Hidden = hidden
        });

        public Task<MarketAccount> AccountAsync(string userId) => Store.Accounts.Find(item => item.Id == userId).SingleAsync();

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
