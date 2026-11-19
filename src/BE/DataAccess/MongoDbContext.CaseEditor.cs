using MongoDB.Driver;
using SirLocked.Api.Models;

namespace SirLocked.Api.DataAccess;

/// <summary>Collections of Case Studio (/admin/editor): the editing state of a case and its saved versions.</summary>
public partial class MongoDbContext
{
    public const string CaseEditorStatesCollectionName = "caseEditorStates";
    public const string CaseEditorRevisionsCollectionName = "caseEditorRevisions";

    public IMongoCollection<CaseEditorState> CaseEditorStates =>
        Database.GetCollection<CaseEditorState>(CaseEditorStatesCollectionName);

    public IMongoCollection<CaseEditorRevision> CaseEditorRevisions =>
        Database.GetCollection<CaseEditorRevision>(CaseEditorRevisionsCollectionName);

    private async Task EnsureCaseEditorIndexesAsync(CancellationToken ct)
    {
        await CaseEditorStates.Indexes.CreateOneAsync(
            new CreateIndexModel<CaseEditorState>(
                Builders<CaseEditorState>.IndexKeys.Ascending(state => state.CaseId),
                new CreateIndexOptions { Unique = true, Name = "ux_caseEditorStates_caseId" }),
            cancellationToken: ct);
        await CaseEditorRevisions.Indexes.CreateOneAsync(
            new CreateIndexModel<CaseEditorRevision>(
                Builders<CaseEditorRevision>.IndexKeys.Ascending(revision => revision.CaseId).Descending(revision => revision.Number),
                new CreateIndexOptions { Unique = true, Name = "ux_caseEditorRevisions_caseId_number" }),
            cancellationToken: ct);
    }
}
