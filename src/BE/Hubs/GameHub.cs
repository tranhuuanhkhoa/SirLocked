using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Hubs;

[Authorize]
public sealed class GameHub : Hub
{
    private readonly IRoomRepository _rooms;

    public GameHub(IRoomRepository rooms)
    {
        _rooms = rooms;
    }

    public async Task JoinRoom(string roomId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("PlayerJoined", new { roomId, connectionId = Context.ConnectionId });
    }

    public async Task LeaveRoom(string roomId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("PlayerLeft", new { roomId, connectionId = Context.ConnectionId });
    }

    public async Task SendRoomMessage(string roomId, string message)
    {
        var userId = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;
        var fullName = Context.User?.FindFirstValue(ClaimTypes.Name) ?? "Player";
        var room = await _rooms.GetByIdAsync(roomId, Context.ConnectionAborted);
        if (room is null || room.Players.All(player => player.UserId != userId))
        {
            await Clients.Caller.SendAsync("RoomError", new { roomId, message = "User is not a room player." }, Context.ConnectionAborted);
            return;
        }

        var trimmed = message.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return;
        }

        var chatMessage = new RoomChatMessage
        {
            RoomId = roomId,
            UserId = userId,
            FullName = fullName,
            Message = trimmed.Length > 500 ? trimmed[..500] : trimmed
        };
        await _rooms.AddMessageAsync(chatMessage, Context.ConnectionAborted);

        await Clients.Group(roomId).SendAsync("RoomMessageReceived", new
        {
            id = chatMessage.Id ?? string.Empty,
            chatMessage.RoomId,
            chatMessage.UserId,
            chatMessage.FullName,
            chatMessage.Message,
            chatMessage.SentAt
        }, Context.ConnectionAborted);
    }
}
