using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Case;
using SirLocked.API.Helpers;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize]
[Route("api/cases")]
public sealed class CaseController : ControllerBase
{
    private readonly ICaseService _caseService;

    public CaseController(ICaseService caseService)
    {
        _caseService = caseService;
    }

    [HttpGet("published")]
    public async Task<IActionResult> GetPublished(CancellationToken cancellationToken)
    {
        var cases = await _caseService.GetPublishedAsync(cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<CaseListResponse>>.Ok(cases));
    }

    [HttpGet("{caseId}")]
    public async Task<IActionResult> GetById(string caseId, CancellationToken cancellationToken)
    {
        var gameCase = await _caseService.GetByIdAsync(caseId, cancellationToken);
        return gameCase is null
            ? NotFound(ApiResponse<object>.Fail("Case not found."))
            : Ok(ApiResponse<CaseDetailResponse>.Ok(gameCase));
    }
}
