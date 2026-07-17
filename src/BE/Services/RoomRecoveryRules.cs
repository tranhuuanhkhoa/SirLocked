using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

internal static class RoomRecoveryRules
{
    internal static bool CanAbandon(RoomPlayer teammate, DateTime now, TimeSpan gracePeriod)
    {
        if (teammate.IsConnected || teammate.DisconnectedAt is null) return false;
        return teammate.DisconnectedAt.Value <= now.Subtract(gracePeriod);
    }
}
