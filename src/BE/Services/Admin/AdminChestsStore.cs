using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Models.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>Stable error codes of the chests and items admin. Rule violations keep their own codes inside the error body.</summary>
public static class AdminChestsErrors
{
    public const string ItemNotFound = "ADMIN_ITEM_NOT_FOUND";
    public const string ChestNotFound = "ADMIN_CHEST_NOT_FOUND";
    public const string VersionNotFound = "ADMIN_VERSION_NOT_FOUND";
    public const string VersionConflict = "ADMIN_VERSION_CONFLICT";
    public const string ReasonRequired = "ADMIN_REASON_REQUIRED";
    public const string ManagedElsewhere = "ADMIN_ITEM_MANAGED_ELSEWHERE";
    public const string Rejected = "ADMIN_VALIDATION";
    public const string NoChange = "ADMIN_NO_CHANGE";
    public const string NothingToRoll = "ADMIN_CHEST_EMPTY";

    public static ApiException Error(int status, string code, string message, IReadOnlyList<CatalogRuleViolation>? violations = null) =>
        new(status, message, new AdminChestsErrorDetails(code, violations ?? Array.Empty<CatalogRuleViolation>()));

    /// <summary>A refused write. The first message doubles as the summary, so a caller that shows only the message still says why.</summary>
    public static ApiException Refused(IReadOnlyList<CatalogRuleViolation> violations) =>
        Error(400, Rejected, violations[0].Message, violations);

    public static ApiException Conflict() =>
        Error(409, VersionConflict, "Một quản trị viên khác vừa sửa mục này. Hãy tải lại rồi làm lại.");

    public static void RequireReason(string? reason, string action)
    {
        if (string.IsNullOrWhiteSpace(reason))
            throw Error(400, ReasonRequired, $"Hãy nhập lý do {action}.");
    }
}

/// <summary>One saved state of a chest (collection chestVersions). _id is "chestId:version". The full chest, so any version can come back.</summary>
[BsonIgnoreExtraElements]
public class ChestVersion
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string ChestId { get; set; } = string.Empty;
    public int Version { get; set; }
    /// <summary>base (the state before the first save), update, restore or clone.</summary>
    public string Action { get; set; } = string.Empty;
    public DateTime At { get; set; }
    public string? AdminId { get; set; }
    public string? AdminName { get; set; }
    public string? Reason { get; set; }
    public CatalogChest Snapshot { get; set; } = new();

    public static string IdOf(string chestId, int version) => $"{chestId}:{version}";
}

/// <summary>What only this admin area stores, and the indexes its lists and statistics lean on.</summary>
public sealed class AdminChestsStore
{
    private readonly MongoDbContext _db;

    public AdminChestsStore(MongoDbContext db) => _db = db;

    public IMongoCollection<ChestVersion> Versions => _db.Database.GetCollection<ChestVersion>("chestVersions");

    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await Versions.Indexes.CreateOneAsync(new CreateIndexModel<ChestVersion>(
            Builders<ChestVersion>.IndexKeys.Ascending(v => v.ChestId).Descending(v => v.Version),
            new CreateIndexOptions { Name = "ix_chestVersions_chest_version" }), cancellationToken: ct);

        await _db.Database.GetCollection<ChestOpening>("chestOpenings").Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<ChestOpening>(
                Builders<ChestOpening>.IndexKeys.Ascending(o => o.ChestDefId).Ascending(o => o.State).Descending(o => o.CreatedAt),
                new CreateIndexOptions { Name = "ix_chestOpenings_chest_state_createdAt" }),
            new CreateIndexModel<ChestOpening>(
                Builders<ChestOpening>.IndexKeys.Descending(o => o.CreatedAt),
                new CreateIndexOptions { Name = "ix_chestOpenings_createdAt" }),
            new CreateIndexModel<ChestOpening>(
                Builders<ChestOpening>.IndexKeys.Ascending(o => o.RewardDefId),
                new CreateIndexOptions { Name = "ix_chestOpenings_rewardDefId" }),
        }, ct);

        await _db.Database.GetCollection<ChestPurchase>("chestPurchases").Indexes.CreateOneAsync(new CreateIndexModel<ChestPurchase>(
            Builders<ChestPurchase>.IndexKeys.Ascending(p => p.ChestDefId).Ascending(p => p.State).Descending(p => p.CreatedAt),
            new CreateIndexOptions { Name = "ix_chestPurchases_chest_state_createdAt" }), cancellationToken: ct);

        await _db.Database.GetCollection<MarketItem>("marketItems").Indexes.CreateOneAsync(new CreateIndexModel<MarketItem>(
            Builders<MarketItem>.IndexKeys.Ascending(i => i.DefId),
            new CreateIndexOptions { Name = "ix_marketItems_defId" }), cancellationToken: ct);
    }

    /// <summary>
    /// Every chest, with the fields a hand edit may have stored as null read as empty, as the catalog provider does.
    /// Such a chest fails validation until it is repaired, but the page that repairs it has to open.
    /// </summary>
    public static async Task<List<CatalogChest>> ReadChestsAsync(IMongoCollection<CatalogChest> collection, CancellationToken ct = default)
    {
        var chests = await ReadAllAsync(collection, ct);
        foreach (var chest in chests)
        {
            chest.Pool ??= new List<string>();
            chest.DropWeights ??= new Dictionary<string, int>(StringComparer.Ordinal);
            chest.Prices ??= new CatalogChestPrices();
            chest.Look ??= new CatalogChestLook();
        }
        return chests;
    }

    /// <summary>
    /// Reads a whole collection one document at a time. Like the catalog provider, a document of the wrong shape costs
    /// only itself (the provider's Problems report it), so one bad edit cannot lock an admin out of the page that fixes it.
    /// </summary>
    public static async Task<List<T>> ReadAllAsync<T>(IMongoCollection<T> collection, CancellationToken ct = default)
    {
        var documents = await collection.Database.GetCollection<BsonDocument>(collection.CollectionNamespace.CollectionName)
            .Find(new BsonDocument()).ToListAsync(ct);
        var read = new List<T>(documents.Count);
        foreach (var document in documents)
        {
            try
            {
                read.Add(BsonSerializer.Deserialize<T>(document));
            }
            catch (Exception exception) when (exception is FormatException or BsonException or InvalidOperationException)
            {
                // Reported by CatalogSnapshot.Problems.
            }
        }
        return read;
    }
}

/// <summary>Creates the indexes in the background: without them the pages are slower, not wrong, so startup does not wait or fail for them.</summary>
public sealed class AdminChestsIndexWorker : BackgroundService
{
    private readonly AdminChestsStore _store;
    private readonly ILogger<AdminChestsIndexWorker> _logger;

    public AdminChestsIndexWorker(AdminChestsStore store, ILogger<AdminChestsIndexWorker> logger)
    {
        _store = store;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await _store.EnsureIndexesAsync(stoppingToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogWarning(exception, "The chest admin indexes could not be created; its pages keep working, only slower.");
        }
    }
}
