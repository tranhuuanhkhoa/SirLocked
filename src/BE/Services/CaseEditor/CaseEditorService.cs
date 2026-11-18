using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.CaseEditor;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Services.CaseEditor;

/// <summary>
/// Case Studio (/admin/editor): edits an unpublished case in place. Every save is validated (errors are shown, never
/// blocking a save), numbered copies can be restored, and only a case with no error can be published — by an admin,
/// from the editor, after looking at it. A published case is read only here: unpublish it first.
/// </summary>
public sealed class CaseEditorService
{
    /// <summary>Saved copies kept per case besides the original one; older ones are dropped.</summary>
    public const int MaxRevisions = 50;
    public const string StaleCode = "CASE_EDITOR_STALE";
    public const string ReadOnlyCode = "CASE_EDITOR_READ_ONLY";

    private readonly MongoDbContext _db;
    private readonly CaseService _cases;
    private readonly ICaseValidationService _validator;
    private readonly ICaseTruthService _truth;
    private readonly IProjectionGraphValidator? _projectionGraph;
    private readonly IRoomService _rooms;
    private readonly IAdminAudit _audit;

    public CaseEditorService(
        MongoDbContext db,
        CaseService cases,
        ICaseValidationService validator,
        ICaseTruthService truth,
        IRoomService rooms,
        IAdminAudit audit,
        IProjectionGraphValidator? projectionGraph = null)
    {
        _db = db;
        _cases = cases;
        _validator = validator;
        _truth = truth;
        _rooms = rooms;
        _audit = audit;
        _projectionGraph = projectionGraph;
    }

    public async Task<CaseEditorResponse> OpenAsync(CurrentUser user, string caseId)
    {
        var gameCase = await RequireCaseAsync(caseId);
        var state = await EnsureStateAsync(gameCase, user);
        var draft = await FindDraftAsync(gameCase);
        return await BuildResponseAsync(gameCase, state, draft);
    }

    /// <summary>
    /// Autosave and "Lưu phiên bản". The editor sends the whole case; fields the server owns (status, AI gates, truth
    /// hashes, presentation) are taken from the stored case, whatever the editor sent.
    /// </summary>
    public async Task<CaseEditorSaveResponse> SaveAsync(CurrentUser user, string caseId, CaseEditorSaveRequest request)
    {
        var existing = await RequireEditableAsync(caseId);
        if (request.CaseJson.ValueKind != System.Text.Json.JsonValueKind.Object)
            throw ApiException.BadRequest("caseJson must be the whole case object.");
        var edited = _cases.ParseCase(request.CaseJson);
        if (!string.Equals(edited.CaseId, existing.CaseId, StringComparison.Ordinal))
            throw ApiException.BadRequest("caseId cannot be changed in the editor.");
        PrepareForSave(existing, edited);

        await EnsureStateAsync(existing, user);
        var version = await ClaimVersionAsync(caseId, request.BaseVersion, user);
        try
        {
            await _cases.ReplaceDraftAsync(edited);
        }
        catch
        {
            await ReleaseVersionAsync(caseId, version);
            throw;
        }

        var draft = await FindDraftAsync(edited);
        var validation = Validate(edited, draft);
        CaseEditorRevision? revision = null;
        if (request.Checkpoint)
            revision = await AddRevisionAsync(edited, version, CaseEditorRevisionKinds.Checkpoint, request.Note, validation, user);
        return new CaseEditorSaveResponse
        {
            Version = version,
            UpdatedAt = edited.UpdatedAt,
            Validation = validation,
            Revision = revision is null ? null : CaseEditorRevisionSummary.From(revision),
            Revisions = await ListRevisionsAsync(caseId)
        };
    }

    public async Task<List<CaseEditorRevisionSummary>> ListRevisionsAsync(string caseId) =>
        (await _db.CaseEditorRevisions.Find(revision => revision.CaseId == caseId)
            .SortByDescending(revision => revision.Number)
            .Project(revision => new CaseEditorRevision
            {
                Number = revision.Number, Kind = revision.Kind, Note = revision.Note, Title = revision.Title,
                EditorVersion = revision.EditorVersion, ErrorCount = revision.ErrorCount, WarningCount = revision.WarningCount,
                CreatedAt = revision.CreatedAt, CreatedByName = revision.CreatedByName
            })
            .Limit(MaxRevisions + 1)
            .ToListAsync())
        .Select(CaseEditorRevisionSummary.From)
        .ToList();

