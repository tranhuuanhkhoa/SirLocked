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

    public async Task AddResultAsync(GameResult result, CancellationToken cancellationToken = default)
    {
        await _results.InsertOneAsync(result, cancellationToken: cancellationToken);
    }
}
