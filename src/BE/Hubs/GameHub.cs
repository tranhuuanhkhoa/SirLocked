using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace SirLocked.API.Hubs;

[Authorize]
public sealed class GameHub : Hub
{
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
        await Clients.Group(roomId).SendAsync("RoomMessageReceived", new
        {
            roomId,
            message,
            sentAt = DateTime.UtcNow
        });
    }
}