    public async Task<CaseEditorRevisionResponse> GetRevisionAsync(string caseId, int number)
    {
        var revision = await RequireRevisionAsync(caseId, number);
        return new CaseEditorRevisionResponse
        {
            Revision = CaseEditorRevisionSummary.From(revision),
            Case = _cases.ParseCase(revision.CaseJson)
        };
    }

    /// <summary>Puts a saved copy back. The case as it was just before is saved first, so a restore can be undone.</summary>
    public async Task<CaseEditorResponse> RestoreAsync(CurrentUser user, string caseId, int number, CaseEditorVersionRequest request)
    {
        var existing = await RequireEditableAsync(caseId);
        var revision = await RequireRevisionAsync(caseId, number);
        var restored = _cases.ParseCase(revision.CaseJson);
        if (!string.Equals(restored.CaseId, existing.CaseId, StringComparison.Ordinal))
            throw ApiException.Conflict("This saved copy belongs to another case.", "CASE_EDITOR_REVISION_MISMATCH", "caseEditor.revisionMismatch");
        PrepareForSave(existing, restored);

        await EnsureStateAsync(existing, user);
        var draft = await FindDraftAsync(existing);
        var version = await ClaimVersionAsync(caseId, request.BaseVersion, user);
        try
        {
            await AddRevisionAsync(existing, version - 1, CaseEditorRevisionKinds.BeforeRestore,
                $"Trước khi khôi phục bản #{number}", Validate(existing, draft), user);
            await _cases.ReplaceDraftAsync(restored);
        }
        catch
        {
            await ReleaseVersionAsync(caseId, version);
            throw;
        }
        await _audit.LogAsync(user, "case-editor.restore", "cases", caseId,
            new { existing.Title, existing.UpdatedAt }, new { restoredFrom = number, restored.Title }, request.Note);
        var state = await _db.CaseEditorStates.Find(entry => entry.CaseId == caseId).FirstAsync();
        return await BuildResponseAsync(restored, state, draft);
    }

    /// <summary>
    /// The owner's "Duyệt và xuất bản". Refused unless the editor shows the latest version and the case has no error
    /// (hints included, E3); then the usual publish gates of <see cref="CaseService.PublishAsync"/> still apply.
    /// </summary>
    public async Task<CaseEditorPublishResponse> PublishAsync(CurrentUser user, string caseId, CaseEditorVersionRequest request)
    {
        var existing = await RequireEditableAsync(caseId);
        var state = await EnsureStateAsync(existing, user);
        if (state.Version != request.BaseVersion) throw Stale(state);
        var draft = await FindDraftAsync(existing);
        var validation = Validate(existing, draft);
        if (!validation.CanPublish)
            throw ApiException.Unprocessable("Vụ còn lỗi nên chưa xuất bản được.", validation.Errors);

        // The version is taken first: a save from another editor between the check and the publish is refused, so what
        // gets published is exactly what this editor showed.
        var version = await ClaimVersionAsync(caseId, request.BaseVersion, user);
        CaseSummaryResponse summary;
        try
        {
            summary = await _cases.PublishAsync(caseId);
        }
        catch
        {
            await ReleaseVersionAsync(caseId, version);
            throw;
        }
        var revision = await AddRevisionAsync(existing, version, CaseEditorRevisionKinds.Publish, request.Note, validation, user);
        await _audit.LogAsync(user, "case-editor.publish", "cases", caseId,
            new { Status = CaseStatus.Draft, existing.SourceAiDraftId },
            new { summary.Status, revision = revision.Number }, request.Note);
        return new CaseEditorPublishResponse { Case = summary, Version = version, Revision = CaseEditorRevisionSummary.From(revision) };
    }

