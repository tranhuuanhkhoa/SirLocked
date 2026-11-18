using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Vip;

/// <summary>
/// Background work of the VIP lane, restart-safe because it only reads state from the database:
/// <list type="number">
/// <item>reads the outcome of open Message Batches ("Tiết kiệm"), stores each answer and resumes its parked draft
/// with the same run id (a failed batch is sent once more, then the step fails);</item>
/// <item>settles the coins of every VIP order whose state calls for it (<see cref="VipBillingService.ReconcileAsync"/>).</item>
/// </list>
/// </summary>
public sealed class VipLaneWorker(
    IServiceScopeFactory scopes,
    IOptions<AnthropicSettings> settings,
    ILogger<VipLaneWorker> logger,
    TimeProvider? time = null) : BackgroundService
{
    public const int MaxBatchAttempts = 2;
    private readonly TimeProvider _time = time ?? TimeProvider.System;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<VipLaneStore>().EnsureIndexesAsync(stoppingToken);
            await scope.ServiceProvider.GetRequiredService<HintPaymentService>().EnsureIndexesAsync(stoppingToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "VIP lane indexes could not be ensured; lookups stay correct, only slower.");
        }

        var interval = TimeSpan.FromSeconds(Math.Clamp(settings.Value.BatchPollSeconds, 15, 3600));
        using var timer = new PeriodicTimer(interval, _time);
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                if (settings.Value.IsConfigured) await PollBatchesAsync(scope.ServiceProvider, stoppingToken);
                await ResumeParkedAsync(scope.ServiceProvider, stoppingToken);
                await scope.ServiceProvider.GetRequiredService<VipBillingService>().ReconcileAsync(ct: stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "VIP lane worker pass failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <summary>
    /// Resumes VIP drafts parked on a call that no longer waits for a batch (answered, failed or reset). Covers an
    /// answer that arrived before the run parked, and a restart between storing an answer and resuming.
    /// </summary>
    public static async Task<int> ResumeParkedAsync(IServiceProvider services, CancellationToken ct)
    {
        var store = services.GetRequiredService<VipLaneStore>();
        var workflow = services.GetRequiredService<IAiDraftWorkflowCoordinator>();
        var parked = await store.Drafts
            .Find(item => item.Lane == AiDraftLanes.VipApi && item.QueueState == AiQueueStates.AwaitingClaude)
            .Limit(200)
            .ToListAsync(ct);
        var resumed = 0;
        foreach (var draft in parked)
        {
            var requestId = draft.ClaudeWait?.RequestId;
            if (string.IsNullOrWhiteSpace(requestId)) continue;
            var call = await store.GetAsync(requestId, ct);
            if (call is null || call.State == AiVipCallStates.BatchPending) continue;
            if (await workflow.ResumeAfterClaudeAsync(draft.Id, requestId, ct)) resumed++;
        }
        return resumed;
    }

    /// <summary>One pass over the open batches. Public for tests.</summary>
    public static async Task<int> PollBatchesAsync(IServiceProvider services, CancellationToken ct)
    {
        var store = services.GetRequiredService<VipLaneStore>();
        var client = services.GetRequiredService<IClaudeApiClient>();
        var answers = services.GetRequiredService<VipAnswerProcessor>();
        var workflow = services.GetRequiredService<IAiDraftWorkflowCoordinator>();
        var db = services.GetRequiredService<MongoDbContext>();
        var logger = services.GetRequiredService<ILogger<VipLaneWorker>>();
        var finished = 0;
        foreach (var call in await store.OpenBatchesAsync(20, ct))
        {
            ClaudeBatchOutcome outcome;
            try
            {
                outcome = await VipLaneErrors.CallAsync(() => client.GetBatchOutcomeAsync(call.BatchId, call.Id, ct));
            }
            catch (ApiException exception)
            {
                logger.LogWarning("Batch {BatchId} of VIP call {CallId} could not be read: {Message}", call.BatchId, call.Id, exception.Message);
                continue;
            }
            if (outcome.State == ClaudeBatchState.InProgress) continue;

            var draft = await db.AiCaseDrafts.Find(item => item.Id == call.DraftId).FirstOrDefaultAsync(ct);
            if (outcome.State == ClaudeBatchState.Succeeded && outcome.Answer is not null && draft is not null)
            {
                try
                {
                    await answers.AcceptAsync(draft, call, call.SchemaJson, outcome.Answer, batch: true, ct);
                }
                catch (ApiException exception)
                {
                    // AcceptAsync already marked the call FAILED; the replay surfaces the error to the pipeline.
                    logger.LogWarning("Batch answer of VIP call {CallId} ({Step}) was not usable: {Message}", call.Id, call.Step, exception.Message);
                }
            }
            else if (call.BatchAttempts < MaxBatchAttempts && draft is not null)
            {
                // Errored, expired or canceled: the replay sends the same question as a new batch.
                await store.ResetBatchAsync(call.Id, $"{outcome.State}: {outcome.Error}", ct);
            }
            else
            {
                await store.FailAsync(call.Id, $"Batch {outcome.State}: {outcome.Error}", ct);
            }
            if (draft is not null) await workflow.ResumeAfterClaudeAsync(draft.Id, call.Id, ct);
            finished++;
        }
        return finished;
    }
}
