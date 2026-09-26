using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin/ai-cases")]
[Authorize(Roles = UserRole.Admin + "," + UserRole.Vip)]
public class AdminAiCasesController : BaseApiController
{
    private readonly IAiCaseService _aiCaseService;
    private readonly IAiArtifactCleanupService _artifactCleanupService;

    public AdminAiCasesController(
        IAiCaseService aiCaseService,
        IAiArtifactCleanupService artifactCleanupService)
    {
        _aiCaseService = aiCaseService;
        _artifactCleanupService = artifactCleanupService;
    }

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
        return Accepted(draft, "Story preview generation was queued.");
    }

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
