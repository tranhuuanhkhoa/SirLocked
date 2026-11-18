using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The two-coin wallet of VUAN-7 against a real (standalone) MongoDB: bonus coins are spent first at system sinks,
/// no balance ever goes negative even under concurrent spends, holds and settlements move coins exactly once per
/// operation key, and every operation is in the ledger. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoCoinWalletTests
{
    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    [Fact]
    public async Task Spend_TakesBonusCoinsFirst_ThenOrdinaryCoins_AndIsRecordedOnce()
    {
        if (!Enabled) return;
        await using var env = await WalletEnv.CreateAsync();
        var user = await env.AddUserAsync(balance: 100, bonus: 30);

        var first = await env.Wallet.SpendPreferBonusAsync(user, "hint:a", 50, WalletLedgerKinds.HintPurchase, "room-1");
        var replay = await env.Wallet.SpendPreferBonusAsync(user, "hint:a", 50, WalletLedgerKinds.HintPurchase, "room-1");

        Assert.Equal(WalletWrite.Applied, first.Write);
        Assert.Equal(-30, first.BonusDelta);
        Assert.Equal(-20, first.BalanceDelta);
        Assert.Equal(WalletWrite.AlreadyApplied, replay.Write);
        Assert.Equal(first.BonusDelta, replay.BonusDelta);
        Assert.Equal(first.BalanceDelta, replay.BalanceDelta);
        var account = await env.AccountAsync(user);
        Assert.Equal(80, account.Balance);
        Assert.Equal(0, account.BonusBalance);
        var entry = await env.Store.WalletLedger.Find(e => e.Id == "hint:a").SingleAsync();
        Assert.Equal(WalletLedgerStates.Applied, entry.State);
        Assert.Equal(user, entry.UserId);
        Assert.Equal(WalletLedgerKinds.HintPurchase, entry.Kind);
        Assert.Equal(-30, entry.BonusDelta);
        Assert.Equal(-20, entry.BalanceDelta);
    }

    [Fact]
    public async Task Spend_WithoutEnoughCoins_IsRejected_AndChangesNothing()
    {
        if (!Enabled) return;
        await using var env = await WalletEnv.CreateAsync();
        var user = await env.AddUserAsync(balance: 10, bonus: 5);

        var result = await env.Wallet.SpendPreferBonusAsync(user, "hint:b", 50, WalletLedgerKinds.HintPurchase, "room-1");

        Assert.Equal(WalletWrite.Rejected, result.Write);
        var account = await env.AccountAsync(user);
        Assert.Equal(10, account.Balance);
        Assert.Equal(5, account.BonusBalance);
        Assert.Equal(WalletLedgerStates.Rejected, (await env.Store.WalletLedger.Find(e => e.Id == "hint:b").SingleAsync()).State);
    }

    [Fact]
    public async Task ConcurrentSpends_NeverOverdraw_AndEachKeyIsAppliedOnce()
    {
        if (!Enabled) return;
        await using var env = await WalletEnv.CreateAsync();
        var user = await env.AddUserAsync(balance: 120, bonus: 80);

        // 40 different spends of 20 coins, each sent twice at the same time: 200 coins buy exactly 10 of them.
        var tasks = Enumerable.Range(0, 40)
            .SelectMany(i => new[] { $"hint:c{i}", $"hint:c{i}" })
            .Select(key => Task.Run(() => env.Wallet.SpendPreferBonusAsync(user, key, 20, WalletLedgerKinds.HintPurchase, "room-1")))
            .ToList();
        var results = await Task.WhenAll(tasks);

        var account = await env.AccountAsync(user);
        Assert.Equal(0, account.Balance);
        Assert.Equal(0, account.BonusBalance);
        Assert.Equal(10, results.Count(r => r.Write == WalletWrite.Applied));
        var applied = await env.Store.WalletLedger.Find(e => e.UserId == user && e.State == WalletLedgerStates.Applied).ToListAsync();
        Assert.Equal(10, applied.Count);
        Assert.Equal(-80, applied.Sum(e => e.BonusDelta));
        Assert.Equal(-120, applied.Sum(e => e.BalanceDelta));
    }

    [Fact]
    public async Task HoldThenFullRefund_RestoresBothBalances()
    {
        if (!Enabled) return;
        await using var env = await WalletEnv.CreateAsync();
        var user = await env.AddUserAsync(balance: 9000, bonus: 1000);

        var hold = await env.Wallet.HoldAsync(user, "vip-hold:d1", 7000, 1000, WalletLedgerKinds.VipHold, "d1");
        var held = await env.AccountAsync(user);
        Assert.True(hold.Succeeded);
        Assert.Equal(2000, held.Balance);
        Assert.Equal(0, held.BonusBalance);
        Assert.Equal(7000, held.Held);
        Assert.Equal(1000, held.BonusHeld);

        var refund = await env.Wallet.SettleHoldAsync(user, "vip-settle:d1", 7000, 1000, 7000, 1000, WalletLedgerKinds.VipRefund, "d1");
        var again = await env.Wallet.SettleHoldAsync(user, "vip-settle:d1", 7000, 1000, 7000, 1000, WalletLedgerKinds.VipRefund, "d1");

        Assert.Equal(WalletWrite.Applied, refund.Write);
        Assert.Equal(WalletWrite.AlreadyApplied, again.Write);
        var after = await env.AccountAsync(user);
        Assert.Equal(9000, after.Balance);
        Assert.Equal(1000, after.BonusBalance);
        Assert.Equal(0, after.Held);
        Assert.Equal(0, after.BonusHeld);
    }

    [Fact]
    public async Task HoldThenCharge_SpendsTheEscrow_AndPartialSettlementRefundsTheRest()
    {
        if (!Enabled) return;
        await using var env = await WalletEnv.CreateAsync();
        var charged = await env.AddUserAsync(balance: 8000);
        var partial = await env.AddUserAsync(balance: 8000);

        await env.Wallet.HoldAsync(charged, "vip-hold:c", 8000, 0, WalletLedgerKinds.VipHold, "c");
        await env.Wallet.SettleHoldAsync(charged, "vip-settle:c", 8000, 0, 0, 0, WalletLedgerKinds.VipCharge, "c");
        await env.Wallet.HoldAsync(partial, "vip-hold:p", 8000, 0, WalletLedgerKinds.VipHold, "p");
        await env.Wallet.SettleHoldAsync(partial, "vip-settle:p", 8000, 0, 6500, 0, WalletLedgerKinds.VipRefund, "p");

        var chargedAccount = await env.AccountAsync(charged);
        Assert.Equal(0, chargedAccount.Balance);
        Assert.Equal(0, chargedAccount.Held);
        var partialAccount = await env.AccountAsync(partial);
        Assert.Equal(6500, partialAccount.Balance);
        Assert.Equal(0, partialAccount.Held);
    }

    [Fact]
    public async Task Hold_WithoutEnoughOrdinaryCoins_IsRejected_EvenWithBonusCoins()
    {
        if (!Enabled) return;
        await using var env = await WalletEnv.CreateAsync();
        var user = await env.AddUserAsync(balance: 1000, bonus: 50_000);

        var hold = await env.Wallet.HoldAsync(user, "vip-hold:x", 5000, 0, WalletLedgerKinds.VipHold, "x");

        Assert.False(hold.Succeeded);
        var account = await env.AccountAsync(user);
        Assert.Equal(1000, account.Balance);
        Assert.Equal(50_000, account.BonusBalance);
        Assert.Equal(0, account.Held);
    }

    [Fact]
    public async Task TwoConcurrentHolds_CannotBothTakeTheSameCoins()
    {
        if (!Enabled) return;
        await using var env = await WalletEnv.CreateAsync();
        var user = await env.AddUserAsync(balance: 10_000);

        var results = await Task.WhenAll(
            Task.Run(() => env.Wallet.HoldAsync(user, "vip-hold:o1", 8000, 0, WalletLedgerKinds.VipHold, "o1")),
            Task.Run(() => env.Wallet.HoldAsync(user, "vip-hold:o2", 8000, 0, WalletLedgerKinds.VipHold, "o2")));

        Assert.Equal(1, results.Count(r => r.Succeeded));
        var account = await env.AccountAsync(user);
        Assert.Equal(2000, account.Balance);
        Assert.Equal(8000, account.Held);
    }

    [Fact]
    public async Task Settlement_CannotRefundMoreThanItReleases()
    {
        await using var env = Enabled ? await WalletEnv.CreateAsync() : null;
        var wallet = env?.Wallet ?? new CoinWalletService(null!, null!, NullLogger<CoinWalletService>.Instance);
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
            wallet.SettleHoldAsync("u", "k", 100, 0, 101, 0, WalletLedgerKinds.VipRefund, "d"));
    }

    [Fact]
    public async Task BonusCredit_AndBonusDebit_OnlyTouchBonusCoins()
    {
        if (!Enabled) return;
        await using var env = await WalletEnv.CreateAsync();
        var user = await env.AddUserAsync(balance: 300);

        await env.Wallet.CreditBonusAsync(user, "author-share:1", 420, WalletLedgerKinds.AuthorShare, "case-1");
        await env.Wallet.CreditBonusAsync(user, "author-share:1", 420, WalletLedgerKinds.AuthorShare, "case-1");
        var tooMuch = await env.Wallet.DebitBonusAsync(user, "author-revoke:1", 1000, WalletLedgerKinds.AuthorRevoke, "case-1");
        var revoke = await env.Wallet.DebitBonusAsync(user, "author-revoke:2", 400, WalletLedgerKinds.AuthorRevoke, "case-1");

        Assert.False(tooMuch.Succeeded);
        Assert.True(revoke.Succeeded);
        var account = await env.AccountAsync(user);
        Assert.Equal(300, account.Balance);
        Assert.Equal(20, account.BonusBalance);
    }

    [Fact]
    public async Task OldAccounts_WithoutBonusFields_StillSpend()
    {
        if (!Enabled) return;
        await using var env = await WalletEnv.CreateAsync();
        var user = ObjectId.GenerateNewId().ToString();
        // A wallet written before VUAN-7: no bonus fields at all.
        await env.Db.Database.GetCollection<BsonDocument>("marketAccounts").InsertOneAsync(new BsonDocument
        {
            { "_id", user }, { "balance", 70L }, { "held", 0L }, { "slots", 0 }, { "ops", new BsonArray { "starter" } },
            { "createdAt", DateTime.UtcNow }, { "updatedAt", DateTime.UtcNow }
        });

        var spend = await env.Store.SpendPreferBonusAsync(user, "chest:1", 50);

        Assert.Equal(WalletWrite.Applied, spend.Write);
        Assert.Equal(50, spend.FromBalance);
        Assert.Equal(0, spend.FromBonus);
        var account = await env.AccountAsync(user);
        Assert.Equal(20, account.Balance);
        Assert.Equal(0, account.BonusBalance);
    }

    internal sealed class WalletEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private WalletEnv(MongoDbSettings settings)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db);
            Market = new MarketService(Store, NullLogger<MarketService>.Instance);
            Wallet = new CoinWalletService(Store, Market, NullLogger<CoinWalletService>.Instance);
        }

        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public MarketService Market { get; }
        public CoinWalletService Wallet { get; }

        public static async Task<WalletEnv> CreateAsync()
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_wallet_{Guid.NewGuid():N}"
            };
            if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
                || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                    server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
                throw new InvalidOperationException("Wallet integration tests need a loopback MongoDB and a temporary database.");
            var env = new WalletEnv(settings);
            await env.Db.PingAsync();
            await env.Store.EnsureIndexesAsync();
            return env;
        }

        public async Task<string> AddUserAsync(long balance = 0, long bonus = 0)
        {
            var user = new User
            {
                Id = ObjectId.GenerateNewId().ToString(),
                FullName = "Thám tử",
                Email = $"{Guid.NewGuid():N}@tests.invalid",
                Status = UserStatus.Active,
                IsEmailVerified = true
            };
            await Db.Users.InsertOneAsync(user);
            await Market.EnsureAccountAsync(user.Id);
            await Store.Accounts.UpdateOneAsync(a => a.Id == user.Id,
                Builders<MarketAccount>.Update.Set(a => a.Balance, balance).Set(a => a.BonusBalance, bonus));
            return user.Id;
        }

        public Task<MarketAccount> AccountAsync(string userId) => Store.Accounts.Find(a => a.Id == userId).SingleAsync();

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
