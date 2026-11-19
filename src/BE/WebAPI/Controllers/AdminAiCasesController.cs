using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Vip;
using SirLocked.Api.Configurations;
using Microsoft.Extensions.Options;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin/ai-cases")]
[Authorize(Roles = UserRole.Admin + "," + UserRole.Vip)]
public class AdminAiCasesController : BaseApiController
{
    private readonly IAiCaseService _aiCaseService;
    private readonly IAiArtifactCleanupService _artifactCleanupService;
    private readonly IAdminAudit _audit;
    private readonly AiCaseSettingsStore _settings;
    private readonly AssetLibraryService _library;

    public AdminAiCasesController(
        IAiCaseService aiCaseService,
        IAiArtifactCleanupService artifactCleanupService,
        IAdminAudit audit,
        AiCaseSettingsStore settings,
        AssetLibraryService library)
    {
        _aiCaseService = aiCaseService;
        _artifactCleanupService = artifactCleanupService;
        _audit = audit;
        _settings = settings;
        _library = library;
    }

    /// <summary>VIP orders wait here until an admin approves them; only then does the Claude bot see them.</summary>
    [HttpPost("{draftId}/approve-order")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> ApproveOrder(string draftId, CancellationToken ct)
    {
        var before = await _aiCaseService.GetDraftAsync(Caller, draftId);
        var approved = await _aiCaseService.ApproveOrderAsync(Caller, draftId);
        if (before.OrderStatus != approved.OrderStatus)
            await _audit.LogAsync(Caller, "ai-order.approve", "aiCaseDrafts", draftId,
                new { before.OrderStatus, before.CreatedByUserId }, new { approved.OrderStatus }, ct: ct);
        return Ok(approved, "Order approved and queued for Claude.");
    }

    [HttpPost("{draftId}/reject-order")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> RejectOrder(
        string draftId, [FromBody] AiOrderRejectRequest request, CancellationToken ct)
    {
        var before = await _aiCaseService.GetDraftAsync(Caller, draftId);
        var rejected = await _aiCaseService.RejectOrderAsync(Caller, draftId, request.Reason);
        if (before.OrderStatus != rejected.OrderStatus)
            await _audit.LogAsync(Caller, "ai-order.reject", "aiCaseDrafts", draftId,
                new { before.OrderStatus, before.CreatedByUserId }, new { rejected.OrderStatus }, request.Reason, ct);
        return Ok(rejected, "Order rejected.");
    }

    /// <summary>
    /// "Chơi thử": opens (or reopens) the caller's private playtest room of an imported, unpublished draft. ADMIN or the
    /// draft's author only; the second seat is taken through the room's single-use invite link.
    /// </summary>
    [HttpPost("{draftId}/playtest")]
    public async Task<ActionResult<ApiResponse<RoomResponse>>> Playtest(string draftId, [FromServices] IRoomService rooms) =>
        Ok(await rooms.CreatePlaytestAsync(Caller, draftId), "Playtest room ready.");

    [HttpGet("settings")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<AiSettingsResponse>>> GetSettings(
        [FromServices] VipSettingsStore vip,
        [FromServices] IOptions<AnthropicSettings> anthropic,
        [FromServices] IOptions<AdsSettings> ads,
        CancellationToken ct) =>
        Ok(await SettingsResponseAsync(vip, anthropic.Value, ads.Value, ct));

    /// <summary>
    /// Saves the sections the request carries (each one optional): the VIP weekly limit, <c>vipPricing</c>,
    /// <c>vipModels</c>, <c>hintPricing</c>, <c>authorRewards</c>. Every changed section is one admin log entry.
    /// </summary>
    [HttpPut("settings")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<AiSettingsResponse>>> PutSettings(
        [FromBody] AiCaseSettingsRequest request,
        [FromServices] VipSettingsStore vip,
        [FromServices] IOptions<AnthropicSettings> anthropic,
        [FromServices] IOptions<AdsSettings> ads,
        CancellationToken ct)
    {
        // Validate every section first, so a bad value in one does not leave the others half saved.
        if (request.VipPricing is not null) VipSettingsStore.ValidatePricing(request.VipPricing);
        if (request.VipModels is not null) VipSettingsStore.ValidateModels(request.VipModels);
        if (request.HintPricing is not null) VipSettingsStore.ValidateHints(request.HintPricing);
        if (request.AuthorRewards is not null) VipSettingsStore.ValidateAuthors(request.AuthorRewards);

        if (request.VipWeeklyOrderLimit.HasValue)
        {
            var before = await _settings.GetAsync(ct);
            var saved = await _settings.SaveAsync(request.VipWeeklyOrderLimit.Value, Caller.Id, ct);
            await _audit.LogAsync(Caller, "ai-settings.update", "gameSettings", AiCaseSettingsDocument.DocumentId,
                new { before.VipWeeklyOrderLimit }, new { saved.VipWeeklyOrderLimit }, ct: ct);
        }
        if (request.VipPricing is not null)
        {
            var before = await vip.GetPricingAsync(ct);
            var saved = await vip.SavePricingAsync(request.VipPricing, Caller.Id, ct);
            await _audit.LogAsync(Caller, "ai-vip-pricing.update", "gameSettings", VipPricingSettings.DocumentId, before, saved, ct: ct);
        }
        if (request.VipModels is not null)
        {
            var before = await vip.GetModelsAsync(ct);
            var saved = await vip.SaveModelsAsync(request.VipModels, Caller.Id, ct);
            await _audit.LogAsync(Caller, "ai-vip-models.update", "gameSettings", VipModelSettings.DocumentId, before, saved, ct: ct);
        }
        if (request.HintPricing is not null)
        {
            var before = await vip.GetHintsAsync(ct);
            var saved = await vip.SaveHintsAsync(request.HintPricing, Caller.Id, ct);
            await _audit.LogAsync(Caller, "hint-pricing.update", "gameSettings", HintPricingSettings.DocumentId, before, saved, ct: ct);
        }
        if (request.AuthorRewards is not null)
        {
            var before = await vip.GetAuthorsAsync(ct);
            var saved = await vip.SaveAuthorsAsync(request.AuthorRewards, Caller.Id, ct);
            await _audit.LogAsync(Caller, "author-rewards.update", "gameSettings", AuthorRewardSettings.DocumentId, before, saved, ct: ct);
        }
        return Ok(await SettingsResponseAsync(vip, anthropic.Value, ads.Value, ct), "AI case settings saved.");
    }

    private async Task<AiSettingsResponse> SettingsResponseAsync(
        VipSettingsStore vip, AnthropicSettings anthropic, AdsSettings ads, CancellationToken ct)
    {
        var general = await _settings.GetAsync(ct);
        return new AiSettingsResponse
        {
            VipWeeklyOrderLimit = general.VipWeeklyOrderLimit,
            UpdatedAt = general.UpdatedAt,
            UpdatedByUserId = general.UpdatedByUserId,
            VipPricing = await vip.GetPricingAsync(ct),
            VipModels = await vip.GetModelsAsync(ct),
            HintPricing = await vip.GetHintsAsync(ct),
            AuthorRewards = await vip.GetAuthorsAsync(ct),
            // Whether a key is set, never the key itself.
            VipLaneConfigured = anthropic.IsConfigured,
            AdsEnabled = ads.IsActive
        };
    }

    /// <summary>
    /// VUAN-7: what a VIP order with this preset, speed and PixelLab cap costs, the caller's coins and whether the VIP lane
    /// is open (an API key is set). Nothing is held; the price is held when the order is placed.
    /// </summary>
    [HttpGet("vip-quote")]
    public async Task<ActionResult<ApiResponse<VipQuote>>> VipQuote(
        [FromQuery] string? preset, [FromQuery] string? speed, [FromQuery] int pixelLabCap,
        [FromServices] VipBillingService billing, CancellationToken ct) =>
        Ok(await billing.QuoteAsync(Caller.Id, preset, speed, pixelLabCap, ct));

    /// <summary>
    /// VUAN-7 part F: real cost of every VIP order (tokens, USD, VND by model), the price taken, profit or loss; averages
    /// by preset and speed; what cases earned from hints and ads; coins shared with authors.
    /// </summary>
    [HttpGet("vip-report")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<VipReportService.Report>>> VipReport(
        [FromServices] VipReportService report, [FromQuery] int days = 30, CancellationToken ct = default) =>
        Ok(await report.BuildAsync(days, ct));

    /// <summary>How many orders the caller has left this week (VIP); ADMIN orders are unlimited.</summary>
    [HttpGet("quota")]
    public async Task<ActionResult<ApiResponse<AiOrderQuotaResponse>>> GetQuota() =>
        Ok(await _aiCaseService.GetOrderQuotaAsync(Caller));

    /// <summary>The shared image library for the order form (places and NPCs), filtered by world and kind.</summary>
    [HttpGet("library")]
    public async Task<ActionResult<ApiResponse<List<AssetLibraryEntry>>>> Library(
        [FromQuery] string? world, [FromQuery] string? kind, CancellationToken ct) =>
        Ok(await _library.ListAsync(world, kind, ct));

    [HttpGet("capabilities")]
    public ActionResult<ApiResponse<AiCaseCapabilitiesResponse>> GetCapabilities() =>
        Ok(_aiCaseService.GetCapabilities());

    [HttpPost("artifacts/cleanup")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<AiArtifactCleanupReport>>> CleanupArtifacts(
        [FromQuery] bool apply = false,
        [FromQuery] int olderThanDays = 30,
        CancellationToken cancellationToken = default) =>
        Ok(await _artifactCleanupService.CleanupAsync(apply, olderThanDays, cancellationToken),
            apply ? "Stale AI artifacts were deleted." : "Dry-run completed; no files were changed.");

    [HttpPost]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> CreatePreview([FromBody] GenerateAiCaseRequest request)
    {
        var idempotencyKey = Request.Headers.TryGetValue("Idempotency-Key", out var header)
            ? header.ToString()
            : null;
        var draft = await _aiCaseService.CreatePreviewAsync(Caller, request, idempotencyKey);
        return Accepted(draft, draft.OrderStatus == AiOrderStatuses.AwaitingOwnerApproval
            ? "Order received; it waits for an admin to approve it."
            : "Order queued for Claude.");
    }

    /// <summary>The creator (or an admin) answers a question the bot asked; the bot then continues.</summary>
    [HttpPost("{draftId}/decisions/{decisionId}")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> AnswerDecision(
        string draftId, string decisionId, [FromBody] AiDecisionAnswerRequest request,
        [FromServices] AiDecisionService decisions, CancellationToken ct) =>
        Ok(await decisions.AnswerAsync(Caller, draftId, decisionId, request.OptionId, ct), "Answer saved; the bot continues.");

    [HttpPost("{draftId}/cancel")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> Cancel(string draftId) =>
        Ok(await _aiCaseService.CancelDraftAsync(Caller, draftId), "AI case generation was cancelled.");

    [HttpPost("{draftId}/approve")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> Approve(string draftId) =>
        Accepted(await _aiCaseService.ApproveDraftAsync(Caller, draftId), "Case truth generation was queued.");

    [HttpPost("{draftId}/approve-truth")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> ApproveTruth(string draftId) =>
        Accepted(await _aiCaseService.ApproveTruthAsync(Caller, draftId), "Gameplay projection generation was queued.");

    [HttpPost("{draftId}/repair-truth")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> RepairTruth(string draftId, [FromBody] RepairCaseTruthRequest request) =>
        Accepted(await _aiCaseService.RepairTruthAsync(Caller, draftId, request), "Case truth repair was queued.");

    [HttpPost("{draftId}/accept-truth-repair")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> AcceptTruthRepair(string draftId) =>
        Ok(await _aiCaseService.AcceptTruthRepairAsync(Caller, draftId), "Case truth repair candidate accepted; downstream artifacts were invalidated.");

    [HttpPost("{draftId}/reject-truth-repair")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> RejectTruthRepair(string draftId) =>
        Ok(await _aiCaseService.RejectTruthRepairAsync(Caller, draftId), "Case truth repair candidate rejected.");

    [HttpPost("{draftId}/approve-full-logic")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> ApproveFullLogic(string draftId) =>
        Accepted(await _aiCaseService.ApproveFullLogicAsync(Caller, draftId), "Scene layout generation was queued.");

    [HttpPost("{draftId}/approve-scene-layout")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> ApproveSceneLayout(string draftId) =>
        Accepted(await _aiCaseService.ApproveSceneLayoutAsync(Caller, draftId), "Final asset generation was queued.");

    [HttpPost("{draftId}/continue")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> Continue(string draftId) =>
        Accepted(await _aiCaseService.ContinueDraftAsync(Caller, draftId), "AI case generation was queued or is already running.");

    [HttpPost("{draftId}/repair-full-logic")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> RepairFullLogic(string draftId, [FromBody] RepairFullLogicRequest request) =>
        Ok(await _aiCaseService.RepairFullLogicAsync(Caller, draftId, request), "Full logic repair candidate generated.");

    [HttpPost("{draftId}/accept-repair")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> AcceptRepair(string draftId) =>
        Ok(await _aiCaseService.AcceptFullLogicRepairAsync(Caller, draftId), "Repair candidate accepted.");

    [HttpPost("{draftId}/reject-repair")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> RejectRepair(string draftId) =>
        Ok(await _aiCaseService.RejectFullLogicRepairAsync(Caller, draftId), "Repair candidate rejected.");

    [HttpPost("{draftId}/regenerate-assets")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> RegenerateAssets(string draftId) =>
        Accepted(await _aiCaseService.RegenerateAssetsAsync(Caller, draftId), "Asset regeneration was queued.");

    [HttpPost("{draftId}/retry-json")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> RetryJson(string draftId) =>
        Accepted(await _aiCaseService.RetryJsonAsync(Caller, draftId), "Case JSON repair was queued from the saved checkpoint.");

    [HttpPost("{draftId}/regenerate-failed-assets")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> RegenerateFailedAssets(string draftId) =>
        Accepted(await _aiCaseService.RegenerateFailedAssetsAsync(Caller, draftId), "Failed asset regeneration was queued.");

    [HttpPut("{draftId}/case-json")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> ReplaceCaseJson(
        string draftId,
        [FromBody] ReplaceAiDraftJsonRequest request) =>
        Ok(await _aiCaseService.ReplaceDraftJsonAsync(Caller, draftId, request), "Draft JSON replaced and reset to full-logic approval.");

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<AiDraftResponse>>>> GetDrafts() =>
        Ok(await _aiCaseService.GetDraftsAsync(Caller));

    [HttpGet("{draftId}")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> GetDraft(string draftId) =>
        Ok(await _aiCaseService.GetDraftAsync(Caller, draftId));

    [HttpPost("{draftId}/import")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> Import(string draftId, [FromQuery] bool overwrite = false) =>
        Ok(await _aiCaseService.ImportDraftAsync(Caller, draftId, overwrite, publish: false), "Draft imported as case.");

    [HttpPost("{draftId}/publish")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> Publish(string draftId, [FromQuery] bool overwrite = false) =>
        Ok(await _aiCaseService.ImportDraftAsync(Caller, draftId, overwrite, publish: true), "Draft imported and published.");
}

public sealed class AiDecisionAnswerRequest
{
    public string OptionId { get; set; } = string.Empty;
}

public sealed class AiOrderRejectRequest
{
    public string Reason { get; set; } = string.Empty;
}

public sealed class AiCaseSettingsRequest
{
    public int? VipWeeklyOrderLimit { get; set; }
    public VipPricingSettings? VipPricing { get; set; }
    public VipModelSettings? VipModels { get; set; }
    public HintPricingSettings? HintPricing { get; set; }
    public AuthorRewardSettings? AuthorRewards { get; set; }
}

/// <summary>Everything the "Cài đặt" card of /admin/ai edits.</summary>
public sealed class AiSettingsResponse
{
    public int VipWeeklyOrderLimit { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public string UpdatedByUserId { get; set; } = string.Empty;
    public VipPricingSettings VipPricing { get; set; } = new();
    public VipModelSettings VipModels { get; set; } = new();
    public HintPricingSettings HintPricing { get; set; } = new();
    public AuthorRewardSettings AuthorRewards { get; set; } = new();
    /// <summary>True when <c>Anthropic__ApiKey</c> is set on the server, so VIP orders can be taken.</summary>
    public bool VipLaneConfigured { get; set; }
    public bool AdsEnabled { get; set; }
}
