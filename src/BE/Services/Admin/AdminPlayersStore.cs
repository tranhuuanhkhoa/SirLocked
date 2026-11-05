using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Market;

namespace SirLocked.Api.Services.Admin;

public static class AdminPlayerOpKinds
{
    public const string Coins = "COINS";
    public const string GrantItem = "GRANT_ITEM";
    public const string RevokeItem = "REVOKE_ITEM";
    public const string SetProgress = "SET_PROGRESS";
}

/// <summary>
/// One admin operation on a player (_id = "&lt;adminId&gt;:&lt;idempotencyKey&gt;") and its journal, in the style of the
/// market's: standalone MongoDB has no multi-document transactions, so what is about to happen is written down first, and
/// every step can run again. Resending a key finds this document and changes nothing. States follow
/// <see cref="ChestOpeningStates"/>. A crash leaves it PENDING, and the maintenance sweep finishes it.
/// </summary>
[BsonIgnoreExtraElements]
public class AdminPlayerOp
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public string TargetUserId { get; set; } = string.Empty;
    public string AdminId { get; set; } = string.Empty;
    public string AdminName { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;

    /// <summary>Coins added (positive) or taken (negative).</summary>
    public long Amount { get; set; }
    public string? DefId { get; set; }
    /// <summary>The item given or revoked. A grant chooses it up front, so creating it twice is a duplicate key and not a second item.</summary>
    public string? ItemId { get; set; }
    public int? Level { get; set; }
    public int? Xp { get; set; }

    public string State { get; set; } = ChestOpeningStates.Pending;
    public string? Error { get; set; }
    /// <summary>A revoke can still stop before this and only rolls forward after it.</summary>
    public bool Committed { get; set; }
    public string? CancelledListingId { get; set; }
    public List<string> KeptRewardDefIds { get; set; } = new();

    public BsonDocument? Before { get; set; }
    public BsonDocument? After { get; set; }
    public bool Audited { get; set; }
    /// <summary>Whoever set this writes the audit, so parallel retries record one entry. An old claim means its writer died.</summary>
    public DateTime? AuditClaimedAt { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>An uploaded avatar an admin has looked at (_id = userId). A new upload has a new address, so it needs looking at again.</summary>
[BsonIgnoreExtraElements]
public class AdminAvatarReview
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string ReviewedBy { get; set; } = string.Empty;
    public DateTime ReviewedAt { get; set; }
}

/// <summary>The collections of the player admin. Like MarketStore, they sit beside the shared context.</summary>
public sealed class AdminPlayersStore
{
    private readonly MongoDbContext _db;

    public AdminPlayersStore(MongoDbContext db) => _db = db;

    public IMongoCollection<AdminPlayerOp> Ops => _db.Database.GetCollection<AdminPlayerOp>("adminPlayerOps");
    public IMongoCollection<AdminAvatarReview> AvatarReviews => _db.Database.GetCollection<AdminAvatarReview>("adminAvatarReviews");

    /// <summary>
    /// Lookup indexes only, so a failure here costs speed, not safety. Also covers what these pages read from other areas'
    /// collections. Each one is tried on its own: one index that cannot be made must not cost the rest. Failures are reported together at the end.
    /// </summary>
    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        var market = _db.Database;
        var creations = new Func<Task>[]
        {
            () => Ops.Indexes.CreateManyAsync(new[]
            {
                new CreateIndexModel<AdminPlayerOp>(Builders<AdminPlayerOp>.IndexKeys.Ascending(o => o.State).Ascending(o => o.UpdatedAt),
                    new CreateIndexOptions { Name = "ix_adminPlayerOps_state_updatedAt" }),
                new CreateIndexModel<AdminPlayerOp>(Builders<AdminPlayerOp>.IndexKeys.Ascending(o => o.Kind).Ascending(o => o.State).Ascending(o => o.CreatedAt),
                    new CreateIndexOptions { Name = "ix_adminPlayerOps_kind_state_createdAt" }),
            }, ct),
            () => _db.Users.Indexes.CreateOneAsync(new CreateIndexModel<User>(
                Builders<User>.IndexKeys.Descending(u => u.CreatedAt),
                new CreateIndexOptions { Name = "ix_users_createdAt" }), cancellationToken: ct),
            // gameResults already has an index on createdAt alone, from MongoDbContext.
            () => _db.GameResults.Indexes.CreateOneAsync(new CreateIndexModel<GameResult>(
                Builders<GameResult>.IndexKeys.Ascending(r => r.Players).Descending(r => r.CreatedAt),
                new CreateIndexOptions { Name = "ix_gameResults_players_createdAt" }), cancellationToken: ct),
            () => _db.Reviews.Indexes.CreateOneAsync(new CreateIndexModel<CaseReview>(
                Builders<CaseReview>.IndexKeys.Descending(r => r.CreatedAt),
                new CreateIndexOptions { Name = "ix_reviews_createdAt" }), cancellationToken: ct),
            () => market.GetCollection<MarketAccount>("marketAccounts").Indexes.CreateOneAsync(new CreateIndexModel<MarketAccount>(
                Builders<MarketAccount>.IndexKeys.Descending(a => a.Balance),
                new CreateIndexOptions { Name = "ix_marketAccounts_balance" }), cancellationToken: ct),
            () => market.GetCollection<MarketListing>("marketListings").Indexes.CreateOneAsync(new CreateIndexModel<MarketListing>(
                Builders<MarketListing>.IndexKeys.Ascending(l => l.Status).Descending(l => l.CreatedAt),
                new CreateIndexOptions { Name = "ix_marketListings_status_createdAt" }), cancellationToken: ct),
            () => market.GetCollection<MarketBuyOrder>("marketOrders").Indexes.CreateOneAsync(new CreateIndexModel<MarketBuyOrder>(
                Builders<MarketBuyOrder>.IndexKeys.Ascending(o => o.Status).Descending(o => o.CreatedAt),
                new CreateIndexOptions { Name = "ix_marketOrders_status_createdAt" }), cancellationToken: ct),
            () => market.GetCollection<TradeOffer>("marketTrades").Indexes.CreateManyAsync(new[]
            {
                new CreateIndexModel<TradeOffer>(Builders<TradeOffer>.IndexKeys.Descending(t => t.CreatedAt),
                    new CreateIndexOptions { Name = "ix_marketTrades_createdAt" }),
                new CreateIndexModel<TradeOffer>(Builders<TradeOffer>.IndexKeys.Ascending(t => t.Status).Descending(t => t.RespondedAt),
                    new CreateIndexOptions { Name = "ix_marketTrades_status_respondedAt" }),
            }, ct),
            () => market.GetCollection<ChestOpening>("chestOpenings").Indexes.CreateOneAsync(new CreateIndexModel<ChestOpening>(
                Builders<ChestOpening>.IndexKeys.Ascending(o => o.State).Descending(o => o.CreatedAt),
                new CreateIndexOptions { Name = "ix_chestOpenings_state_createdAt" }), cancellationToken: ct),
            () => market.GetCollection<PlayerProgress>("playerProgress").Indexes.CreateOneAsync(new CreateIndexModel<PlayerProgress>(
                Builders<PlayerProgress>.IndexKeys.Ascending(p => p.AvatarUrl),
                new CreateIndexOptions<PlayerProgress>
                {
                    Name = "ix_playerProgress_avatarUrl",
                    PartialFilterExpression = Builders<PlayerProgress>.Filter.Type(p => p.AvatarUrl, BsonType.String),
                }), cancellationToken: ct),
        };

        var failures = new List<Exception>();
        foreach (var create in creations)
        {
            try
            {
                await create();
            }
            catch (MongoException exception)
            {
                failures.Add(exception);
            }
        }
        if (failures.Count > 0) throw new AggregateException("Some player admin indexes could not be created.", failures);
    }
}
