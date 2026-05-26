using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Admin;
using SirLocked.API.DTOs.Investigation;
using SirLocked.API.DTOs.Room;
using SirLocked.API.Helpers;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize(Policy = "AdminOnly")]
[Route("api/admin")]
public sealed class AdminController : ControllerBase
{
    private readonly IAdminService _adminService;

    public AdminController(IAdminService adminService)
    {
        _adminService = adminService;
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard(CancellationToken cancellationToken)
    {
        var dashboard = await _adminService.GetDashboardAsync(cancellationToken);
        return Ok(ApiResponse<AdminDashboardResponse>.Ok(dashboard));
    }

    [HttpGet("rooms")]
    public async Task<IActionResult> Rooms(CancellationToken cancellationToken)
    {
        var rooms = await _adminService.GetRoomsAsync(cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<RoomResponse>>.Ok(rooms));
    }

    [HttpGet("logs")]
    public async Task<IActionResult> Logs(CancellationToken cancellationToken)
    {
        var logs = await _adminService.GetActionLogsAsync(cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<AdminActionLogResponse>>.Ok(logs));
    }

    [HttpGet("results")]
    public async Task<IActionResult> Results(CancellationToken cancellationToken)
    {
        var results = await _adminService.GetResultsAsync(cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<GameResultResponse>>.Ok(results));
    }
}
