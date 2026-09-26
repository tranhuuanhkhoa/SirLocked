using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Services;

public partial class AiCaseService
{
    private async Task<AiDraftResponse> ApproveStoryToTruthAsync(AiCaseDraft draft)
    {
        if (draft.Status == AiDraftStatus.CaseTruthAwaitingApproval
            || draft.Status == AiDraftStatus.CaseTruthInvalid)
            return AiDraftResponse.From(draft);

        if (draft.Status == AiDraftStatus.GeneratingCaseTruth)
        {
            if (draft.QueueState is AiQueueStates.Pending or AiQueueStates.Running or AiQueueStates.RetryScheduled)
                return AiDraftResponse.From(draft);
            var recovered = await _workflow.EnqueueAsync(
                draft,
                [AiDraftStatus.GeneratingCaseTruth],
                AiDraftStatus.GeneratingCaseTruth,
                AiQueuedOperations.CaseTruth,
                "CASE_TRUTH");
            return AiDraftResponse.From(recovered.Draft);
        }

        if (draft.Status != AiDraftStatus.StoryAwaitingApproval)
            throw ApiException.BadRequest("Only an approved story preview can generate the case truth.");

        var queued = await _workflow.EnqueueAsync(
            draft,
            [AiDraftStatus.StoryAwaitingApproval],
            AiDraftStatus.GeneratingCaseTruth,
            AiQueuedOperations.CaseTruth,
            "CASE_TRUTH");
        return AiDraftResponse.From(queued.Draft);
    }

    private async Task<AiDraftResponse> GenerateCaseTruthAsync(AiCaseDraft draft)
    {
        try
        {
            var plannedTargetKind = CaseTargetAllocationPolicy.Resolve(draft);
            if (!string.Equals(draft.PlannedTargetKind, plannedTargetKind, StringComparison.Ordinal))
            {
                await UpdateActiveRunAsync(
                    draft,
                    Builders<AiCaseDraft>.Update
                        .Set(item => item.PlannedTargetKind, plannedTargetKind)
                        .Set(item => item.UpdatedAt, DateTime.UtcNow));
                draft.PlannedTargetKind = plannedTargetKind;
            }
            // Ordinary retry/resume continues from the last persisted artifact.  This
            // prevents a worker crash after a paid stage from regenerating the seed and
            // every downstream artifact on the next lease.
            var resumeArtifact = draft.TruthCheckpointArtifact == CaseTruthArtifacts.ProofGraph
                && draft.CaseTruth is not null
                ? "__TRUTH_CHECKPOINT_COMPLETE__"
                : NextTruthArtifact(draft.TruthCheckpointArtifact);
            var truth = await GenerateTruthStagesAsync(
                draft,
                checkpoint: draft.CaseTruth,
                regenerateFromArtifact: resumeArtifact,
                persistCheckpoints: true);
            var budget = TruthBudgetForDraft(draft);
            var validation = ValidateTruthForGameplay(draft, truth, budget);

            var canonical = _truthService.Canonicalize(truth);
            var hash = _truthService.ComputeHash(truth);
            if (!validation.IsValid)
            {
                await SaveInvalidTruthAsync(draft, truth, canonical, hash, validation);
                return AiDraftResponse.From(await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync());
            }

            var review = await ReviewTruthFeasibilityAsync(draft, truth);
            var reviewValidation = ValidateGeneratedFeasibilityReview(review);
            if (!reviewValidation.IsValid)
                LogAdvisoryTruthReview(draft.Id, review, CaseTruthRepairPolicy.PlanReview(review).RegenerateFromArtifact);

            var provenance = BuildTruthProvenance(draft, truth);
            await UpdateActiveRunAsync(draft, Builders<AiCaseDraft>.Update
                .Set(item => item.Status, AiDraftStatus.CaseTruthAwaitingApproval)
                .Set(item => item.GenerationProgress, 100)
                .Set(item => item.CaseTruth, truth)
                .Set(item => item.CaseTruthJson, canonical)
                .Set(item => item.TruthSchemaVersion, truth.SchemaVersion)
                .Set(item => item.TruthHash, hash)
                .Set(item => item.TruthReviewerResult, review)
                .Set(item => item.TruthValidationReport, new List<string>())
                .Set(item => item.TruthRepairCandidate, null)
                .Set(item => item.TruthRepairCandidateJson, string.Empty)
                .Set(item => item.TruthRepairStatus, AiRepairStatus.None)
                .Set(item => item.TruthRepairRecommendedArtifact, string.Empty)
                .Set(item => item.TruthRepairFromArtifact, string.Empty)
                .Set(item => item.TruthRepairReasonCodes, new List<string>())
                .Set(item => item.ArtifactProvenance, provenance)
                .Set(item => item.FailurePhase, AiFailurePhases.None)
                .Set(item => item.UpdatedAt, DateTime.UtcNow));
            return AiDraftResponse.From(await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync());
        }
        catch (ApiException ex)
        {
            await MarkTruthGenerationFailedAsync(draft, ex);
            throw;
        }
    }

    public async Task<AiDraftResponse> ApproveTruthAsync(CurrentUser user, string draftId)
    {
        EnsureOpenAiConfigured();
        var draft = await _db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("AI draft not found.");
        EnsureDraftAccess(user, draft);

        if (draft.Status == AiDraftStatus.GeneratingFullCase)
        {
            return AiDraftResponse.From(draft);
        }
        if (draft.Status != AiDraftStatus.CaseTruthAwaitingApproval)
            throw ApiException.BadRequest("Only a valid case truth waiting for approval can generate gameplay logic.");
        if (draft.TruthRepairStatus == AiRepairStatus.CandidateReady)
            throw ApiException.BadRequest("Accept or reject the pending truth repair candidate first.");

        RequireApprovedTruth(draft);
        var queued = await _workflow.EnqueueAsync(
            draft,
            [AiDraftStatus.CaseTruthAwaitingApproval],
            AiDraftStatus.GeneratingFullCase,
            AiQueuedOperations.FullLogic,
            "FULL_LOGIC");
        return AiDraftResponse.From(queued.Draft);
    }

