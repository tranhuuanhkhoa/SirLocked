using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;

namespace SirLocked.Api.WebAPI.Hubs;

[Authorize]
public class GameHub : Hub
{
    private readonly MongoDbContext _db;

    public GameHub(MongoDbContext db) => _db = db;

    public static string RoomGroup(string roomId) => $"room-{roomId}";

    /// <summary>Clients call this after connect and after every reconnect, then refetch room/game state.</summary>
    public async Task JoinRoom(string roomId)
    {
        var userId = Context.UserIdentifier;
        var room = await _db.Rooms.Find(r => r.Id == roomId).FirstOrDefaultAsync();
        if (room is null || room.Players.All(p => p.UserId != userId))
        {
            await Clients.Caller.SendAsync("RoomError", new { roomId, message = "You are not a member of this room." });
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, RoomGroup(roomId));
    }

    public Task LeaveRoom(string roomId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, RoomGroup(roomId));
}
