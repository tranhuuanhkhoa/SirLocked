using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Every model-written artifact now comes from the Claude bot through the bridge queue. Prompts, schemas and
/// validators are unchanged; only the writer changed. A step without an answer parks the run
/// (<see cref="AiAwaitingClaudeException"/>) and the worker replays it from its checkpoint after the answer arrives.
/// </summary>
public partial class AiCaseService
{
    public const string AssetHttpClientName = "case-assets";
    internal const string DefaultInstructions =
        "You are a senior detective game designer. Return exactly one valid JSON object. Do not include markdown fences or commentary.";
    internal const string VisionInstructions =
        "You inspect game scene backgrounds and transparent cutout assets (open every image URL listed in the prompt), then return exact JSON layout metadata. Return exactly one valid JSON object. No markdown fences or commentary.";
    internal const string VisionSchemaVersion = "scene-vision-layout-v1";

    private readonly Dictionary<string, string> _orderBlocks = new(StringComparer.Ordinal);

    internal sealed record SceneImageReference(string Label, string Url);

    /// <summary>
    /// Asks Claude for one structured JSON answer. Mock and dry-run modes return the deterministic mock as before.
    /// </summary>
    internal async Task<string> GenerateJsonAsync(
        string draftId,
        string step,
        string prompt,
        int maxOutputTokens,
        string schemaVersion,
        JsonObject schema,
        int attemptNumber,
        Func<string>? mockResponseFactory = null,
        string? generationRunId = null,
        string? instructions = null,
        IReadOnlyList<string>? imageUrls = null)
    {
        var containsSpoilers = !step.Contains("StoryPreview", StringComparison.OrdinalIgnoreCase);
        var loggedPrompt = containsSpoilers ? $"[REDACTED SPOILER PROMPT: {step}]" : prompt;
        await HeartbeatGenerationAsync(draftId, generationRunId);
        if (_settings.BlocksAiCalls)
        {
            var reason = _settings.MockAiResponses ? "MOCK_AI_RESPONSES enabled" : "AI_DRY_RUN enabled";
            await RecordPlannedCallAsync(draftId, step, "text", wouldCallApi: false, reason, generationRunId);
            await LogGenerationAsync(draftId, ProviderName, step, "MOCKED", loggedPrompt, reason, null);
        }
        else if (string.IsNullOrWhiteSpace(generationRunId))
        {
            // Only a queued run can park and resume. A synchronous admin call reports the step as unavailable.
            throw ApiException.Conflict(
                "Claude can only answer this step inside a queued generation run. Use continue or retry-json.",
                "AI_BRIDGE_RUN_REQUIRED",
                "ai.bridge.runRequired");
        }

        var answer = await _textProvider.GenerateJsonAsync(new AiTextRequest
        {
            OwnerType = AiBridgeOwnerTypes.CaseDraft,
            OwnerId = draftId,
            Step = step,
            SchemaVersion = schemaVersion,
            Schema = schema,
            Instructions = instructions ?? DefaultInstructions,
            Prompt = await WithOrderAsync(draftId, prompt),
            MaxOutputTokens = maxOutputTokens,
            AttemptNumber = attemptNumber,
            GenerationRunId = generationRunId ?? string.Empty,
            ImageUrls = imageUrls ?? [],
            MockResponseFactory = mockResponseFactory
        }, _operationCancellationToken);
        if (!_settings.BlocksAiCalls) await HeartbeatGenerationAsync(draftId, generationRunId);
        return StripMarkdownFences(answer);
    }

    /// <summary>
    /// The former vision call: the prompt now lists the image URLs and Claude opens them. The JSON contract of the
    /// placement plan and verification is unchanged.
    /// </summary>
    private async Task<string> GenerateVisionJsonAsync(
        AiCaseDraft draft,
        string step,
        string prompt,
        IReadOnlyList<SceneImageReference> images,
        int maxOutputTokens,
        Func<string>? mockResponseFactory = null,
        string runtimeSpace = "1600x900 runtime space")
    {
        if (images.Count == 0)
            throw ApiException.BadGateway("A scene inspection step needs at least one image.");
        var builder = new StringBuilder(prompt.TrimEnd());
        builder.AppendLine().AppendLine().AppendLine($"IMAGES TO INSPECT (open each URL; coordinates use the {runtimeSpace}):");
        foreach (var image in images)
            builder.Append("- ").Append(image.Label).Append(": ").AppendLine(image.Url);
        var visionPrompt = builder.ToString();
        return await GenerateJsonAsync(
            draft.Id,
            step,
            visionPrompt,
            maxOutputTokens,
            VisionSchemaVersion,
            new JsonObject { ["type"] = "object" },
            // The step name already names the scene and the retry; scenes are asked side by side, so a global
            // attempt counter would shift between replays and change the request keys.
            attemptNumber: 1,
            mockResponseFactory: mockResponseFactory,
            generationRunId: draft.GenerationRunId,
            instructions: VisionInstructions,
            imageUrls: images.Select(image => image.Url).Where(url => !string.IsNullOrWhiteSpace(url)).ToList());
    }

    /// <summary>The creator's order, appended to every step's prompt in a fixed, explicit form.</summary>
    private async Task<string> WithOrderAsync(string draftId, string prompt)
    {
        if (!_orderBlocks.TryGetValue(draftId, out var block))
        {
            var stored = await _db.AiCaseDrafts.Find(item => item.Id == draftId)
                .Project(item => new { item.Order, item.Settings, item.VipBrief })
                .FirstOrDefaultAsync(_operationCancellationToken);
            block = AiCaseOrderPolicy.BuildPromptBlock(stored?.Order,
                AiPipelineVersions.IsOpenCoop(stored?.Settings) ? AiDifficultyProfiles.For(stored!.Settings.Difficulty) : null);
            // VUAN-7: a VIP order's brief follows its order block in every later step.
            var brief = BuildVipBriefBlock(stored?.VipBrief);
            if (brief.Length > 0) block = string.IsNullOrEmpty(block) ? brief : $"{block}\n\n{brief}";
            _orderBlocks[draftId] = block;
        }
        return string.IsNullOrEmpty(block) ? prompt : $"{prompt.TrimEnd()}\n\n{block}";
    }

