using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.API.Configurations;
using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public sealed class GameplayRepository : IGameplayRepository
{
    private readonly IMongoCollection<GameActionLog> _logs;
    private readonly IMongoCollection<GameResult> _results;

    public GameplayRepository(IMongoClient mongoClient, IOptions<MongoDbSettings> settings)
    {
        var database = mongoClient.GetDatabase(settings.Value.DatabaseName);
        _logs = database.GetCollection<GameActionLog>(settings.Value.GameActionLogsCollectionName);
        _results = database.GetCollection<GameResult>(settings.Value.GameResultsCollectionName);
    }

    public async Task AddActionLogAsync(GameActionLog log, CancellationToken cancellationToken = default)
    {
        await _logs.InsertOneAsync(log, cancellationToken: cancellationToken);
    }

    public async Task<IReadOnlyList<GameActionLog>> GetRecentActionLogsAsync(int limit = 50, CancellationToken cancellationToken = default)
    {
        var safeLimit = Math.Clamp(limit, 1, 200);
        return await _logs.Find(_ => true)
            .SortByDescending(log => log.CreatedAt)
            .Limit(safeLimit)
            .ToListAsync(cancellationToken);
    }

    public async Task AddResultAsync(GameResult result, CancellationToken cancellationToken = default)
    {
        await _results.InsertOneAsync(result, cancellationToken: cancellationToken);
    }

    public async Task<IReadOnlyList<GameResult>> GetRecentResultsAsync(int limit = 50, CancellationToken cancellationToken = default)
    {
        var safeLimit = Math.Clamp(limit, 1, 200);
        return await _results.Find(_ => true)
            .SortByDescending(result => result.CompletedAt)
            .Limit(safeLimit)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<GameResult>> GetResultsByUserAsync(string userId, int limit = 50, CancellationToken cancellationToken = default)
    {
        var safeLimit = Math.Clamp(limit, 1, 200);
        return await _results.Find(result => result.SubmittedByUserId == userId)
            .SortByDescending(result => result.CompletedAt)
            .Limit(safeLimit)
            .ToListAsync(cancellationToken);
    }

    public async Task<long> CountResultsAsync(CancellationToken cancellationToken = default)
    {
        return await _results.CountDocumentsAsync(_ => true, cancellationToken: cancellationToken);
    }
}
