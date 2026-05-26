using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Room;
using SirLocked.API.Helpers;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize]
[Route("api/rooms")]
public sealed class RoomController : ControllerBase
{
    private readonly IRoomService _roomService;

    public RoomController(IRoomService roomService)
    {
        _roomService = roomService;
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateRoomRequest request, CancellationToken cancellationToken)
    {
        var room = await _roomService.CreateAsync(request, GetUserId(), GetFullName(), cancellationToken);
        return Ok(ApiResponse<RoomResponse>.Ok(room, "Room created."));
    }

    [HttpPost("join")]
    public async Task<IActionResult> Join(JoinRoomRequest request, CancellationToken cancellationToken)
    {
        var room = await _roomService.JoinAsync(request, GetUserId(), GetFullName(), cancellationToken);
        return room is null
            ? Conflict(ApiResponse<object>.Fail("Room not found or full."))
            : Ok(ApiResponse<RoomResponse>.Ok(room, "Room joined."));
    }

    [HttpGet("{roomId}")]
    public async Task<IActionResult> GetById(string roomId, CancellationToken cancellationToken)
    {
        var room = await _roomService.GetByIdAsync(roomId, cancellationToken);
        return room is null
            ? NotFound(ApiResponse<object>.Fail("Room not found."))
            : Ok(ApiResponse<RoomResponse>.Ok(room));
    }

    private string GetUserId() => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;
    private string GetFullName() => User.FindFirstValue(ClaimTypes.Name) ?? "Player";
}
