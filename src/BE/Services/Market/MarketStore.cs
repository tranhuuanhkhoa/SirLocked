using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models.Market;

namespace SirLocked.Api.Services.Market;

public enum WalletWrite
{
    Applied,
    /// <summary>The same operation key was applied before (a replay); nothing changed.</summary>
    AlreadyApplied,
    /// <summary>A guard failed (not enough coins/held coins, or no free slot); nothing changed.</summary>
    Rejected
}

/// <summary>A system-sink spend: how much came from the ordinary balance and how much from bonus coins.</summary>
public readonly record struct WalletSpend(WalletWrite Write, long FromBalance, long FromBonus);

/// <summary>
/// Market collections plus the guarded single-document writes every market operation is built from.
/// Collections live next to the existing ones through <see cref="MongoDbContext.Database"/>, so the
/// shared context is not modified.
/// </summary>
public sealed class MarketStore
{
    private readonly MongoDbContext _db;
    private readonly TimeProvider _time;

    public MarketStore(MongoDbContext db, TimeProvider? time = null)
    {
        _db = db;
        _time = time ?? TimeProvider.System;
    }

    public MongoDbContext Context => _db;
    public IMongoCollection<MarketAccount> Accounts => _db.Database.GetCollection<MarketAccount>("marketAccounts");
    public IMongoCollection<MarketItem> Items => _db.Database.GetCollection<MarketItem>("marketItems");
    public IMongoCollection<MarketListing> Listings => _db.Database.GetCollection<MarketListing>("marketListings");
    public IMongoCollection<MarketBuyOrder> Orders => _db.Database.GetCollection<MarketBuyOrder>("marketOrders");
    public IMongoCollection<MarketSale> Sales => _db.Database.GetCollection<MarketSale>("marketSales");
    public IMongoCollection<TradeOffer> Trades => _db.Database.GetCollection<TradeOffer>("marketTrades");
    public IMongoCollection<MarketReward> Rewards => _db.Database.GetCollection<MarketReward>("marketRewards");
    public IMongoCollection<MarketTx> Txs => _db.Database.GetCollection<MarketTx>("marketTx");
    public IMongoCollection<MarketRequest> Requests => _db.Database.GetCollection<MarketRequest>("marketRequests");
    public IMongoCollection<ChestOpening> ChestOpenings => _db.Database.GetCollection<ChestOpening>("chestOpenings");
    public IMongoCollection<ChestPurchase> ChestPurchases => _db.Database.GetCollection<ChestPurchase>("chestPurchases");
    public IMongoCollection<PlayerProgress> PlayerProgress => _db.Database.GetCollection<PlayerProgress>("playerProgress");
    public IMongoCollection<XpExchange> XpExchanges => _db.Database.GetCollection<XpExchange>("xpExchanges");
    public IMongoCollection<WalletLedgerEntry> WalletLedger => _db.Database.GetCollection<WalletLedgerEntry>("walletLedger");
    public IMongoCollection<WeeklyDrop> WeeklyDrops => _db.Database.GetCollection<WeeklyDrop>("weeklyDrops");

    public DateTime Now => _time.GetUtcNow().UtcDateTime;

    public static string NewId() => ObjectId.GenerateNewId().ToString();

