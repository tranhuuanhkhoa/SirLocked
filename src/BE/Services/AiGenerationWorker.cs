using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class AiGenerationWorker : BackgroundService
{
    private static readonly TimeSpan EmptyQueueDelay = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan FailureDelay = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromMinutes(2);
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<AiGenerationWorker> _logger;

    public AiGenerationWorker(
        IServiceScopeFactory scopeFactory,
        TimeProvider timeProvider,
        ILogger<AiGenerationWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await BackfillLegacyDraftsAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var workflow = scope.ServiceProvider.GetRequiredService<IAiDraftWorkflowCoordinator>();
                var draft = await workflow.ClaimNextQueuedAsync(stoppingToken);
                if (draft is null)
                {
                    await Task.Delay(EmptyQueueDelay, _timeProvider, stoppingToken);
                    continue;
                }

                var executor = scope.ServiceProvider.GetRequiredService<IAiGenerationExecutor>();
                using var leaseCancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                var heartbeat = MaintainLeaseAsync(workflow, draft, leaseCancellation, stoppingToken);
                Exception? failure = null;
                try
                {
                    await executor.ExecuteAsync(draft, leaseCancellation.Token);
                }
                catch (OperationCanceledException) when (leaseCancellation.IsCancellationRequested)
                {
                    failure = new InvalidOperationException("AI generation lost its lease or the host is stopping.");
                }
                catch (Exception ex)
                {
                    failure = ex;
                }
                finally
                {
                    leaseCancellation.Cancel();
                    await heartbeat;
                }

                if (failure is null)
                {
                    if (!await workflow.CompleteQueuedAsync(draft, cancellationToken: stoppingToken))
                        _logger.LogWarning("AI run {RunId} completed after its lease became stale.", draft.GenerationRunId);
                    continue;
                }

                var transient = IsTransient(failure);
                if (transient && draft.QueueAttemptCount <= 3 && !stoppingToken.IsCancellationRequested)
                {
                    var delay = draft.QueueAttemptCount switch
                    {
                        1 => TimeSpan.FromSeconds(15),
                        2 => TimeSpan.FromMinutes(1),
                        _ => TimeSpan.FromMinutes(5)
                    };
                    var scheduled = await workflow.ScheduleRetryAsync(
                        draft,
                        _timeProvider.GetUtcNow().UtcDateTime + delay,
                        "TRANSIENT_PROVIDER_ERROR",
                        stoppingToken);
                    if (scheduled)
                        _logger.LogWarning(failure,
                            "AI operation {Operation} for draft {DraftId} will retry after {Delay}.",
                            draft.QueuedOperation, draft.Id, delay);
                    continue;
                }

                var errorCode = failure is ApiException { Errors: ApiErrorDetails details }
                    ? details.Code
                    : failure is ApiException api && api.StatusCode == 422
                        ? "AI_GENERATION_INVALID"
                        : "AI_GENERATION_FAILED";
                await workflow.CompleteQueuedAsync(draft, errorCode, stoppingToken);
                _logger.LogError(failure,
                    "AI operation {Operation} for draft {DraftId} ended without retry.",
                    draft.QueuedOperation, draft.Id);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "AI generation worker polling failed.");
                await Task.Delay(FailureDelay, _timeProvider, stoppingToken);
            }
        }
    }

    private async Task BackfillLegacyDraftsAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var workflow = scope.ServiceProvider.GetRequiredService<IAiDraftWorkflowCoordinator>();
                await workflow.BackfillLegacyGeneratingDraftsAsync(stoppingToken);
                return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "AI generation queue backfill failed; retrying.");
                await Task.Delay(FailureDelay, _timeProvider, stoppingToken);
            }
        }
    }

    private static bool IsTransient(Exception failure) =>
        failure is HttpRequestException or TimeoutException
        || failure is ApiException api
            && (api.StatusCode is 408 or 429 || api.StatusCode >= 500);

    private static async Task MaintainLeaseAsync(
        IAiDraftWorkflowCoordinator workflow,
        AiCaseDraft draft,
        CancellationTokenSource leaseCancellation,
        CancellationToken stoppingToken)
    {
        try
        {
            using var timer = new PeriodicTimer(HeartbeatInterval);
            while (await timer.WaitForNextTickAsync(leaseCancellation.Token))
            {
                if (await workflow.HeartbeatAsync(draft, leaseCancellation.Token)) continue;
                leaseCancellation.Cancel();
                return;
            }
        }
        catch (OperationCanceledException)
        {
            // Expected when the operation completes or the host shuts down.
        }
    }
}
