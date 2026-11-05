using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>
/// gameSettings/cosmeticDefaults: what a detective wears when nothing is equipped. One field per group, so "at most
/// one default in each group" holds by the shape of the document, whatever two admins do at once.
/// </summary>
[BsonIgnoreExtraElements]
public class CosmeticDefaultsDocument
{
    public const string DocumentId = "cosmeticDefaults";

    [BsonId] public string Id { get; set; } = DocumentId;
    public string? Frame { get; set; }
    public string? Title { get; set; }
    public string? Entrance { get; set; }
}

/// <summary>What nobody chose falls back to the defaults in code: no frame, Tân Binh, Bước Vào Lặng Lẽ.</summary>
public sealed record CosmeticDefaults(string? Frame, string Title, string Entrance)
{
    public static readonly CosmeticDefaults InCode = new(null, CosmeticCatalog.DefaultTitleDefId, CosmeticCatalog.DefaultEntranceDefId);

    public string? For(string category) => category switch
    {
        MarketCategories.Frame => Frame,
        MarketCategories.Title => Title,
        MarketCategories.Entrance => Entrance,
        _ => null,
    };

    /// <summary>True when the item is the default only because of the code: it cannot stop being one, something else must take over.</summary>
    public static bool IsDefaultInCode(string category, string defId) => InCode.For(category) == defId;
}

public interface ICosmeticDefaults
{
    /// <summary>Never throws: with the database away the last good answer stands, or the defaults in code.</summary>
    Task<CosmeticDefaults> GetAsync(CancellationToken ct = default);

    /// <summary>Makes <paramref name="defId"/> the default of its group, or clears the group's choice when it is null.</summary>
    Task SetAsync(string category, string? defId, CancellationToken ct = default);
}

public sealed class CosmeticDefaultsStore : ICosmeticDefaults
{
    // A lobby asks on every read of a room. Saving here clears the cache, so an admin never waits for it.
    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(30);

    private readonly CatalogStore _store;
    private readonly ILogger<CosmeticDefaultsStore> _logger;
    private readonly TimeProvider _time;
    private readonly object _gate = new();
    private CosmeticDefaults _cached = CosmeticDefaults.InCode;
    private DateTimeOffset _validUntil = DateTimeOffset.MinValue;

    public CosmeticDefaultsStore(CatalogStore store, ILogger<CosmeticDefaultsStore> logger, TimeProvider? time = null)
    {
        _store = store;
        _logger = logger;
        _time = time ?? TimeProvider.System;
    }

    private IMongoCollection<CosmeticDefaultsDocument> Documents =>
        _store.ProgressSettings.Database.GetCollection<CosmeticDefaultsDocument>(_store.ProgressSettings.CollectionNamespace.CollectionName);

    public async Task<CosmeticDefaults> GetAsync(CancellationToken ct = default)
    {
        lock (_gate)
        {
            if (_time.GetUtcNow() < _validUntil) return _cached;
        }
        try
        {
            var document = await Documents.Find(d => d.Id == CosmeticDefaultsDocument.DocumentId).FirstOrDefaultAsync(ct);
            var fresh = new CosmeticDefaults(
                document?.Frame,
                document?.Title ?? CosmeticDefaults.InCode.Title,
                document?.Entrance ?? CosmeticDefaults.InCode.Entrance);
            lock (_gate)
            {
                _cached = fresh;
                _validUntil = _time.GetUtcNow() + CacheFor;
            }
            return fresh;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogError(exception, "The cosmetic defaults could not be read; the last good answer stands.");
            lock (_gate) return _cached;
        }
    }

    public async Task SetAsync(string category, string? defId, CancellationToken ct = default)
    {
        var field = category switch
        {
            MarketCategories.Frame => "frame",
            MarketCategories.Title => "title",
            MarketCategories.Entrance => "entrance",
            _ => throw new ArgumentOutOfRangeException(nameof(category), category, "Only cosmetics have a default."),
        };
        var update = defId is null
            ? new BsonDocument("$unset", new BsonDocument(field, ""))
            : new BsonDocument("$set", new BsonDocument(field, defId));
        await Documents.UpdateOneAsync(d => d.Id == CosmeticDefaultsDocument.DocumentId, update, new UpdateOptions { IsUpsert = true }, ct);
        lock (_gate) _validUntil = DateTimeOffset.MinValue;
    }
}
