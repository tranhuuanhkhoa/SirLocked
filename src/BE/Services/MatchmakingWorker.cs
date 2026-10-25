namespace SirLocked.Api.Services;

/// <summary>
/// Retries matching for queued tickets, expires unanswered matches after their 15-second window,
/// finishes confirmed matches whose room was not created, and drops tickets nobody polls any more.
/// Every step is a conditional write, so several API instances may run this worker side by side.
/// </summary>
public sealed class MatchmakingWorker(
    IServiceScopeFactory scopeFactory, TimeProvider timeProvider, ILogger<MatchmakingWorker> logger) : BackgroundService
{
    internal static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(PollInterval, timeProvider);
        try
        {
            do { await RunPassAsync(stoppingToken); }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    internal async Task RunPassAsync(CancellationToken stoppingToken)
    {
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        bounded.CancelAfter(TimeSpan.FromSeconds(20));
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<MatchmakingService>().RunMaintenanceAsync(bounded.Token);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException)
        {
            logger.LogWarning("Matchmaking sweep exceeded its time limit; the next sweep will retry.");
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Matchmaking sweep failed; the next sweep will retry.");
        }
    }
}
