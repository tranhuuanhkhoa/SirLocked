using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// The single allow-list of room status transitions. Every legal pair is listed here and
/// anything absent is refused, so COMPLETED and ABANDONED rooms are terminal for good.
/// Adding a status means adding rows here, not scattering new checks through RoomService.
/// </summary>
internal static class RoomLifecycle
{
    /// <summary>Statuses a lobby mutation (join, role, ready, leave) may act on.</summary>
    internal static readonly IReadOnlyCollection<string> LobbyStatuses =
        new[] { RoomStatus.Waiting, RoomStatus.Ready };

    /// <summary>Statuses the host may start a game from; SetReadyAsync writes READY once both players are ready.</summary>
    internal static readonly IReadOnlyCollection<string> StartableStatuses =
        new[] { RoomStatus.Ready };

    private static readonly HashSet<string> Terminal = new(StringComparer.Ordinal)
    {
        RoomStatus.Completed,
        RoomStatus.Abandoned
    };

    private static readonly HashSet<(string From, string To)> Allowed = new()
    {
        (RoomStatus.Waiting, RoomStatus.Waiting),       // join, select role, unready, leave
        (RoomStatus.Waiting, RoomStatus.Ready),         // second player readies up with two distinct roles
        (RoomStatus.Ready, RoomStatus.Waiting),         // role change, unready, one player leaves
        (RoomStatus.Ready, RoomStatus.Ready),           // lobby write that does not change readiness
        (RoomStatus.Ready, RoomStatus.InProgress),      // host starts
        (RoomStatus.InProgress, RoomStatus.Completed),  // accusation resolved
        (RoomStatus.InProgress, RoomStatus.Abandoned)   // remaining member abandons after the grace period
    };

    internal static bool IsTerminal(string status) => Terminal.Contains(status);

    internal static bool CanTransition(string from, string to) => Allowed.Contains((from, to));

    internal static bool AllowsLobbyMutation(string status) => LobbyStatuses.Contains(status);

    internal static bool AllowsStart(string status) => StartableStatuses.Contains(status);
}
