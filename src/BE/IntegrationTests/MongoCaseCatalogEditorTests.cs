using System.Text.Json;
using System.Text.Json.Nodes;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.CaseEditor;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.CaseEditor;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// Case Studio against a real loopback MongoDB: a case the bot imported is opened (its original kept), saved with
/// version checks, restored, played from one scene and published only by the editor's "Duyệt và xuất bản" once it has
/// no error; a published case is read only.
/// </summary>
public sealed partial class MongoCaseCatalogTests
{
    private const string EditorCase = "case-ai-editor-draft-vi";

    [Fact]
    public Task Editor_SavesWithVersions_KeepsServerFields_AndRestores() => WithCatalog(async c =>
    {
        var (editor, audit) = Editor(c);
        var vip = await VipAsync(c, "VIP tác giả");
        var draftId = await ImportedEditorDraftAsync(c, vip, carryDraftId: true);
        var admin = new CurrentUser(NewId(), "Yen", UserRole.Admin);

        var opened = await editor.OpenAsync(admin, EditorCase);
        Assert.True(opened.CanEdit);
        Assert.True(opened.CanPlaytest);
        Assert.Equal(draftId, opened.SourceAiDraftId);
        Assert.Equal(1, opened.Version);
        var original = Assert.Single(opened.Revisions);
        Assert.Equal(CaseEditorRevisionKinds.Original, original.Kind);
        // A V3 bot case without its semantic review: the editor shows the publish gate as an error up front.
        Assert.Contains(opened.Validation.Errors, error => error.Code == "AI_V3_SEMANTIC_REVIEW_REQUIRED");
        Assert.False(opened.Validation.CanPublish);
        // Opening again keeps the one original copy.
        Assert.Single((await editor.OpenAsync(admin, EditorCase)).Revisions);

        // A save that also tries to change what only the server sets.
        var edited = CaseJson(opened.Case, json =>
        {
            json["title"] = "Tên sửa trong editor";
            json["status"] = CaseStatus.Published;
            json["sourceAiDraftId"] = NewId();
            json["truthHash"] = "forged";
        });
        var saved = await editor.SaveAsync(admin, EditorCase, new CaseEditorSaveRequest { BaseVersion = 1, CaseJson = edited });
        Assert.Equal(2, saved.Version);
        Assert.Null(saved.Revision);
        var stored = await c.Db.Cases.Find(x => x.CaseId == EditorCase).FirstAsync();
        Assert.Equal("Tên sửa trong editor", stored.Title);
        Assert.Equal(CaseStatus.Draft, stored.Status);
        Assert.Equal(draftId, stored.SourceAiDraftId);
        Assert.Equal(string.Empty, stored.TruthHash);
        // The cache sees the save at once.
        Assert.Equal("Tên sửa trong editor", (await c.Open.Cases.GetCaseAsync(EditorCase)).Title);

        // A second editor still on version 1 is refused and told who saved.
        var stale = await Assert.ThrowsAsync<ApiException>(() =>
            editor.SaveAsync(admin, EditorCase, new CaseEditorSaveRequest { BaseVersion = 1, CaseJson = edited }));
        Assert.Equal(409, stale.StatusCode);
        Assert.Contains(CaseEditorService.StaleCode, JsonSerializer.Serialize(stale.Errors));

        // "Lưu phiên bản" keeps a numbered copy.
        var checkpoint = await editor.SaveAsync(admin, EditorCase, new CaseEditorSaveRequest
        {
            BaseVersion = 2, CaseJson = CaseJson(opened.Case, json => json["title"] = "Bản có ghi chú"), Checkpoint = true, Note = "đổi tên"
        });
        Assert.Equal(3, checkpoint.Version);
        Assert.Equal(CaseEditorRevisionKinds.Checkpoint, checkpoint.Revision!.Kind);
        Assert.Equal("đổi tên", checkpoint.Revision.Note);
        Assert.Equal("Bản có ghi chú", (await editor.GetRevisionAsync(EditorCase, checkpoint.Revision.Number)).Case.Title);

        // Restoring the original saves the current case first, so the restore can itself be undone.
        var restored = await editor.RestoreAsync(admin, EditorCase, original.Number, new CaseEditorVersionRequest { BaseVersion = 3 });
        Assert.Equal(4, restored.Version);
        Assert.Equal(opened.Case.Title, restored.Case.Title);
        Assert.Equal(opened.Case.Title, (await c.Db.Cases.Find(x => x.CaseId == EditorCase).FirstAsync()).Title);
        var before = restored.Revisions.First(revision => revision.Kind == CaseEditorRevisionKinds.BeforeRestore);
        Assert.Equal("Bản có ghi chú", (await editor.GetRevisionAsync(EditorCase, before.Number)).Case.Title);
        Assert.Contains("case-editor.restore", audit.Actions);
    });

