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

    [HttpGet("{caseId}")]
    public async Task<IActionResult> GetById(string caseId, CancellationToken cancellationToken)
    {
        var gameCase = await _caseService.GetByIdAsync(caseId, cancellationToken);
        return gameCase is null
            ? NotFound(ApiResponse<object>.Fail("Case not found."))
            : Ok(ApiResponse<CaseDetailResponse>.Ok(gameCase));
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

        try
        {
            var imported = await _caseService.ImportAsync(request, cancellationToken);
            return Ok(ApiResponse<CaseDetailResponse>.Ok(imported, "Case imported."));
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPatch("{caseId}/publish")]
    public async Task<IActionResult> Publish(string caseId, CancellationToken cancellationToken)
    {
        try
        {
            var result = await _caseService.PublishAsync(caseId, cancellationToken);
            return result is null
                ? NotFound(ApiResponse<object>.Fail("Case not found."))
                : Ok(ApiResponse<CaseStatusResponse>.Ok(result, "Case published."));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPatch("{caseId}/unpublish")]
    public async Task<IActionResult> Unpublish(string caseId, CancellationToken cancellationToken)
    {
        var result = await _caseService.UnpublishAsync(caseId, cancellationToken);
        return result is null
            ? NotFound(ApiResponse<object>.Fail("Case not found."))
            : Ok(ApiResponse<CaseStatusResponse>.Ok(result, "Case unpublished."));
    }

    [HttpPost("seed-sample")]
    public async Task<IActionResult> SeedSample(CancellationToken cancellationToken)
    {
        var imported = await _caseService.SeedSampleAsync(cancellationToken);
        return Ok(ApiResponse<CaseDetailResponse>.Ok(imported, "Sample Week 2 case is ready."));
    }

    [HttpPost("seed-demo")]
    public async Task<IActionResult> SeedDemo(CancellationToken cancellationToken)
    {
        var cases = await _caseService.SeedDemoCasesAsync(cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<CaseDetailResponse>>.Ok(cases, "Demo cases are ready."));
    }
}