    /// <summary>A4 "Chơi thử cảnh này": the playtest room of the AI draft the case came from, starting in that scene.</summary>
    public async Task<RoomResponse> PlaytestAsync(CurrentUser user, string caseId, CaseEditorPlaytestRequest request)
    {
        var gameCase = await RequireCaseAsync(caseId);
        if (TutorialRules.IsTutorialCase(caseId))
            throw ApiException.Conflict("Màn tân thủ chơi thử bằng nút Màn tân thủ.", "CASE_EDITOR_NO_PLAYTEST", "caseEditor.noPlaytest");
        var draft = await FindDraftAsync(gameCase);
        if (draft is null || !string.Equals(draft.ImportedCaseId, caseId, StringComparison.Ordinal))
            throw ApiException.Conflict(
                "Vụ này không đến từ bản nháp AI nên chưa có phòng chơi thử. Dùng Chơi thử ở /admin/ai cho vụ do bot làm.",
                "CASE_EDITOR_NO_PLAYTEST", "caseEditor.noPlaytest");
        return await _rooms.CreatePlaytestAsync(user, draft.Id, request.SceneId);
    }

    /// <summary>
    /// Validation the editor shows after every save: the publish validator, the hint rule as errors (E3), the pixel
    /// layout rules (errors for a bot case, warnings for a hand-made one) and, for a bot case, its truth gates.
    /// </summary>
    public CaseEditorValidation Validate(GameCase gameCase, AiCaseDraft? draft)
    {
        var result = _validator.Validate(gameCase);
        result.RequireHints();
        if (CaseCatalogRules.IsPixel(gameCase))
        {
            var layout = new CaseValidationResult();
            PixelDraftRules.ValidateLayout(gameCase, layout);
            if (draft is not null) result.Errors.AddRange(layout.Errors);
            else result.Warnings.AddRange(layout.Errors);
            result.Warnings.AddRange(layout.Warnings);
        }
        // The gates CaseService.PublishAsync applies to a bot case, shown here so the editor never offers a publish that
        // the server then refuses.
        var aiSourced = !string.IsNullOrWhiteSpace(gameCase.SourceAiDraftId);
        if (gameCase.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation && aiSourced)
        {
            result.Errors.AddRange(AiV3GenerationProfile.Validate(gameCase).Errors);
            if (gameCase.GenerationMode != CaseGenerationModes.CameraEmbedded
                || gameCase.AiSemanticReviewStatus != AiV3SemanticReviewStatuses.Passed)
                result.Add("AI_V3_SEMANTIC_REVIEW_REQUIRED", "aiSemanticReviewStatus",
                    "Vụ V3 của bot phải là CAMERA_EMBEDDED và đã qua duyệt ngữ nghĩa (AiSemanticReviewStatus PASSED) mới xuất bản được.");
        }
        if (gameCase.LogicContractVersion >= CaseLogicContractVersions.CausalFiveClaim && aiSourced
            && (gameCase.TruthSchemaVersion is not (CaseTruthSchemaVersions.V1 or CaseTruthSchemaVersions.V2)
                || string.IsNullOrWhiteSpace(gameCase.TruthHash)
                || gameCase.LogicVerificationStatus != CaseLogicVerificationStatuses.CausalVerified))
            result.Add("AI_CASE_TRUTH_REQUIRED", "truthHash",
                "Vụ của bot chưa qua cổng sự thật (truth gate) nên chưa xuất bản được.");
        if (draft?.CaseTruth is not null)
        {
            result.Errors.AddRange(_truth.ValidateProjection(draft.CaseTruth, gameCase).Errors);
            if (draft.ProjectionPlan is not null && _projectionGraph is not null)
                result.Errors.AddRange(_projectionGraph.Validate(draft.CaseTruth, draft.ProjectionPlan, gameCase).Errors);
        }
        result.Deduplicate();
        if (TutorialRules.IsTutorialCase(gameCase.CaseId))
            result.AddWarning("TUTORIAL_READ_ONLY", "caseId",
                "Màn tân thủ được nạp lại từ file JSON mỗi lần server khởi động: xem được ở đây, sửa trong repo.");
        return new CaseEditorValidation
        {
            CanPublish = result.IsValid && IsEditable(gameCase),
            Errors = result.Errors,
            Warnings = result.Warnings
        };
    }

