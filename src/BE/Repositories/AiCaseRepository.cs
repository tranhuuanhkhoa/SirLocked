using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.API.Configurations;
using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public sealed class AiCaseRepository : IAiCaseRepository
{
    private readonly IMongoCollection<AiCaseDraft> _drafts;

    public AiCaseRepository(IMongoClient mongoClient, IOptions<MongoDbSettings> settings)
    {
        var database = mongoClient.GetDatabase(settings.Value.DatabaseName);
        _drafts = database.GetCollection<AiCaseDraft>(settings.Value.AiCaseDraftsCollectionName);
    }

    public async Task CreateDraftAsync(AiCaseDraft draft, CancellationToken cancellationToken = default)
    {
        await _drafts.InsertOneAsync(draft, cancellationToken: cancellationToken);
    }

    public async Task<AiCaseDraft?> GetDraftAsync(string draftId, CancellationToken cancellationToken = default)
    {
        return await _drafts.Find(draft => draft.Id == draftId).FirstOrDefaultAsync(cancellationToken);
    }
}
