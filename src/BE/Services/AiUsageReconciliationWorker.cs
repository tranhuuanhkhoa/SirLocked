using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Retries only RECORDED settlements. PENDING/UNKNOWN reservations remain held until
/// a provider response supplies a known cost; elapsed time is never proof of zero spend.
/// </summary>
public sealed class AiUsageReconciliationWorker(
    IServiceScopeFactory scopeFactory, ILogger<AiUsageReconciliationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        try
        {
            do { await RunPassAsync(stoppingToken); }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    internal async Task RunPassAsync(CancellationToken stoppingToken)
    {
        // The service caps each pass at 200 events; this also bounds a stalled DB call.
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        bounded.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var reconciler = scope.ServiceProvider.GetRequiredService<IAiRecordedUsageReconciler>();
            await reconciler.ReconcileRecordedAsync(cancellationToken: bounded.Token);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException)
        {
            logger.LogWarning("AI usage reconciliation exceeded its time limit; known unsettled usage will be retried.");
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "AI usage reconciliation failed; reservations remain held for retry.");
        }
    }
}
