using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Cutscene;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Bridge;

public static class BridgeGates
{
    public const string Story = "STORY";
    public const string Truth = "TRUTH";
    public const string Logic = "LOGIC";
    public const string Layout = "LAYOUT";
}

/// <summary>Everything the Claude bot does through <c>/api/bridge</c>. Never publishes a case.</summary>
public sealed class AiBridgeService(
    MongoDbContext db,
    AiBridgeRequestStore store,
    IAiDraftWorkflowCoordinator workflow,
    IAiCaseService cases,
    ICaseService caseService,
    CutsceneService cutscenes,
    IBridgeAssetStorage assetStorage,
    IOptions<BridgeSettings> bridge,
    IOptions<AiGenerationSettings> generation,
    IHostEnvironment environment,
    ILogger<AiBridgeService> logger)
{
    /// <summary>The identity the bridge uses for the few admin operations it may run (gates in fast mode, import).</summary>
    public static readonly CurrentUser BridgeUser = new("claude-bridge", "Claude bridge", UserRole.Admin);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const int MaxReportLength = 200_000;

    // ---------------------------------------------------------------- requests

    public async Task<List<object>> ListRequestsAsync(string? status, int limit, CancellationToken ct)
    {
        var requests = await store.ListAsync(string.IsNullOrWhiteSpace(status) ? AiBridgeStatuses.Pending : status, limit, ct);
        var draftIds = requests.Where(item => item.OwnerType == AiBridgeOwnerTypes.CaseDraft).Select(item => item.OwnerId).Distinct().ToList();
        var drafts = draftIds.Count == 0
            ? new Dictionary<string, AiCaseDraft>()
            : (await db.AiCaseDrafts.Find(Builders<AiCaseDraft>.Filter.In(item => item.Id, draftIds)).ToListAsync(ct))
                .ToDictionary(item => item.Id, StringComparer.Ordinal);
        var result = new List<object>();
        foreach (var request in requests)
        {
            AiCaseDraft? draft = null;
            if (request.OwnerType == AiBridgeOwnerTypes.CaseDraft)
            {
                // Only approved orders are visible: a VIP order never reaches the bot before an admin approves it.
                if (!drafts.TryGetValue(request.OwnerId, out draft) || !IsApprovedOrder(draft)) continue;
            }
            result.Add(new
            {
                requestId = request.Id,
                request.Kind,
                request.OwnerType,
                draftId = request.OwnerType == AiBridgeOwnerTypes.CaseDraft ? request.OwnerId : null,
                caseId = request.OwnerType == AiBridgeOwnerTypes.Cutscene ? request.OwnerId : draft?.CaseId,
                request.Step,
                request.Status,
                request.AttemptNumber,
                preset = draft?.Settings.GenerationPreset,
                language = draft?.Settings.Language,
                world = draft?.Order?.World,
                reviewMode = draft?.Order?.ReviewMode,
                orderedByRole = draft?.CreatedByRole,
                orderedByUserId = draft?.CreatedByUserId,
                promptBytes = System.Text.Encoding.UTF8.GetByteCount(request.Prompt),
                schemaBytes = System.Text.Encoding.UTF8.GetByteCount(request.SchemaJson),
                request.AssetPhase,
                request.AssetSlotIds,
                request.CreatedAt,
                request.LeaseExpiresAt,
                request.Errors
            });
        }
        return result;
    }

    public async Task<object> TakeAsync(string requestId, CancellationToken ct)
    {
        var current = await store.GetAsync(requestId, ct) ?? throw ApiException.NotFound("Bridge request not found.");
        var draft = await RequireApprovedOwnerAsync(current, ct);
        var taken = await store.TakeAsync(requestId, bridge.Value.LeaseHours, ct);
        if (taken is null)
        {
            var latest = await store.GetAsync(requestId, ct) ?? current;
            throw ApiException.Conflict(
                latest.Status == AiBridgeStatuses.Taken
                    ? $"This request is taken until {latest.LeaseExpiresAt:O}. Release it first or wait for the lease to expire."
                    : $"This request is {latest.Status} and cannot be taken.",
                "BRIDGE_REQUEST_NOT_TAKEABLE", "ai.bridge.notTakeable");
        }
        if (draft is not null) await workflow.SyncOrderStatusAsync(draft.Id, ct);
        JsonNode? schema = null;
        if (!string.IsNullOrWhiteSpace(taken.SchemaJson))
        {
            try { schema = JsonNode.Parse(taken.SchemaJson); }
            catch (JsonException) { schema = null; }
        }
        return new
        {
            requestId = taken.Id,
            taken.Kind,
            taken.OwnerType,
            draftId = taken.OwnerType == AiBridgeOwnerTypes.CaseDraft ? taken.OwnerId : null,
            caseId = taken.OwnerType == AiBridgeOwnerTypes.Cutscene ? taken.OwnerId : draft?.CaseId,
            taken.Step,
            taken.SchemaVersion,
            taken.AttemptNumber,
            taken.Instructions,
            taken.Prompt,
            schema,
            lengthHintTokens = taken.MaxOutputTokens,
            taken.AssetPhase,
            taken.AssetSlotIds,
            taken.AssetRegenerateSlotIds,
            taken.LeaseExpiresAt,
            previousErrors = taken.Errors,
            order = draft is null ? null : OrderSummary(draft),
            // Development/Testing smoke runs only; Production never stores or returns it.
            devMockResponse = bridge.Value.ExposeMockResponses && !environment.IsProduction() ? taken.MockResponseJson : null
        };
    }

    public async Task<object> ReleaseAsync(string requestId, CancellationToken ct)
    {
        var released = await store.ReleaseAsync(requestId, ct)
            ?? throw ApiException.Conflict("Only a taken request can be released.", "BRIDGE_REQUEST_NOT_TAKEN", "ai.bridge.notTaken");
        if (released.OwnerType == AiBridgeOwnerTypes.CaseDraft) await workflow.SyncOrderStatusAsync(released.OwnerId, ct);
        return new { requestId = released.Id, released.Status };
    }

    /// <summary>Checks the answer against the step schema, stores it and lets the pipeline continue.</summary>
    public async Task<BridgeSubmitResult> SubmitAsync(string requestId, JsonElement answer, CancellationToken ct)
    {
        var request = await store.GetAsync(requestId, ct) ?? throw ApiException.NotFound("Bridge request not found.");
        if (request.Kind == AiBridgeKinds.Assets)
            throw ApiException.BadRequest("Image requests are answered by uploading files and calling assets/complete.",
                new ApiErrorDetails("BRIDGE_USE_ASSET_UPLOAD", "ai.bridge.useAssetUpload"));
        await RequireApprovedOwnerAsync(request, ct);
        var json = answer.ValueKind == JsonValueKind.String ? answer.GetString() ?? string.Empty : answer.GetRawText();
        json = AiBridgeSchemaValidator.StripMarkdownFences(json);

        if (AiBridgeStatuses.Answered.Contains(request.Status))
        {
            // Idempotent resubmission of the same answer; a different answer cannot replace an accepted one.
            if (request.ResultSha256 == AiBridgeSchemaValidator.Sha256(json))
                return new BridgeSubmitResult(true, [], await NextAsync(request, ct));
            throw ApiException.Conflict("This request already has an accepted answer.", "BRIDGE_REQUEST_ANSWERED", "ai.bridge.answered");
        }
        if (!AiBridgeStatuses.Open.Contains(request.Status))
            throw ApiException.Conflict($"This request is {request.Status} and no longer accepts answers.",
                "BRIDGE_REQUEST_CLOSED", "ai.bridge.closed");

        var errors = AiBridgeSchemaValidator.Validate(request.SchemaJson, json);
        if (errors.Count > 0)
        {
            await store.RejectAsync(request.Id, errors, ct);
            return new BridgeSubmitResult(false, errors, null);
        }
        var submitted = await store.SubmitAsync(request.Id, json, ct)
            ?? throw ApiException.Conflict("The request changed before the answer could be stored.", "BRIDGE_REQUEST_CLOSED", "ai.bridge.closed");
        return new BridgeSubmitResult(true, [], await ContinueAsync(submitted, ct));
    }

    private async Task<object?> ContinueAsync(AiBridgeRequest request, CancellationToken ct)
    {
        if (request.OwnerType == AiBridgeOwnerTypes.Cutscene)
        {
            try
            {
                var result = await cutscenes.ContinueFromBridgeAsync(request.OwnerId, request.GenerationRunId, ct);
                return new { cutscene = result.ClaudeRequest is null ? "SAVED" : "WAITING_FOR_CLAUDE", result.ClaudeRequest };
            }
            catch (ApiException exception)
            {
                // The answer was schema-valid but failed the cutscene validator twice: report it, keep the answer.
                logger.LogInformation("Cutscene continuation for {CaseId} ended with: {Message}", request.OwnerId, exception.Message);
                return new { cutscene = "INVALID", message = exception.Message, details = exception.Errors };
            }
        }
        await workflow.ResumeAfterClaudeAsync(request.OwnerId, request.Id, ct);
        await workflow.SyncOrderStatusAsync(request.OwnerId, ct);
        return await NextAsync(request, ct);
    }

    private async Task<object?> NextAsync(AiBridgeRequest request, CancellationToken ct)
    {
        if (request.OwnerType != AiBridgeOwnerTypes.CaseDraft) return null;
        var draft = await db.AiCaseDrafts.Find(item => item.Id == request.OwnerId).FirstOrDefaultAsync(ct);
        return draft is null ? null : new { draftId = draft.Id, draft.Status, draft.QueueState, nextAction = NextAction(draft) };
    }

    // ---------------------------------------------------------------- drafts

    public async Task<object> GetDraftAsync(string draftId, CancellationToken ct)
    {
        var draft = await RequireDraftAsync(draftId, ct);
        var requests = await store.ListForOwnerAsync(AiBridgeOwnerTypes.CaseDraft, draftId, ct);
        return new
        {
            draftId = draft.Id,
            draft.Status,
            draft.QueueState,
            draft.QueuedOperation,
            draft.GenerationPhase,
            orderStatus = AiDraftOrderStatus(draft),
            draft.OrderStatusHistory,
            order = OrderSummary(draft),
            waitingGate = WaitingGate(draft),
            nextAction = NextAction(draft),
            draft.ClaudeWait,
            draft.CaseId,
            draft.CaseTitle,
            draft.FailurePhase,
            draft.FailedAssetIds,
            draft.LastGenerationErrorCode,
            validator = new
            {
                draft.ValidationErrors,
                draft.TruthValidationReport,
                truthReview = new { draft.TruthReviewerResult.Status, draft.TruthReviewerResult.Findings },
                draft.BlueprintValidationErrors,
                semanticReview = draft.V3SemanticReview.Status,
                blindReview = draft.BlindReviewAssessment.Status,
                lastAttemptErrors = draft.GenerationAttempts.TakeLast(5).SelectMany(attempt => attempt.ValidationErrors).Take(60)
            },
            openRequests = requests.Where(item => AiBridgeStatuses.Open.Contains(item.Status) || item.Status == AiBridgeStatuses.Submitted)
                .Select(item => new { requestId = item.Id, item.Kind, item.Step, item.Status, item.CreatedAt, item.LeaseExpiresAt }),
            hasReport = !string.IsNullOrWhiteSpace(draft.BridgeReport),
            draft.BridgeReportUpdatedAt,
            draft.ImportedCaseId
        };
    }

    public async Task<JsonObject> PlayerViewAsync(string draftId, CancellationToken ct)
    {
        var draft = await RequireDraftAsync(draftId, ct);
        if (string.IsNullOrWhiteSpace(draft.GeneratedJson))
            throw ApiException.Conflict("This draft has no case JSON yet.", "BRIDGE_DRAFT_HAS_NO_CASE", "ai.bridge.noCase");
        var gameCase = caseService.ParseCase(draft.GeneratedJson);
        return AiPlayerViewBuilder.Build(gameCase);
    }

    /// <summary>
    /// The whole case JSON, solution included, for the bot's local playtest. After the bridge import it is the stored
    /// (imported, unpublished) case with every server-owned field; before that, the draft's generated JSON.
    /// </summary>
    public async Task<object> CaseJsonAsync(string draftId, CancellationToken ct)
    {
        var draft = await RequireDraftAsync(draftId, ct);
        if (!string.IsNullOrWhiteSpace(draft.ImportedCaseId))
        {
            try
            {
                var imported = await caseService.GetCaseAsync(draft.ImportedCaseId);
                return new { draftId, source = "IMPORTED", caseId = imported.CaseId, caseJson = imported };
            }
            catch (ApiException exception) when (exception.StatusCode == 404)
            {
                // The imported case was deleted by an admin; fall back to the draft below.
            }
        }
        if (string.IsNullOrWhiteSpace(draft.GeneratedJson))
            throw ApiException.Conflict("This draft has no case JSON yet.", "BRIDGE_DRAFT_HAS_NO_CASE", "ai.bridge.noCase");
        var gameCase = caseService.ParseCase(draft.GeneratedJson);
        return new { draftId, source = "DRAFT", caseId = gameCase.CaseId, caseJson = gameCase };
    }

    public async Task<object> AssetsNeededAsync(string draftId, CancellationToken ct)
    {
        var draft = await RequireDraftAsync(draftId, ct);
        if (string.IsNullOrWhiteSpace(draft.GeneratedJson))
            throw ApiException.Conflict("This draft has no case JSON yet.", "BRIDGE_DRAFT_HAS_NO_CASE", "ai.bridge.noCase");
        var gameCase = caseService.ParseCase(draft.GeneratedJson);
        var open = await OpenAssetRequestAsync(draftId, ct);
        object? pixel = null;
        if (PixelCasePipeline.IsPixel(draft))
        {
            var library = await db.AssetLibrary.Find(Builders<AssetLibraryEntry>.Filter.Empty).ToListAsync(ct);
            var cap = draft.Order?.PixelLabCap ?? 0;
            var preview = PixelAssetPlanning.Plan(gameCase, draft.AssetPlan?.Choices ?? new List<AiAssetChoice>(), library, cap, RecordRoot(draftId));
            pixel = new
            {
                pipeline = draft.VisualPipeline,
                pixelLabCap = cap,
                planAccepted = draft.AssetPlan is not null,
                planAcceptedAt = draft.AssetPlan?.AcceptedAt,
                estimatedGenerations = preview.EstimatedGenerations,
                withinCap = preview.WithinCap,
                planErrors = preview.Errors,
                next = draft.AssetPlan is null
                    ? "Declare where every picture comes from: PUT asset-plan { choices: [{ subject, source: LIBRARY|VARIANT|PIXELLAB, libraryKey, parentKey, variant }] }. Undeclared subjects count as new PixelLab pictures."
                    : "The plan fits pixelLabCap: run the PixelLab requests in order (first creation only), process, then upload each slot.",
                subjects = preview.Subjects.Select(subject => new
                {
                    subject.Subject,
                    subject.Kind,
                    subject.TargetId,
                    subject.Name,
                    subject.Projection,
                    libraryKind = PixelAssetPlanning.LibraryKindFor(subject.Kind, subject.Projection),
                    slots = subject.SlotIds,
                    declared = draft.AssetPlan?.Choices.Any(choice => choice.Subject == subject.Subject) == true,
                    subject.Source,
                    subject.LibraryKey,
                    subject.ParentKey,
                    subject.Variant,
                    suggestions = PixelAssetPlanning.Suggestions(draft.Order, subject.Kind, subject.Projection, library)
                }),
                plan = preview.Plan
            };
        }
        var slots = AiCaseService.BuildAssetSlots(draft, gameCase, AiAssetPhases.SceneLayout)
            .Concat(AiCaseService.BuildAssetSlots(draft, gameCase, AiAssetPhases.FinalAssets))
            .Select(slot => new
            {
                slot.SlotId,
                slot.Kind,
                slot.TargetId,
                slot.Name,
                slot.Phase,
                artDirection = slot.ArtDirection,
                slot.Width,
                slot.Height,
                slot.Transparent,
                slot.Required,
                slot.CurrentUrl,
                requestedNow = open?.AssetSlotIds.Contains(slot.SlotId) == true,
                mustReplace = open?.AssetRegenerateSlotIds.Contains(slot.SlotId) == true
            });
        return new
        {
            draftId,
            storageAvailable = assetStorage.IsAvailable,
            maxBytes = bridge.Value.MaxAssetBytes,
            formats = new[] { "image/png", "image/webp" },
            openRequest = open is null ? null : new { requestId = open.Id, open.Step, open.AssetPhase, open.Status, open.Prompt },
            pixel,
            slots
        };
    }

    private static string Clip(string? value, int max)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length <= max ? text : text[..max];
    }

    /// <summary>Where the bot keeps originals, requests and receipts of a draft (outside src/FE/public).</summary>
    private static string RecordRoot(string draftId) => $"tmp/pixellab/{draftId}";

    /// <summary>
    /// Pixel drafts: the bot declares where every picture comes from (library, variant, PixelLab). The server builds the
    /// PixelLab request plan from templates.json; a plan over the order's pixelLabCap is refused and nothing may start.
    /// </summary>
    public async Task<object> PutAssetPlanAsync(string draftId, List<AiAssetChoice>? choices, CancellationToken ct)
    {
        var draft = await RequireDraftAsync(draftId, ct);
        if (!PixelCasePipeline.IsPixel(draft))
            throw ApiException.Conflict("Only pixel drafts (made after VUAN-6B) take an asset plan; this draft keeps the classic image slots.",
                "AI_ASSET_PLAN_NOT_PIXEL", "ai.assetPlan.notPixel");
        if (draft.Status is AiDraftStatus.Cancelled or AiDraftStatus.Published or AiDraftStatus.Imported)
            throw ApiException.Conflict("This draft no longer accepts images.", "BRIDGE_DRAFT_CLOSED", "ai.bridge.draftClosed");
        if (string.IsNullOrWhiteSpace(draft.GeneratedJson))
            throw ApiException.Conflict("This draft has no case JSON yet.", "BRIDGE_DRAFT_HAS_NO_CASE", "ai.bridge.noCase");
        if (choices is { Count: > 500 })
            throw ApiException.BadRequest("Declare at most 500 picture subjects.",
                new ApiErrorDetails("AI_ASSET_PLAN_INVALID", "ai.assetPlan.invalid"));
        var gameCase = caseService.ParseCase(draft.GeneratedJson);
        var library = await db.AssetLibrary.Find(Builders<AssetLibraryEntry>.Filter.Empty).ToListAsync(ct);
        var cap = draft.Order?.PixelLabCap ?? 0;
        var result = PixelAssetPlanning.Plan(gameCase, choices ?? new List<AiAssetChoice>(), library, cap, RecordRoot(draftId));
        if (result.Errors.Count > 0)
            throw ApiException.BadRequest("The asset plan has errors: " + string.Join(" | ", result.Errors.Take(12)),
                new { code = "AI_ASSET_PLAN_INVALID", messageKey = "ai.assetPlan.invalid", errors = result.Errors });
        if (!result.WithinCap)
            throw ApiException.Conflict(PixelLabPlanBuilder.CapMessage(result.Plan), new
            {
                code = "AI_PIXELLAB_CAP_EXCEEDED",
                messageKey = "ai.assetPlan.capExceeded",
                estimatedGenerations = result.EstimatedGenerations,
                pixelLabCap = cap,
                requests = result.Plan["requests"]!.AsArray().Select(node => new
                {
                    id = node!["id"]!.GetValue<string>(), estimatedGenerations = node["estimatedGenerations"]!.GetValue<int>()
                }).ToList()
            });
        var planJson = result.Plan.ToJsonString();
        var accepted = new AiAssetPlan
        {
            Choices = result.Subjects.Select(subject => new AiAssetChoice
            {
                Subject = subject.Subject, Source = subject.Source, LibraryKey = subject.LibraryKey,
                ParentKey = subject.ParentKey, Variant = subject.Variant, InpaintItems = (subject.InpaintItems ?? new List<string>()).ToList(),
                Note = Clip((choices ?? new()).FirstOrDefault(choice => choice.Subject == subject.Subject)?.Note, 500)
            }).ToList(),
            EstimatedGenerations = result.EstimatedGenerations,
            PixelLabCap = cap,
            Requests = result.Plan["summary"]!["requests"]!.GetValue<int>(),
            PlanJson = planJson,
            PlanSha256 = AiBridgeSchemaValidator.Sha256(planJson),
            AcceptedAt = DateTime.UtcNow
        };
        await db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draftId,
            Builders<AiCaseDraft>.Update.Set(item => item.AssetPlan, accepted).Set(item => item.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
        return new
        {
            draftId,
            accepted = true,
            estimatedGenerations = result.EstimatedGenerations,
            pixelLabCap = cap,
            requests = accepted.Requests,
            plan = result.Plan
        };
    }

    public async Task<AiBridgeAssetUpload> UploadAssetAsync(string draftId, string slotId, byte[] bytes, CancellationToken ct)
    {
        var draft = await RequireDraftAsync(draftId, ct);
        if (draft.Status is AiDraftStatus.Cancelled or AiDraftStatus.Published or AiDraftStatus.Imported)
            throw ApiException.Conflict("This draft no longer accepts images.", "BRIDGE_DRAFT_CLOSED", "ai.bridge.draftClosed");
        if (string.IsNullOrWhiteSpace(draft.GeneratedJson))
            throw ApiException.Conflict("This draft has no case JSON yet.", "BRIDGE_DRAFT_HAS_NO_CASE", "ai.bridge.noCase");
        var gameCase = caseService.ParseCase(draft.GeneratedJson);
        var known = AiCaseService.BuildAssetSlots(draft, gameCase, AiAssetPhases.SceneLayout)
            .Concat(AiCaseService.BuildAssetSlots(draft, gameCase, AiAssetPhases.FinalAssets))
            .Any(slot => slot.SlotId == slotId);
        if (!known)
            throw ApiException.BadRequest($"Slot '{slotId}' is not an image slot of this draft. See assets-needed.",
                new ApiErrorDetails("BRIDGE_UNKNOWN_SLOT", "ai.bridge.unknownSlot"));
        double? feetAnchorY = null;
        if (PixelCasePipeline.IsPixel(draft))
        {
            if (draft.AssetPlan is null)
                throw ApiException.Conflict(
                    "Declare the asset plan first (PUT asset-plan): library pictures, variants and PixelLab requests within pixelLabCap.",
                    "AI_ASSET_PLAN_REQUIRED", "ai.assetPlan.required");
            var slot = AiCaseService.BuildAssetSlots(draft, gameCase, AiAssetPhases.SceneLayout)
                .Concat(AiCaseService.BuildAssetSlots(draft, gameCase, AiAssetPhases.FinalAssets))
                .First(entry => entry.SlotId == slotId);
            var info = BridgeAssetStorage.Inspect(bytes, Math.Max(1024, bridge.Value.MaxAssetBytes));
            if (info.Width != slot.Width || info.Height != slot.Height)
                throw ApiException.BadRequest(
                    $"Slot '{slotId}' needs {slot.Width}x{slot.Height} (pixel case); the picture is {info.Width}x{info.Height}.",
                    new ApiErrorDetails("ASSET_WRONG_SIZE", "ai.bridge.assetWrongSize"));
            if (slot.Kind != AiAssetSlotKinds.Background && !info.HasAlpha)
                throw ApiException.BadRequest($"Slot '{slotId}' needs a transparent background (PNG/WebP with alpha).",
                    new ApiErrorDetails("ASSET_NEEDS_ALPHA", "ai.bridge.assetNeedsAlpha"));
            if (slot.Kind == AiAssetSlotKinds.CharacterSprite)
            {
                feetAnchorY = PixelCasePipeline.MeasureFeetAnchorY(bytes);
                if (feetAnchorY is not > 0.5)
                    throw ApiException.BadRequest(
                        $"Slot '{slotId}': frame 0 of the idle sheet must show the NPC with the feet in the lower half of the 128px frame.",
                        new ApiErrorDetails("ASSET_SPRITE_EMPTY", "ai.bridge.assetSpriteEmpty"));
            }
        }
        var upload = await assetStorage.SaveAsync(draftId, slotId, bytes, ct);
        upload.FeetAnchorY = feetAnchorY;
        await db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draftId,
            Builders<AiCaseDraft>.Update
                .Push(item => item.BridgeAssets, upload)
                .Set(item => item.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
        return upload;
    }

    /// <summary>The bot has uploaded every picture of the open image request: the pipeline continues.</summary>
    public async Task<BridgeSubmitResult> CompleteAssetsAsync(string draftId, CancellationToken ct)
    {
        var draft = await RequireDraftAsync(draftId, ct);
        var open = await OpenAssetRequestAsync(draftId, ct)
            ?? throw ApiException.Conflict("This draft is not waiting for images.", "BRIDGE_NO_ASSET_REQUEST", "ai.bridge.noAssetRequest");
        var latest = AiCaseService.LatestUploads(draft);
        var missing = open.AssetSlotIds
            .Where(slotId => !latest.TryGetValue(slotId, out var upload)
                || (open.AssetRegenerateSlotIds.Contains(slotId) && upload.UploadedAt < open.CreatedAt))
            .Select(slotId => open.AssetRegenerateSlotIds.Contains(slotId)
                ? $"{slotId}: upload a new picture (the request asks to replace it)"
                : $"{slotId}: no picture uploaded")
            .ToList();
        if (missing.Count > 0)
        {
            await store.RejectAsync(open.Id, missing, ct);
            return new BridgeSubmitResult(false, missing, null);
        }
        var gameCase = caseService.ParseCase(draft.GeneratedJson);
        var phaseSlots = AiCaseService.BuildAssetSlots(draft, gameCase, open.AssetPhase).Select(slot => slot.SlotId).ToHashSet(StringComparer.Ordinal);
        var answer = latest.Where(pair => phaseSlots.Contains(pair.Key))
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        var submitted = await store.SubmitAsync(open.Id, JsonSerializer.Serialize(answer, Json), ct)
            ?? throw ApiException.Conflict("The image request changed before it could be completed.", "BRIDGE_REQUEST_CLOSED", "ai.bridge.closed");
        return new BridgeSubmitResult(true, [], await ContinueAsync(submitted, ct));
    }

    public async Task<object> PutReportAsync(string draftId, string markdown, CancellationToken ct)
    {
        await RequireDraftAsync(draftId, ct);
        var report = markdown ?? string.Empty;
        if (report.Length > MaxReportLength)
            throw ApiException.BadRequest($"The report may be at most {MaxReportLength} characters.");
        var now = DateTime.UtcNow;
        await db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draftId,
            Builders<AiCaseDraft>.Update
                .Set(item => item.BridgeReport, report)
                .Set(item => item.BridgeReportUpdatedAt, now),
            cancellationToken: ct);
        return new { draftId, length = report.Length, updatedAt = now };
    }

    /// <summary>
    /// Fast review mode only: the bot may pass the story, logic and layout gates. The truth gate always waits for a
    /// person, whatever the mode.
    /// </summary>
    public async Task<object> ApproveGateAsync(string draftId, string gate, CancellationToken ct)
    {
        var draft = await RequireDraftAsync(draftId, ct);
        var normalized = (gate ?? string.Empty).Trim().ToUpperInvariant();
        if (normalized == BridgeGates.Truth)
            throw ApiException.Forbidden("The truth gate is always approved by a person.");
        if (draft.Order?.ReviewMode != AiCaseReviewModes.Fast)
            throw ApiException.Forbidden("Only orders in fast review mode let the bot pass a gate.");
        var expected = normalized switch
        {
            BridgeGates.Story => AiDraftStatus.StoryAwaitingApproval,
            BridgeGates.Logic => AiDraftStatus.FullLogicAwaitingApproval,
            BridgeGates.Layout => AiDraftStatus.SceneLayoutAwaitingApproval,
            _ => throw ApiException.BadRequest("gate must be STORY, LOGIC or LAYOUT.")
        };
        if (draft.Status != expected)
            throw ApiException.Conflict($"The draft is at {draft.Status}, not at the {normalized} gate.",
                "BRIDGE_GATE_NOT_OPEN", "ai.bridge.gateNotOpen");
        var result = normalized switch
        {
            BridgeGates.Story => await cases.ApproveDraftAsync(BridgeUser, draftId),
            BridgeGates.Logic => await cases.ApproveFullLogicAsync(BridgeUser, draftId),
            _ => await cases.ApproveSceneLayoutAsync(BridgeUser, draftId)
        };
        await workflow.SyncOrderStatusAsync(draftId, ct);
        return new { draftId, gate = normalized, result.Status, result.QueueState };
    }

    /// <summary>Imports the finished draft as an unpublished case for the playtest. There is no publish here.</summary>
    public async Task<CaseSummaryResponse> ImportAsync(string draftId, CancellationToken ct)
    {
        await RequireDraftAsync(draftId, ct);
        var summary = await cases.ImportDraftAsync(BridgeUser, draftId, overwrite: false, publish: false);
        await workflow.SyncOrderStatusAsync(draftId, ct);
        return summary;
    }

    // ---------------------------------------------------------------- helpers

    private async Task<AiCaseDraft> RequireDraftAsync(string draftId, CancellationToken ct)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(draftId, out _)) throw ApiException.NotFound("AI draft not found.");
        var draft = await db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("AI draft not found.");
        if (!IsApprovedOrder(draft))
            throw ApiException.Forbidden("This order has not been approved by an admin.");
        return draft;
    }

    private async Task<AiCaseDraft?> RequireApprovedOwnerAsync(AiBridgeRequest request, CancellationToken ct) =>
        request.OwnerType == AiBridgeOwnerTypes.CaseDraft ? await RequireDraftAsync(request.OwnerId, ct) : null;

    private async Task<AiBridgeRequest?> OpenAssetRequestAsync(string draftId, CancellationToken ct) =>
        (await store.ListForOwnerAsync(AiBridgeOwnerTypes.CaseDraft, draftId, ct))
            .LastOrDefault(item => item.Kind == AiBridgeKinds.Assets && AiBridgeStatuses.Open.Contains(item.Status));

    private static bool IsApprovedOrder(AiCaseDraft draft) =>
        draft.OrderStatus is not (AiOrderStatuses.AwaitingOwnerApproval or AiOrderStatuses.Rejected);

    private static string AiDraftOrderStatus(AiCaseDraft draft) =>
        string.IsNullOrWhiteSpace(draft.OrderStatus) ? AiCaseOrderPolicy.Derive(draft, false) : draft.OrderStatus;

    private static object OrderSummary(AiCaseDraft draft) => new
    {
        draft.Order,
        idea = draft.Prompt,
        draft.Settings.GenerationPreset,
        draft.Settings.Language,
        draft.Settings.StageCount,
        draft.Settings.Difficulty,
        draft.Settings.CaseType,
        draft.Settings.IncludeCrackTheLie,
        orderedByRole = draft.CreatedByRole,
        storyPreview = string.IsNullOrWhiteSpace(draft.StoryPreview.Title) ? null : draft.StoryPreview
    };

    private static string? WaitingGate(AiCaseDraft draft) => draft.QueueState is AiQueueStates.None or "" ? draft.Status switch
    {
        AiDraftStatus.StoryAwaitingApproval => BridgeGates.Story,
        AiDraftStatus.CaseTruthAwaitingApproval => BridgeGates.Truth,
        AiDraftStatus.FullLogicAwaitingApproval => BridgeGates.Logic,
        AiDraftStatus.SceneLayoutAwaitingApproval => BridgeGates.Layout,
        _ => null
    } : null;

    private static string NextAction(AiCaseDraft draft)
    {
        if (draft.QueueState == AiQueueStates.AwaitingClaude)
            return $"Answer request {draft.ClaudeWait?.RequestId} ({draft.ClaudeWait?.Step}).";
        if (draft.QueueState is AiQueueStates.Pending or AiQueueStates.Running or AiQueueStates.RetryScheduled)
            return "The server is working; poll again in a few seconds.";
        return draft.Status switch
        {
            AiDraftStatus.StoryAwaitingApproval => draft.Order?.ReviewMode == AiCaseReviewModes.Fast
                ? "Fast mode: run your checks, then approve-gate STORY." : "Wait for an admin to approve the story preview.",
            AiDraftStatus.CaseTruthAwaitingApproval => "Wait for an admin to approve the case truth (always a person).",
            AiDraftStatus.CaseTruthInvalid => "The truth failed validation; an admin must ask for a scoped repair.",
            AiDraftStatus.FullLogicAwaitingApproval => draft.Order?.ReviewMode == AiCaseReviewModes.Fast
                ? "Fast mode: run the blind detective and editor checks, then approve-gate LOGIC." : "Wait for an admin to approve the logic.",
            AiDraftStatus.SceneLayoutAwaitingApproval => draft.Order?.ReviewMode == AiCaseReviewModes.Fast
                ? "Fast mode: check the layout, then approve-gate LAYOUT." : "Wait for an admin to approve the scene layout.",
            AiDraftStatus.ReadyToPublish => "Import the draft for the playtest (POST import), then write report.md.",
            AiDraftStatus.GeneratedInvalid => "Generation failed validation; see validator and wait for an admin to retry.",
            AiDraftStatus.Imported => "Imported for the playtest. Only an admin can publish.",
            AiDraftStatus.Published => "Published by an admin.",
            AiDraftStatus.Cancelled => "Cancelled.",
            _ => "Nothing to do right now."
        };
    }
}

public sealed record BridgeSubmitResult(bool Accepted, List<string> Errors, object? Next);
