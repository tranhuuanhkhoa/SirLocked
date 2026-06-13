using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;

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
        var player = room?.Players.FirstOrDefault(p => p.UserId == userId);
        if (room is null || player is null)
        {
            await Clients.Caller.SendAsync("RoomError", new { roomId, message = "You are not a member of this room." });
            return;
        }

        Context.Items[RoomPlayerItemKey(roomId)] = player;
        JoinedRooms().Add(roomId);
        await Groups.AddToGroupAsync(Context.ConnectionId, RoomGroup(roomId));
    }

    public async Task LeaveRoom(string roomId)
    {
        await Clients.OthersInGroup(RoomGroup(roomId)).SendAsync("PlayerPoseLeft", new
        {
            roomId,
            userId = Context.UserIdentifier
        });
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, RoomGroup(roomId));
        Context.Items.Remove(RoomPlayerItemKey(roomId));
        JoinedRooms().Remove(roomId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var roomId in JoinedRooms())
        {
            await Clients.OthersInGroup(RoomGroup(roomId)).SendAsync("PlayerPoseLeft", new
            {
                roomId,
                userId = Context.UserIdentifier
            });
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task UpdatePlayerPose(string roomId, PlayerPoseMessage pose)
    {
        var player = await GetRoomPlayerAsync(roomId);
        if (player is null)
        {
            await Clients.Caller.SendAsync("RoomError", new { roomId, message = "You are not a member of this room." });
            return;
        }

        var x = Math.Clamp(pose.X, 0, 5000);
        var y = Math.Clamp(pose.Y, 0, 5000);
        var viewportWidth = Math.Clamp(pose.ViewportWidth, 1, 10000);
        var viewportHeight = Math.Clamp(pose.ViewportHeight, 1, 10000);
        var direction = string.Equals(pose.Direction, "left", StringComparison.OrdinalIgnoreCase) ? "left" : "right";

        await Clients.OthersInGroup(RoomGroup(roomId)).SendAsync("PlayerPoseUpdated", new
        {
            roomId,
            userId = player.UserId,
            username = player.Username,
            role = player.Role,
            sceneId = pose.SceneId,
            x,
            y,
            direction,
            moving = pose.Moving,
            viewportWidth,
            viewportHeight,
            updatedAt = DateTime.UtcNow
        });
    }

    private async Task<RoomPlayer?> GetRoomPlayerAsync(string roomId)
    {
        if (Context.Items.TryGetValue(RoomPlayerItemKey(roomId), out var cached) && cached is RoomPlayer player)
        {
            return player;
        }

        var userId = Context.UserIdentifier ?? Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return null;

        var room = await _db.Rooms.Find(r => r.Id == roomId).FirstOrDefaultAsync();
        var roomPlayer = room?.Players.FirstOrDefault(p => p.UserId == userId);
        if (roomPlayer is not null)
        {
            Context.Items[RoomPlayerItemKey(roomId)] = roomPlayer;
        }

        return roomPlayer;
    }

    private static string RoomPlayerItemKey(string roomId) => $"room-player:{roomId}";

    private HashSet<string> JoinedRooms()
    {
        const string key = "joined-rooms";
        if (Context.Items.TryGetValue(key, out var rooms) && rooms is HashSet<string> roomSet)
        {
            return roomSet;
        }

        roomSet = new HashSet<string>();
        Context.Items[key] = roomSet;
        return roomSet;
    }
}

public class PlayerPoseMessage
{
    public string SceneId { get; set; } = string.Empty;
    public double X { get; set; }
    public double Y { get; set; }
    public string Direction { get; set; } = "right";
    public bool Moving { get; set; }
    public double ViewportWidth { get; set; } = 1600;
    public double ViewportHeight { get; set; } = 900;
}