    [Fact]
    public Task Editor_RoomsAndPublishing() => WithCatalog(async c =>
    {
        var (editor, audit) = Editor(c);
        var vip = await VipAsync(c, "VIP tác giả");
        // Linked only through the draft's ImportedCaseId: the V3 publish gates of a bot case do not apply.
        await ImportedEditorDraftAsync(c, vip, carryDraftId: false);
        var admin = new CurrentUser(NewId(), "Yen", UserRole.Admin);
        var opened = await editor.OpenAsync(admin, EditorCase);
        var lastScene = opened.Case.Stages.OrderBy(stage => stage.Order).SelectMany(stage => stage.Scenes).Last();

        // "Chơi thử cảnh này": the draft's playtest room, starting in that scene; pressing it again moves the start.
        var room = await editor.PlaytestAsync(admin, EditorCase, new CaseEditorPlaytestRequest { SceneId = lastScene.SceneId });
        Assert.Equal(lastScene.SceneId, (await c.Db.Rooms.Find(x => x.Id == room.RoomId).FirstAsync()).Playtest!.StartSceneId);
        var again = await editor.PlaytestAsync(admin, EditorCase, new CaseEditorPlaytestRequest());
        Assert.Equal(room.RoomId, again.RoomId);
        Assert.Null((await c.Db.Rooms.Find(x => x.Id == room.RoomId).FirstAsync()).Playtest!.StartSceneId);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() =>
            editor.PlaytestAsync(admin, EditorCase, new CaseEditorPlaytestRequest { SceneId = "scene-khong-co" }))).StatusCode);

        // A playtest room does not stop saving; an ordinary active room does, and the version stays where it was.
        var saved = await editor.SaveAsync(admin, EditorCase, new CaseEditorSaveRequest { BaseVersion = 1, CaseJson = CaseJson(opened.Case, _ => { }) });
        Assert.Equal(2, saved.Version);
        await c.Db.Rooms.InsertOneAsync(new GameRoom
        {
            CaseId = EditorCase, RoomCode = "EDIT01", HostUserId = admin.Id, Status = RoomStatus.InProgress,
            Players = new List<RoomPlayer> { new() { UserId = admin.Id, Username = "Yen" } }
        });
        var busy = await Assert.ThrowsAsync<ApiException>(() =>
            editor.SaveAsync(admin, EditorCase, new CaseEditorSaveRequest { BaseVersion = 2, CaseJson = CaseJson(opened.Case, _ => { }) }));
        Assert.Equal("CASE_IMMUTABLE_WHILE_ACTIVE", Assert.IsType<ApiErrorDetails>(busy.Errors).Code);
        Assert.Equal(2, (await editor.OpenAsync(admin, EditorCase)).Version);
        await c.Db.Rooms.DeleteManyAsync(x => x.RoomCode == "EDIT01");

        // Missing hints block publishing (E3) even though the save went through.
        var noHints = await editor.SaveAsync(admin, EditorCase, new CaseEditorSaveRequest
        {
            BaseVersion = 2, CaseJson = CaseJson(opened.Case, json => json["hints"] = new JsonArray())
        });
        Assert.False(noHints.Validation.CanPublish);
        var refused = await Assert.ThrowsAsync<ApiException>(() =>
            editor.PublishAsync(admin, EditorCase, new CaseEditorVersionRequest { BaseVersion = 3 }));
        Assert.Equal(422, refused.StatusCode);
        Assert.Equal(CaseStatus.Draft, (await c.Db.Cases.Find(x => x.CaseId == EditorCase).FirstAsync()).Status);

        // Publishing what an older editor showed is refused; the latest version with no error is published.
        var fixedHints = await editor.SaveAsync(admin, EditorCase, new CaseEditorSaveRequest { BaseVersion = 3, CaseJson = CaseJson(opened.Case, _ => { }) });
        Assert.True(fixedHints.Validation.CanPublish);
        Assert.Equal(409, (await Assert.ThrowsAsync<ApiException>(() =>
            editor.PublishAsync(admin, EditorCase, new CaseEditorVersionRequest { BaseVersion = 3 }))).StatusCode);
        var published = await editor.PublishAsync(admin, EditorCase, new CaseEditorVersionRequest { BaseVersion = 4, Note = "Yen duyệt" });
        Assert.Equal(CaseStatus.Published, published.Case.Status);
        Assert.Equal(CaseEditorRevisionKinds.Publish, published.Revision.Kind);
        Assert.Contains("case-editor.publish", audit.Actions);

        // A published case is read only in the editor.
        var reopened = await editor.OpenAsync(admin, EditorCase);
        Assert.False(reopened.CanEdit);
        Assert.False(reopened.Validation.CanPublish);
        var readOnly = await Assert.ThrowsAsync<ApiException>(() => editor.SaveAsync(admin, EditorCase,
            new CaseEditorSaveRequest { BaseVersion = reopened.Version, CaseJson = CaseJson(opened.Case, _ => { }) }));
        Assert.Equal(CaseEditorService.ReadOnlyCode, Assert.IsType<ApiErrorDetails>(readOnly.Errors).Code);
    });

    [Fact]
    public Task Editor_AnImportOverTheEditedCaseKeepsTheEditsAsACopy() => WithCatalog(async c =>
    {
        var (editor, _) = Editor(c);
        var vip = await VipAsync(c, "VIP tác giả");
        await ImportedEditorDraftAsync(c, vip, carryDraftId: true);
        var admin = new CurrentUser(NewId(), "Yen", UserRole.Admin);
        var opened = await editor.OpenAsync(admin, EditorCase);
        await editor.SaveAsync(admin, EditorCase, new CaseEditorSaveRequest
        {
            BaseVersion = 1, CaseJson = CaseJson(opened.Case, json => json["title"] = "Yen đã sửa")
        });

        // The bot imports its draft again over the edited case.
        var bot = CaseJson(opened.Case, json => json["title"] = "Bản bot nhập lại");
        await c.Open.Cases.ImportJsonAsync(bot, overwrite: true, preserveServerMetadata: true);

        var after = await editor.OpenAsync(admin, EditorCase);
        Assert.Equal("Bản bot nhập lại", after.Case.Title);
        var kept = after.Revisions.First(revision => revision.Kind == CaseEditorRevisionKinds.BeforeImport);
        Assert.Equal("Yen đã sửa", (await editor.GetRevisionAsync(EditorCase, kept.Number)).Case.Title);
        // An editor still holding version 2 is told to reload instead of saving over the import.
        Assert.Equal(3, after.Version);
        Assert.Equal(409, (await Assert.ThrowsAsync<ApiException>(() => editor.SaveAsync(admin, EditorCase,
            new CaseEditorSaveRequest { BaseVersion = 2, CaseJson = CaseJson(opened.Case, _ => { }) }))).StatusCode);
    });

    private sealed class AuditLog : IAdminAudit
    {
        public List<string> Actions { get; } = new();

        public Task LogAsync(CurrentUser admin, string action, string targetType, string targetId, object? before, object? after,
            string? reason = null, CancellationToken ct = default)
        {
            Actions.Add(action);
            return Task.CompletedTask;
        }

        public Task<AdminAuditPageDto> QueryAsync(AdminAuditQuery query, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private static (CaseEditorService Editor, AuditLog Audit) Editor(Catalog c)
    {
        var audit = new AuditLog();
        return (new CaseEditorService(c.Db, c.Open.Cases, new CaseValidationService(), new CaseTruthService(), c.Open.Rooms, audit), audit);
    }

    private static JsonElement CaseJson(GameCase gameCase, Action<JsonObject> change)
    {
        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var json = JsonNode.Parse(JsonSerializer.Serialize(gameCase, web))!.AsObject();
        change(json);
        using var document = JsonDocument.Parse(json.ToJsonString());
        return document.RootElement.Clone();
    }

    /// <summary>
    /// The tutorial case (complete, with every hint) imported under a new id, with its IMPORTED draft. With
    /// <paramref name="carryDraftId"/> the case names the draft as a bridge import does; without it only the draft points
    /// at the case.
    /// </summary>
    private static async Task<string> ImportedEditorDraftAsync(Catalog c, CurrentUser author, bool carryDraftId)
    {
        var draftId = NewId();
        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var path = Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", TutorialRules.CaseFile);
        var copy = JsonNode.Parse(await File.ReadAllTextAsync(path))!.AsObject();
        copy["id"] = string.Empty;
        copy["caseId"] = EditorCase;
        copy["title"] = "Bản nháp AI cho editor";
        copy["sourceAiDraftId"] = carryDraftId ? draftId : string.Empty;
        using var json = JsonDocument.Parse(copy.ToJsonString());
        var imported = await c.Open.Cases.ImportJsonAsync(json.RootElement, overwrite: false, preserveServerMetadata: true);
        Assert.Equal(CaseStatus.Draft, imported.Status);
        await c.Db.AiCaseDrafts.InsertOneAsync(new AiCaseDraft
        {
            Id = draftId, Status = AiDraftStatus.Imported, ImportedCaseId = EditorCase, CaseId = EditorCase, CaseTitle = imported.Title,
            CreatedByUserId = author.Id, CreatedByRole = author.Role, VisualPipeline = AiVisualPipelines.PixelV1,
            OrderStatus = AiOrderStatuses.Submitted
        });
        return draftId;
    }
}
