using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Catalog;

namespace SirLocked.Api.Services.Catalog;

public sealed record CatalogSeedReport(int FromVersion, int ToVersion, int Inserted);

/// <summary>
/// Copies the seed into MongoDB when the code holds a newer seed version than the database. An entry is only ever
/// inserted when its id is missing, so an admin's edit is never overwritten; and a batch runs once, so something an
/// admin deleted on purpose does not come back at the next start. Safe to run from several processes at once.
/// </summary>
public sealed class CatalogSeeder
{
    private readonly CatalogStore _store;
    private readonly ChestSettings _prices;
    private readonly TimeProvider _time;
    private readonly ILogger<CatalogSeeder> _logger;

    public CatalogSeeder(CatalogStore store, IOptions<ChestSettings> prices, ILogger<CatalogSeeder> logger, TimeProvider? time = null)
    {
        _store = store;
        _prices = prices.Value;
        _logger = logger;
        _time = time ?? TimeProvider.System;
    }

    public async Task<CatalogSeedReport> SeedAsync(CancellationToken ct = default)
    {
        await _store.EnsureIndexesAsync(ct);

        var state = await _store.SeedState
            .Find(new BsonDocument("_id", CatalogSeedState.DocumentId))
            .FirstOrDefaultAsync(ct);
        var from = state?.SeedVersion ?? 0;
        var inserted = 0;
        for (var version = from + 1; version <= CatalogSeedData.CurrentVersion; version++)
        {
            var now = _time.GetUtcNow().UtcDateTime;
            var batch = CatalogSeedData.ForVersion(version, _prices, now);
            // Items first: a crash here must leave no chest pointing at an item that does not exist yet.
            inserted += await InsertMissingAsync(_store.Items, batch.Items, ct);
            inserted += await InsertMissingAsync(_store.Chests, batch.Chests, ct);
            inserted += await InsertMissingAsync(_store.LevelRewards, batch.LevelRewards, ct);
            inserted += await InsertMissingAsync(_store.Achievements, batch.Achievements, ct);
            if (batch.Progress is not null) inserted += await InsertMissingAsync(_store.ProgressSettings, new[] { batch.Progress }, ct);

            // Written last, so a crash just repeats a batch and finds its entries already there.
            await _store.SeedState.UpdateOneAsync(
                new BsonDocument("_id", CatalogSeedState.DocumentId),
                Builders<CatalogSeedState>.Update.Max(s => s.SeedVersion, version).Set(s => s.UpdatedAt, now),
                new UpdateOptions { IsUpsert = true },
                ct);
        }

        var report = new CatalogSeedReport(from, Math.Max(from, CatalogSeedData.CurrentVersion), inserted);
        if (from < CatalogSeedData.CurrentVersion)
            _logger.LogInformation("Catalog seed: version {From} to {To}, {Inserted} documents added.", report.FromVersion, report.ToVersion, inserted);
        return report;
    }

    private static async Task<int> InsertMissingAsync<T>(IMongoCollection<T> collection, IReadOnlyCollection<T> documents, CancellationToken ct)
    {
        if (documents.Count == 0) return 0;
        try
        {
            await collection.InsertManyAsync(documents, new InsertManyOptions { IsOrdered = false }, ct);
            return documents.Count;
        }
        catch (MongoBulkWriteException<T> exception)
            when (exception.WriteConcernError is null && exception.WriteErrors.All(error => error.Category == ServerErrorCategory.DuplicateKey))
        {
            // The ones already there (an admin may have edited them) stay exactly as they are.
            return documents.Count - exception.WriteErrors.Count;
        }
    }
}
