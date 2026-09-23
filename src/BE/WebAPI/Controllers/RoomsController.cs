using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/rooms")]
[Authorize]
public class RoomsController : BaseApiController
{
    private readonly IRoomService _roomService;

    public RoomsController(IRoomService roomService) => _roomService = roomService;

    [HttpPost]
    public async Task<ActionResult<ApiResponse<RoomResponse>>> Create([FromBody] CreateRoomRequest request) =>
        Ok(await _roomService.CreateAsync(Caller, request.CaseId), "Room created.");

    [HttpPost("join")]
    public async Task<ActionResult<ApiResponse<RoomResponse>>> Join([FromBody] JoinRoomRequest request) =>
        Ok(await _roomService.JoinAsync(Caller, request.RoomCode), "Joined room.");

    [HttpGet("{roomId}")]
    public async Task<ActionResult<ApiResponse<RoomResponse>>> Get(string roomId) =>
        Ok(await _roomService.GetAsync(CallerId, roomId));

    [HttpPost("{roomId}/leave")]
    public async Task<ActionResult<ApiResponse<RoomResponse?>>> Leave(string roomId) =>
        Ok(await _roomService.LeaveAsync(Caller, roomId), "Left room.");

    [HttpPost("{roomId}/select-role")]
    public async Task<ActionResult<ApiResponse<RoomResponse>>> SelectRole(string roomId, [FromBody] SelectRoleRequest request) =>
        Ok(await _roomService.SelectRoleAsync(Caller, roomId, request.Role), "Role selected.");

    [HttpPost("{roomId}/ready")]
    public async Task<ActionResult<ApiResponse<RoomResponse>>> Ready(string roomId, [FromBody] ReadyRequest request) =>
        Ok(await _roomService.SetReadyAsync(Caller, roomId, request.IsReady), "Ready state updated.");

    [HttpPost("{roomId}/start")]
    public async Task<ActionResult<ApiResponse<RoomResponse>>> Start(string roomId) =>
        Ok(await _roomService.StartAsync(Caller, roomId), "Game started.");

    [HttpPost("{roomId}/abandon")]
    public async Task<ActionResult<ApiResponse<RoomResponse>>> Abandon(string roomId) =>
        Ok(await _roomService.AbandonAsync(Caller, roomId), "Game abandoned.");
}