    /// <summary>
    /// Takes the fields only the server sets from the stored case and brings derived data in line: the percent hotspots
    /// follow the runtime boxes, interactive puzzles keep their answers. Pictures must stay on the site or on HTTPS.
    /// </summary>
    public static void PrepareForSave(GameCase stored, GameCase edited)
    {
        edited.Id = stored.Id;
        edited.CaseId = stored.CaseId;
        edited.Status = stored.Status;
        edited.MechanicsVersion = stored.MechanicsVersion;
        edited.GenerationMode = stored.GenerationMode;
        edited.GenerationPreset = stored.GenerationPreset;
        edited.ShortDemoProfileVersion = stored.ShortDemoProfileVersion;
        edited.SourceAiDraftId = stored.SourceAiDraftId;
        edited.AuthorUserId = stored.AuthorUserId;
        edited.LogicContractVersion = stored.LogicContractVersion;
        edited.LogicVerificationStatus = stored.LogicVerificationStatus;
        edited.TruthSchemaVersion = stored.TruthSchemaVersion;
        edited.TruthHash = stored.TruthHash;
        edited.BlindReviewStatus = stored.BlindReviewStatus;
        edited.ProjectionSchemaVersion = stored.ProjectionSchemaVersion;
        edited.ProjectionPlanHash = stored.ProjectionPlanHash;
        edited.ProjectionCompilerVersion = stored.ProjectionCompilerVersion;
        edited.ProjectionBuildMode = stored.ProjectionBuildMode;
        edited.AiSemanticReviewStatus = stored.AiSemanticReviewStatus;
        edited.RuleSet = stored.RuleSet;
        edited.Presentation = stored.Presentation;
        edited.CreatedAt = stored.CreatedAt;

        var badUrls = UnsafeUrls(edited).ToList();
        if (badUrls.Count > 0)
            throw ApiException.Unprocessable("Ảnh phải là /assets/... hoặc https://...",
                badUrls.Select(path => new CaseValidationError
                {
                    Code = "CASE_EDITOR_URL", Path = path, Message = "Ảnh phải là /assets/... hoặc https://..."
                }).ToList());

        foreach (var scene in PixelCasePipeline.OrderedScenes(edited)) PixelCasePipeline.SyncSceneHotspots(scene);
        PuzzleKinds.PuzzleKindRegistry.FillMissing(edited);
    }

    /// <summary>Picture URLs the editor may set: empty, a site asset (/assets/...) or HTTPS. Returns the paths of the others.</summary>
    public static IEnumerable<string> UnsafeUrls(GameCase gameCase)
    {
        static bool Safe(string? url) =>
            string.IsNullOrEmpty(url)
            || (url.StartsWith("/assets/", StringComparison.Ordinal) && !url.Contains("..", StringComparison.Ordinal))
            || (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps);

        for (var index = 0; index < gameCase.Characters.Count; index++)
        {
            var character = gameCase.Characters[index];
            if (!Safe(character.ImageUrl)) yield return $"characters[{index}].imageUrl";
            if (!Safe(character.Presentation?.SpriteSheet?.Url)) yield return $"characters[{index}].presentation.spriteSheet.url";
        }
        for (var index = 0; index < gameCase.Items.Count; index++)
            if (!Safe(gameCase.Items[index].ImageUrl)) yield return $"items[{index}].imageUrl";
        foreach (var scene in PixelCasePipeline.OrderedScenes(gameCase))
            if (!Safe(scene.BackgroundUrl)) yield return $"scene:{scene.SceneId}.backgroundUrl";
    }

    /// <summary>
    /// Numbers of the saved copies to drop: all but the newest <see cref="MaxRevisions"/>. The original import is kept
    /// forever, so the bot's version can always be compared with.
    /// </summary>
    public static IReadOnlyList<int> RevisionsToPrune(IEnumerable<(int Number, string Kind)> revisions) =>
        revisions.Where(revision => revision.Kind != CaseEditorRevisionKinds.Original)
            .OrderByDescending(revision => revision.Number)
            .Skip(MaxRevisions)
            .Select(revision => revision.Number)
            .ToList();

    public static bool IsEditable(GameCase gameCase) =>
        string.Equals(gameCase.Status, CaseStatus.Draft, StringComparison.OrdinalIgnoreCase)
        && !TutorialRules.IsTutorialCase(gameCase.CaseId);

