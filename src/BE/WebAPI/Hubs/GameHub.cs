using System.Collections.Concurrent;
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
    private static readonly TimeSpan ReconnectGracePeriod = TimeSpan.FromSeconds(30);
    private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> ActiveConnections = new();
    private static readonly ConcurrentDictionary<string, long> LastPoseTicks = new();
    private static readonly TimeSpan PoseInterval = TimeSpan.FromMilliseconds(50);
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
        var connectedAt = DateTime.UtcNow;
        var becameOnline = RegisterConnection(roomId, userId!, Context.ConnectionId);
        if (becameOnline)
        {
            await SetPresenceAsync(roomId, userId!, true, connectedAt);
        }
        await Clients.Group(RoomGroup(roomId)).SendAsync("PlayerPresenceChanged", new
        {
            roomId,
            userId,
            isConnected = true,
            changedAt = connectedAt,
            graceEndsAt = (DateTime?)null
        });
        // The initial GET can race the JoinRoom call. Return the authoritative
        // version so the client can reconcile only when it actually missed state.
        await Clients.Caller.SendAsync("RoomStateVersion", new
        {
            roomId,
            version = room.GameplayState?.Version ?? 0
        });
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
        if (UnregisterConnection(roomId, Context.UserIdentifier, Context.ConnectionId))
        {
            var disconnectedAt = DateTime.UtcNow;
            if (!string.IsNullOrWhiteSpace(Context.UserIdentifier))
                await SetPresenceAsync(roomId, Context.UserIdentifier, false, disconnectedAt);
            await Clients.Group(RoomGroup(roomId)).SendAsync("PlayerPresenceChanged", new
            {
                roomId,
                userId = Context.UserIdentifier,
                isConnected = false,
                changedAt = disconnectedAt,
                graceEndsAt = disconnectedAt.Add(ReconnectGracePeriod)
            });
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var roomId in JoinedRooms())
        {
            var disconnectedAt = DateTime.UtcNow;
            var becameOffline = UnregisterConnection(roomId, Context.UserIdentifier, Context.ConnectionId);
            if (becameOffline && !string.IsNullOrWhiteSpace(Context.UserIdentifier))
                await SetPresenceAsync(roomId, Context.UserIdentifier, false, disconnectedAt);
            await Clients.OthersInGroup(RoomGroup(roomId)).SendAsync("PlayerPoseLeft", new
            {
                roomId,
                userId = Context.UserIdentifier
            });
            if (becameOffline)
            {
                await Clients.OthersInGroup(RoomGroup(roomId)).SendAsync("PlayerPresenceChanged", new
                {
                    roomId,
                    userId = Context.UserIdentifier,
                    isConnected = false,
                    changedAt = disconnectedAt,
                    graceEndsAt = disconnectedAt.Add(ReconnectGracePeriod)
                });
            }
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

        var nowTicks = DateTime.UtcNow.Ticks;
        var poseKey = $"{roomId}:{player.UserId}";
        var previousTicks = LastPoseTicks.GetOrAdd(poseKey, 0);
        if (nowTicks - previousTicks < PoseInterval.Ticks)
        {
            return;
        }
        LastPoseTicks[poseKey] = nowTicks;
        if (!double.IsFinite(pose.X) || !double.IsFinite(pose.Y)) return;
        var x = Math.Clamp(pose.X, 0, 5000);
        var y = Math.Clamp(pose.Y, 0, 5000);
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

    private Task SetPresenceAsync(string roomId, string userId, bool connected, DateTime changedAt)
    {
        var update = connected
            ? Builders<GameRoom>.Update
                .Set("Players.$.IsConnected", true)
                .Set("Players.$.LastConnectedAt", changedAt)
                .Unset("Players.$.DisconnectedAt")
            : Builders<GameRoom>.Update
                .Set("Players.$.IsConnected", false)
                .Set("Players.$.DisconnectedAt", changedAt);
        return _db.Rooms.UpdateOneAsync(
            room => room.Id == roomId && room.Players.Any(player => player.UserId == userId),
            update);
    }

    private static bool RegisterConnection(string roomId, string userId, string connectionId)
    {
        var connections = ActiveConnections.GetOrAdd($"{roomId}:{userId}", _ => new ConcurrentDictionary<string, byte>());
        lock (connections)
        {
            var wasEmpty = connections.IsEmpty;
            connections[connectionId] = 0;
            return wasEmpty;
        }
    }

    private static bool UnregisterConnection(string roomId, string? userId, string connectionId)
    {
        if (string.IsNullOrWhiteSpace(userId)) return false;
        var key = $"{roomId}:{userId}";
        if (!ActiveConnections.TryGetValue(key, out var connections)) return false;
        lock (connections)
        {
            connections.TryRemove(connectionId, out _);
            if (!connections.IsEmpty) return false;
            ActiveConnections.TryRemove(key, out _);
            LastPoseTicks.TryRemove(key, out _);
            return true;
        }
    }

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
}
