using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Weekly;

/// <summary>
/// Makes sure the week has its challenge without waiting for a player to ask: at startup and every five minutes it
/// runs <see cref="IWeeklyService.EnsureChallengeAsync"/> for the week that holds now. Shortly after 07:00 on a
/// Wednesday (Vietnam) that picks the new week's case; the rest of the time it only reads the week's document.
/// A failed pass is logged and the next one tries again.
/// </summary>
public sealed class WeeklyChallengeWorker(
    IServiceScopeFactory scopeFactory, TimeProvider time, ILogger<WeeklyChallengeWorker> logger) : BackgroundService
{
    internal static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval, time);
        try
        {
            do { await RunPassAsync(stoppingToken); }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    internal async Task RunPassAsync(CancellationToken stoppingToken)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var weekly = scope.ServiceProvider.GetRequiredService<IWeeklyService>();
            await weekly.EnsureChallengeAsync(ChallengeWeek.Containing(time.GetUtcNow().UtcDateTime), stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Weekly challenge check failed; the next pass will try again.");
        }
    }
}
