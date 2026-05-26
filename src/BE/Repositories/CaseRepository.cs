using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.API.Configurations;
using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public sealed class CaseRepository : ICaseRepository
{
    private readonly IMongoCollection<GameCase> _cases;

    public CaseRepository(IMongoClient mongoClient, IOptions<MongoDbSettings> settings)
    {
        var database = mongoClient.GetDatabase(settings.Value.DatabaseName);
        _cases = database.GetCollection<GameCase>(settings.Value.CasesCollectionName);
    }

    public async Task<IReadOnlyList<GameCase>> GetPublishedAsync(CancellationToken cancellationToken = default)
    {
        return await _cases.Find(gameCase => gameCase.Status == "PUBLISHED").ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<GameCase>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        return await _cases.Find(_ => true).SortByDescending(gameCase => gameCase.CreatedAt).ToListAsync(cancellationToken);
    }

    public async Task<GameCase?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        return await _cases.Find(gameCase => gameCase.Id == id || gameCase.CaseId == id).FirstOrDefaultAsync(cancellationToken);
    }

    public async Task CreateAsync(GameCase gameCase, CancellationToken cancellationToken = default)
    {
        await _cases.InsertOneAsync(gameCase, cancellationToken: cancellationToken);
    }

    public async Task UpdateAsync(GameCase gameCase, CancellationToken cancellationToken = default)
    {
        gameCase.UpdatedAt = DateTime.UtcNow;
        await _cases.ReplaceOneAsync(existing => existing.Id == gameCase.Id, gameCase, cancellationToken: cancellationToken);
    }
}
