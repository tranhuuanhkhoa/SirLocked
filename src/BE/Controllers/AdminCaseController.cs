using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Case;
using SirLocked.API.Helpers;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize(Policy = "AdminOnly")]
[Route("api/admin/cases")]
public sealed class AdminCaseController : ControllerBase
{
    private readonly ICaseService _caseService;

    public AdminCaseController(ICaseService caseService)
    {
        _caseService = caseService;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
    {
        var cases = await _caseService.GetAllAsync(cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<CaseListResponse>>.Ok(cases));
    }

    [HttpPost("validate")]
    public async Task<IActionResult> Validate(ImportCaseRequest request, CancellationToken cancellationToken)
    {
        var result = await _caseService.ValidateAsync(request, cancellationToken);
        return Ok(ApiResponse<CaseValidationResult>.Ok(result));
    }

    [HttpPost("import-json")]
    public async Task<IActionResult> ImportJson(ImportCaseRequest request, CancellationToken cancellationToken)
    {
        var validation = await _caseService.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            return BadRequest(ApiResponse<CaseValidationResult>.Fail(string.Join("; ", validation.Errors)));
        }

        var imported = await _caseService.ImportAsync(request, cancellationToken);
        return Ok(ApiResponse<CaseDetailResponse>.Ok(imported, "Case imported."));
    }
}
