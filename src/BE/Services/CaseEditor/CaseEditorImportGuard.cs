using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.CaseEditor;

/// <summary>
/// An import that overwrites a case (the bot importing its draft again, or /admin/import with overwrite) must not
/// silently drop what the owner changed in Case Studio. When the case has been opened in the editor, the stored case
/// is kept as a BEFORE_IMPORT copy first, and the editor version moves on so an editor still open is told to reload
/// instead of saving over the import.
/// </summary>
public static class CaseEditorImportGuard
{
    public static async Task KeepEditedCopyAsync(MongoDbContext db, GameCase existing)
    {
        var state = await db.CaseEditorStates.FindOneAndUpdateAsync(
            Builders<CaseEditorState>.Filter.Where(entry => entry.CaseId == existing.CaseId),
            Builders<CaseEditorState>.Update
                .Inc(entry => entry.Version, 1)
                .Inc(entry => entry.NextRevision, 1)
                .Set(entry => entry.UpdatedAt, DateTime.UtcNow)
                .Set(entry => entry.UpdatedByUserId, string.Empty)
                .Set(entry => entry.UpdatedByName, "nhập lại vụ"),
            new FindOneAndUpdateOptions<CaseEditorState> { ReturnDocument = ReturnDocument.Before });
        if (state is null) return;
        await db.CaseEditorRevisions.InsertOneAsync(new CaseEditorRevision
        {
            CaseId = existing.CaseId,
            Number = state.NextRevision,
            Kind = CaseEditorRevisionKinds.BeforeImport,
            Note = "Bản trong editor ngay trước khi vụ được nhập lại",
            Title = existing.Title,
            EditorVersion = state.Version,
            CreatedAt = DateTime.UtcNow,
            CreatedByName = "Hệ thống",
            CaseJson = CaseService.SerializeCase(existing)
        });
    }
}
