using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/cases")]
[Authorize]
public class CasesController : BaseApiController
{
    private readonly ICaseService _caseService;

    public CasesController(ICaseService caseService) => _caseService = caseService;

    [HttpGet("published")]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryResponse>>>> GetPublished() =>
        Ok(await _caseService.GetPublishedAsync());

    [HttpGet("{caseId}")]
    public async Task<ActionResult<ApiResponse<CasePublicDetailResponse>>> GetDetail(string caseId) =>
        Ok(await _caseService.GetPublicDetailAsync(caseId));
}
