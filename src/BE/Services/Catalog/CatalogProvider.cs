using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Catalog;

namespace SirLocked.Api.Services.Catalog;

/// <summary>
/// The only place that reads the catalog at runtime. Reads come from memory. Call <see cref="Invalidate"/> after
/// writing a catalog collection: the next read of <see cref="Current"/> loads the new data before it answers.
/// </summary>
public interface ICatalogProvider
{
    /// <summary>The catalog as of now. Never null. Blocks only for the first read after <see cref="Invalidate"/>.</summary>
    CatalogSnapshot Current { get; }

    /// <summary>Marks the cache stale. Cheap, so call it after every write.</summary>
    void Invalidate();

    /// <summary>Reloads from the database now. If the database cannot be read this throws and the last good catalog stays in place.</summary>
    Task RefreshAsync(CancellationToken ct = default);
}

/// <summary>A catalog that never changes: the seed data. For code built without a database-backed provider.</summary>
public sealed class FixedCatalogProvider : ICatalogProvider
{
    private static readonly Lazy<FixedCatalogProvider> Lazy = new(() => new FixedCatalogProvider(new ChestSettings()));

    public FixedCatalogProvider(ChestSettings prices) => Current = CatalogSeedData.ToSnapshot(prices);

    /// <summary>The seed catalog with the default prices.</summary>
    public static FixedCatalogProvider Default => Lazy.Value;

    public CatalogSnapshot Current { get; }

    public void Invalidate()
    {
    }

    public Task RefreshAsync(CancellationToken ct = default) => Task.CompletedTask;
}

public sealed class CatalogProvider : ICatalogProvider
{
    private static readonly TimeSpan RetryAfterFailure = TimeSpan.FromSeconds(5);

    private readonly CatalogStore _store;
    private readonly ILogger<CatalogProvider> _logger;
    private readonly TimeProvider _time;
    private readonly object _gate = new();

    private CatalogSnapshot _current;
    private long _wanted;           // Raised by Invalidate.
    private long _satisfied;        // The value of _wanted that _current reflects.
    private long _lastLoadTicket;   // Orders the loads, so a slow old one cannot replace a newer result.
    private long _publishedTicket;
    private DateTimeOffset _retryAt = DateTimeOffset.MinValue;

    public CatalogProvider(CatalogStore store, IOptions<ChestSettings> seedPrices, ILogger<CatalogProvider> logger, TimeProvider? time = null)
    {
        _store = store;
        _logger = logger;
        _time = time ?? TimeProvider.System;
        // Until the first load finishes (or for good, in a degraded development start) the seed data answers.
        _current = CatalogSeedData.ToSnapshot(seedPrices.Value);
    }

    public CatalogSnapshot Current
    {
        get
        {
            if (Interlocked.Read(ref _satisfied) < Interlocked.Read(ref _wanted)) ReloadInvalidated();
            return Volatile.Read(ref _current);
        }
    }

    public void Invalidate()
    {
        Interlocked.Increment(ref _wanted);
        lock (_gate) _retryAt = DateTimeOffset.MinValue;
    }

    public async Task RefreshAsync(CancellationToken ct = default)
    {
        var (wanted, ticket) = BeginLoad();
        var snapshot = await LoadAsync(ct);
        Publish(snapshot, wanted, ticket);
    }

    /// <summary>
    /// Readers wait here so whoever just wrote is guaranteed to read their own write. The wait is one load, and only
    /// after a write. When the database is down the last good catalog keeps answering and the load is retried shortly.
    /// </summary>
    private void ReloadInvalidated()
    {
        lock (_gate)
        {
            if (Interlocked.Read(ref _satisfied) >= Interlocked.Read(ref _wanted) || _time.GetUtcNow() < _retryAt) return;
            var (wanted, ticket) = BeginLoad();
            try
            {
                Publish(LoadAsync(CancellationToken.None).GetAwaiter().GetResult(), wanted, ticket);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // A database outage or one malformed document: either way players keep the catalog they had.
                _retryAt = _time.GetUtcNow() + RetryAfterFailure;
                _logger.LogError(exception, "The catalog could not be reloaded; the last good copy keeps answering.");
            }
        }
    }

    private (long Wanted, long Ticket) BeginLoad()
    {
        // Read before the load starts: an Invalidate during the load must trigger another one.
        var wanted = Interlocked.Read(ref _wanted);
        return (wanted, Interlocked.Increment(ref _lastLoadTicket));
    }

    private void Publish(CatalogSnapshot snapshot, long wanted, long ticket)
    {
        lock (_gate)
        {
            if (ticket < _publishedTicket) return;
            _publishedTicket = ticket;
            Volatile.Write(ref _current, snapshot);
            Interlocked.Exchange(ref _satisfied, wanted);
        }
        foreach (var problem in snapshot.Problems) _logger.LogWarning("Catalog: {Problem}", problem);
    }

    private async Task<CatalogSnapshot> LoadAsync(CancellationToken ct)
    {
        var problems = new List<string>();
        var items = await ReadAsync(_store.Items, new BsonDocument(), problems, ct);
        var chests = await ReadAsync(_store.Chests, new BsonDocument(), problems, ct);
        CatalogStore.AttachScenes(chests, await ReadAsync(_store.ChestStyles, new BsonDocument(), problems, ct));
        var rewards = await ReadAsync(_store.LevelRewards, new BsonDocument(), problems, ct);
        var achievements = await ReadAsync(_store.Achievements, new BsonDocument(), problems, ct);
        var progress = await ReadAsync(_store.ProgressSettings, new BsonDocument("_id", ProgressSettingsDocument.DocumentId), problems, ct);
        return CatalogSnapshot.Build(items, chests, rewards, achievements, progress.FirstOrDefault(), problems);
    }

    /// <summary>
    /// Reads one document at a time. A document of the wrong shape costs that document and is reported; it must not
    /// stop every later admin edit from taking effect, or the API from starting after a restart.
    /// </summary>
    private static async Task<List<T>> ReadAsync<T>(IMongoCollection<T> collection, BsonDocument filter, List<string> problems, CancellationToken ct)
    {
        var name = collection.CollectionNamespace.CollectionName;
        var documents = await collection.Database.GetCollection<BsonDocument>(name).Find(filter).ToListAsync(ct);
        var read = new List<T>(documents.Count);
        foreach (var document in documents)
        {
            try
            {
                read.Add(BsonSerializer.Deserialize<T>(document));
            }
            catch (Exception exception) when (exception is FormatException or BsonException or InvalidOperationException)
            {
                problems.Add($"{name}/{document.GetValue("_id", BsonNull.Value)} was left out, it has the wrong shape: {exception.Message}");
            }
        }
        return read;
    }
}
