using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class AiDraftWorkflowCoordinator : IAiDraftWorkflowCoordinator
{
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(20);
    private readonly MongoDbContext _db;
    private readonly TimeProvider _timeProvider;

    public AiDraftWorkflowCoordinator(MongoDbContext db, TimeProvider timeProvider)
    {
        _db = db;
        _timeProvider = timeProvider;
    }

    public bool IsLeaseExpired(AiCaseDraft draft) =>
        draft.GenerationClaimedAt is null
        || draft.GenerationClaimedAt <= _timeProvider.GetUtcNow().UtcDateTime - LeaseDuration;

    public async Task<AiGenerationClaim> ClaimAsync(
        AiCaseDraft observedDraft,
        IReadOnlyCollection<string> expectedStatuses,
        string claimedStatus,
        string phase,
        CancellationToken cancellationToken = default)
    {
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var runId = Guid.NewGuid().ToString("N");
        var inputHash = ComputeGenerationInputHash(observedDraft, phase);
        var expectedOrExpiredLease = Builders<AiCaseDraft>.Filter.Or(
            Builders<AiCaseDraft>.Filter.In(draft => draft.Status, expectedStatuses),
            Builders<AiCaseDraft>.Filter.And(
                Builders<AiCaseDraft>.Filter.Eq(draft => draft.Status, claimedStatus),
                Builders<AiCaseDraft>.Filter.Or(
                    Builders<AiCaseDraft>.Filter.Eq(draft => draft.GenerationClaimedAt, null),
                    Builders<AiCaseDraft>.Filter.Lte(draft => draft.GenerationClaimedAt, now - LeaseDuration))));
        var filter = Builders<AiCaseDraft>.Filter.And(
            Builders<AiCaseDraft>.Filter.Eq(draft => draft.Id, observedDraft.Id),
            ObservedVersionFilter(observedDraft),
            expectedOrExpiredLease);
        var update = Builders<AiCaseDraft>.Update
            .Set(draft => draft.Status, claimedStatus)
            .Set(draft => draft.GenerationRunId, runId)
            .Set(draft => draft.GenerationInputHash, inputHash)
            .Set(draft => draft.GenerationPhase, phase)
            .Set(draft => draft.GenerationProgress, 0)
            .Set(draft => draft.GenerationClaimedAt, now)
            .Inc(draft => draft.WorkflowVersion, 1)
            .Set(draft => draft.UpdatedAt, now);

        var claimed = await _db.AiCaseDrafts.FindOneAndUpdateAsync(
            filter,
            update,
            new FindOneAndUpdateOptions<AiCaseDraft> { ReturnDocument = ReturnDocument.After },
            cancellationToken);
        if (claimed is not null) return new AiGenerationClaim(claimed, true);

        var current = await _db.AiCaseDrafts
            .Find(draft => draft.Id == observedDraft.Id)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw ApiException.NotFound("AI draft not found.");
        if (current.Status == claimedStatus) return new AiGenerationClaim(current, false);
        throw ApiException.Conflict(
            $"AI draft changed from '{observedDraft.Status}' to '{current.Status}' before generation could start.");
    }

    public async Task<AiGenerationClaim> EnqueueAsync(
        AiCaseDraft observedDraft,
        IReadOnlyCollection<string> expectedStatuses,
        string generatingStatus,
        string operation,
        string phase,
        CancellationToken cancellationToken = default)
    {
        if (observedDraft.QueuedOperation == operation
            && observedDraft.QueueState is AiQueueStates.Pending or AiQueueStates.Running
                or AiQueueStates.RetryScheduled or AiQueueStates.AwaitingClaude)
            return new AiGenerationClaim(observedDraft, false);

        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var inputHash = ComputeGenerationInputHash(observedDraft, phase);
        var filter = Builders<AiCaseDraft>.Filter.And(
            Builders<AiCaseDraft>.Filter.Eq(item => item.Id, observedDraft.Id),
            ObservedVersionFilter(observedDraft),
            Builders<AiCaseDraft>.Filter.In(item => item.Status, expectedStatuses),
            Builders<AiCaseDraft>.Filter.Not(
                Builders<AiCaseDraft>.Filter.In(item => item.QueueState,
                    [AiQueueStates.Pending, AiQueueStates.Running, AiQueueStates.RetryScheduled, AiQueueStates.AwaitingClaude])));
        var update = Builders<AiCaseDraft>.Update
            .Set(item => item.Status, generatingStatus)
            .Set(item => item.QueuedOperation, operation)
            .Set(item => item.QueueState, AiQueueStates.Pending)
            .Set(item => item.GenerationRunId, string.Empty)
            .Set(item => item.OperationRunId, Guid.NewGuid().ToString("N"))
            .Set(item => item.ClaudeWait, null)
            .Set(item => item.GenerationInputHash, inputHash)
            .Set(item => item.GenerationPhase, phase)
            .Set(item => item.GenerationProgress, 0)
            .Set(item => item.GenerationClaimedAt, null)
            .Set(item => item.NextAttemptAt, now)
            .Set(item => item.LastGenerationErrorCode, string.Empty)
            .Set(item => item.QueueAttemptCount, 0)
            .Inc(item => item.WorkflowVersion, 1)
            .Set(item => item.UpdatedAt, now);
        var queued = await _db.AiCaseDrafts.FindOneAndUpdateAsync(
            filter,
            update,
            new FindOneAndUpdateOptions<AiCaseDraft> { ReturnDocument = ReturnDocument.After },
            cancellationToken);
        if (queued is not null) return new AiGenerationClaim(queued, true);

        var current = await _db.AiCaseDrafts.Find(item => item.Id == observedDraft.Id)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw ApiException.NotFound("AI draft not found.");
        if (current.QueuedOperation == operation
            && current.QueueState is AiQueueStates.Pending or AiQueueStates.Running
                or AiQueueStates.RetryScheduled or AiQueueStates.AwaitingClaude)
            return new AiGenerationClaim(current, false);

        // A worker completion or harmless metadata update can advance the version
        // between the endpoint read and this CAS. Retry once only when every input
        // that controls generation is unchanged and there is still no active queue.
        var currentInputHash = ComputeGenerationInputHash(current, phase);
        if (expectedStatuses.Contains(current.Status, StringComparer.Ordinal)
            && current.QueueState is "" or AiQueueStates.None
            && string.Equals(currentInputHash, inputHash, StringComparison.Ordinal))
        {
            var refreshedFilter = Builders<AiCaseDraft>.Filter.And(
                Builders<AiCaseDraft>.Filter.Eq(item => item.Id, current.Id),
                ObservedVersionFilter(current),
                Builders<AiCaseDraft>.Filter.In(item => item.Status, expectedStatuses),
                Builders<AiCaseDraft>.Filter.Not(
                    Builders<AiCaseDraft>.Filter.In(item => item.QueueState,
                        [AiQueueStates.Pending, AiQueueStates.Running, AiQueueStates.RetryScheduled, AiQueueStates.AwaitingClaude])));
            var refreshed = await _db.AiCaseDrafts.FindOneAndUpdateAsync(
                refreshedFilter,
                update,
                new FindOneAndUpdateOptions<AiCaseDraft> { ReturnDocument = ReturnDocument.After },
                cancellationToken);
            if (refreshed is not null) return new AiGenerationClaim(refreshed, true);
        }
        throw ApiException.Conflict(
            $"AI draft changed from workflow version {observedDraft.WorkflowVersion} to {current.WorkflowVersion} before '{operation}' could be queued.",
            "AI_WORKFLOW_CONFLICT",
            "ai.workflow.conflict");
    }

    public async Task<AiCaseDraft?> ClaimNextQueuedAsync(CancellationToken cancellationToken = default)
    {
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var due = Builders<AiCaseDraft>.Filter.And(
            Builders<AiCaseDraft>.Filter.In(item => item.QueueState,
                [AiQueueStates.Pending, AiQueueStates.RetryScheduled]),
            Builders<AiCaseDraft>.Filter.Or(
                Builders<AiCaseDraft>.Filter.Eq(item => item.NextAttemptAt, null),
                Builders<AiCaseDraft>.Filter.Lte(item => item.NextAttemptAt, now)));
        var expired = Builders<AiCaseDraft>.Filter.And(
            Builders<AiCaseDraft>.Filter.Eq(item => item.QueueState, AiQueueStates.Running),
            Builders<AiCaseDraft>.Filter.Or(
                Builders<AiCaseDraft>.Filter.Eq(item => item.GenerationClaimedAt, null),
                Builders<AiCaseDraft>.Filter.Lte(item => item.GenerationClaimedAt, now - LeaseDuration)));
        var claimed = await _db.AiCaseDrafts.FindOneAndUpdateAsync(
            Builders<AiCaseDraft>.Filter.Or(due, expired),
            Builders<AiCaseDraft>.Update
                .Set(item => item.QueueState, AiQueueStates.Running)
                .Set(item => item.GenerationRunId, Guid.NewGuid().ToString("N"))
                .Set(item => item.GenerationClaimedAt, now)
                .Set(item => item.NextAttemptAt, null)
                .Inc(item => item.QueueAttemptCount, 1)
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, now),
            new FindOneAndUpdateOptions<AiCaseDraft>
            {
                ReturnDocument = ReturnDocument.After,
                Sort = Builders<AiCaseDraft>.Sort.Ascending(item => item.NextAttemptAt)
                    .Ascending(item => item.CreatedAt)
            },
            cancellationToken);
        if (claimed is null) return null;

        // The run id of a queued operation never changes while it parks for Claude, retries or is reclaimed after a
        // restart: bridge request keys are built from it, so a replay finds the answers Claude already gave.
        var runId = string.IsNullOrWhiteSpace(claimed.OperationRunId) ? claimed.GenerationRunId : claimed.OperationRunId;
        var inputHash = string.IsNullOrWhiteSpace(claimed.GenerationInputHash)
            ? ComputeGenerationInputHash(claimed, claimed.GenerationPhase)
            : claimed.GenerationInputHash;
        var stabilized = await _db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == claimed.Id
                && item.WorkflowVersion == claimed.WorkflowVersion
                && item.GenerationRunId == claimed.GenerationRunId,
            Builders<AiCaseDraft>.Update
                .Set(item => item.GenerationRunId, runId)
                .Set(item => item.OperationRunId, runId)
                .Set(item => item.GenerationInputHash, inputHash),
            cancellationToken: cancellationToken);
        if (stabilized.MatchedCount == 0) return null;
        claimed.GenerationRunId = runId;
        claimed.OperationRunId = runId;
        claimed.GenerationInputHash = inputHash;
        return claimed;
    }

    public async Task BackfillLegacyGeneratingDraftsAsync(CancellationToken cancellationToken = default)
    {
        await _db.AiCaseDrafts.UpdateManyAsync(
            Builders<AiCaseDraft>.Filter.Exists(nameof(AiCaseDraft.WorkflowVersion), false),
            Builders<AiCaseDraft>.Update.Set(item => item.WorkflowVersion, 0),
            cancellationToken: cancellationToken);
        await _db.AiCaseDrafts.UpdateManyAsync(
            Builders<AiCaseDraft>.Filter.Exists(nameof(AiCaseDraft.QueueState), false),
            Builders<AiCaseDraft>.Update
                .Set(item => item.QueueState, AiQueueStates.None)
                .Set(item => item.QueuedOperation, AiQueuedOperations.None),
            cancellationToken: cancellationToken);
        var mappings = new[]
        {
            (AiDraftStatus.GeneratingStory, AiQueuedOperations.StoryPreview, "STORY_PREVIEW"),
            (AiDraftStatus.GeneratingCaseTruth, AiQueuedOperations.CaseTruth, "CASE_TRUTH"),
            (AiDraftStatus.GeneratingFullCase, AiQueuedOperations.FullLogic, "FULL_LOGIC"),
            (AiDraftStatus.GeneratingSceneLayout, AiQueuedOperations.SceneLayout, "SCENE_LAYOUT"),
            (AiDraftStatus.GeneratingFinalAssets, AiQueuedOperations.FinalAssets, "FINAL_ASSETS")
        };
        var missingQueueState = Builders<AiCaseDraft>.Filter.Or(
            Builders<AiCaseDraft>.Filter.Exists(nameof(AiCaseDraft.QueueState), false),
            Builders<AiCaseDraft>.Filter.Eq(item => item.QueueState, string.Empty),
            Builders<AiCaseDraft>.Filter.Eq(item => item.QueueState, AiQueueStates.None));
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        foreach (var (status, operation, phase) in mappings)
        {
            await _db.AiCaseDrafts.UpdateManyAsync(
                Builders<AiCaseDraft>.Filter.And(
                    Builders<AiCaseDraft>.Filter.Eq(item => item.Status, status),
                    missingQueueState),
                Builders<AiCaseDraft>.Update
                    .Set(item => item.QueuedOperation, operation)
                    .Set(item => item.QueueState, AiQueueStates.Pending)
                    .Set(item => item.GenerationPhase, phase)
                    .Set(item => item.GenerationRunId, string.Empty)
                    .Set(item => item.GenerationClaimedAt, null)
                    .Set(item => item.NextAttemptAt, now)
                    .Set(item => item.LastGenerationErrorCode, string.Empty)
                    .Set(item => item.QueueAttemptCount, 0)
                    .Inc(item => item.WorkflowVersion, 1)
                    .Set(item => item.UpdatedAt, now),
                cancellationToken: cancellationToken);
        }
    }

    public async Task<bool> CompleteQueuedAsync(
        AiCaseDraft draft,
        string? errorCode = null,
        CancellationToken cancellationToken = default)
    {
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var activeFilter = ActiveQueueFilter(draft);
        var current = await _db.AiCaseDrafts.Find(activeFilter)
            .FirstOrDefaultAsync(cancellationToken);
        if (current is null) return false;
        var effectiveErrorCode = errorCode;
        if (string.IsNullOrWhiteSpace(effectiveErrorCode)
            && current.Status is AiDraftStatus.GeneratedInvalid or AiDraftStatus.CaseTruthInvalid)
            effectiveErrorCode = current.LastGenerationErrorCode;
        var completion = Builders<AiCaseDraft>.Update
            .Set(item => item.QueueState, AiQueueStates.None)
            .Set(item => item.QueuedOperation, AiQueuedOperations.None)
            .Set(item => item.GenerationRunId, string.Empty)
            .Set(item => item.OperationRunId, string.Empty)
            .Set(item => item.ClaudeWait, null)
            .Set(item => item.GenerationInputHash, string.Empty)
            .Set(item => item.GenerationClaimedAt, null)
            .Set(item => item.NextAttemptAt, null)
            .Set(item => item.LastGenerationErrorCode, effectiveErrorCode ?? string.Empty)
            .Inc(item => item.WorkflowVersion, 1)
            .Set(item => item.UpdatedAt, now);
        if (!string.IsNullOrWhiteSpace(errorCode))
        {
            if (draft.QueuedOperation == AiQueuedOperations.TruthRepair)
            {
                // A failed candidate cannot invalidate the checkpoint it was repairing.
                completion = completion
                    .Set(item => item.TruthRepairStatus, AiRepairStatus.CandidateInvalid)
                    // A failed continuation retains its previous invalid candidate for
                    // an explicit retry; the active truth and gameplay never change.
                    .Set(item => item.TruthRepairValidationReport,
                        current.TruthRepairValidationReport.Append(errorCode).Distinct(StringComparer.Ordinal).ToList())
                    .Set(item => item.TruthRepairInput, null)
                    .Set(item => item.TruthRepairInputHash, string.Empty)
                    .Set(item => item.TruthRepairUseCandidate, false);
            }
            else
            {
                var failureStatus = draft.Status == AiDraftStatus.GeneratingCaseTruth
                    ? AiDraftStatus.CaseTruthInvalid : AiDraftStatus.GeneratedInvalid;
                completion = completion.Set(item => item.Status, failureStatus);
            }
        }
        var result = await _db.AiCaseDrafts.UpdateOneAsync(
            activeFilter,
            completion,
            cancellationToken: cancellationToken);
        return result.ModifiedCount > 0;
    }

    public async Task<bool> ScheduleRetryAsync(
        AiCaseDraft draft,
        DateTime nextAttemptAt,
        string errorCode,
        CancellationToken cancellationToken = default)
    {
        var result = await _db.AiCaseDrafts.UpdateOneAsync(
            ActiveQueueFilter(draft),
            Builders<AiCaseDraft>.Update
                .Set(item => item.QueueState, AiQueueStates.RetryScheduled)
                .Set(item => item.GenerationRunId, string.Empty)
                .Set(item => item.GenerationClaimedAt, null)
                .Set(item => item.NextAttemptAt, nextAttemptAt)
                .Set(item => item.LastGenerationErrorCode, errorCode)
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, _timeProvider.GetUtcNow().UtcDateTime),
            cancellationToken: cancellationToken);
        return result.ModifiedCount > 0;
    }

    public async Task<bool> HeartbeatAsync(AiCaseDraft draft, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(draft.GenerationRunId)) return false;
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var result = await _db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draft.Id && item.GenerationRunId == draft.GenerationRunId,
            Builders<AiCaseDraft>.Update
                .Set(item => item.GenerationClaimedAt, now)
                .Set(item => item.UpdatedAt, now),
            cancellationToken: cancellationToken);
        if (result.MatchedCount > 0) draft.GenerationClaimedAt = now;
        return result.MatchedCount > 0;
    }

    public async Task<bool> ParkAwaitingClaudeAsync(
        AiCaseDraft draft,
        string requestId,
        string step,
        CancellationToken cancellationToken = default)
    {
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var parked = await _db.AiCaseDrafts.UpdateOneAsync(
            ActiveQueueFilter(draft),
            Builders<AiCaseDraft>.Update
                .Set(item => item.QueueState, AiQueueStates.AwaitingClaude)
                .Set(item => item.ClaudeWait, new AiClaudeWait { RequestId = requestId, Step = step, Since = now })
                .Set(item => item.GenerationClaimedAt, null)
                .Set(item => item.NextAttemptAt, null)
                .Set(item => item.LastGenerationErrorCode, string.Empty)
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, now),
            cancellationToken: cancellationToken);
        if (parked.ModifiedCount == 0) return false;

        // The bot may have answered between the question being stored and this park: resume at once.
        var request = await _db.AiBridgeRequests.Find(item => item.Id == requestId).FirstOrDefaultAsync(cancellationToken);
        if (request is not null && AiBridgeStatuses.Answered.Contains(request.Status))
            await ResumeAfterClaudeAsync(draft.Id, requestId, cancellationToken);
        return true;
    }

    public async Task<bool> ResumeAfterClaudeAsync(
        string draftId,
        string? requestId = null,
        CancellationToken cancellationToken = default)
    {
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var filter = Builders<AiCaseDraft>.Filter.And(
            Builders<AiCaseDraft>.Filter.Eq(item => item.Id, draftId),
            Builders<AiCaseDraft>.Filter.Eq(item => item.QueueState, AiQueueStates.AwaitingClaude));
        if (!string.IsNullOrWhiteSpace(requestId))
            filter &= Builders<AiCaseDraft>.Filter.Eq(item => item.ClaudeWait!.RequestId, requestId);
        // The same queued operation goes back to the queue with its run id, so the replay reuses every answer.
        var resumed = await _db.AiCaseDrafts.UpdateOneAsync(
            filter,
            Builders<AiCaseDraft>.Update
                .Set(item => item.QueueState, AiQueueStates.Pending)
                .Set(item => item.NextAttemptAt, now)
                .Set(item => item.ClaudeWait, null)
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, now),
            cancellationToken: cancellationToken);
        return resumed.ModifiedCount > 0;
    }

    public async Task<int> ResumeAnsweredAsync(CancellationToken cancellationToken = default)
    {
        var parked = await _db.AiCaseDrafts
            .Find(item => item.QueueState == AiQueueStates.AwaitingClaude)
            .Limit(200)
            .ToListAsync(cancellationToken);
        var resumed = 0;
        foreach (var draft in parked)
        {
            var requestId = draft.ClaudeWait?.RequestId;
            if (string.IsNullOrWhiteSpace(requestId)) continue;
            var request = await _db.AiBridgeRequests.Find(item => item.Id == requestId).FirstOrDefaultAsync(cancellationToken);
            if (request is null || !AiBridgeStatuses.Answered.Contains(request.Status)) continue;
            if (await ResumeAfterClaudeAsync(draft.Id, requestId, cancellationToken)) resumed++;
        }
        return resumed;
    }

    public async Task SyncOrderStatusAsync(string draftId, CancellationToken cancellationToken = default)
    {
        var draft = await _db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(cancellationToken);
        if (draft is null) return;
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var inHand = await _db.AiBridgeRequests.Find(item =>
                item.OwnerType == AiBridgeOwnerTypes.CaseDraft
                && item.OwnerId == draftId
                && (item.Status == AiBridgeStatuses.Submitted
                    || (item.Status == AiBridgeStatuses.Taken && item.LeaseExpiresAt > now)))
            .AnyAsync(cancellationToken);
        var next = AiCaseOrderPolicy.Derive(draft, inHand);
        if (string.Equals(next, draft.OrderStatus, StringComparison.Ordinal)) return;
        await _db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draftId && item.OrderStatus == draft.OrderStatus,
            Builders<AiCaseDraft>.Update
                .Set(item => item.OrderStatus, next)
                .Push(item => item.OrderStatusHistory, new AiOrderStatusChange { Status = next, At = now }),
            cancellationToken: cancellationToken);
    }

    private static string ComputeGenerationInputHash(AiCaseDraft draft, string phase)
    {
        var json = JsonSerializer.Serialize(new
        {
            phase,
            draft.Prompt,
            draft.Settings,
            draft.StoryPreview,
            draft.StoryFingerprint,
            draft.PlannedTargetKind,
            draft.TruthHash,
            draft.BlueprintHash,
            draft.ProjectionPlanHash,
            draft.ProjectionContentHash,
            draft.V3CrackContentHash,
            // A truth-repair edit is not harmless metadata: stale downstream commands
            // must not retry across a new candidate or a change of repair scope.
            draft.TruthRepairStatus,
            draft.TruthRepairFromArtifact,
            draft.TruthRepairInstructions,
            draft.TruthRepairUseCandidate,
            draft.TruthRepairInputHash,
            draft.TruthRepairCandidateHash,
            draft.TruthRepairOriginalFromArtifact,
            draft.TruthRepairBaseHash,
            draft.TruthRepairFailedArtifact,
            GeneratedJsonHash = string.IsNullOrWhiteSpace(draft.GeneratedJson)
                ? string.Empty
                : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(draft.GeneratedJson)))
                    .ToLowerInvariant()
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
    }

    private static FilterDefinition<AiCaseDraft> ActiveQueueFilter(AiCaseDraft draft) =>
        Builders<AiCaseDraft>.Filter.And(
            Builders<AiCaseDraft>.Filter.Eq(item => item.Id, draft.Id),
            Builders<AiCaseDraft>.Filter.Eq(item => item.WorkflowVersion, draft.WorkflowVersion),
            Builders<AiCaseDraft>.Filter.Eq(item => item.QueueState, AiQueueStates.Running),
            Builders<AiCaseDraft>.Filter.Eq(item => item.GenerationRunId, draft.GenerationRunId),
            Builders<AiCaseDraft>.Filter.Eq(item => item.GenerationInputHash, draft.GenerationInputHash));

    private static FilterDefinition<AiCaseDraft> ObservedVersionFilter(AiCaseDraft draft)
    {
        var exact = Builders<AiCaseDraft>.Filter.Eq(item => item.WorkflowVersion, draft.WorkflowVersion);
        return draft.WorkflowVersion == 0
            ? Builders<AiCaseDraft>.Filter.Or(
                exact,
                Builders<AiCaseDraft>.Filter.Exists(nameof(AiCaseDraft.WorkflowVersion), false))
            : exact;
    }
}
