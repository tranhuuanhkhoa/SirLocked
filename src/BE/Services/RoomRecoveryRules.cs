using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

internal static class RoomRecoveryRules
{
    internal static readonly TimeSpan DisconnectTimeout = TimeSpan.FromMinutes(5);

    internal static DateTime? ReconnectDeadline(RoomPlayer player, DateTime? matchStartedAt)
    {
        if (player.IsConnected || matchStartedAt is null) return null;
        var disconnectedAt = player.DisconnectedAt ?? matchStartedAt.Value;
        // Lobby time never consumes a newly-started game's reconnect grace.
        if (disconnectedAt < matchStartedAt.Value) disconnectedAt = matchStartedAt.Value;
        return disconnectedAt.Add(DisconnectTimeout);
    }

    internal static bool CanAbandon(GameRoom room, RoomPlayer teammate, DateTime now) =>
        room.Status == RoomStatus.InProgress
        && room.GameplayState is { GameStatus: GameStatus.InProgress } state
        && ReconnectDeadline(teammate, state.StartedAt) is DateTime deadline && deadline <= now;
}