    /// <summary>
    /// Lookup indexes only. Every uniqueness invariant of the market is carried by _id
    /// (sale = tx id, reward = room:user, request = user:requestId), so a failure here costs speed, not safety.
    /// </summary>
    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await Items.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<MarketItem>(Builders<MarketItem>.IndexKeys.Ascending(i => i.OwnerId).Ascending(i => i.DefId),
                new CreateIndexOptions { Name = "ix_marketItems_owner_def" }),
            new CreateIndexModel<MarketItem>(Builders<MarketItem>.IndexKeys.Ascending(i => i.LockedBy),
                new CreateIndexOptions<MarketItem>
                {
                    Name = "ix_marketItems_lockedBy",
                    PartialFilterExpression = Builders<MarketItem>.Filter.Type(i => i.LockedBy, BsonType.String)
                })
        }, ct);
        await Listings.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<MarketListing>(Builders<MarketListing>.IndexKeys
                    .Ascending(l => l.DefId).Ascending(l => l.Status).Ascending(l => l.Price).Ascending(l => l.CreatedAt),
                new CreateIndexOptions { Name = "ix_marketListings_def_status_price" }),
            new CreateIndexModel<MarketListing>(Builders<MarketListing>.IndexKeys
                    .Ascending(l => l.SellerId).Ascending(l => l.Status),
                new CreateIndexOptions { Name = "ix_marketListings_seller_status" }),
            new CreateIndexModel<MarketListing>(Builders<MarketListing>.IndexKeys
                    .Ascending(l => l.Status).Ascending(l => l.UpdatedAt),
                new CreateIndexOptions { Name = "ix_marketListings_status_updatedAt" })
        }, ct);
        await Orders.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<MarketBuyOrder>(Builders<MarketBuyOrder>.IndexKeys
                    .Ascending(o => o.DefId).Ascending(o => o.Status).Descending(o => o.Price).Ascending(o => o.CreatedAt),
                new CreateIndexOptions { Name = "ix_marketOrders_def_status_price" }),
            new CreateIndexModel<MarketBuyOrder>(Builders<MarketBuyOrder>.IndexKeys
                    .Ascending(o => o.BuyerId).Ascending(o => o.Status),
                new CreateIndexOptions { Name = "ix_marketOrders_buyer_status" }),
            new CreateIndexModel<MarketBuyOrder>(Builders<MarketBuyOrder>.IndexKeys
                    .Ascending(o => o.Status).Ascending(o => o.UpdatedAt),
                new CreateIndexOptions { Name = "ix_marketOrders_status_updatedAt" })
        }, ct);
        await Sales.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<MarketSale>(Builders<MarketSale>.IndexKeys.Ascending(s => s.DefId).Descending(s => s.At),
                new CreateIndexOptions { Name = "ix_marketSales_def_at" }),
            new CreateIndexModel<MarketSale>(Builders<MarketSale>.IndexKeys.Descending(s => s.At),
                new CreateIndexOptions { Name = "ix_marketSales_at" }),
            new CreateIndexModel<MarketSale>(Builders<MarketSale>.IndexKeys.Ascending(s => s.SellerId).Descending(s => s.At),
                new CreateIndexOptions { Name = "ix_marketSales_seller_at" }),
            new CreateIndexModel<MarketSale>(Builders<MarketSale>.IndexKeys.Ascending(s => s.BuyerId).Descending(s => s.At),
                new CreateIndexOptions { Name = "ix_marketSales_buyer_at" })
        }, ct);
        await Trades.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<TradeOffer>(Builders<TradeOffer>.IndexKeys
                    .Ascending(t => t.ToUserId).Ascending(t => t.Status).Descending(t => t.CreatedAt),
                new CreateIndexOptions { Name = "ix_marketTrades_to_status" }),
            new CreateIndexModel<TradeOffer>(Builders<TradeOffer>.IndexKeys
                    .Ascending(t => t.FromUserId).Ascending(t => t.Status).Descending(t => t.CreatedAt),
                new CreateIndexOptions { Name = "ix_marketTrades_from_status" })
        }, ct);
        await Txs.Indexes.CreateOneAsync(new CreateIndexModel<MarketTx>(
            Builders<MarketTx>.IndexKeys.Ascending(t => t.State).Ascending(t => t.UpdatedAt),
            new CreateIndexOptions { Name = "ix_marketTx_state_updatedAt" }), cancellationToken: ct);
        await Rewards.Indexes.CreateOneAsync(new CreateIndexModel<MarketReward>(
            Builders<MarketReward>.IndexKeys.Ascending(r => r.Applied).Ascending(r => r.CreatedAt),
            new CreateIndexOptions { Name = "ix_marketRewards_applied_createdAt" }), cancellationToken: ct);
        await Requests.Indexes.CreateOneAsync(new CreateIndexModel<MarketRequest>(
            Builders<MarketRequest>.IndexKeys.Ascending(r => r.CreatedAt),
            new CreateIndexOptions { Name = "ttl_marketRequests_createdAt", ExpireAfter = TimeSpan.FromDays(1) }), cancellationToken: ct);
        await ChestOpenings.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<ChestOpening>(Builders<ChestOpening>.IndexKeys.Ascending(o => o.State).Ascending(o => o.UpdatedAt),
                new CreateIndexOptions { Name = "ix_chestOpenings_state_updatedAt" }),
            new CreateIndexModel<ChestOpening>(Builders<ChestOpening>.IndexKeys.Ascending(o => o.UserId).Descending(o => o.CreatedAt),
                new CreateIndexOptions { Name = "ix_chestOpenings_user_createdAt" })
        }, ct);
        await ChestPurchases.Indexes.CreateOneAsync(new CreateIndexModel<ChestPurchase>(
            Builders<ChestPurchase>.IndexKeys.Ascending(p => p.State).Ascending(p => p.UpdatedAt),
            new CreateIndexOptions { Name = "ix_chestPurchases_state_updatedAt" }), cancellationToken: ct);
        await WalletLedger.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<WalletLedgerEntry>(Builders<WalletLedgerEntry>.IndexKeys
                    .Ascending(e => e.UserId).Descending(e => e.CreatedAt),
                new CreateIndexOptions { Name = "ix_walletLedger_user_createdAt" }),
            new CreateIndexModel<WalletLedgerEntry>(Builders<WalletLedgerEntry>.IndexKeys
                    .Ascending(e => e.State).Ascending(e => e.UpdatedAt),
                new CreateIndexOptions { Name = "ix_walletLedger_state_updatedAt" })
        }, ct);
        await XpExchanges.Indexes.CreateOneAsync(new CreateIndexModel<XpExchange>(
            Builders<XpExchange>.IndexKeys.Ascending(e => e.State).Ascending(e => e.UpdatedAt),
            new CreateIndexOptions { Name = "ix_xpExchanges_state_updatedAt" }), cancellationToken: ct);
        await WeeklyDrops.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<WeeklyDrop>(Builders<WeeklyDrop>.IndexKeys.Ascending(d => d.UserId).Ascending(d => d.State),
                new CreateIndexOptions { Name = "ix_weeklyDrops_user_state" }),
            new CreateIndexModel<WeeklyDrop>(Builders<WeeklyDrop>.IndexKeys.Ascending(d => d.State).Ascending(d => d.UpdatedAt),
                new CreateIndexOptions { Name = "ix_weeklyDrops_state_updatedAt" })
        }, ct);
    }

    /// <summary>
    /// The only way coins and slots change. One atomic update: applies the deltas when the operation key
    /// was not applied before AND the guards hold (balance/held never go negative, slots never exceed
    /// <paramref name="slotCap"/> when increasing).
    /// </summary>
    public async Task<WalletWrite> ApplyWalletAsync(
        string userId,
        string opKey,
        long balanceDelta,
        long heldDelta = 0,
        int slotDelta = 0,
        int slotCap = MarketRules.InventorySlots,
        CancellationToken ct = default,
        long bonusDelta = 0,
        long bonusHeldDelta = 0)
    {
        var filter = Builders<MarketAccount>.Filter;
        var conditions = new List<FilterDefinition<MarketAccount>>
        {
            filter.Eq(a => a.Id, userId),
            filter.AnyNe(a => a.Ops, opKey)
        };
        if (balanceDelta < 0) conditions.Add(filter.Gte(a => a.Balance, -balanceDelta));
        if (heldDelta < 0) conditions.Add(filter.Gte(a => a.Held, -heldDelta));
        if (bonusDelta < 0) conditions.Add(filter.Gte(a => a.BonusBalance, -bonusDelta));
        if (bonusHeldDelta < 0) conditions.Add(filter.Gte(a => a.BonusHeld, -bonusHeldDelta));
        if (slotDelta > 0) conditions.Add(filter.Lte(a => a.Slots, slotCap - slotDelta));

        var update = Builders<MarketAccount>.Update
            .Inc(a => a.Balance, balanceDelta)
            .Inc(a => a.Held, heldDelta)
            .Inc(a => a.Slots, slotDelta)
            .PushEach(a => a.Ops, new[] { opKey }, slice: -MarketRules.OpsWindow)
            .Set(a => a.UpdatedAt, Now);
        if (bonusDelta != 0) update = update.Inc(a => a.BonusBalance, bonusDelta);
        if (bonusHeldDelta != 0) update = update.Inc(a => a.BonusHeld, bonusHeldDelta);
        var result = await Accounts.UpdateOneAsync(filter.And(conditions), update, cancellationToken: ct);
        if (result.ModifiedCount == 1) return WalletWrite.Applied;

        var replayed = await Accounts.CountDocumentsAsync(
            filter.Eq(a => a.Id, userId) & filter.AnyEq(a => a.Ops, opKey), cancellationToken: ct);
        return replayed > 0 ? WalletWrite.AlreadyApplied : WalletWrite.Rejected;
    }

    /// <summary>
    /// Spends <paramref name="amount"/> coins at a system sink (chest, shop cosmetic, hint): bonus coins first, the rest
    /// from the ordinary balance. One atomic pipeline update decides the split from the document itself, so two
    /// concurrent spends can never both use the same bonus coins and neither part goes negative. The split is only known
    /// to the call that applied it; a replay reports <see cref="WalletWrite.AlreadyApplied"/> without it.
    /// </summary>
    public async Task<WalletSpend> SpendPreferBonusAsync(
        string userId,
        string opKey,
        long amount,
        int slotDelta = 0,
        int slotCap = MarketRules.InventorySlots,
        CancellationToken ct = default)
    {
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount), "A spend cannot be negative.");
        var bonus = new BsonDocument("$ifNull", new BsonArray { "$bonusBalance", 0L });
        var fromBonus = new BsonDocument("$min", new BsonArray { bonus, amount });
        var filter = new BsonDocument
        {
            { "_id", userId },
            { "ops", new BsonDocument("$ne", opKey) },
            { "$expr", new BsonDocument("$gte", new BsonArray { new BsonDocument("$add", new BsonArray { "$balance", bonus }), amount }) }
        };
        if (slotDelta > 0) filter.Add("slots", new BsonDocument("$lte", slotCap - slotDelta));
        var set = new BsonDocument
        {
            { "bonusBalance", new BsonDocument("$subtract", new BsonArray { bonus, fromBonus }) },
            { "balance", new BsonDocument("$subtract", new BsonArray
                { "$balance", new BsonDocument("$subtract", new BsonArray { amount, fromBonus }) }) },
            { "slots", new BsonDocument("$add", new BsonArray { "$slots", slotDelta }) },
            { "ops", new BsonDocument("$slice", new BsonArray
                {
                    new BsonDocument("$concatArrays", new BsonArray
                    {
                        new BsonDocument("$ifNull", new BsonArray { "$ops", new BsonArray() }),
                        new BsonArray { opKey }
                    }),
                    -MarketRules.OpsWindow
                }) },
            { "updatedAt", Now }
        };
        var pipeline = PipelineDefinition<MarketAccount, MarketAccount>.Create(new[] { new BsonDocument("$set", set) });
        var before = await Accounts.FindOneAndUpdateAsync(
            new BsonDocumentFilterDefinition<MarketAccount>(filter),
            Builders<MarketAccount>.Update.Pipeline(pipeline),
            new FindOneAndUpdateOptions<MarketAccount> { ReturnDocument = ReturnDocument.Before },
            ct);
        if (before is not null)
        {
            var bonusPart = Math.Min(Math.Max(before.BonusBalance, 0), amount);
            return new WalletSpend(WalletWrite.Applied, amount - bonusPart, bonusPart);
        }
        var replayed = await Accounts.CountDocumentsAsync(
            Builders<MarketAccount>.Filter.Eq(a => a.Id, userId) & Builders<MarketAccount>.Filter.AnyEq(a => a.Ops, opKey),
            cancellationToken: ct);
        return new WalletSpend(replayed > 0 ? WalletWrite.AlreadyApplied : WalletWrite.Rejected, 0, 0);
    }

    public Task<MarketAccount?> FindAccountAsync(string userId, CancellationToken ct = default) =>
        Accounts.Find(a => a.Id == userId).FirstOrDefaultAsync(ct)!;

    /// <summary>Locks a free item of <paramref name="ownerId"/> (or confirms it is already locked by <paramref name="lockKey"/>).</summary>
    public async Task<bool> LockItemAsync(string itemId, string ownerId, string lockKey, CancellationToken ct = default)
    {
        var filter = Builders<MarketItem>.Filter;
        var result = await Items.UpdateOneAsync(
            filter.Eq(i => i.Id, itemId)
            & filter.Eq(i => i.OwnerId, ownerId)
            & (filter.Eq(i => i.LockedBy, null) | filter.Eq(i => i.LockedBy, lockKey)),
            Builders<MarketItem>.Update.Set(i => i.LockedBy, lockKey),
            cancellationToken: ct);
        return result.MatchedCount == 1;
    }

    public async Task UnlockItemAsync(string itemId, string lockKey, CancellationToken ct = default) =>
        await Items.UpdateOneAsync(
            i => i.Id == itemId && i.LockedBy == lockKey,
            Builders<MarketItem>.Update.Set(i => i.LockedBy, null),
            cancellationToken: ct);

    /// <summary>
    /// Moves an item locked by <paramref name="lockKey"/> from one owner to another and unlocks it.
    /// Idempotent: a replay that finds the item already moved by <paramref name="txId"/> reports success.
    /// </summary>
    public async Task<bool> MoveItemAsync(
        string itemId, string fromOwner, string toOwner, string lockKey, string txId, string source,
        CancellationToken ct = default)
    {
        var result = await Items.UpdateOneAsync(
            i => i.Id == itemId && i.OwnerId == fromOwner && i.LockedBy == lockKey,
            Builders<MarketItem>.Update
                .Set(i => i.OwnerId, toOwner)
                .Set(i => i.LockedBy, null)
                .Set(i => i.LastTxId, txId)
                .Set(i => i.Source, source)
                .Set(i => i.AcquiredAt, Now),
            cancellationToken: ct);
        if (result.MatchedCount == 1) return true;
        return await Items.CountDocumentsAsync(i => i.Id == itemId && i.OwnerId == toOwner && i.LastTxId == txId,
            cancellationToken: ct) > 0;
    }

    /// <summary>Clears an equipped slot if it still points at <paramref name="itemId"/>.</summary>
    public async Task UnequipItemAsync(string userId, string category, string itemId, CancellationToken ct = default) =>
        await Accounts.UpdateOneAsync(
            Builders<MarketAccount>.Filter.Eq(a => a.Id, userId)
            & Builders<MarketAccount>.Filter.Eq($"equipped.{category}", itemId),
            Builders<MarketAccount>.Update.Unset($"equipped.{category}"),
            cancellationToken: ct);

    public async Task TouchTxAsync(string txId, UpdateDefinition<MarketTx> update, CancellationToken ct = default) =>
        await Txs.UpdateOneAsync(t => t.Id == txId, update.Set(t => t.UpdatedAt, Now), cancellationToken: ct);
}
