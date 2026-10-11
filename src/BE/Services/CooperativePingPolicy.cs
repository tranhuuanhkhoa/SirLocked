using System.Collections.Concurrent;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>Ephemeral coordination only; deliberately contains no clue, scene or location payload.</summary>
public sealed class CooperativePingPolicy
{
    private readonly ConcurrentDictionary<string, long> _lastSent = new();
    private int _calls;
    public static readonly TimeSpan Cooldown = TimeSpan.FromSeconds(3);
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(8);
    public static bool IsKind(string kind) => kind is "DISCOVERY" or "COMPARE" or "WAITING";
    public static bool CanSend(GameRoom? room, string? userId, string kind) =>
        IsKind(kind) && room?.Status == RoomStatus.InProgress && !string.IsNullOrEmpty(userId)
        && room.Players.Any(p => p.UserId == userId);

    public bool TryAcquire(string roomId, string userId, DateTime utcNow)
    {
        var key = roomId + ":" + userId;
        var now = utcNow.Ticks;
        while (true)
        {
            if (!_lastSent.TryGetValue(key, out var previous))
            {
                if (_lastSent.TryAdd(key, now)) break;
                continue;
            }
            if (now - previous < Cooldown.Ticks) return false;
            if (_lastSent.TryUpdate(key, now, previous)) break;
        }
        if (Interlocked.Increment(ref _calls) % 128 == 0)
            foreach (var entry in _lastSent)
                if (now - entry.Value > Lifetime.Ticks)
                    ((ICollection<KeyValuePair<string, long>>)_lastSent).Remove(entry);
        return true;
    }
}