    private async Task<CaseEditorResponse> BuildResponseAsync(GameCase gameCase, CaseEditorState state, AiCaseDraft? draft) => new()
    {
        CaseId = gameCase.CaseId,
        Title = gameCase.Title,
        Status = gameCase.Status,
        CanEdit = IsEditable(gameCase),
        SourceAiDraftId = draft?.Id ?? gameCase.SourceAiDraftId,
        World = draft?.Order?.World ?? string.Empty,
        CanPlaytest = draft is not null && string.Equals(draft.ImportedCaseId, gameCase.CaseId, StringComparison.Ordinal)
                      && draft.Status != AiDraftStatus.Cancelled,
        Version = state.Version,
        UpdatedAt = state.UpdatedAt,
        UpdatedByName = state.UpdatedByName,
        Case = gameCase,
        Validation = Validate(gameCase, draft),
        Revisions = await ListRevisionsAsync(gameCase.CaseId)
    };

    private async Task<GameCase> RequireCaseAsync(string caseId)
    {
        if (string.IsNullOrWhiteSpace(caseId)) throw ApiException.NotFound("Case not found.");
        return await _cases.FindCaseAsync(caseId) ?? throw ApiException.NotFound("Case not found.");
    }

    private async Task<GameCase> RequireEditableAsync(string caseId)
    {
        var gameCase = await RequireCaseAsync(caseId);
        if (TutorialRules.IsTutorialCase(caseId))
            throw ApiException.Conflict("Màn tân thủ được nạp lại từ file mỗi lần server khởi động; sửa file JSON trong repo.",
                ReadOnlyCode, "caseEditor.readOnly");
        if (!string.Equals(gameCase.Status, CaseStatus.Draft, StringComparison.OrdinalIgnoreCase))
            throw ApiException.Conflict("Vụ đã xuất bản: gỡ xuất bản trước khi sửa.", ReadOnlyCode, "caseEditor.readOnly");
        return gameCase;
    }

    private async Task<CaseEditorRevision> RequireRevisionAsync(string caseId, int number) =>
        await _db.CaseEditorRevisions.Find(revision => revision.CaseId == caseId && revision.Number == number).FirstOrDefaultAsync()
        ?? throw ApiException.NotFound($"Saved copy #{number} not found.");

    /// <summary>The AI draft a case came from: by the id the case carries, else the draft that imported it.</summary>
    private async Task<AiCaseDraft?> FindDraftAsync(GameCase gameCase)
    {
        if (MongoDB.Bson.ObjectId.TryParse(gameCase.SourceAiDraftId, out _))
        {
            var byId = await _db.AiCaseDrafts.Find(draft => draft.Id == gameCase.SourceAiDraftId).FirstOrDefaultAsync();
            if (byId is not null) return byId;
        }
        return await _db.AiCaseDrafts.Find(draft => draft.ImportedCaseId == gameCase.CaseId)
            .SortByDescending(draft => draft.UpdatedAt)
            .FirstOrDefaultAsync();
    }

    /// <summary>The editing state of a case; the first open also keeps the case as it came in (the ORIGINAL copy).</summary>
    private async Task<CaseEditorState> EnsureStateAsync(GameCase gameCase, CurrentUser user)
    {
        var state = await _db.CaseEditorStates.Find(entry => entry.CaseId == gameCase.CaseId).FirstOrDefaultAsync();
        if (state is not null) return state;
        state = new CaseEditorState
        {
            CaseId = gameCase.CaseId,
            Version = 1,
            NextRevision = 1,
            UpdatedAt = DateTime.UtcNow,
            UpdatedByUserId = user.Id,
            UpdatedByName = user.FullName
        };
        try
        {
            await _db.CaseEditorStates.InsertOneAsync(state);
        }
        catch (MongoWriteException exception) when (exception.WriteError.Category == ServerErrorCategory.DuplicateKey)
        {
            // Two editors opened the case at the same moment: the other one created the state and the original copy.
            return await _db.CaseEditorStates.Find(entry => entry.CaseId == gameCase.CaseId).FirstAsync();
        }
        var draft = await FindDraftAsync(gameCase);
        await AddRevisionAsync(gameCase, state.Version, CaseEditorRevisionKinds.Original,
            draft is null ? "Bản khi mở editor lần đầu" : "Bản bot nhập vào", Validate(gameCase, draft), user);
        return await _db.CaseEditorStates.Find(entry => entry.CaseId == gameCase.CaseId).FirstAsync();
    }

