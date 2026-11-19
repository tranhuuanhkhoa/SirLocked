using Microsoft.AspNetCore.SignalR;
using SirLocked.Api.WebAPI.Hubs;

namespace SirLocked.Api.Services.Bridge;

/// <summary>Tells the studio machine that the bridge has work, so it never has to poll.</summary>
public interface IBridgeNotifier
{
    Task WorkAvailableAsync(CancellationToken ct = default);
}

/// <summary>
/// Sends <c>WorkAvailable</c> (no payload) to every machine connected to <c>/hubs/bridge</c>. A failed send is only
/// logged: the request stays in the database and the machine sees it when it (re)connects.
/// </summary>
public sealed class BridgeHubNotifier(IHubContext<BridgeHub> hub, ILogger<BridgeHubNotifier> logger) : IBridgeNotifier
{
    public const string WorkAvailableEvent = "WorkAvailable";

    public async Task WorkAvailableAsync(CancellationToken ct = default)
    {
        try
        {
            await hub.Clients.All.SendAsync(WorkAvailableEvent, ct);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Could not push WorkAvailable to the studio machine.");
        }
    }
}
