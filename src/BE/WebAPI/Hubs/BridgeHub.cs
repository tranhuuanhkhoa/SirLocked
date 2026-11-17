using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.WebAPI.Controllers;

namespace SirLocked.Api.WebAPI.Hubs;

/// <summary>
/// Push channel of the studio runner. The <c>X-Bridge-Key</c> header is checked by <see cref="BridgeHubKeyGate"/>
/// before any request reaches the hub, so JWTs play no part here. The server only says "there is work"; the runner then
/// asks <see cref="PendingCount"/> and starts the bot.
/// </summary>
[AllowAnonymous]
public sealed class BridgeHub : Hub
{
    public const string Path = "/hubs/bridge";

    /// <summary>A machine that just connected may have missed work while it was off: tell it to look.</summary>
    public override async Task OnConnectedAsync()
    {
        await Clients.Caller.SendAsync(BridgeHubNotifier.WorkAvailableEvent);
        await base.OnConnectedAsync();
    }

    /// <summary>How many requests the bot could take now (the same list as GET /api/bridge/requests?status=PENDING).</summary>
    public async Task<int> PendingCount(AiBridgeService bridge) =>
        (await bridge.ListRequestsAsync(AiBridgeStatuses.Pending, 500, Context.ConnectionAborted)).Count;
}

/// <summary>Refuses every <c>/hubs/bridge</c> request without the configured bridge key (header only, never the URL).</summary>
public static class BridgeHubKeyGate
{
    public static IApplicationBuilder UseBridgeHubKeyGate(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (!context.Request.Path.StartsWithSegments(BridgeHub.Path))
            {
                await next();
                return;
            }
            var settings = context.RequestServices.GetRequiredService<IOptions<BridgeSettings>>().Value;
            if (!settings.IsConfigured)
            {
                await Refuse(context, StatusCodes.Status503ServiceUnavailable, "The Claude bridge is not configured on this server.", "BRIDGE_NOT_CONFIGURED");
                return;
            }
            var supplied = context.Request.Headers[BridgeKeyAttribute.HeaderName].ToString();
            if (string.IsNullOrEmpty(supplied) || !BridgeKeyAttribute.KeysMatch(supplied, settings.Key))
            {
                await Refuse(context, StatusCodes.Status401Unauthorized, "A valid X-Bridge-Key header is required.", "BRIDGE_KEY_INVALID");
                return;
            }
            await next();
        });

    private static Task Refuse(HttpContext context, int status, string message, string code)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(
            ApiResponse<object>.Fail(message, new ApiErrorDetails(code, $"ai.bridge.{code.ToLowerInvariant()}")));
    }
}
