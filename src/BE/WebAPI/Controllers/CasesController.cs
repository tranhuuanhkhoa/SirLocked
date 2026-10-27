using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Cutscene;
using SirLocked.Api.Services.Cutscene;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/cases")]
[Authorize]
public class CasesController : BaseApiController
{
    private readonly ICaseService _caseService;
    private readonly CutsceneService _cutscenes;

    public CasesController(ICaseService caseService, CutsceneService cutscenes)
    {
        _caseService = caseService;
        _cutscenes = cutscenes;
    }

    [HttpGet("published")]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryResponse>>>> GetPublished() =>
        Ok(await _caseService.GetPublishedAsync());

    [HttpGet("{caseId}")]
    public async Task<ActionResult<ApiResponse<CasePublicDetailResponse>>> GetDetail(string caseId) =>
        Ok(await _caseService.GetPublicDetailAsync(caseId));

    /// <summary>
    /// The approved intro cutscene of a case a player can open. <c>data</c> is null when there is none (also for hidden
    /// or unpublished cases and drafts), which the client treats as "go straight to the investigation".
    /// </summary>
    [HttpGet("{caseId}/intro-cutscene")]
    public async Task<ActionResult<ApiResponse<PlayerCutsceneDto?>>> GetIntroCutscene(string caseId, CancellationToken ct) =>
        Ok(await _cutscenes.GetPlayerIntroAsync(caseId, ct));
}
