using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MongoDB.Driver;
using MongoDB.Bson;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services;

namespace SirLocked.Api.WebAPI.Hubs;

[Authorize]
public class GameHub : Hub
{
    private static readonly RoomPresenceTracker Presence = new();
    private static readonly ConcurrentDictionary<string, long> LastPoseTicks = new();
    private static readonly TimeSpan PoseInterval = TimeSpan.FromMilliseconds(50);
    private readonly MongoDbContext _db;
    private readonly RoomDisconnectTimeoutService _disconnectTimeout;
    private readonly ILogger<GameHub> _logger;
    private static readonly CooperativePingPolicy PingPolicy = new();

    public GameHub(MongoDbContext db, RoomDisconnectTimeoutService disconnectTimeout, ILogger<GameHub> logger)
    {
        _db = db;
        _disconnectTimeout = disconnectTimeout;
        _logger = logger;
    }

    public static string RoomGroup(string roomId) => $"room-{roomId}";

    public async Task SendPing(string roomId, string kind)
    {
        if (!ObjectId.TryParse(roomId, out _) || !CooperativePingPolicy.IsKind(kind))
            throw new HubException("Invalid team ping.");
        var userId = Context.UserIdentifier;
        // Fresh membership/status read: cached presence is insufficient after a player leaves a room.
        var room = await _db.Rooms.Find(r => r.Id == roomId).FirstOrDefaultAsync(Context.ConnectionAborted);
        if (!CooperativePingPolicy.CanSend(room, userId, kind))
            throw new HubException("Team pings are available only to members of an active match.");
        var now = DateTime.UtcNow;
        if (!PingPolicy.TryAcquire(roomId, userId!, now))
            throw new HubException("Please wait three seconds before sending another ping.");
        await Clients.OthersInGroup(RoomGroup(roomId)).SendAsync("TeamPing", new
        {
            roomId, kind, senderUserId = userId, expiresAt = now.Add(CooperativePingPolicy.Lifetime)
        }, Context.ConnectionAborted);
    }

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
        JoinedRooms().TryAdd(roomId, 0);
        await Groups.AddToGroupAsync(Context.ConnectionId, RoomGroup(roomId), Context.ConnectionAborted);
        await Presence.TryRegisterAsync(
            roomId, userId!, Context.ConnectionId,
            transition => TryPersistAndNotifyOnlineAsync(roomId, userId!, transition),
            async now => !await _disconnectTimeout.ExpireRoomIfNeededAsync(roomId, now, Context.ConnectionAborted),
            Context.ConnectionAborted);
        // The deadline check may have ended the room. A returning player must still receive
        // its terminal version and refetch the ended state instead of reviving the match.
        room = await _db.Rooms.Find(candidate => candidate.Id == roomId).FirstOrDefaultAsync() ?? room;
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
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, RoomGroup(roomId));
        Context.Items.Remove(RoomPlayerItemKey(roomId));
        JoinedRooms().TryRemove(roomId, out _);
        await UnregisterPresenceAsync(roomId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var roomId in JoinedRooms().Keys)
        {
            try
            {
                await UnregisterPresenceAsync(roomId);
            }
            catch (Exception error)
            {
                // Clean the other joined rooms even when one persistence/notification failed.
                _logger.LogWarning(error, "Could not persist disconnected presence for room {RoomId}.", roomId);
            }
            Context.Items.Remove(RoomPlayerItemKey(roomId));
            JoinedRooms().TryRemove(roomId, out _);
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

    private Task UnregisterPresenceAsync(string roomId)
    {
        var userId = Context.UserIdentifier;
        return string.IsNullOrWhiteSpace(userId)
            ? Task.CompletedTask
            : Presence.UnregisterAsync(roomId, userId, Context.ConnectionId,
                transition => PersistAndNotifyPresenceAsync(roomId, userId, transition));
    }

    private async Task PersistAndNotifyPresenceAsync(string roomId, string userId, RoomPresenceTransition transition)
    {
        await SetPresenceAsync(roomId, userId, transition.IsConnected, transition.ChangedAt);
        await NotifyPresenceAsync(roomId, userId, transition);
    }

    private async Task<bool> TryPersistAndNotifyOnlineAsync(string roomId, string userId, RoomPresenceTransition transition)
    {
        var result = await _db.Rooms.UpdateOneAsync(
            RoomPresenceWriteRules.ReconnectFilter(roomId, userId),
            Builders<GameRoom>.Update
                .Set("Players.$.IsConnected", true)
                .Set("Players.$.LastConnectedAt", transition.ChangedAt)
                .Unset("Players.$.DisconnectedAt"));
        if (result.MatchedCount == 0)
        {
            // The deadline may have elapsed while the preliminary check was in flight.
            // No online event is emitted; JoinRoom still sends the terminal state version.
            await _disconnectTimeout.ExpireRoomIfNeededAsync(roomId, DateTime.UtcNow);
            return false;
        }
        await NotifyPresenceAsync(roomId, userId, transition);
        return true;
    }

    private async Task NotifyPresenceAsync(string roomId, string userId, RoomPresenceTransition transition)
    {
        if (!transition.IsConnected)
        {
            LastPoseTicks.TryRemove($"{roomId}:{userId}", out _);
            // Closing one tab must not remove the avatar belonging to another live tab.
            await Clients.Group(RoomGroup(roomId)).SendAsync("PlayerPoseLeft", new { roomId, userId });
        }
        await Clients.Group(RoomGroup(roomId)).SendAsync("PlayerPresenceChanged", new
        {
            roomId,
            userId,
            isConnected = transition.IsConnected,
            changedAt = transition.ChangedAt,
            graceEndsAt = transition.IsConnected ? (DateTime?)null : transition.ChangedAt.Add(RoomService.DisconnectGracePeriod)
        });
    }

    private ConcurrentDictionary<string, byte> JoinedRooms()
    {
        const string key = "joined-rooms";
        lock (Context.Items)
        {
            if (Context.Items.TryGetValue(key, out var rooms) && rooms is ConcurrentDictionary<string, byte> existing) return existing;
            var roomSet = new ConcurrentDictionary<string, byte>();
            Context.Items[key] = roomSet;
            return roomSet;
        }
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