    public async Task<AiDraftResponse> RepairTruthAsync(CurrentUser user, string draftId, RepairCaseTruthRequest request)
    {
        EnsureOpenAiConfigured();
        var draft = await _db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("AI draft not found.");
        EnsureDraftAccess(user, draft);
        if (draft.Status is not (AiDraftStatus.CaseTruthAwaitingApproval or AiDraftStatus.CaseTruthInvalid))
            throw ApiException.BadRequest("Truth repair is available only at the case-truth approval gate.");
        if (draft.TruthRepairStatus == AiRepairStatus.CandidateReady)
            throw ApiException.BadRequest("Accept or reject the pending truth repair candidate first.");
        draft.PlannedTargetKind = CaseTargetAllocationPolicy.Resolve(draft);
        if (draft.CaseTruth is null || string.IsNullOrWhiteSpace(draft.CaseTruthJson))
        {
            if (draft.Status != AiDraftStatus.CaseTruthInvalid)
                throw ApiException.BadRequest("The draft has no saved truth checkpoint to repair.");

            // Older drafts did not persist stage checkpoints. Re-run from the approved story
            // using the current bounded stage budgets instead of leaving the repair action dead.
            var restart = await _workflow.EnqueueAsync(
                draft,
                [AiDraftStatus.CaseTruthInvalid],
                AiDraftStatus.GeneratingCaseTruth,
                AiQueuedOperations.CaseTruth,
                "CASE_TRUTH_RETRY");
            return AiDraftResponse.From(restart.Draft);
        }

        var instructions = request.RepairInstructions?.Trim() ?? string.Empty;
        var currentValidation = ValidateTruthForGameplay(
            draft,
            draft.CaseTruth,
            TruthBudgetForDraft(draft));
        var recommendedPlan = DetermineTruthRepairPlan(draft, currentValidation);
        var recommended = recommendedPlan.RegenerateFromArtifact;
        var requested = CaseTruthRepairPolicy.Normalize(request.RepairFromArtifact);
        if (!string.IsNullOrWhiteSpace(requested)
            && !CaseTruthRepairPolicy.IsTruthArtifact(requested))
            throw ApiException.Unprocessable(
                "repairFromArtifact must name a truth artifact.",
                new ApiErrorDetails("INVALID_TRUTH_REPAIR_SCOPE", "ai.caseTruth.invalidRepairScope"));
        if (!string.IsNullOrWhiteSpace(requested)
            && !CaseTruthRepairPolicy.IsAtOrBefore(requested, recommended))
            throw ApiException.Unprocessable(
                $"Truth repair cannot start after recommended artifact {recommended}.",
                new ApiErrorDetails("UNSAFE_TRUTH_REPAIR_SCOPE", "ai.caseTruth.unsafeRepairScope"));
        var selected = string.IsNullOrWhiteSpace(requested) ? recommended : requested;
        var stored = await _db.AiCaseDrafts.FindOneAndUpdateAsync(
            item => item.Id == draft.Id
                && item.WorkflowVersion == draft.WorkflowVersion
                && item.Status == draft.Status
                && item.QueueState == AiQueueStates.None,
            Builders<AiCaseDraft>.Update
                .Set(item => item.PlannedTargetKind, draft.PlannedTargetKind)
                .Set(item => item.TruthRepairInstructions, instructions)
                .Set(item => item.TruthRepairRecommendedArtifact, recommended)
                .Set(item => item.TruthRepairFromArtifact, selected)
                .Set(item => item.TruthRepairReasonCodes, recommendedPlan.ReasonCodes)
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, DateTime.UtcNow),
            new FindOneAndUpdateOptions<AiCaseDraft> { ReturnDocument = ReturnDocument.After });
        if (stored is null)
            throw ApiException.Conflict(
                "The draft changed before truth repair could be queued.",
                "AI_WORKFLOW_CONFLICT",
                "ai.workflow.conflict");
        var queued = await _workflow.EnqueueAsync(
            stored,
            [stored.Status],
            stored.Status,
            AiQueuedOperations.TruthRepair,
            "CASE_TRUTH_REPAIR");
        return AiDraftResponse.From(queued.Draft);
    }

    private async Task<AiDraftResponse> GenerateTruthRepairCandidateAsync(AiCaseDraft draft)
    {
        if (draft.CaseTruth is null)
            throw ApiException.Conflict("The draft has no truth checkpoint to repair.");
        var instructions = draft.TruthRepairInstructions;
        var budget = TruthBudgetForDraft(draft);
        var currentValidation = ValidateTruthForGameplay(draft, draft.CaseTruth, budget);
        var recommendedPlan = DetermineTruthRepairPlan(draft, currentValidation);
        var selected = CaseTruthRepairPolicy.Normalize(draft.TruthRepairFromArtifact);
        var fromArtifact = CaseTruthRepairPolicy.IsAtOrBefore(selected, recommendedPlan.RegenerateFromArtifact)
            ? selected
            : recommendedPlan.RegenerateFromArtifact;
        var feedback = currentValidation.IsValid
            ? BuildTruthReviewFeedback(draft.TruthReviewerResult)
            : FormatValidation(currentValidation);
        var candidate = await GenerateTruthStagesAsync(draft, draft.CaseTruth, fromArtifact, $"""
            Create one scoped repair candidate starting at artifact {fromArtifact}.
            Preserve every valid upstream field exactly. Never relax a validator and never change unrelated truth.
            Admin direction: {instructions}
            Blocking validation and independent-review feedback:
            {feedback}
            """);
        var validation = ValidateTruthForGameplay(draft, candidate, budget);
        var review = validation.IsValid
            ? await ReviewTruthFeasibilityAsync(draft, candidate)
            : new CaseTruthFeasibilityReview();
        if (validation.IsValid)
        {
            var reviewValidation = ValidateGeneratedFeasibilityReview(review);
            if (!reviewValidation.IsValid)
                LogAdvisoryTruthReview(draft.Id, review, fromArtifact);
        }
        var status = validation.IsValid ? AiRepairStatus.CandidateReady : AiRepairStatus.CandidateInvalid;
        await UpdateActiveRunAsync(
            draft,
            Builders<AiCaseDraft>.Update
                .Set(item => item.TruthRepairCandidate, candidate)
                .Set(item => item.TruthRepairCandidateJson, _truthService.Canonicalize(candidate))
                .Set(item => item.TruthRepairStatus, status)
                .Set(item => item.TruthRepairValidationReport, ValidationMessages(validation))
                .Set(item => item.TruthRepairReviewerResult, review)
                .Set(item => item.TruthRepairRecommendedArtifact, recommendedPlan.RegenerateFromArtifact)
                .Set(item => item.TruthRepairFromArtifact, fromArtifact)
                .Set(item => item.TruthRepairReasonCodes, recommendedPlan.ReasonCodes)
                .Set(item => item.TruthRepairInstructions, instructions)
                .Set(item => item.UpdatedAt, DateTime.UtcNow));
        return AiDraftResponse.From(await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync());
    }

    public async Task<AiDraftResponse> AcceptTruthRepairAsync(CurrentUser user, string draftId)
    {
        var draft = await _db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("AI draft not found.");
        EnsureDraftAccess(user, draft);
        if (draft.Status is not (AiDraftStatus.CaseTruthAwaitingApproval or AiDraftStatus.CaseTruthInvalid))
            throw ApiException.BadRequest("Truth repair can be accepted only at the case-truth gate.");
        if (draft.QueueState == AiQueueStates.Running)
            throw ApiException.Conflict("A generation operation is currently running for this draft.");
        if (draft.TruthRepairStatus != AiRepairStatus.CandidateReady || draft.TruthRepairCandidate is null)
            throw ApiException.BadRequest("There is no valid truth repair candidate to accept.");
        var validation = ValidateTruthForGameplay(
            draft,
            draft.TruthRepairCandidate,
            TruthBudgetForDraft(draft));
        if (!validation.IsValid)
            throw ApiException.Unprocessable("Truth repair candidate no longer passes validation.", validation.Errors);

        var truth = draft.TruthRepairCandidate;
        var canonical = _truthService.Canonicalize(truth);
        var hash = _truthService.ComputeHash(truth);
        var provenance = BuildTruthProvenance(draft, truth);
        provenance.AddRange(draft.ArtifactProvenance
            .Where(item => item.Artifact is CaseTruthArtifacts.Projection or CaseTruthArtifacts.Layout or CaseTruthArtifacts.Assets)
            .Select(item => new AiArtifactProvenance
            {
                Artifact = item.Artifact, InputHash = item.InputHash, OutputHash = item.OutputHash,
                IsStale = true, GeneratedAt = item.GeneratedAt
            }));

        var accepted = await _db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draft.Id
                && item.WorkflowVersion == draft.WorkflowVersion
                && (item.Status == AiDraftStatus.CaseTruthAwaitingApproval
                    || item.Status == AiDraftStatus.CaseTruthInvalid)
                && item.QueueState != AiQueueStates.Running
                && item.TruthRepairStatus == AiRepairStatus.CandidateReady,
            Builders<AiCaseDraft>.Update
                .Set(item => item.Status, AiDraftStatus.CaseTruthAwaitingApproval)
                .Set(item => item.CaseTruth, truth)
                .Set(item => item.CaseTruthJson, canonical)
                .Set(item => item.TruthSchemaVersion, truth.SchemaVersion)
                .Set(item => item.TruthHash, hash)
                .Set(item => item.TruthReviewerResult, draft.TruthRepairReviewerResult)
                .Set(item => item.TruthValidationReport, new List<string>())
                .Set(item => item.TruthRepairCandidate, null)
                .Set(item => item.TruthRepairCandidateJson, string.Empty)
                .Set(item => item.TruthRepairStatus, AiRepairStatus.Accepted)
                .Set(item => item.TruthRepairValidationReport, new List<string>())
                .Set(item => item.TruthRepairRecommendedArtifact, string.Empty)
                .Set(item => item.TruthRepairFromArtifact, string.Empty)
                .Set(item => item.TruthRepairReasonCodes, new List<string>())
                .Set(item => item.GeneratedJson, string.Empty)
                .Set(item => item.CaseBlueprint, null)
                .Set(item => item.BlueprintJson, string.Empty)
                .Set(item => item.BlindSolvabilityReview, new BlindSolvabilityReview())
                .Set(item => item.AssetManifest, new AiAssetManifest())
                .Set(item => item.CaseId, string.Empty)
                .Set(item => item.CaseTitle, string.Empty)
                .Set(item => item.JsonFilePath, string.Empty)
                .Set(item => item.JsonFolderPath, string.Empty)
                .Set(item => item.ArtifactProvenance, provenance)
                .Set(item => item.GenerationRunId, string.Empty)
                .Set(item => item.GenerationInputHash, string.Empty)
                .Set(item => item.GenerationPhase, string.Empty)
                .Set(item => item.GenerationProgress, 0)
                .Set(item => item.GenerationClaimedAt, null)
                .Set(item => item.QueuedOperation, AiQueuedOperations.None)
                .Set(item => item.QueueState, AiQueueStates.None)
                .Set(item => item.NextAttemptAt, null)
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, DateTime.UtcNow));
        if (accepted.MatchedCount == 0)
            throw ApiException.Conflict(
                "The draft changed before the truth repair could be accepted.",
                "AI_WORKFLOW_CONFLICT",
                "ai.workflow.conflict");
        return AiDraftResponse.From(await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync());
    }

    public async Task<AiDraftResponse> RejectTruthRepairAsync(CurrentUser user, string draftId)
    {
        var draft = await _db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("AI draft not found.");
        EnsureDraftAccess(user, draft);
        if (draft.Status is not (AiDraftStatus.CaseTruthAwaitingApproval or AiDraftStatus.CaseTruthInvalid))
            throw ApiException.BadRequest("Truth repair can be rejected only at the case-truth gate.");
        if (draft.QueueState == AiQueueStates.Running)
            throw ApiException.Conflict("A generation operation is currently running for this draft.");
        var rejected = await _db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draft.Id
                && item.WorkflowVersion == draft.WorkflowVersion
                && (item.Status == AiDraftStatus.CaseTruthAwaitingApproval
                    || item.Status == AiDraftStatus.CaseTruthInvalid)
                && item.QueueState != AiQueueStates.Running,
            Builders<AiCaseDraft>.Update
                .Set(item => item.TruthRepairCandidate, null)
                .Set(item => item.TruthRepairCandidateJson, string.Empty)
                .Set(item => item.TruthRepairStatus, AiRepairStatus.Rejected)
                .Set(item => item.TruthRepairValidationReport, new List<string>())
                .Set(item => item.TruthRepairReviewerResult, new CaseTruthFeasibilityReview())
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, DateTime.UtcNow));
        if (rejected.MatchedCount == 0)
            throw ApiException.Conflict(
                "The draft changed before the truth repair could be rejected.",
                "AI_WORKFLOW_CONFLICT",
                "ai.workflow.conflict");
        return AiDraftResponse.From(await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync());
    }

    private async Task<CaseTruthPackage> GenerateTruthStagesAsync(
        AiCaseDraft draft,
        CaseTruthPackage? checkpoint = null,
        string? regenerateFromArtifact = null,
        string? correction = null,
        bool persistCheckpoints = false)
    {
        var budget = TruthBudgetForDraft(draft);
        var gameplayContract = AiGenerationContract.For(draft.Settings);
        var plannedTargetKind = CaseTargetAllocationPolicy.Resolve(draft);
        var requiredSuspects = CaseTargetAllocationPolicy.RequiredSuspects(
            gameplayContract,
            plannedTargetKind);
        var truth = checkpoint is null
            ? new CaseTruthPackage { SchemaVersion = CaseTruthSchemaVersions.V2 }
            : JsonSerializer.Deserialize<CaseTruthPackage>(JsonSerializer.Serialize(checkpoint, PrettyJson), PrettyJson)!;
        var order = new[]
        {
            CaseTruthArtifacts.CaseSeed, CaseTruthArtifacts.CoreTruth, CaseTruthArtifacts.Timeline,
            CaseTruthArtifacts.Opportunity, CaseTruthArtifacts.Evidence, CaseTruthArtifacts.Statements,
            CaseTruthArtifacts.ProofGraph
        };
        var start = regenerateFromArtifact == "__TRUTH_CHECKPOINT_COMPLETE__"
            ? order.Length
            : regenerateFromArtifact is null ? 0 : Array.IndexOf(order, regenerateFromArtifact);
        if (start < 0) start = order.Length - 1;

        string StageCorrection(int index) => index >= start ? correction ?? string.Empty : string.Empty;
        if (start <= 0)
        {
            var artifact = await GenerateTruthStageAsync<GeneratedCaseSeedArtifact>(
                draft, "GenerateCaseSeed", AiGenerationSchemaVersions.CaseSeed,
                AiStrictSchemaProvider.CaseSeedSchema(
                    budget,
                    requiredSuspects,
                    gameplayContract.MinScenes,
                    exactSuspects: requiredSuspects),
                BuildTruthStagePrompt(draft, CaseTruthArtifacts.CaseSeed, truth, StageCorrection(0)));
            truth.CaseSeed = artifact.CaseSeed;
            if (persistCheckpoints) await SaveTruthCheckpointAsync(draft, truth, CaseTruthArtifacts.CaseSeed, 12);
        }
        if (start <= 1)
        {
            var suspectIds = RequireTruthReferenceIds(truth.CaseSeed.SuspectIds, "caseSeed.suspectIds");
            var artifact = await GenerateTruthStageAsync<GeneratedCoreTruthArtifact>(
                draft, "GenerateCoreTruth", AiGenerationSchemaVersions.CoreTruth,
                AiStrictSchemaProvider.CoreTruthSchema(budget, suspectIds, plannedTargetKind),
                BuildTruthStagePrompt(draft, CaseTruthArtifacts.CoreTruth, truth, StageCorrection(1)));
            truth.CoreTruth = artifact.CoreTruth;
            if (persistCheckpoints) await SaveTruthCheckpointAsync(draft, truth, CaseTruthArtifacts.CoreTruth, 24);
        }
        if (start <= 2)
        {
            var suspectIds = RequireTruthReferenceIds(truth.CaseSeed.SuspectIds, "caseSeed.suspectIds");
            var locationIds = RequireTruthReferenceIds(truth.CaseSeed.LocationIds, "caseSeed.locationIds");
            var targetId = RequireTruthReferenceIds([truth.CoreTruth.TargetId], "coreTruth.targetId").Single();
            var schema = AiStrictSchemaProvider.TrueTimelineSchema(
                budget,
                suspectIds,
                targetId,
                truth.CoreTruth.TargetKind,
                locationIds);
            var timelineResult = await GenerateTimelineWithReferenceRepairAsync(
                async activeCorrection => await GenerateTruthStageAsync<GeneratedTimelineArtifact>(
                    draft, "BuildTrueTimeline", AiGenerationSchemaVersions.TrueTimeline,
                    schema, BuildTruthStagePrompt(draft, CaseTruthArtifacts.Timeline, truth, activeCorrection)),
                artifact =>
                {
                    truth.TrueTimeline = artifact.TrueTimeline;
                    return _truthService.ValidateTimelineReferences(truth, budget);
                },
                StageCorrection(2));
            truth.TrueTimeline = timelineResult.Artifact.TrueTimeline;
            var completedArtifact = CompletedArtifactAfterValidation(
                CaseTruthArtifacts.CoreTruth,
                CaseTruthArtifacts.Timeline,
                timelineResult.Validation);
            if (persistCheckpoints)
                await SaveTruthCheckpointAsync(
                    draft,
                    truth,
                    completedArtifact,
                    timelineResult.Validation.IsValid ? 36 : 24);
            if (!timelineResult.Validation.IsValid)
            {
                if (!persistCheckpoints)
                    return truth;
                throw ApiException.Unprocessable(
                    "Timeline references failed deterministic validation.",
                    timelineResult.Validation.Errors);
            }
        }
        if (start <= 3)
        {
            var suspectIds = RequireTruthReferenceIds(truth.CaseSeed.SuspectIds, "caseSeed.suspectIds");
            var eventIds = RequireTruthReferenceIds(
                CaseTruthReferenceContract.TimelineEventIds(truth.TrueTimeline), "trueTimeline.eventId");
            var artifact = await GenerateTruthStageAsync<GeneratedOpportunityArtifact>(
                draft, "BuildOpportunityMatrix", AiGenerationSchemaVersions.OpportunityMatrix,
                AiStrictSchemaProvider.OpportunityMatrixSchema(budget, suspectIds, eventIds), BuildTruthStagePrompt(draft, CaseTruthArtifacts.Opportunity, truth, StageCorrection(3)));
            truth.OpportunityMatrix = artifact.OpportunityMatrix;
            if (persistCheckpoints) await SaveTruthCheckpointAsync(draft, truth, CaseTruthArtifacts.Opportunity, 48);
        }
        if (start <= 4)
        {
            var eventIds = RequireTruthReferenceIds(
                CaseTruthReferenceContract.TimelineEventIds(truth.TrueTimeline), "trueTimeline.eventId");
            var plannedTraceIds = RequireTruthReferenceIds(
                CaseTruthReferenceContract.PlannedTraceIds(truth.TrueTimeline), "trueTimeline.traceIds");
            var schema = AiStrictSchemaProvider.TraceLedgerSchema(budget, eventIds, plannedTraceIds);
            var evidenceResult = await GenerateTruthArtifactWithScopedRepairAsync(
                async activeCorrection => await GenerateTruthStageAsync<GeneratedTraceArtifact>(
                    draft, "GenerateCausalEvidence", AiGenerationSchemaVersions.TraceLedger,
                    schema, BuildTruthStagePrompt(draft, CaseTruthArtifacts.Evidence, truth, activeCorrection)),
                artifact =>
                {
                    truth.TraceLedger = artifact.TraceLedger;
                    var validation = ValidateGeneratedTraceSet(truth.TraceLedger, plannedTraceIds);
                    validation.Errors.AddRange(_truthService.ValidateTraceArtifact(truth).Errors);
                    return validation;
                },
                CaseTruthArtifacts.Evidence,
                StageCorrection(4));
            truth.TraceLedger = evidenceResult.Artifact.TraceLedger;
            var traceValidation = evidenceResult.Validation;
            var completedArtifact = CompletedArtifactAfterValidation(
                CaseTruthArtifacts.Opportunity,
                CaseTruthArtifacts.Evidence,
                traceValidation);
            if (persistCheckpoints)
                await SaveTruthCheckpointAsync(
                    draft,
                    truth,
                    completedArtifact,
                    traceValidation.IsValid ? 60 : 48);
            if (!traceValidation.IsValid)
            {
                if (!persistCheckpoints)
                    return truth;
                throw ApiException.Unprocessable(
                    "Causal evidence failed deterministic validation.",
                    traceValidation.Errors);
            }
        }
        if (start <= 5)
        {
            var speakerIds = RequireTruthReferenceIds(
                CaseTargetKinds.IsAsset(truth.CoreTruth)
                    ? truth.CaseSeed.SuspectIds
                    : truth.CaseSeed.SuspectIds.Append(truth.CoreTruth.TargetId),
                "statement speaker IDs");
            var eventIds = RequireTruthReferenceIds(
                CaseTruthReferenceContract.TimelineEventIds(truth.TrueTimeline), "trueTimeline.eventId");
            var traceIds = RequireTruthReferenceIds(truth.TraceLedger.Select(item => item.TraceId), "traceLedger.traceId");
            var schema = AiStrictSchemaProvider.StatementLedgerSchema(budget, speakerIds, eventIds, traceIds);
            var statementResult = await GenerateTruthArtifactWithScopedRepairAsync(
                async activeCorrection => await GenerateTruthStageAsync<GeneratedStatementArtifact>(
                    draft, "BuildStatements", AiGenerationSchemaVersions.StatementLedger,
                    schema, BuildTruthStagePrompt(draft, CaseTruthArtifacts.Statements, truth, activeCorrection)),
                artifact =>
                {
                    truth.StatementLedger = artifact.StatementLedger;
                    return _truthService.ValidateStatementArtifact(
                        truth,
                        draft.Settings);
                },
                CaseTruthArtifacts.Statements,
                StageCorrection(5));
            truth.StatementLedger = statementResult.Artifact.StatementLedger;
            var completedArtifact = CompletedArtifactAfterValidation(
                CaseTruthArtifacts.Evidence,
                CaseTruthArtifacts.Statements,
                statementResult.Validation);
            if (persistCheckpoints)
                await SaveTruthCheckpointAsync(
                    draft,
                    truth,
                    completedArtifact,
                    statementResult.Validation.IsValid ? 72 : 60);
            if (!statementResult.Validation.IsValid)
            {
                if (!persistCheckpoints)
                    return truth;
                throw ApiException.Unprocessable(
                    "Statements failed deterministic validation.",
                    statementResult.Validation.Errors);
            }
        }
        if (start <= 6)
        {
            var suspectIds = RequireTruthReferenceIds(truth.CaseSeed.SuspectIds, "caseSeed.suspectIds");
            var traceIds = RequireTruthReferenceIds(truth.TraceLedger.Select(item => item.TraceId), "traceLedger.traceId");
            var statementIds = RequireTruthReferenceIds(
                truth.StatementLedger.Select(item => item.StatementId), "statementLedger.statementId");
            var schema = AiStrictSchemaProvider.ProofGraphSchema(budget, suspectIds, traceIds, statementIds);
            var proofResult = await GenerateTruthArtifactWithScopedRepairAsync(
                async activeCorrection => await GenerateTruthStageAsync<GeneratedProofArtifact>(
                    draft, "BuildProofGraph", AiGenerationSchemaVersions.ProofGraph,
                    schema, BuildTruthStagePrompt(draft, CaseTruthArtifacts.ProofGraph, truth, activeCorrection)),
                artifact =>
                {
                    truth.ProofGraph = artifact.ProofGraph;
                    truth.RedHerringLedger = artifact.RedHerringLedger;
                    var validation = _truthService.Validate(truth, budget);
                    validation.Errors.AddRange(_projectionPlanner.ValidateProjectability(draft, truth).Errors);
                    validation.Deduplicate();
                    return validation;
                },
                CaseTruthArtifacts.ProofGraph,
                StageCorrection(6));
            truth.ProofGraph = proofResult.Artifact.ProofGraph;
            truth.RedHerringLedger = proofResult.Artifact.RedHerringLedger;
            var completedArtifact = CompletedArtifactAfterValidation(
                CaseTruthArtifacts.Statements,
                CaseTruthArtifacts.ProofGraph,
                proofResult.Validation);
            if (persistCheckpoints)
                await SaveTruthCheckpointAsync(
                    draft,
                    truth,
                    completedArtifact,
                    proofResult.Validation.IsValid ? 84 : 72);
            if (!proofResult.Validation.IsValid)
            {
                if (!persistCheckpoints)
                    return truth;
                throw ApiException.Unprocessable(
                    "Proof graph failed deterministic validation.",
                    proofResult.Validation.Errors);
            }
        }
        return truth;
    }

    internal sealed record TruthArtifactGenerationResult<T>(
        T Artifact,
        CaseValidationResult Validation,
        int Attempts);

    internal static async Task<TruthArtifactGenerationResult<T>> GenerateTruthArtifactWithScopedRepairAsync<T>(
        Func<string, Task<T>> generate,
        Func<T, CaseValidationResult> validate,
        string artifactName,
        string initialCorrection = "")
    {
        var artifact = await generate(initialCorrection);
        var validation = validate(artifact);
        return new TruthArtifactGenerationResult<T>(artifact, validation, 1);
    }

    internal sealed record TimelineReferenceGenerationResult(
        GeneratedTimelineArtifact Artifact,
        CaseValidationResult Validation,
        int Attempts);

    internal static string CompletedArtifactAfterValidation(
        string lastValidArtifact,
        string candidateArtifact,
        CaseValidationResult validation) =>
        validation.IsValid ? candidateArtifact : lastValidArtifact;

    internal static async Task<TimelineReferenceGenerationResult> GenerateTimelineWithReferenceRepairAsync(
        Func<string, Task<GeneratedTimelineArtifact>> generate,
        Func<GeneratedTimelineArtifact, CaseValidationResult> validate,
        string initialCorrection = "")
    {
        var artifact = await generate(initialCorrection);
        var validation = validate(artifact);
        return new TimelineReferenceGenerationResult(artifact, validation, 1);
    }

    private static IReadOnlyList<string> RequireTruthReferenceIds(
        IEnumerable<string> values,
        string path)
    {
        var ids = values.Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal).ToList();
        if (ids.Count == 0)
            throw ApiException.Unprocessable(
                $"Cannot generate the next truth artifact because '{path}' is empty.",
                new ApiErrorDetails("CASE_TRUTH_INVALID", "ai.caseTruth.missingReferenceSet"));
        return ids;
    }

    internal static CaseValidationResult ValidateGeneratedTraceSet(
        IReadOnlyCollection<TraceLedgerEntry> traces,
        IReadOnlyCollection<string> plannedTraceIds)
    {
        var result = new CaseValidationResult();
        var actual = traces.Select(item => item.TraceId).ToList();
        var hasBlank = actual.Any(string.IsNullOrWhiteSpace);
        var hasDuplicate = actual.Count != actual.Distinct(StringComparer.Ordinal).Count();
        if (!hasBlank && !hasDuplicate
            && plannedTraceIds.ToHashSet(StringComparer.Ordinal).SetEquals(actual)) return result;
        result.Add(
            "TraceSetMismatch",
            "traceLedger",
            "Generated trace IDs must match the distinct timeline-planned trace IDs exactly.");
        return result;
    }

    private async Task SaveTruthCheckpointAsync(
        AiCaseDraft draft,
        CaseTruthPackage truth,
        string completedArtifact,
        int progress)
    {
        var canonical = _truthService.Canonicalize(truth);
        await UpdateActiveRunAsync(draft, Builders<AiCaseDraft>.Update
            .Set(item => item.CaseTruth, truth)
            .Set(item => item.CaseTruthJson, canonical)
            .Set(item => item.TruthSchemaVersion, truth.SchemaVersion)
            .Set(item => item.TruthHash, string.Empty)
            .Set(item => item.TruthCheckpointArtifact, completedArtifact)
            .Set(item => item.GenerationProgress, progress)
            .Set(item => item.UpdatedAt, DateTime.UtcNow));
    }

    internal static string? NextTruthArtifact(string? completedArtifact) => completedArtifact switch
    {
        CaseTruthArtifacts.CaseSeed => CaseTruthArtifacts.CoreTruth,
        CaseTruthArtifacts.CoreTruth => CaseTruthArtifacts.Timeline,
        CaseTruthArtifacts.Timeline => CaseTruthArtifacts.Opportunity,
        CaseTruthArtifacts.Opportunity => CaseTruthArtifacts.Evidence,
        CaseTruthArtifacts.Evidence => CaseTruthArtifacts.Statements,
        CaseTruthArtifacts.Statements => CaseTruthArtifacts.ProofGraph,
        _ => null
    };

    private async Task<T> GenerateTruthStageAsync<T>(
        AiCaseDraft draft,
        string step,
        string schemaVersion,
        JsonObject schema,
        string prompt)
    {
        var maxOutputTokens = TruthStageMaxOutputTokens(schemaVersion);
        async Task<string> GenerateAsync(string activeStep, string activePrompt, int activeMaxOutputTokens) =>
            await GenerateJsonWithOpenAiAsync(
                draft.Id, activeStep, activePrompt, activeMaxOutputTokens, schemaVersion, schema,
                await NextGenerationAttemptNumberAsync(draft.Id, schemaVersion),
                mockResponseFactory: () => AiCaseMockFactory.BuildMockTruthStageJson(draft, schemaVersion),
                generationRunId: draft.GenerationRunId);

        string raw;
        try
        {
            raw = await GenerateAsync(step, prompt, maxOutputTokens);
        }
        catch (ApiException)
        {
            var latest = await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync();
            var failedAttempt = latest.GenerationAttempts.LastOrDefault();
            if (failedAttempt?.FailureCategory != AiFailureCategories.Incomplete
                || failedAttempt.SchemaVersion != schemaVersion)
                throw;

            var retryTokens = Math.Min(TruthStageRetryMaxOutputTokens(schemaVersion), 32000);
            try
            {
                raw = await GenerateAsync(
                    $"{step}:RetryIncomplete",
                    BuildIncompleteTruthRetryPrompt(prompt, schemaVersion),
                    retryTokens);
            }
            catch (ApiException)
            {
                var afterRetry = await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync();
                var retryAttempt = afterRetry.GenerationAttempts.LastOrDefault();
                if (retryAttempt?.FailureCategory == AiFailureCategories.Incomplete
                    && retryAttempt.SchemaVersion == schemaVersion)
                {
                    throw ApiException.Unprocessable(
                        $"{step} remained incomplete after its single bounded retry.",
                        new ApiErrorDetails("CASE_TRUTH_INVALID", "ai.caseTruth.incomplete"));
                }
                throw;
            }
        }
        try
        {
            return JsonSerializer.Deserialize<T>(StripMarkdownFences(raw), PrettyJson)
                ?? throw ApiException.Unprocessable($"{step} returned an empty artifact.");
        }
        catch (JsonException ex)
        {
            throw ApiException.Unprocessable($"{step} JSON could not be parsed: {ex.Message}");
        }
    }

    internal static int TruthStageMaxOutputTokens(string schemaVersion) => schemaVersion switch
    {
        AiGenerationSchemaVersions.CaseSeed => 6000,
        AiGenerationSchemaVersions.CoreTruth => 6000,
        AiGenerationSchemaVersions.TrueTimeline => 12000,
        AiGenerationSchemaVersions.OpportunityMatrix => 9000,
        AiGenerationSchemaVersions.TraceLedger => 18000,
        AiGenerationSchemaVersions.StatementLedger => 14000,
        AiGenerationSchemaVersions.ProofGraph => 14000,
        _ => 9000
    };

    internal static int TruthStageRetryMaxOutputTokens(string schemaVersion) =>
        Math.Max(TruthStageMaxOutputTokens(schemaVersion) + 4000,
            (int)Math.Ceiling(TruthStageMaxOutputTokens(schemaVersion) * 1.5));

    internal static string BuildIncompleteTruthRetryPrompt(string originalPrompt, string schemaVersion) => $"""
        {originalPrompt}

        RETRY AFTER INCOMPLETE OUTPUT:
        The previous {schemaVersion} response exhausted max_output_tokens and was discarded.
        Recreate the complete artifact from the locked input. Return every required array entry exactly once.
        Keep prose fields factual and compact: normally one sentence and at most 24 words per descriptive field.
        Do not repeat the story, explain your reasoning, add commentary, or omit IDs to save space.
        Output only the complete JSON object required by the schema.
        """;

    internal static string BuildTruthStagePrompt(AiCaseDraft draft, string artifact, CaseTruthPackage truth, string correction)
    {
        var budget = TruthBudgetForDraft(draft);
        var gameplayContract = AiGenerationContract.For(draft.Settings);
        var lockedCrimeActionIds = truth.CoreTruth.CrimeActionIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var lockedCrimeActionList = lockedCrimeActionIds.Count == 0
            ? "(not generated yet)"
            : string.Join(", ", lockedCrimeActionIds);
        var eligibleIdentityTraceIds = truth.TraceLedger
            .Where(trace => trace.CreatedByCharacterId == truth.CoreTruth.CulpritId
                && lockedCrimeActionIds.Contains(trace.SourceActionId, StringComparer.Ordinal)
                && trace.SupportsConclusionIds.Contains(ProofConclusionIds.Identity))
            .Select(trace => trace.TraceId)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var eligibleIdentityTraceList = eligibleIdentityTraceIds.Count == 0
            ? "(none; Evidence must be regenerated)"
            : string.Join(", ", eligibleIdentityTraceIds);
        var instruction = artifact switch
        {
            CaseTruthArtifacts.CaseSeed => $"Lock crime type, era, technology constraints, difficulty, duration, exactly {CaseTargetAllocationPolicy.RequiredSuspects(gameplayContract, CaseTargetAllocationPolicy.Resolve(draft))} stable suspect IDs, location IDs, and a complete travel-time graph. The server has locked target kind {CaseTargetAllocationPolicy.Resolve(draft)}; do not add the target to suspectIds. Do not choose a culprit yet.",
            CaseTruthArtifacts.CoreTruth => $"Using only the locked seed, choose one culprit and lock target, motive, method, and IDs for preparation, crime, concealment, and culprit-mistake actions. targetKind is server-owned and must be copied exactly as {CaseTargetAllocationPolicy.Resolve(draft)}. targetId must be stable and distinct from every suspectId. Every generated action ID becomes a canonical timeline eventId in the next stage. Each core action ID must describe a physical action performed by the culprit, never a victim response or a third-party action. Do not write evidence or gameplay.",
            CaseTruthArtifacts.Timeline => $"Build the true minute-based timeline for every core action plus necessary alibi/witness events. Every distinct core action ID must be copied verbatim exactly once into eventId; auxiliary alibi and witness eventIds are allowed. actorId is the sole physical actor performing that event's action. Split interactions into separate overlapping events when another character performs a physical act. Every witnessId must also have its own actor event overlapping the witnessed event at the same location; boundary-only contact is not overlap. The action field is prose and prose must never define, embed, normalize, or alias a second causal ID. Include actor, location, duration, travel, required access/tools/knowledge, witnesses, SIGHT/HEARING observation conditions, and planned trace IDs. No actor can overlap or teleport. A covert crime action must not overlap another actor at the same location unless visibility or lack of visibility is physically explained. Resetting a control must not erase a delayed effect that the later timeline still requires; explicitly retain the mechanism or perform the reset after the effect. Every altered physical record needs an earlier event that created the original record. Declare between {ProofConclusionIds.ByCategory.Count} and {budget.MaxTraces} distinct trace IDs total and no more than two per event; assign each planned trace to the event whose actor physically creates it, and give every trace a distinct investigative purpose. HARD IDENTITY INVARIANT: at least one locked crime action ({lockedCrimeActionList}) performed by culprit {truth.CoreTruth.CulpritId} must plan a physical trace whose purpose is to identify that actor, not merely a shared tool, place, access right, or suspicious circumstance.",
            CaseTruthArtifacts.Opportunity => "Build one opportunity row per suspect from the locked timeline: motive, access, tools, knowledge, crime-opportunity window, verified alibi, identity linkage, and a causal elimination reason for every non-culprit. availableFromMinute/availableToMinute means the interval in which that suspect could execute the complete locked crime-action chain; it is not the character's full presence schedule. Every alibiEventIds item must copy an exact timeline eventId, case-sensitively. Set alibiVerified true only when another observable actor or a causal trace objectively corroborates each alibi event; self-report alone is never verified.",
            CaseTruthArtifacts.Evidence => $"Create every trace declared by timeline actions. sourceActionId must copy an exact timeline eventId, case-sensitively; never derive it from action prose. traceId must copy one planned trace ID exactly once. createdByCharacterId must exactly equal the actorId of sourceActionId; if a different character physically creates a trace, the timeline must have planned it under that character's event instead. Each trace must include exact time/location, physical cause, persistence for the full elapsed time and stated environment, bounded proves/does-not-prove statements, independent group, and one or two IDs from the locked proof-ID contract below. FINAL EVIDENCE INVARIANT: each of the five canonical conclusion IDs must be supported by at least one trace, and the complete ledger must admit five different trace IDs, one for each conclusion. HARD IDENTITY INVARIANT: at least one trace must set createdByCharacterId to culprit {truth.CoreTruth.CulpritId}, set sourceActionId to one of the locked crime actions ({lockedCrimeActionList}), include {ProofConclusionIds.Identity} in supportsConclusionIds, and physically distinguish that actor rather than only a shared tool, place, access right, or suspicious circumstance.",
            CaseTruthArtifacts.Statements => $"Create statements only from locked events and knowledge sources. eventIds must copy exact timeline eventIds, case-sensitively, and should identify directly discussed events. For every eventId, the speakerId must be that event's actorId or one of its witnessIds so the speaker is physically present at the projected scene. Every statement must contain at least one knowledgeSourceIds entry naming the exact event or trace that gives the speaker that knowledge. Each contradictedByTraceIds array contains at most one exact trace-ledger ID, and the complete ledger may use at most {ProjectionCapacityPolicy.For(draft.Settings).MaxChallengeSlots} distinct contradiction trace IDs. Mark TRUE/FALSE/MISLEADING, provide a reason for every lie, independent source group, and one or two IDs from the locked proof-ID contract below. Across upstream traces plus these statements, every one of the five locked conclusion IDs must have at least two distinct independent source groups; generate compact corroborating statements for any missing category. GAMEPLAY DIALOGUE BUDGET: the projection allows {gameplayContract.MinDialogues}-{gameplayContract.MaxDialogues} dialogue slots. Statements that carry contradictions must either stay within that limit or share the same speaker and at least one referenced event location so the backend can group them without changing truth.",
            _ => $"Build exactly five proof conclusions using the locked ID/category pairs below, plus at most {budget.MaxRedHerrings} red-herring ledger entries. supportingTraceIds and clearingTraceIds must copy exact locked trace-ledger IDs; supportingStatementIds and clearingStatementIds must copy exact locked statement-ledger IDs; excluded and red-herring suspect IDs must copy exact locked suspect IDs. Every conclusion must contain at least one supportingTraceId. Each red herring may use at most one clearingTraceId and must reuse an existing proof-linked trace whenever possible. Aggregate all relevant support under those five conclusions; cover each category with at least two independent source groups; eliminate every other suspect; every red herring needs clearing evidence. HARD IDENTITY INVARIANT: the {ProofConclusionIds.Identity} conclusion must include at least one of these eligible culprit crime-action traces in supportingTraceIds: {eligibleIdentityTraceList}."
        };
        var proofIdContract = artifact is CaseTruthArtifacts.Evidence
            or CaseTruthArtifacts.Statements
            or CaseTruthArtifacts.ProofGraph
            ? $"""

              LOCKED PROOF-ID CONTRACT (exact, case-sensitive, no other conclusion IDs):
              - {ProofConclusionIds.Motive} => {ProofConclusionCategories.Motive}
              - {ProofConclusionIds.Method} => {ProofConclusionCategories.Method}
              - {ProofConclusionIds.Opportunity} => {ProofConclusionCategories.Opportunity}
              - {ProofConclusionIds.Identity} => {ProofConclusionCategories.Identity}
              - {ProofConclusionIds.Timeline} => {ProofConclusionCategories.Timeline}
              Evidence and statements are generated before ProofGraph, so supportsConclusionIds must use only these predeclared IDs.
              ProofGraph must contain exactly one conclusion for each pair. Its supportingTraceIds/supportingStatementIds
              must be reciprocal: every listed source must contain that same conclusion ID in supportsConclusionIds.
              """
            : string.Empty;
        return $"""
            You are producing only the {artifact} artifact of {CaseTruthSchemaVersions.V2}.
            {instruction}
            {proofIdContract}
            All upstream JSON is immutable. Never rewrite, rename, or reinterpret upstream IDs or facts.
            HARD GENERATION BUDGET: suspects <= {budget.MaxSuspects}; locations <= {budget.MaxLocations};
            timeline events <= {budget.MaxTimelineEvents}; traces <= {budget.MaxTraces}; statements <= {budget.MaxStatements}; red herrings <= {budget.MaxRedHerrings};
            opportunity rows exactly equal the suspect count; proof conclusions exactly {budget.ProofConclusionCount};
            IDs <= {budget.MaxIdLength} characters; descriptive strings <= {budget.MaxDescriptionLength} characters.
            Do not output gameplay scenes, discovery routes, puzzles, deductions, accusation UI, or player success text.
            Keep descriptive prose compact and factual. Use one short sentence per text field where possible;
            do not restate the full story inside each event, trace, statement, or conclusion.
            {correction}

            STORY PREVIEW:
            {JsonSerializer.Serialize(draft.StoryPreview, CompactJson)}
            STORY DIVERSITY CONTRACT:
            {JsonSerializer.Serialize(draft.StoryDiversity, CompactJson)}
            CREATOR DIRECTION:
            {draft.Prompt}
            LOCKED UPSTREAM:
            {BuildTruthUpstreamSnapshot(artifact, truth)}
            """;
    }

    private static string BuildTruthUpstreamSnapshot(string artifact, CaseTruthPackage truth)
    {
        object value = artifact switch
        {
            CaseTruthArtifacts.CaseSeed => new { },
            CaseTruthArtifacts.CoreTruth => new { truth.CaseSeed },
            CaseTruthArtifacts.Timeline => new { truth.CaseSeed, truth.CoreTruth },
            CaseTruthArtifacts.Opportunity => new { truth.CaseSeed, truth.CoreTruth, truth.TrueTimeline },
            CaseTruthArtifacts.Evidence => new { truth.CaseSeed, truth.CoreTruth, truth.TrueTimeline, truth.OpportunityMatrix },
            CaseTruthArtifacts.Statements => new { truth.CaseSeed, truth.CoreTruth, truth.TrueTimeline, truth.OpportunityMatrix, truth.TraceLedger },
            _ => new { truth.CaseSeed, truth.CoreTruth, truth.TrueTimeline, truth.OpportunityMatrix, truth.TraceLedger, truth.StatementLedger }
        };
        return JsonSerializer.Serialize(value, CompactJson);
    }

    internal static int TruthTraceBudget(AiCaseDraft draft) =>
        TruthBudgetForDraft(draft).MaxTraces;

    private static List<AiArtifactProvenance> BuildTruthProvenance(AiCaseDraft draft, CaseTruthPackage truth)
    {
        var artifacts = new (string Name, object Value)[]
        {
            (CaseTruthArtifacts.CaseSeed, truth.CaseSeed),
            (CaseTruthArtifacts.CoreTruth, truth.CoreTruth),
            (CaseTruthArtifacts.Timeline, truth.TrueTimeline),
            (CaseTruthArtifacts.Opportunity, truth.OpportunityMatrix),
            (CaseTruthArtifacts.Evidence, truth.TraceLedger),
            (CaseTruthArtifacts.Statements, truth.StatementLedger),
            (CaseTruthArtifacts.ProofGraph, new { truth.ProofGraph, truth.RedHerringLedger })
        };
        var inputHash = Sha256(JsonSerializer.Serialize(new
        {
            draft.StoryPreview,
            draft.StoryDiversity,
            draft.StoryFingerprint,
            draft.Prompt,
            draft.Settings
        }, PrettyJson));
        var generatedAt = DateTime.UtcNow;
        var result = new List<AiArtifactProvenance>();
        foreach (var artifact in artifacts)
        {
            var outputHash = Sha256(JsonSerializer.Serialize(artifact.Value, PrettyJson));
            result.Add(new AiArtifactProvenance
            {
                Artifact = artifact.Name,
                InputHash = inputHash,
                OutputHash = outputHash,
                IsStale = false,
                GeneratedAt = generatedAt
            });
            inputHash = outputHash;
        }
        return result;
    }

    private static void RecordArtifactProvenance(AiCaseDraft draft, string artifact, string serializedOutput)
    {
        var inputHash = draft.ArtifactProvenance.LastOrDefault(item => !item.IsStale)?.OutputHash ?? draft.TruthHash;
        draft.ArtifactProvenance.RemoveAll(item => item.Artifact == artifact);
        draft.ArtifactProvenance.Add(new AiArtifactProvenance
        {
            Artifact = artifact,
            InputHash = inputHash,
            OutputHash = Sha256(serializedOutput),
            IsStale = false,
            GeneratedAt = DateTime.UtcNow
        });
    }

    private async Task<CaseTruthFeasibilityReview> ReviewTruthFeasibilityAsync(
        AiCaseDraft draft,
        CaseTruthPackage truth)
    {
        try
        {
            return await ReviewTruthFeasibilityCoreAsync(draft, truth);
        }
        catch (Exception ex) when (ex is ApiException or JsonException)
        {
            _logger.LogWarning(ex,
                "Advisory truth feasibility review was unavailable for draft {DraftId}; deterministic validation remains authoritative.",
                draft.Id);
            return UnavailableTruthReview("Truth feasibility reviewer was unavailable.");
        }
    }

    private async Task<CaseTruthFeasibilityReview> ReviewTruthFeasibilityCoreAsync(
        AiCaseDraft draft,
        CaseTruthPackage truth)
    {
        var canonical = _truthService.Canonicalize(truth);
        var raw = await GenerateJsonWithOpenAiAsync(
            draft.Id, "ReviewCaseTruthFeasibility", $"""
                Independently audit this locked detective-case truth. Do not repair or embellish it.
                Check time/travel feasibility, physical trace causality, witness observability, access/tools/knowledge,
                verified alibis, five-category proof coverage, and whether exactly one suspect fits all facts.
                availableFromMinute/availableToMinute is the interval in which a suspect could execute the complete
                locked crime-action chain; it is not the suspect's full presence schedule.
                PASSED is allowed only when every check succeeds and confidence is at least 0.80.
                Confidence measures confidence in your verdict, not a feasibility score. A FAILED verdict may have
                high confidence. For FAILED or AMBIGUOUS, return one structured finding per blocking defect using only
                the allowed finding codes, stable findingId values, and exact related IDs. Return legacy issues as [].
                Check retained physical mechanisms after resets, covert actions overlapping another actor at the same
                location, trace persistence for the stated elapsed time/environment, antecedents for altered records,
                objectively corroborated alibis, and whether IDENTITY evidence actually identifies an actor.
                Return findings without proposing story changes.

                LOCKED TRUTH:
                {canonical}
                """, 5000,
            AiGenerationSchemaVersions.CaseTruthReview,
            AiStrictSchemaProvider.CaseTruthFeasibilityReviewSchema(),
            await NextGenerationAttemptNumberAsync(draft.Id, AiGenerationSchemaVersions.CaseTruthReview),
            mockResponseFactory: () => JsonSerializer.Serialize(AiCaseMockFactory.BuildMockTruthReview(), PrettyJson),
            generationRunId: string.IsNullOrWhiteSpace(draft.GenerationRunId) ? null : draft.GenerationRunId);
        var review = JsonSerializer.Deserialize<CaseTruthFeasibilityReview>(StripMarkdownFences(raw), PrettyJson)
            ?? new CaseTruthFeasibilityReview
            {
                Status = CaseTruthReviewStatuses.Failed,
                SchemaVersion = CaseTruthSchemaVersions.FeasibilityReviewV2,
                Findings =
                {
                    new CaseTruthReviewFinding
                    {
                        FindingId = "reviewer-empty-result",
                        Code = CaseTruthReviewFindingCodes.Other,
                        Message = "Reviewer returned no result."
                    }
                }
            };
        review.ReviewedAt = DateTime.UtcNow;
        return review;
    }

    private async Task<BlindSolvabilityReview> ReviewBlindSolvabilityAsync(
        AiCaseDraft draft,
        GameCase gameCase)
    {
        if (!_settings.EnableBlindSolvabilityReview)
        {
            _logger.LogInformation(
                "Blind-solvability review is disabled by configuration for draft {DraftId}.",
                draft.Id);
            return DisabledBlindReview();
        }

        try
        {
            return await ReviewBlindSolvabilityCoreAsync(draft, gameCase);
        }
        catch (Exception ex) when (ex is ApiException or JsonException)
        {
            _logger.LogWarning(ex,
                "Advisory blind-solvability review was unavailable for draft {DraftId}; deterministic validation remains authoritative.",
                draft.Id);
            return UnavailableBlindReview("Blind-solvability reviewer was unavailable.");
        }
    }

    private async Task<BlindSolvabilityReview> ReviewBlindSolvabilityCoreAsync(
        AiCaseDraft draft,
        GameCase gameCase)
    {
        if (draft.CaseTruth is null) throw ApiException.Conflict("Approved truth is missing.");
        var playerKnowledge = _truthService.BuildBlindPlayerKnowledge(gameCase).ToJsonString(PrettyJson);
        var raw = await GenerateJsonWithOpenAiAsync(
            draft.Id, "ReviewBlindSolvability", $"""
                Act as a blind detective-game solver. Use only the player-visible information below.
                Infer culpritId, the exact motive and method strings, a concrete crime timeline, and a five-claim evidence chain.
                Do not assume hidden truth, success text, red-herring flags, or final answer metadata.
                PASSED requires exactly one reasonable solution and confidence >= 0.80.
                Confidence measures confidence in your verdict, not a solvability score. Return legacy issues as [].
                For FAILED or AMBIGUOUS, return structured findings with exact player-visible related IDs so a
                projection-only repair can address the reviewer feedback without changing locked truth.

                PLAYER-VISIBLE KNOWLEDGE:
                {playerKnowledge}
                """, 5000,
            AiGenerationSchemaVersions.BlindSolvabilityReview,
            AiStrictSchemaProvider.BlindSolvabilityReviewSchema(),
            await NextGenerationAttemptNumberAsync(draft.Id, AiGenerationSchemaVersions.BlindSolvabilityReview),
            mockResponseFactory: () => JsonSerializer.Serialize(AiCaseMockFactory.BuildMockBlindReview(draft.CaseTruth, gameCase), PrettyJson),
            generationRunId: draft.GenerationRunId);
        var review = JsonSerializer.Deserialize<BlindSolvabilityReview>(StripMarkdownFences(raw), PrettyJson)
            ?? new BlindSolvabilityReview
            {
                Status = CaseTruthReviewStatuses.Failed,
                SchemaVersion = CaseTruthSchemaVersions.BlindReviewV2,
                Findings =
                {
                    new CaseTruthReviewFinding
                    {
                        FindingId = "reviewer-empty-result",
                        Code = CaseTruthReviewFindingCodes.Other,
                        Message = "Reviewer returned no result."
                    }
                }
            };
        review.ReviewedAt = DateTime.UtcNow;
        return review;
    }

    private static CaseTruthFeasibilityReview UnavailableTruthReview(string message) => new()
    {
        Status = CaseTruthReviewStatuses.NotRun,
        SchemaVersion = CaseTruthSchemaVersions.FeasibilityReviewV2,
        ReviewedAt = DateTime.UtcNow,
        Findings =
        {
            new CaseTruthReviewFinding
            {
                FindingId = "truth-review-unavailable",
                Code = CaseTruthReviewFindingCodes.Other,
                Message = message
            }
        }
    };

    private static BlindSolvabilityReview UnavailableBlindReview(string message) => new()
    {
        Status = CaseTruthReviewStatuses.NotRun,
        SchemaVersion = CaseTruthSchemaVersions.BlindReviewV2,
        ReviewedAt = DateTime.UtcNow,
        Findings =
        {
            new CaseTruthReviewFinding
            {
                FindingId = "blind-review-unavailable",
                Code = CaseTruthReviewFindingCodes.Other,
                Message = message
            }
        }
    };

    private static BlindSolvabilityReview DisabledBlindReview() => new()
    {
        Status = CaseTruthReviewStatuses.NotRun,
        SchemaVersion = CaseTruthSchemaVersions.BlindReviewV2,
        ReviewedAt = DateTime.UtcNow
    };

    private static string AdvisoryReviewStatus(string? status) =>
        CaseTruthReviewStatuses.All.Contains(status ?? string.Empty)
            ? status!
            : CaseTruthReviewStatuses.NotRun;

    private void RequireApprovedTruth(AiCaseDraft draft)
    {
        if (draft.LogicContractVersion < CaseLogicContractVersions.CausalFiveClaim) return;
        if (draft.CaseTruth is null || string.IsNullOrWhiteSpace(draft.TruthHash))
            throw ApiException.Conflict("This draft has no approved case truth.", "CASE_TRUTH_REQUIRED", "ai.caseTruth.required");
        var validation = ValidateTruthForGameplay(
            draft,
            draft.CaseTruth,
            TruthBudgetForDraft(draft));
        if (_truthService.ComputeHash(draft.CaseTruth) != draft.TruthHash)
            validation.Add("TruthHashMismatch", "truthHash", "The saved truth no longer matches its approved hash.");
        if (!validation.IsValid)
            throw ApiException.Unprocessable("Approved case truth no longer passes its gate.", validation.Errors);
    }

    private CaseValidationResult ValidateTruthForGameplay(
        AiCaseDraft draft,
        CaseTruthPackage truth,
        AiTruthGenerationBudget budget)
    {
        var validation = _truthService.Validate(truth, budget);
        if (!validation.IsValid)
            return validation;

        validation.Errors.AddRange(_projectionPlanner.ValidateProjectability(draft, truth).Errors);
        if (!validation.IsValid)
            return validation;

        // The planner also owns stable distractor and acquisition allocation. Building it
        // here is pure and catches those late projectability failures before truth approval.
        try
        {
            _projectionPlanner.Build(draft, truth);
        }
        catch (ProjectionPlanningException ex)
        {
            foreach (var error in ex.Errors)
            {
                var path = error.Contains("challenge", StringComparison.OrdinalIgnoreCase)
                    ? "statementLedger"
                    : "trueTimeline.traceIds";
                validation.Add("ProjectionAllocationFailure", path, error);
            }
        }
        validation.Deduplicate();
        return validation;
    }

    private static AiTruthGenerationBudget TruthBudgetForDraft(AiCaseDraft draft) =>
        CaseTargetKinds.All.Contains(draft.PlannedTargetKind)
            ? AiTruthGenerationBudget.ForProjection(draft.Settings)
            : AiTruthGenerationBudget.For(draft.Settings);

    private void ApplyTruthServerOwnedFields(AiCaseDraft draft, GameCase gameCase, bool includeBlindStatus = false)
    {
        if (draft.LogicContractVersion < CaseLogicContractVersions.CausalFiveClaim) return;
        RequireApprovedTruth(draft);
        gameCase.LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim;
        gameCase.LogicVerificationStatus = CaseLogicVerificationStatuses.CausalVerified;
        gameCase.TruthSchemaVersion = draft.TruthSchemaVersion;
        gameCase.TruthHash = draft.TruthHash;
        gameCase.BlindReviewStatus = includeBlindStatus ? draft.BlindSolvabilityReview.Status : CaseTruthReviewStatuses.NotRun;
    }

    private async Task SaveInvalidTruthAsync(AiCaseDraft draft, CaseTruthPackage truth, string canonical, string hash,
        CaseValidationResult validation, CaseTruthFeasibilityReview? review = null)
    {
        var repairPlan = _truthService.PlanRepair(validation.Errors);
        await UpdateActiveRunAsync(draft, Builders<AiCaseDraft>.Update
            .Set(item => item.Status, AiDraftStatus.CaseTruthInvalid)
            .Set(item => item.CaseTruth, truth)
            .Set(item => item.CaseTruthJson, canonical)
            .Set(item => item.TruthSchemaVersion, truth.SchemaVersion)
            .Set(item => item.TruthHash, hash)
            .Set(item => item.TruthReviewerResult, review ?? new CaseTruthFeasibilityReview())
            .Set(item => item.TruthValidationReport, ValidationMessages(validation))
            .Set(item => item.TruthRepairRecommendedArtifact, repairPlan.RegenerateFromArtifact)
            .Set(item => item.TruthRepairFromArtifact, string.Empty)
            .Set(item => item.TruthRepairReasonCodes, repairPlan.ReasonCodes)
            .Set(item => item.ValidationErrors, ValidationMessages(validation))
            .Set(item => item.LastGenerationErrorCode,
                validation.Errors.Any(error => error.Code == "TRUTH_BUDGET_EXCEEDED")
                    ? "TRUTH_BUDGET_EXCEEDED"
                    : "CASE_TRUTH_INVALID")
            .Set(item => item.FailurePhase, AiFailurePhases.CaseTruth)
            .Set(item => item.UpdatedAt, DateTime.UtcNow));
    }

    private Task MarkTruthGenerationFailedAsync(AiCaseDraft draft, ApiException exception)
    {
        var typedErrors = exception.Errors is IEnumerable<CaseValidationError> errors
            ? errors.ToList()
            : new List<CaseValidationError>();
        var validationErrors = typedErrors.Count > 0
            ? ValidationMessages(typedErrors)
            : new List<string> { exception.Message };
        var errorCode = typedErrors.Any(error => error.Code == "TRUTH_BUDGET_EXCEEDED")
                ? "TRUTH_BUDGET_EXCEEDED"
                : "CASE_TRUTH_INVALID";
        var repairPlan = typedErrors.Count > 0
            ? _truthService.PlanRepair(typedErrors)
            : CaseTruthRepairPolicy.BuildPlan(CaseTruthArtifacts.Timeline);
        return UpdateActiveRunAsync(draft, Builders<AiCaseDraft>.Update
            .Set(item => item.Status, AiDraftStatus.CaseTruthInvalid)
            .Set(item => item.TruthValidationReport, validationErrors)
            .Set(item => item.TruthRepairRecommendedArtifact, repairPlan.RegenerateFromArtifact)
            .Set(item => item.TruthRepairFromArtifact, string.Empty)
            .Set(item => item.TruthRepairReasonCodes, repairPlan.ReasonCodes)
            .Set(item => item.ValidationErrors, validationErrors)
            .Set(item => item.LastGenerationErrorCode, errorCode)
            .Set(item => item.FailurePhase, AiFailurePhases.CaseTruth)
            .Set(item => item.UpdatedAt, DateTime.UtcNow));
    }

    private static string BuildCausalProjectionRequirements(AiCaseDraft draft) => $"""


        CAUSAL LOGIC CONTRACT V2 (overrides every conflicting three-claim or freeform-story instruction above):
        - The approved truth below is immutable. Never change culprit, target, motive, method, action timing, trace cause, statements, or proof graph.
        - Project all gameplay from truth; do not invent facts in clues, dialogue, puzzles, deductions, success text, or endings.
        - Every clue needs sourceActionId, supportsConclusionIds, and independentSourceGroup from the approved truth.
          sourceActionId is the physical/narrative cause; source, sourceType, discoverMethod, and acquisitionMethod are only player discovery routing.
        - Every dialogue needs statementIds and availableSceneIds. The character must actually be present in each available scene.
        - Every conversation node needs statementIds and availableSceneIds.
        - Every puzzle needs basedOnTruthIds, investigationPurpose, revealsConclusionIds, and progressionRole (REQUIRED, OPTIONAL, or ALTERNATE). It cannot create a new fact. OPTIONAL still needs a distinct useful payoff.
        - Every deduction needs conclusionId from the proof graph.
        - finalLogic culpritId, motive, and method must exactly equal approved truth.
        - finalLogic.requiredEvidenceLinks must contain five distinct evidence clues: MOTIVE, METHOD, OPPORTUNITY, IDENTITY, TIMELINE.
          The primary clue for each claim must support a conclusion of that category; the truth already contains an independent corroborating source.
        - Do not expose truth status, lie reasons, red-herring truth metadata, hidden review output, or the truth JSON in player-facing prose.
        - Rewards may have multiple producers only when declared in alternateRewardPaths with rewardId, all producerIds, and a reason.
        - Never consume an item that any later puzzle, interaction, or scene completion requires.
        - A bounded repair may change only the projection artifact named in correction text. It must not alter approved truth.

        LOCKED PROJECTION MAP (copy IDs and exact final values; do not infer replacements):
        {BuildCausalProjectionMap(draft.CaseTruth!)}

        APPROVED CANONICAL CASE TRUTH (server will hash-check conformance):
        {draft.CaseTruthJson}
        """;

    internal static string BuildCausalProjectionMap(CaseTruthPackage truth)
    {
        var tracesByAction = truth.TraceLedger
            .GroupBy(trace => trace.SourceActionId, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.Select(trace => new
                {
                    trace.TraceId,
                    trace.LocationId,
                    trace.IndependentSourceGroup,
                    trace.SupportsConclusionIds
                }).ToList(),
                StringComparer.Ordinal);
        var map = new
        {
            lockedFinal = new
            {
                truth.CoreTruth.CulpritId,
                truth.CoreTruth.Motive,
                truth.CoreTruth.Method
            },
            locationIds = truth.CaseSeed.LocationIds,
            actions = truth.TrueTimeline.Select(action => new
            {
                action.EventId,
                action.ActorId,
                action.LocationId,
                traces = tracesByAction.GetValueOrDefault(action.EventId) ?? []
            }),
            statementsBySpeaker = truth.StatementLedger
                .GroupBy(statement => statement.SpeakerId, StringComparer.Ordinal)
                .Select(group => new
                {
                    characterId = group.Key,
                    statementIds = group.Select(statement => statement.StatementId).ToList()
                }),
            conclusions = truth.ProofGraph.Conclusions.Select(conclusion => new
            {
                conclusion.ConclusionId,
                conclusion.Category
            })
        };
        return JsonSerializer.Serialize(map, CompactJson);
    }

    internal static string BuildProjectionRepairFeedback(
        CaseTruthPackage truth,
        GameCase gameCase,
        CaseValidationResult validation)
    {
        var lines = new List<string>
        {
            "Repair only the invalid gameplay projection. Approved truth is immutable.",
            "Use these exact targeted corrections:"
        };
        foreach (var error in validation.Errors.Take(40))
        {
            var reference = string.IsNullOrWhiteSpace(error.RefId)
                ? string.Empty
                : $" [ref: {error.RefId}]";
            var detail = ProjectionRepairDetail(truth, gameCase, error);
            lines.Add($"- {error.Code} {error.Path}{reference}: {error.Message}{detail}");
        }
        return string.Join("\n", lines);
    }

    private static string ProjectionRepairDetail(
        CaseTruthPackage truth,
        GameCase gameCase,
        CaseValidationError error)
    {
        if (error.Code == "TruthConformance")
        {
            var expected = error.Path switch
            {
                "finalLogic.culpritId" => truth.CoreTruth.CulpritId,
                "finalLogic.motive" => truth.CoreTruth.Motive,
                "finalLogic.method" => truth.CoreTruth.Method,
                _ => string.Empty
            };
            return string.IsNullOrEmpty(expected)
                ? string.Empty
                : $" Expected exact locked value={JsonSerializer.Serialize(expected)}.";
        }

        if (error.Code is "TraceLocationMismatch" or "MissingProofLink" or "ClaimOverreach"
            && !string.IsNullOrWhiteSpace(error.RefId))
        {
            var clue = gameCase.Clues.FirstOrDefault(item => item.ClueId == error.RefId);
            if (clue is null) return string.Empty;
            var source = truth.TrueTimeline.FirstOrDefault(item => item.EventId == clue.SourceActionId);
            var traces = truth.TraceLedger.Where(trace => trace.SourceActionId == clue.SourceActionId).ToList();
            var matching = string.IsNullOrWhiteSpace(clue.IndependentSourceGroup)
                ? traces
                : traces.Where(trace => trace.IndependentSourceGroup == clue.IndependentSourceGroup).ToList();
            var allowedTraces = matching.Count > 0 ? matching : traces;
            var allowedConclusions = allowedTraces.SelectMany(trace => trace.SupportsConclusionIds)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var allowedSourceGroups = traces.Select(trace => trace.IndependentSourceGroup)
                .Where(group => !string.IsNullOrWhiteSpace(group))
                .Distinct(StringComparer.Ordinal)
                .ToList();
            return $" Actual sceneId={JsonSerializer.Serialize(clue.SceneId)}; " +
                   $"expected sceneId={JsonSerializer.Serialize(source?.LocationId ?? string.Empty)}; " +
                   $"sourceActionId={JsonSerializer.Serialize(clue.SourceActionId)}; " +
                   $"actual independentSourceGroup={JsonSerializer.Serialize(clue.IndependentSourceGroup)}; " +
                   $"allowed independentSourceGroup={JsonSerializer.Serialize(allowedSourceGroups)}; " +
                   $"actual supportsConclusionIds={JsonSerializer.Serialize(clue.SupportsConclusionIds)}; " +
                   $"allowed supportsConclusionIds={JsonSerializer.Serialize(allowedConclusions)}.";
        }

        if (error.Code == "StatementSpeakerMismatch"
            && TryPathIndex(error.Path, out var dialogueIndex)
            && dialogueIndex >= 0)
        {
            var isConversation = error.Path.StartsWith("conversationNodes", StringComparison.Ordinal);
            var characterId = isConversation && dialogueIndex < gameCase.ConversationNodes.Count
                ? gameCase.ConversationNodes[dialogueIndex].CharacterId
                : dialogueIndex < gameCase.Dialogues.Count
                    ? gameCase.Dialogues[dialogueIndex].CharacterId
                    : string.Empty;
            if (string.IsNullOrWhiteSpace(characterId)) return string.Empty;
            var actual = isConversation && dialogueIndex < gameCase.ConversationNodes.Count
                ? gameCase.ConversationNodes[dialogueIndex].StatementIds
                : dialogueIndex < gameCase.Dialogues.Count
                    ? gameCase.Dialogues[dialogueIndex].StatementIds
                    : [];
            var allowed = truth.StatementLedger
                .Where(statement => statement.SpeakerId == characterId)
                .Select(statement => statement.StatementId)
                .ToList();
            return $" Dialogue characterId={JsonSerializer.Serialize(characterId)}; " +
                   $"actual statementIds={JsonSerializer.Serialize(actual)}; " +
                   $"allowed statementIds={JsonSerializer.Serialize(allowed)}.";
        }

        if (error.Code == "MissingTruthLocationScene")
            return $" Add the exact sceneId={JsonSerializer.Serialize(error.RefId ?? string.Empty)}.";
        return string.Empty;
    }

    private static bool TryPathIndex(string path, out int index)
    {
        index = -1;
        var open = path.IndexOf('[', StringComparison.Ordinal);
        var close = path.IndexOf(']', open + 1);
        return open >= 0 && close > open + 1
            && int.TryParse(path.AsSpan(open + 1, close - open - 1), out index);
    }

    private static string FormatValidation(CaseValidationResult validation) =>
        string.Join("\n", validation.Errors.Take(40).Select(error =>
            $"- {error.Code} {error.Path}{(string.IsNullOrWhiteSpace(error.RefId) ? string.Empty : $" [ref: {error.RefId}]")}: {error.Message}"));

    private static List<string> ValidationMessages(CaseValidationResult validation) =>
        ValidationMessages(validation.Errors);

    private static List<string> ValidationMessages(IEnumerable<CaseValidationError> errors) =>
        errors.Select(error =>
            $"{error.Code} {error.Path}" +
            $"{(string.IsNullOrWhiteSpace(error.RefId) ? string.Empty : $" [ref: {error.RefId}]")}: {error.Message}")
            .Distinct(StringComparer.Ordinal)
            .ToList();

    private CaseTruthRepairPlan DetermineTruthRepairPlan(AiCaseDraft draft, CaseValidationResult validation)
    {
        if (!validation.IsValid)
            return _truthService.PlanRepair(validation.Errors);
        var resumableArtifact = NextTruthArtifact(draft.TruthCheckpointArtifact);
        if (resumableArtifact is not null) return CaseTruthRepairPolicy.BuildPlan(resumableArtifact);
        if (draft.TruthReviewerResult.Status is CaseTruthReviewStatuses.Failed or CaseTruthReviewStatuses.Ambiguous)
            return CaseTruthRepairPolicy.PlanReview(draft.TruthReviewerResult);
        return CaseTruthRepairPolicy.BuildPlan(CaseTruthArtifacts.CoreTruth);
    }

    internal static string BuildTruthReviewFeedback(CaseTruthFeasibilityReview review)
    {
        var lines = new List<string>
        {
            $"Reviewer status={review.Status}; confidence={review.Confidence:0.00}; " +
            $"timelineFeasible={review.TimelineFeasible}; physicalCausalityFeasible={review.PhysicalCausalityFeasible}; " +
            $"uniqueSolution={review.UniqueSolution}."
        };
        lines.AddRange(review.Findings.Select(finding =>
            $"- {finding.Code} [{string.Join(", ", finding.RelatedIds)}]: {finding.Message}"));
        lines.AddRange(review.Issues.Select(issue => $"- LEGACY_REVIEW_ISSUE: {issue}"));
        if (lines.Count == 1) lines.Add("- No detailed reviewer finding was persisted; perform a conservative timeline repair.");
        return string.Join("\n", lines);
    }

    internal static string BuildBlindReviewFeedback(BlindSolvabilityReview review)
    {
        var lines = new List<string>
        {
            $"Blind reviewer status={review.Status}; confidence={review.Confidence:0.00}; uniqueSolution={review.UniqueSolution}; " +
            $"inferredCulpritId={review.CulpritId}."
        };
        lines.AddRange(review.Findings.Select(finding =>
            $"- {finding.Code} [{string.Join(", ", finding.RelatedIds)}]: {finding.Message}"));
        lines.AddRange(review.Issues.Select(issue => $"- LEGACY_REVIEW_ISSUE: {issue}"));
        return string.Join("\n", lines);
    }

    private CaseValidationResult ValidateGeneratedFeasibilityReview(CaseTruthFeasibilityReview review)
    {
        var result = _truthService.ValidateFeasibilityReview(review);
        if (review.SchemaVersion != CaseTruthSchemaVersions.FeasibilityReviewV2
            && !result.Errors.Any(error => error.Code == "InvalidReviewSchema"))
            result.Add("InvalidReviewSchema", "truthReview.schemaVersion",
                "New feasibility reviews must use case-truth-feasibility-review-v2.");
        return result;
    }

    private CaseValidationResult ValidateGeneratedBlindReview(CaseTruthPackage truth, BlindSolvabilityReview review)
    {
        if (!_settings.EnableBlindSolvabilityReview)
            return new CaseValidationResult();

        var result = _truthService.ValidateBlindReview(truth, review);
        if (review.SchemaVersion != CaseTruthSchemaVersions.BlindReviewV2
            && !result.Errors.Any(error => error.Code == "InvalidReviewSchema"))
            result.Add("InvalidReviewSchema", "blindReview.schemaVersion",
                "New blind reviews must use case-blind-solvability-review-v2.");
        return result;
    }

    private void LogAdvisoryTruthReview(string draftId, CaseTruthFeasibilityReview review, string selectedScope)
    {
        _logger.LogWarning(
            "TruthReviewAdvisory DraftId={DraftId} Status={Status} TimelineFeasible={TimelineFeasible} " +
            "PhysicalCausalityFeasible={PhysicalCausalityFeasible} UniqueSolution={UniqueSolution} " +
            "Confidence={Confidence} FindingCodes={FindingCodes} FindingCount={FindingCount} SelectedScope={SelectedScope}",
            draftId,
            review.Status,
            review.TimelineFeasible,
            review.PhysicalCausalityFeasible,
            review.UniqueSolution,
            review.Confidence,
            review.Findings.Select(finding => finding.Code).Distinct(StringComparer.Ordinal).ToArray(),
            review.Findings.Count + review.Issues.Count,
            selectedScope);
    }

    private void LogAdvisoryBlindReview(
        string draftId,
        BlindSolvabilityReview review,
        CaseValidationResult reviewValidation)
    {
        _logger.LogWarning(
            "BlindReviewAdvisory DraftId={DraftId} Status={Status} UniqueSolution={UniqueSolution} " +
            "Confidence={Confidence} FindingCodes={FindingCodes} ValidationCodes={ValidationCodes}",
            draftId,
            review.Status,
            review.UniqueSolution,
            review.Confidence,
            review.Findings.Select(finding => finding.Code).Distinct(StringComparer.Ordinal).ToArray(),
            reviewValidation.Errors.Select(error => error.Code).Distinct(StringComparer.Ordinal).ToArray());
    }
}
