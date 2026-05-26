using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Room;
using SirLocked.API.Helpers;
using SirLocked.API.Hubs;
using SirLocked.API.Models;
using SirLocked.API.Repositories;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize]
[Route("api/rooms")]
public sealed class RoomController : ControllerBase
{
    private readonly IRoomService _roomService;
    private readonly IRoomRepository _roomRepository;
    private readonly IHubContext<GameHub> _hubContext;

    public RoomController(IRoomService roomService, IRoomRepository roomRepository, IHubContext<GameHub> hubContext)
    {
        _roomService = roomService;
        _roomRepository = roomRepository;
        _hubContext = hubContext;
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateRoomRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var room = await _roomService.CreateAsync(request, GetUserId(), GetFullName(), cancellationToken);
            return Ok(ApiResponse<RoomResponse>.Ok(room, "Room created."));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPost("join")]
    public async Task<IActionResult> Join(JoinRoomRequest request, CancellationToken cancellationToken)
    {
        var room = await _roomService.JoinAsync(request, GetUserId(), GetFullName(), cancellationToken);
        if (room is null)
        {
            return Conflict(ApiResponse<object>.Fail("Room not found, already started, or full."));
        }

        await _hubContext.Clients.Group(room.Id).SendAsync("RoomUpdated", room, cancellationToken);
        return Ok(ApiResponse<RoomResponse>.Ok(room, "Room joined."));
    }

    [HttpGet("{roomId}")]
    public async Task<IActionResult> GetById(string roomId, CancellationToken cancellationToken)
    {
        var room = await _roomService.GetByIdAsync(roomId, cancellationToken);
        return room is null
            ? NotFound(ApiResponse<object>.Fail("Room not found."))
            : Ok(ApiResponse<RoomResponse>.Ok(room));
    }

    [HttpGet("{roomId}/messages")]
    public async Task<IActionResult> GetMessages(string roomId, CancellationToken cancellationToken)
    {
        var room = await _roomRepository.GetByIdAsync(roomId, cancellationToken);
        if (room is null)
        {
            return NotFound(ApiResponse<object>.Fail("Room not found."));
        }

        if (room.Players.All(player => player.UserId != GetUserId()))
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<object>.Fail("User is not a room player."));
        }

        var messages = await _roomRepository.GetRecentMessagesAsync(roomId, 50, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<RoomChatMessageResponse>>.Ok(messages.Select(MapMessage).ToList()));
    }

    [HttpPatch("{roomId}/ready")]
    public async Task<IActionResult> Ready(string roomId, ReadyRequest request, CancellationToken cancellationToken)
    {
        var room = await _roomService.SetReadyAsync(roomId, GetUserId(), request, cancellationToken);
        if (room is null)
        {
            return NotFound(ApiResponse<object>.Fail("Room/player not found or room already started."));
        }

        await _hubContext.Clients.Group(room.Id).SendAsync("RoomUpdated", room, cancellationToken);
        await _hubContext.Clients.Group(room.Id).SendAsync("ReadyUpdated", room, cancellationToken);
        return Ok(ApiResponse<RoomResponse>.Ok(room, "Ready state updated."));
    }

    [HttpPatch("{roomId}/role")]
    public async Task<IActionResult> SelectRole(string roomId, SelectRoleRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var room = await _roomService.SelectRoleAsync(roomId, GetUserId(), request, cancellationToken);
            if (room is null)
            {
                return Conflict(ApiResponse<object>.Fail("Role unavailable or room/player not found."));
            }

            await _hubContext.Clients.Group(room.Id).SendAsync("RoomUpdated", room, cancellationToken);
            await _hubContext.Clients.Group(room.Id).SendAsync("RolesUpdated", room, cancellationToken);
            return Ok(ApiResponse<RoomResponse>.Ok(room, "Role selected."));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPost("{roomId}/start")]
    public async Task<IActionResult> Start(string roomId, CancellationToken cancellationToken)
    {
        try
        {
            var room = await _roomService.StartAsync(roomId, GetUserId(), cancellationToken);
            if (room is null)
            {
                return NotFound(ApiResponse<object>.Fail("Room not found or already started."));
            }

            await _hubContext.Clients.Group(room.Id).SendAsync("GameStarted", room, cancellationToken);
            return Ok(ApiResponse<RoomResponse>.Ok(room, "Game started."));
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<object>.Fail(ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPost("{roomId}/leave")]
    public async Task<IActionResult> Leave(string roomId, CancellationToken cancellationToken)
    {
        var room = await _roomService.LeaveAsync(roomId, GetUserId(), cancellationToken);
        if (room is null)
        {
            return NotFound(ApiResponse<object>.Fail("Room/player not found."));
        }

        await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", room, cancellationToken);
        await _hubContext.Clients.Group(room.Id).SendAsync("RoomUpdated", room, cancellationToken);
        return Ok(ApiResponse<RoomResponse>.Ok(room, "Left room."));
    }

    private string GetUserId() => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;
    private string GetFullName() => User.FindFirstValue(ClaimTypes.Name) ?? "Player";

    private static RoomChatMessageResponse MapMessage(RoomChatMessage message)
    {
        return new RoomChatMessageResponse
        {
            Id = message.Id ?? string.Empty,
            RoomId = message.RoomId,
            UserId = message.UserId,
            FullName = message.FullName,
            Message = message.Message,
            SentAt = message.SentAt
        };
    }
}
