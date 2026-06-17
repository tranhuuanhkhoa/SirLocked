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

    public AdminAiCasesController(IAiCaseService aiCaseService) => _aiCaseService = aiCaseService;

    [HttpPost]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> CreatePreview([FromBody] GenerateAiCaseRequest request)
    {
        var draft = await _aiCaseService.CreatePreviewAsync(Caller, request);
        return Ok(draft, "Story preview generated. Approve it to generate the full case logic.");
    }

    [HttpPost("{draftId}/approve")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> Approve(string draftId) =>
        Ok(await _aiCaseService.ApproveDraftAsync(Caller, draftId), "Full case logic generated. Review it before scene layout generation.");

    [HttpPost("{draftId}/approve-full-logic")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> ApproveFullLogic(string draftId) =>
        Ok(await _aiCaseService.ApproveFullLogicAsync(Caller, draftId), "Scene backgrounds and clue regions generated. Review the layout before publishing.");

    [HttpPost("{draftId}/approve-scene-layout")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> ApproveSceneLayout(string draftId) =>
        Ok(await _aiCaseService.ApproveSceneLayoutAsync(Caller, draftId), "Final assets generated. Review once more before publishing.");

    [HttpPost("{draftId}/continue")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> Continue(string draftId) =>
        Ok(await _aiCaseService.ContinueDraftAsync(Caller, draftId), "AI case generation continued.");

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
        Ok(await _aiCaseService.RegenerateAssetsAsync(Caller, draftId), "Assets regenerated with the current pipeline.");

    [HttpGet]
    [Authorize(Roles = UserRole.Admin)]
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
