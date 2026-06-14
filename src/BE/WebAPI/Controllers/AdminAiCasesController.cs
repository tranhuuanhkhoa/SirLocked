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
        var draft = await _aiCaseService.CreatePreviewAsync(request);
        return Ok(draft, "Story preview generated. Approve it to generate and publish the full case.");
    }

    [HttpPost("{draftId}/approve")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> Approve(string draftId) =>
        Ok(await _aiCaseService.ApproveDraftAsync(draftId), "Full case generated and published.");

    [HttpPost("{draftId}/regenerate-assets")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> RegenerateAssets(string draftId) =>
        Ok(await _aiCaseService.RegenerateAssetsAsync(draftId), "Assets regenerated with the current pipeline and published.");

    [HttpGet]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<List<AiDraftResponse>>>> GetDrafts() =>
        Ok(await _aiCaseService.GetDraftsAsync());

    [HttpGet("{draftId}")]
    public async Task<ActionResult<ApiResponse<AiDraftResponse>>> GetDraft(string draftId) =>
        Ok(await _aiCaseService.GetDraftAsync(draftId));

    [HttpPost("{draftId}/import")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> Import(string draftId, [FromQuery] bool overwrite = false) =>
        Ok(await _aiCaseService.ImportDraftAsync(draftId, overwrite, publish: false), "Draft imported as case.");

    [HttpPost("{draftId}/publish")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> Publish(string draftId, [FromQuery] bool overwrite = false) =>
        Ok(await _aiCaseService.ImportDraftAsync(draftId, overwrite, publish: true), "Draft imported and published.");
}
