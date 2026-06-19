using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Workshop;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/workshop")]
[Authorize]
public class WorkshopController : BaseApiController
{
    private readonly IWorkshopService _workshop;

    public WorkshopController(IWorkshopService workshop) => _workshop = workshop;

    [HttpGet("cases")]
    public async Task<ActionResult<ApiResponse<WorkshopCaseListDto>>> GetCases(
        [FromQuery] string? search,
        [FromQuery] string? sort,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = WorkshopService.DefaultPageSize,
        CancellationToken ct = default) =>
        Ok(await _workshop.GetWorkshopCasesAsync(search, sort, page, pageSize, ct));

    [HttpGet("cases/{caseId}/stats")]
    public async Task<ActionResult<ApiResponse<CaseStatsDto>>> GetStats(
        string caseId, CancellationToken ct = default) =>
        Ok(await _workshop.GetCaseStatsAsync(caseId, ct));
}
