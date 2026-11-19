using Microsoft.AspNetCore.SignalR;
using SirLocked.Api.DTOs.Matchmaking;
using SirLocked.Api.WebAPI.Hubs;

namespace SirLocked.Api.Services;

/// <summary>Pushes one player's personalised matchmaking state to every hub connection of that user.</summary>
public interface IMatchmakingNotifier
{
    /// <summary>
    /// Sends "MatchmakingUpdated" with the caller's status. Clients treat the push as a hint and
    /// may also poll GET /api/matchmaking/status, so a lost message only delays the update.
    /// </summary>
    Task StatusChanged(string userId, MatchmakingStatusResponse status);
}

/// <summary>
/// Targets users, not room groups: GameHub is [Authorize] and SignalR's default user id is the JWT
/// NameIdentifier claim (the same Context.UserIdentifier the hub already uses for room membership),
/// so Clients.User(userId) reaches every tab that user has connected, without a room join.
/// </summary>
public sealed class MatchmakingNotifier(IHubContext<GameHub> hub, ILogger<MatchmakingNotifier> logger) : IMatchmakingNotifier
{
    public const string StatusEvent = "MatchmakingUpdated";

    public async Task StatusChanged(string userId, MatchmakingStatusResponse status)
    {
        try
        {
            await hub.Clients.User(userId).SendAsync(StatusEvent, status);
        }
        catch (Exception error)
        {
            // Delivery is best effort; polling recovers the state.
            logger.LogWarning(error, "Could not push matchmaking status to user {UserId}.", userId);
        }
    }
}
