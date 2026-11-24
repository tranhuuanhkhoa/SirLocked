using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin/metrics")]
[Authorize(Roles = "ADMIN")]
public sealed class AdminMetricsController(AdminMetricsService metrics) : BaseApiController
{
    [HttpGet("activity")]
    public async Task<ActionResult<ApiResponse<AdminActivityMetrics>>> Activity(
        [FromQuery] int days = 30,
        CancellationToken cancellationToken = default) =>
        Ok(await metrics.GetActivityAsync(Math.Clamp(days, 7, 90), cancellationToken));

    [HttpGet("revenue")]
    [Authorize(Policy = AdminPolicies.Economy)]
    public async Task<ActionResult<ApiResponse<AdminRevenueMetrics>>> Revenue(
        [FromQuery] int days = 30,
        CancellationToken cancellationToken = default) =>
        Ok(await metrics.GetRevenueAsync(Math.Clamp(days, 7, 90), cancellationToken));
}
