using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin/cases")]
[Authorize(Roles = "ADMIN")]
public class AdminCasesController : BaseApiController
{
    private readonly ICaseService _caseService;

    public AdminCasesController(ICaseService caseService) => _caseService = caseService;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryResponse>>>> GetAll() =>
        Ok(await _caseService.GetAllForAdminAsync());

    [HttpGet("{caseId}")]
    public async Task<ActionResult<ApiResponse<GameCase>>> GetDetail(string caseId) =>
        Ok(await _caseService.GetCaseAsync(caseId));

    [HttpPost("validate")]
    public ActionResult<ApiResponse<CaseValidationResponse>> Validate([FromBody] CaseJsonRequest request)
    {
        var result = _caseService.ValidateJson(request.CaseJson);
        return Ok(result, result.IsValid ? "Case is valid." : "Case validation failed.");
    }

    [HttpPost("import-json")]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> ImportJson([FromBody] CaseJsonRequest request) =>
        Ok(await _caseService.ImportJsonAsync(request.CaseJson, request.Overwrite), "Case imported as draft.");

    [HttpPatch("{caseId}/publish")]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> Publish(string caseId) =>
        Ok(await _caseService.PublishAsync(caseId), "Case published.");

    [HttpPatch("{caseId}/unpublish")]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> Unpublish(string caseId) =>
        Ok(await _caseService.UnpublishAsync(caseId), "Case unpublished.");

    [HttpPost("seed-sample")]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> SeedSample([FromQuery] bool publish = true) =>
        Ok(await _caseService.SeedSampleAsync(publish), "Sample case seeded.");

    [HttpPost("seed-demo")]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryResponse>>>> SeedDemo() =>
        Ok(await _caseService.SeedDemoAsync(), "Demo cases seeded.");

    [HttpPost("seed-crack-demo")]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryResponse>>>> SeedCrackDemo() =>
        Ok(await _caseService.SeedCrackDemoAsync(), "Crack demo cases seeded and published.");
}
