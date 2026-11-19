using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MongoDB.Driver;
using MongoDB.Bson;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.TeamComms;

namespace SirLocked.Api.WebAPI.Hubs;

[Authorize]
public class GameHub : Hub
{
    private static readonly RoomPresenceTracker Presence = new();
    private static readonly ConcurrentDictionary<string, long> LastPoseTicks = new();
    private static readonly TimeSpan PoseInterval = TimeSpan.FromMilliseconds(50);
    private static readonly HashSet<string> PixelFacings = new(StringComparer.Ordinal)
    {
        "south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"
    };
    private readonly MongoDbContext _db;
    private readonly RoomDisconnectTimeoutService _disconnectTimeout;
    private readonly LobbyEntranceService _entrances;
    private readonly ILogger<GameHub> _logger;
    private static readonly CooperativePingPolicy PingPolicy = new();
    /// <summary>Who has the voice channel of each match open. In memory, like <see cref="Presence"/>.</summary>
    internal static readonly VoiceRoomRegistry Voice = new();
    private static readonly SlidingWindowLimiter VoiceSignals = SlidingWindowLimiter.ForVoiceSignals();
    public const string VoiceStateEvent = "VoiceState";
    public const string VoiceSignalEvent = "VoiceSignal";

    public GameHub(MongoDbContext db, RoomDisconnectTimeoutService disconnectTimeout, LobbyEntranceService entrances, ILogger<GameHub> logger)
    {
        _db = db;
        _disconnectTimeout = disconnectTimeout;
        _entrances = entrances;
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
        try
        {
            // After joining the group, so the arriving player sees their own entrance too.
            await _entrances.AnnounceAsync(roomId, userId!, Context.ConnectionAborted);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Cosmetic only: a player must still get into the room.
            _logger.LogWarning(error, "Could not announce the entrance of {UserId} in room {RoomId}.", userId, roomId);
        }
    }

    public async Task LeaveRoom(string roomId)
    {
        var userId = Context.UserIdentifier;
        if (!string.IsNullOrEmpty(userId) && Voice.Leave(roomId, userId, Context.ConnectionId))
            await AnnounceVoiceAsync(roomId, userId, inVoice: false, micOn: false);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, RoomGroup(roomId));
        Context.Items.Remove(RoomPlayerItemKey(roomId));
        JoinedRooms().TryRemove(roomId, out _);
        await UnregisterPresenceAsync(roomId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var (roomId, userId) in Voice.LeaveAll(Context.ConnectionId))
        {
            try
            {
                await AnnounceVoiceAsync(roomId, userId, inVoice: false, micOn: false);
            }
            catch (Exception error)
            {
                _logger.LogWarning(error, "Could not announce that {UserId} left voice in room {RoomId}.", userId, roomId);
            }
        }
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
        // Pixel scenes animate eight facings; anything else is dropped so clients fall back to direction.
        var facing = pose.Facing is { } requested && PixelFacings.Contains(requested) ? requested : null;

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
            facing,
            moving = pose.Moving,
            updatedAt = DateTime.UtcNow
        });
    }

    // ------------------------------------------------------------------ voice between the two detectives
    // The audio goes browser to browser (WebRTC). The server only checks who may talk and passes the set-up messages
    // (offer, answer, ICE candidates) from one player's open voice channel to the other's.

    /// <summary>Opens the caller's voice channel. Returns who already has theirs open; the one with the smaller id calls the other.</summary>
    public async Task<VoiceJoinResult> VoiceJoin(string roomId, bool micOn)
    {
        var userId = Context.UserIdentifier;
        if (!ObjectId.TryParse(roomId, out _)) throw new HubException("Voice is open only during a two-player match.");
        // Fresh read: a player who left the room must not get back into its voice channel.
        var room = await _db.Rooms.Find(r => r.Id == roomId).FirstOrDefaultAsync(Context.ConnectionAborted);
        if (!TeamCommsRules.CanTalk(room, userId)) throw new HubException("Voice is open only during a two-player match.");
        var (others, replaced) = Voice.Join(roomId, userId!, Context.ConnectionId, micOn);
        if (replaced is not null)
        {
            // The same player opened voice in another tab: the old tab closes its own.
            await Clients.Client(replaced.ConnectionId).SendAsync(VoiceStateEvent,
                new { roomId, userId, inVoice = false, micOn = false, replaced = true }, Context.ConnectionAborted);
        }
        await AnnounceVoiceAsync(roomId, userId!, inVoice: true, micOn, fresh: true);
        return new VoiceJoinResult(others.Select(member => new VoicePeerDto(member.UserId, member.MicOn)).ToList());
    }

    public async Task VoiceMic(string roomId, bool micOn)
    {
        var userId = Context.UserIdentifier;
        if (string.IsNullOrEmpty(userId) || Voice.SetMic(roomId, userId, Context.ConnectionId, micOn) is null)
            throw new HubException("Open voice first.");
        await AnnounceVoiceAsync(roomId, userId, inVoice: true, micOn);
    }

    public async Task VoiceLeave(string roomId)
    {
        var userId = Context.UserIdentifier;
        if (!string.IsNullOrEmpty(userId) && Voice.Leave(roomId, userId, Context.ConnectionId))
            await AnnounceVoiceAsync(roomId, userId, inVoice: false, micOn: false);
    }

    /// <summary>Passes one WebRTC set-up message to the partner, if both have voice open. Anything else is dropped.</summary>
    public async Task VoiceSignal(string roomId, string toUserId, VoiceSignalMessage signal)
    {
        var userId = Context.UserIdentifier;
        var from = string.IsNullOrEmpty(userId) ? null : Voice.Find(roomId, userId);
        if (from is null || from.ConnectionId != Context.ConnectionId) throw new HubException("Open voice first.");
        if (!TeamCommsRules.IsValidSignal(signal)) throw new HubException("Invalid voice signal.");
        if (string.IsNullOrEmpty(toUserId) || toUserId == userId) return;
        // The partner may have closed voice a moment ago: nothing to deliver.
        var to = Voice.Find(roomId, toUserId);
        if (to is null) return;
        if (!VoiceSignals.TryAcquire($"{roomId}:{userId}", DateTime.UtcNow)) return;
        await Clients.Client(to.ConnectionId).SendAsync(VoiceSignalEvent, new
        {
            roomId,
            fromUserId = userId,
            kind = signal.Kind,
            sdp = signal.Sdp,
            candidate = signal.Candidate,
            sdpMid = signal.SdpMid,
            sdpMLineIndex = signal.SdpMLineIndex
        }, Context.ConnectionAborted);
    }

    /// <summary>
    /// Tells the partner. <paramref name="fresh"/> marks a (re)opened channel: the partner then drops any connection it still
    /// holds to this player, because this side starts from nothing.
    /// </summary>
    private Task AnnounceVoiceAsync(string roomId, string userId, bool inVoice, bool micOn, bool fresh = false) =>
        Clients.OthersInGroup(RoomGroup(roomId)).SendAsync(VoiceStateEvent, new { roomId, userId, inVoice, micOn, fresh });

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
    /// <summary>Optional eight-way facing used by pixel scenes (south, south-east, east, ...).</summary>
    public string? Facing { get; set; }
    public bool Moving { get; set; }
}
