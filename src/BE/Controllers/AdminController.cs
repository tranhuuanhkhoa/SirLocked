using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Admin;
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
}
