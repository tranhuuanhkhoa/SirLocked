using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Rooms still open or being played, and closing the ones that hung.</summary>
[Route("api/admin/rooms")]
[Authorize(Roles = UserRole.Admin)]
public class AdminRoomsController : BaseApiController
{
    private readonly AdminRoomsService _rooms;

    public AdminRoomsController(AdminRoomsService rooms) => _rooms = rooms;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminRoomRowDto>>>> List(
        [FromQuery] string? status,
        [FromQuery] string? q,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = AdminPlayersRules.DefaultPageSize,
        CancellationToken ct = default) =>
        Ok(await _rooms.ListAsync(new AdminRoomQuery(status, q, page, pageSize), ct));

    [HttpPost("{roomId}/close")]
    public async Task<ActionResult<ApiResponse<AdminRoomRowDto>>> Close(string roomId, [FromBody] AdminReasonRequest request, CancellationToken ct) =>
        Ok(await _rooms.CloseAsync(Caller, roomId, request.Reason, ct), "Đã đóng phòng.");
}