    /// <summary>
    /// Waits for the bot to upload every image slot of <paramref name="phase"/>. The answer maps slot ids to the
    /// uploaded files; it stays fixed for this run, so a replay applies exactly the same images.
    /// </summary>
    private async Task<Dictionary<string, AiBridgeAssetUpload>> RequireClaudeAssetsAsync(
        AiCaseDraft draft,
        string phase,
        IReadOnlyList<AiAssetSlot> slots,
        IReadOnlySet<string>? forcedSlotIds,
        string? stepSuffix = null,
        string? note = null)
    {
        var step = string.IsNullOrWhiteSpace(stepSuffix) ? $"UploadAssets:{phase}" : $"UploadAssets:{phase}:{stepSuffix}";
        var requestKey = ClaudeBridgeTextProvider.BuildRequestKey(new AiTextRequest
        {
            OwnerType = AiBridgeOwnerTypes.CaseDraft,
            OwnerId = draft.Id,
            GenerationRunId = draft.GenerationRunId,
            Step = step,
            AttemptNumber = 1
        }, 0);
        var store = new AiBridgeRequestStore(_db, TimeProvider.System, _bridgeNotifier);
        var existing = await store.FindByKeyAsync(requestKey, _operationCancellationToken);
        if (existing is not null)
        {
            if (existing.Status == AiBridgeStatuses.Cancelled)
                throw ApiException.Conflict("The image request for this draft was cancelled.",
                    "AI_BRIDGE_REQUEST_CANCELLED", "ai.bridge.requestCancelled");
            if (!AiBridgeStatuses.Answered.Contains(existing.Status))
                throw new AiAwaitingClaudeException(existing.Id, existing.OwnerType, existing.OwnerId, step);
            if (existing.Status == AiBridgeStatuses.Submitted) await store.MarkAcceptedAsync(existing.Id, _operationCancellationToken);
            return JsonSerializer.Deserialize<Dictionary<string, AiBridgeAssetUpload>>(existing.ResultJson, CompactJson)
                ?? new Dictionary<string, AiBridgeAssetUpload>(StringComparer.Ordinal);
        }

        // VUAN-7: a VIP pixel order plans its pictures through the API lane first; the images themselves are made by the
        // non-AI runner on the studio VPS, which takes only VIP-lane image requests.
        await EnsureVipAssetPlanAsync(draft);

        var regenerate = forcedSlotIds is { Count: > 0 }
            ? slots.Where(slot => forcedSlotIds.Contains(slot.SlotId)).Select(slot => slot.SlotId).ToList()
            : new List<string>();
        var required = slots
            .Where(slot => regenerate.Contains(slot.SlotId)
                           || (slot.Required && (regenerate.Count == 0 || string.IsNullOrWhiteSpace(slot.CurrentUrl))))
            .Select(slot => slot.SlotId)
            .ToList();
        var description = new StringBuilder()
            .AppendLine($"Upload the {phase} images of draft {draft.Id} through POST /api/bridge/drafts/{draft.Id}/assets, then call assets/complete.")
            .AppendLine("GET /api/bridge/drafts/{id}/assets-needed lists every slot with its art direction, size and current URL.")
            .AppendLine("Required slots: " + string.Join(", ", required))
            .AppendLine(regenerate.Count > 0
                ? "Upload NEW pictures for: " + string.Join(", ", regenerate)
                : "Slots that already have a picture may keep it.")
            .AppendLine(string.IsNullOrWhiteSpace(note) ? string.Empty : $"Why: {note}")
            .AppendLine(PixelCasePipeline.IsPixel(draft)
                ? $"Pixel case (VUAN-6B): first declare where each picture comes from with PUT /api/bridge/drafts/{draft.Id}/asset-plan "
                  + "(library -> variant -> PixelLab, within the order's pixelLabCap); uploads are refused until a plan fits. "
                  + "Sizes: backgrounds 512x512, NPC idle sheets 1152x128 (9 frames of 128), portraits 288x288, inventory icons 64x64."
                : string.Empty)
            .ToString();
        var created = await store.InsertPendingAsync(new AiBridgeRequest
        {
            OwnerType = AiBridgeOwnerTypes.CaseDraft,
            OwnerId = draft.Id,
            RequestKey = requestKey,
            GenerationRunId = draft.GenerationRunId,
            Step = step,
            AttemptNumber = 1,
            Kind = AiBridgeKinds.Assets,
            SchemaVersion = "claude-asset-upload-v1",
            Prompt = description,
            Instructions = "Upload PNG or WebP files (at most 5 MB, transparent where the slot says so).",
            PromptSha256 = AiBridgeSchemaValidator.PromptSha256(description),
            AssetPhase = phase,
            AssetSlotIds = required,
            AssetRegenerateSlotIds = regenerate,
            Lane = draft.Lane == AiDraftLanes.VipApi ? AiBridgeLanes.VipRunner : AiBridgeLanes.Bot
        }, _operationCancellationToken);
        await LogGenerationAsync(draft.Id, ProviderName, step, "AWAITING_CLAUDE",
            string.Empty, $"Request {created.Id} waits for {required.Count} uploaded image(s).", null);
        throw new AiAwaitingClaudeException(created.Id, AiBridgeOwnerTypes.CaseDraft, draft.Id, step);
    }
}
