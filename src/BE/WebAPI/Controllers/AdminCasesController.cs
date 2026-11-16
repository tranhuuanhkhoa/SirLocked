using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin/cases")]
[Authorize(Roles = "ADMIN")]
public class AdminCasesController : BaseApiController
{
    private readonly ICaseService _caseService;
    private readonly LegacyCaseCatalog _legacy;
    private readonly IHostEnvironment? _environment;

    public AdminCasesController(ICaseService caseService, LegacyCaseCatalog legacy, IHostEnvironment? environment = null)
    {
        _caseService = caseService;
        _legacy = legacy;
        _environment = environment;
    }

    /// <summary>
    /// Every case an admin works with. While the catalogue is pixel-only the older cases are hidden from this
    /// list; <c>?includeLegacy=true</c> shows them again (they are still stored, and open by id).
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryResponse>>>> GetAll([FromQuery] bool includeLegacy = false) =>
        Ok(_legacy.FilterAdminList(await _caseService.GetAllForAdminAsync(), includeLegacy));

    [HttpGet("{caseId}")]
    public async Task<ActionResult<ApiResponse<GameCase>>> GetDetail(string caseId) =>
        Ok(await _caseService.GetCaseAsync(caseId));

    [HttpPost("validate")]
    public async Task<ActionResult<ApiResponse<CaseValidationResponse>>> Validate([FromBody] CaseJsonRequest request)
    {
        var result = await _caseService.ValidateJsonForImportAsync(request.CaseJson);
        return Ok(result, result.IsValid ? "Case is valid." : "Case validation failed.");
    }

    /// <summary>
    /// Imports a case as an unpublished draft. <c>preserveServerMetadata</c> (keep the AI preset, contract versions and
    /// review stamps, as the bridge import does) is honoured only outside Production: the studio's local playtest
    /// stack uses it to load an AI case exactly as the server stored it.
    /// </summary>
    [HttpPost("import-json")]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> ImportJson([FromBody] CaseJsonRequest request)
    {
        var preserve = request.PreserveServerMetadata && _environment is not null && !_environment.IsProduction();
        return Ok(await _caseService.ImportJsonAsync(request.CaseJson, request.Overwrite, preserve), "Case imported as draft.");
    }

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

    [HttpPost("seed-point-click-demo")]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryResponse>>>> SeedPointClickDemo() =>
        Ok(await _caseService.SeedPointClickDemoAsync(), "Point-and-click cases seeded and published.");

    [HttpPost("seed-pixel-demo")]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryResponse>>>> SeedPixelDemo() =>
        Ok(await _caseService.SeedPixelDemoAsync(), "Pixel case seeded and published.");
}
