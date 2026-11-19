using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Cutscene;

public interface ICutsceneStore
{
    Task<List<CaseCutscene>> ListAsync(string caseId, string trigger, CancellationToken ct = default);
    Task<CaseCutscene?> GetAsync(string id, CancellationToken ct = default);
    /// <summary>Throws a 409 ApiException when the id already exists (two instances racing to the same version).</summary>
    Task InsertAsync(CaseCutscene cutscene, CancellationToken ct = default);
    Task ReplaceAsync(CaseCutscene cutscene, CancellationToken ct = default);
}

public sealed class MongoCutsceneStore(MongoDbContext db) : ICutsceneStore
{
    public Task<List<CaseCutscene>> ListAsync(string caseId, string trigger, CancellationToken ct = default) =>
        db.CaseCutscenes.Find(c => c.CaseId == caseId && c.Trigger == trigger).SortByDescending(c => c.Version).ToListAsync(ct);

    public async Task<CaseCutscene?> GetAsync(string id, CancellationToken ct = default) =>
        await db.CaseCutscenes.Find(c => c.Id == id).FirstOrDefaultAsync(ct);

    public async Task InsertAsync(CaseCutscene cutscene, CancellationToken ct = default)
    {
        try { await db.CaseCutscenes.InsertOneAsync(cutscene, cancellationToken: ct); }
        catch (MongoWriteException error) when (error.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            throw ApiException.Conflict("This cutscene version already exists. Reload and try again.");
        }
    }

    public Task ReplaceAsync(CaseCutscene cutscene, CancellationToken ct = default) =>
        db.CaseCutscenes.ReplaceOneAsync(c => c.Id == cutscene.Id, cutscene, cancellationToken: ct);
}
