namespace SirLocked.Api.Services;

public sealed class RoomDisconnectTimeoutWorker(
    IServiceScopeFactory scopeFactory, TimeProvider timeProvider, ILogger<RoomDisconnectTimeoutWorker> logger) : BackgroundService
{
    internal static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(5);

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
        bounded.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<RoomDisconnectTimeoutService>().ExpireDueRoomsAsync(bounded.Token);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException)
        {
            logger.LogWarning("Room disconnect timeout sweep exceeded its time limit; the next sweep will retry.");
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Room disconnect timeout sweep failed; the next sweep will retry.");
        }
    }
}
