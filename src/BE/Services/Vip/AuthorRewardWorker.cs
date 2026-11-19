using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;

namespace SirLocked.Api.Services.Vip;

/// <summary>
/// Author rewards (VUAN-7 part H) on a timer: share new case revenue every 10 minutes, pay payouts whose hold period is
/// over, refresh badges and tier bonuses hourly. Restart-safe: every pass reads its work from the database.
/// </summary>
public sealed class AuthorRewardWorker(IServiceScopeFactory scopes, ILogger<AuthorRewardWorker> logger, TimeProvider? time = null)
    : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan StatsInterval = TimeSpan.FromHours(1);
    private readonly TimeProvider _time = time ?? TimeProvider.System;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AuthorRewardService>().EnsureIndexesAsync(stoppingToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Author reward indexes could not be ensured.");
        }

        var lastStats = DateTime.MinValue;
        using var timer = new PeriodicTimer(Interval, _time);
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var rewards = scope.ServiceProvider.GetRequiredService<AuthorRewardService>();
                var started = _time.GetUtcNow();
                await rewards.ShareAsync(ct: stoppingToken);
                if (_time.GetUtcNow().UtcDateTime - lastStats >= StatsInterval)
                {
                    await rewards.RefreshStatsAsync(stoppingToken);
                    lastStats = _time.GetUtcNow().UtcDateTime;
                }
                await rewards.PayDueAsync(stoppingToken);
                rewards.LogIfSlow("all", _time.GetUtcNow() - started);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Author reward pass failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

/// <summary>
/// Records a hashed network fingerprint (IP address + the browser's <c>X-Device-Id</c>) of signed-in players at most
/// every few hours, so accounts sharing a device or connection count once toward an author's rewards. The IP itself is
/// never stored: only SHA-256 of it with a server-side salt.
/// </summary>
public sealed class NetworkKeyMiddleware(RequestDelegate next, IOptions<JwtSettings> jwt)
{
    private static readonly TimeSpan Throttle = TimeSpan.FromHours(6);
    private static readonly ConcurrentDictionary<string, DateTime> Recent = new(StringComparer.Ordinal);

    public async Task InvokeAsync(HttpContext context, IServiceScopeFactory scopes)
    {
        await next(context);
        var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId) || context.Response.StatusCode >= 400) return;
        var key = Key(context, jwt.Value.Secret);
        var cacheKey = userId + "|" + key;
        var now = DateTime.UtcNow;
        if (Recent.TryGetValue(cacheKey, out var seen) && now - seen < Throttle) return;
        Recent[cacheKey] = now;
        if (Recent.Count > 50_000) Recent.Clear();
        try
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AuthorRewardService>().RecordNetworkKeyAsync(userId, key);
        }
        catch (Exception)
        {
            // A missed fingerprint only makes the anti-fraud rule less strict for this request.
        }
    }

    public static string Key(HttpContext context, string salt)
    {
        var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var device = context.Request.Headers["X-Device-Id"].ToString();
        if (device.Length > 64) device = device[..64];
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"sirlocked-net|{salt}|{ip}|{device}"));
        return Convert.ToHexString(bytes)[..32].ToLowerInvariant();
    }
}