    /// <summary>Takes the next version if the editor still holds <paramref name="baseVersion"/>; 409 otherwise.</summary>
    private async Task<int> ClaimVersionAsync(string caseId, int baseVersion, CurrentUser user)
    {
        var updated = await _db.CaseEditorStates.FindOneAndUpdateAsync(
            Builders<CaseEditorState>.Filter.Where(entry => entry.CaseId == caseId && entry.Version == baseVersion),
            Builders<CaseEditorState>.Update
                .Inc(entry => entry.Version, 1)
                .Set(entry => entry.UpdatedAt, DateTime.UtcNow)
                .Set(entry => entry.UpdatedByUserId, user.Id)
                .Set(entry => entry.UpdatedByName, user.FullName),
            new FindOneAndUpdateOptions<CaseEditorState> { ReturnDocument = ReturnDocument.After });
        if (updated is not null) return updated.Version;
        var current = await _db.CaseEditorStates.Find(entry => entry.CaseId == caseId).FirstOrDefaultAsync();
        throw Stale(current);
    }

    /// <summary>Gives a claimed version back when the save behind it failed, so the editor's version stays current.</summary>
    private Task ReleaseVersionAsync(string caseId, int version) =>
        _db.CaseEditorStates.UpdateOneAsync(
            entry => entry.CaseId == caseId && entry.Version == version,
            Builders<CaseEditorState>.Update.Inc(entry => entry.Version, -1));

    private static ApiException Stale(CaseEditorState? current) => new(409,
        $"Vụ vừa được lưu ở nơi khác{(current is null ? string.Empty : $" bởi {current.UpdatedByName}")}. Tải lại để thấy bản mới.",
        new
        {
            code = StaleCode,
            messageKey = "caseEditor.stale",
            currentVersion = current?.Version ?? 0,
            updatedByName = current?.UpdatedByName ?? string.Empty,
            updatedAt = current?.UpdatedAt
        });

    private async Task<CaseEditorRevision> AddRevisionAsync(GameCase gameCase, int editorVersion, string kind, string? note,
        CaseEditorValidation validation, CurrentUser user)
    {
        var state = await _db.CaseEditorStates.FindOneAndUpdateAsync(
            Builders<CaseEditorState>.Filter.Where(entry => entry.CaseId == gameCase.CaseId),
            Builders<CaseEditorState>.Update.Inc(entry => entry.NextRevision, 1),
            new FindOneAndUpdateOptions<CaseEditorState> { ReturnDocument = ReturnDocument.Before });
        var revision = new CaseEditorRevision
        {
            CaseId = gameCase.CaseId,
            Number = state?.NextRevision ?? 1,
            Kind = kind,
            Note = (note ?? string.Empty).Trim() is { Length: > 200 } longNote ? longNote[..200] : (note ?? string.Empty).Trim(),
            Title = gameCase.Title,
            EditorVersion = editorVersion,
            ErrorCount = validation.Errors.Count,
            WarningCount = validation.Warnings.Count,
            CreatedAt = DateTime.UtcNow,
            CreatedByUserId = user.Id,
            CreatedByName = user.FullName,
            CaseJson = CaseService.SerializeCase(gameCase)
        };
        await _db.CaseEditorRevisions.InsertOneAsync(revision);

        var all = await _db.CaseEditorRevisions.Find(entry => entry.CaseId == gameCase.CaseId)
            .Project(entry => new CaseEditorRevision { Number = entry.Number, Kind = entry.Kind })
            .ToListAsync();
        var prune = RevisionsToPrune(all.Select(entry => (entry.Number, entry.Kind)));
        if (prune.Count > 0)
            await _db.CaseEditorRevisions.DeleteManyAsync(entry => entry.CaseId == gameCase.CaseId && prune.Contains(entry.Number));
        return revision;
    }
}
