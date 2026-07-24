using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

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
            var truth = await GenerateTruthStagesAsync(draft, persistCheckpoints: true);
            var budget = AiTruthGenerationBudget.For(draft.Settings);
            var validation = _truthService.Validate(truth, budget);

            if (!validation.IsValid)
            {
                var feedback = FormatValidation(validation);
                var plan = _truthService.PlanRepair(validation.Errors);
                truth = await GenerateTruthStagesAsync(draft, truth, plan.RegenerateFromArtifact,
                    $"One scoped deterministic repair is allowed. Fix these errors without weakening constraints:\n{feedback}",
                    persistCheckpoints: true);
                validation = _truthService.Validate(truth, budget);
            }

            var canonical = _truthService.Canonicalize(truth);
            var hash = _truthService.ComputeHash(truth);
            if (!validation.IsValid)
            {
                await SaveInvalidTruthAsync(draft, truth, canonical, hash, validation);
                return AiDraftResponse.From(await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync());
            }

            var review = await ReviewTruthFeasibilityAsync(draft, truth);
            var reviewValidation = _truthService.ValidateFeasibilityReview(review);
            if (!reviewValidation.IsValid)
            {
                validation.Errors.AddRange(reviewValidation.Errors);
                await SaveInvalidTruthAsync(draft, truth, canonical, hash, validation, review);
                return AiDraftResponse.From(await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync());
            }

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
                .Set(item => item.ArtifactProvenance, provenance)
                .Set(item => item.FailurePhase, AiFailurePhases.None)
                .Set(item => item.UpdatedAt, DateTime.UtcNow));
            return AiDraftResponse.From(await _db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync());
        }
        catch (ApiException ex)
        {
            await MarkTruthGenerationFailedAsync(draft, ex.Message);
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
        var stored = await _db.AiCaseDrafts.FindOneAndUpdateAsync(
            item => item.Id == draft.Id
                && item.WorkflowVersion == draft.WorkflowVersion
                && item.Status == draft.Status
                && item.QueueState == AiQueueStates.None,
            Builders<AiCaseDraft>.Update
                .Set(item => item.TruthRepairInstructions, instructions)
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
        var budget = AiTruthGenerationBudget.For(draft.Settings);
        var currentValidation = _truthService.Validate(draft.CaseTruth, budget);
        var resumableArtifact = NextTruthArtifact(draft.TruthCheckpointArtifact);
        var plan = resumableArtifact is not null
            ? new CaseTruthRepairPlan
            {
                RegenerateFromArtifact = resumableArtifact,
                InvalidArtifacts = { resumableArtifact }
            }
            : currentValidation.IsValid
            ? new CaseTruthRepairPlan
            {
                RegenerateFromArtifact = draft.TruthReviewerResult.Status is CaseTruthReviewStatuses.Failed or CaseTruthReviewStatuses.Ambiguous
                    ? CaseTruthArtifacts.Evidence
                    : CaseTruthArtifacts.CoreTruth
            }
            : _truthService.PlanRepair(currentValidation.Errors);
        var feedback = currentValidation.IsValid ? "No deterministic error is currently recorded." : FormatValidation(currentValidation);
        var candidate = await GenerateTruthStagesAsync(draft, draft.CaseTruth, plan.RegenerateFromArtifact, $"""
            Create one scoped repair candidate starting at artifact {plan.RegenerateFromArtifact}.
            Preserve every valid upstream field exactly. Never relax a validator and never change unrelated truth.
            Admin direction: {instructions}
            Current validation:
            {feedback}
            """);
        var validation = _truthService.Validate(candidate, budget);
        var review = validation.IsValid
            ? await ReviewTruthFeasibilityAsync(draft, candidate)
            : new CaseTruthFeasibilityReview();
        if (validation.IsValid) validation.Errors.AddRange(_truthService.ValidateFeasibilityReview(review).Errors);
        var status = validation.IsValid ? AiRepairStatus.CandidateReady : AiRepairStatus.CandidateInvalid;
        await UpdateActiveRunAsync(
            draft,
            Builders<AiCaseDraft>.Update
                .Set(item => item.TruthRepairCandidate, candidate)
                .Set(item => item.TruthRepairCandidateJson, _truthService.Canonicalize(candidate))
                .Set(item => item.TruthRepairStatus, status)
                .Set(item => item.TruthRepairValidationReport, ValidationMessages(validation))
                .Set(item => item.TruthRepairReviewerResult, review)
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
        var validation = _truthService.Validate(
            draft.TruthRepairCandidate,
            AiTruthGenerationBudget.For(draft.Settings));
        validation.Errors.AddRange(_truthService.ValidateFeasibilityReview(draft.TruthRepairReviewerResult).Errors);
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
        var budget = AiTruthGenerationBudget.For(draft.Settings);
        var truth = checkpoint is null
            ? new CaseTruthPackage { SchemaVersion = CaseTruthSchemaVersions.V1 }
            : JsonSerializer.Deserialize<CaseTruthPackage>(JsonSerializer.Serialize(checkpoint, PrettyJson), PrettyJson)!;
        var order = new[]
        {
            CaseTruthArtifacts.CaseSeed, CaseTruthArtifacts.CoreTruth, CaseTruthArtifacts.Timeline,
            CaseTruthArtifacts.Opportunity, CaseTruthArtifacts.Evidence, CaseTruthArtifacts.Statements,
            CaseTruthArtifacts.ProofGraph
        };
        var start = regenerateFromArtifact is null ? 0 : Array.IndexOf(order, regenerateFromArtifact);
        if (start < 0) start = order.Length - 1;

        string StageCorrection(int index) => index == start ? correction ?? string.Empty : string.Empty;
        if (start <= 0)
        {
            var artifact = await GenerateTruthStageAsync<GeneratedCaseSeedArtifact>(
                draft, "GenerateCaseSeed", AiGenerationSchemaVersions.CaseSeed,
                AiStrictSchemaProvider.CaseSeedSchema(budget), BuildTruthStagePrompt(draft, CaseTruthArtifacts.CaseSeed, truth, StageCorrection(0)));
            truth.CaseSeed = artifact.CaseSeed;
            if (persistCheckpoints) await SaveTruthCheckpointAsync(draft, truth, CaseTruthArtifacts.CaseSeed, 12);
        }
        if (start <= 1)
        {
            var suspectIds = RequireTruthReferenceIds(truth.CaseSeed.SuspectIds, "caseSeed.suspectIds");
            var artifact = await GenerateTruthStageAsync<GeneratedCoreTruthArtifact>(
                draft, "GenerateCoreTruth", AiGenerationSchemaVersions.CoreTruth,
                AiStrictSchemaProvider.CoreTruthSchema(budget, suspectIds), BuildTruthStagePrompt(draft, CaseTruthArtifacts.CoreTruth, truth, StageCorrection(1)));
            truth.CoreTruth = artifact.CoreTruth;
            if (persistCheckpoints) await SaveTruthCheckpointAsync(draft, truth, CaseTruthArtifacts.CoreTruth, 24);
        }
        if (start <= 2)
        {
            var suspectIds = RequireTruthReferenceIds(truth.CaseSeed.SuspectIds, "caseSeed.suspectIds");
            var locationIds = RequireTruthReferenceIds(truth.CaseSeed.LocationIds, "caseSeed.locationIds");
            var targetId = RequireTruthReferenceIds([truth.CoreTruth.TargetId], "coreTruth.targetId").Single();
            var schema = AiStrictSchemaProvider.TrueTimelineSchema(budget, suspectIds, targetId, locationIds);
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
                throw ApiException.Unprocessable(
                    "Timeline references remained invalid after their single scoped retry.",
                    timelineResult.Validation.Errors);
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
            var artifact = await GenerateTruthStageAsync<GeneratedTraceArtifact>(
                draft, "GenerateCausalEvidence", AiGenerationSchemaVersions.TraceLedger,
                AiStrictSchemaProvider.TraceLedgerSchema(budget, eventIds, plannedTraceIds), BuildTruthStagePrompt(draft, CaseTruthArtifacts.Evidence, truth, StageCorrection(4)));
            truth.TraceLedger = artifact.TraceLedger;
            var traceValidation = ValidateGeneratedTraceSet(truth.TraceLedger, plannedTraceIds);
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
                throw ApiException.Unprocessable(
                    "Generated trace IDs must match the distinct timeline-planned trace IDs exactly.",
                    traceValidation.Errors);
        }
        if (start <= 5)
        {
            var speakerIds = RequireTruthReferenceIds(
                truth.CaseSeed.SuspectIds.Append(truth.CoreTruth.TargetId), "statement speaker IDs");
            var eventIds = RequireTruthReferenceIds(
                CaseTruthReferenceContract.TimelineEventIds(truth.TrueTimeline), "trueTimeline.eventId");
            var traceIds = RequireTruthReferenceIds(truth.TraceLedger.Select(item => item.TraceId), "traceLedger.traceId");
            var artifact = await GenerateTruthStageAsync<GeneratedStatementArtifact>(
                draft, "BuildStatements", AiGenerationSchemaVersions.StatementLedger,
                AiStrictSchemaProvider.StatementLedgerSchema(budget, speakerIds, eventIds, traceIds), BuildTruthStagePrompt(draft, CaseTruthArtifacts.Statements, truth, StageCorrection(5)));
            truth.StatementLedger = artifact.StatementLedger;
            if (persistCheckpoints) await SaveTruthCheckpointAsync(draft, truth, CaseTruthArtifacts.Statements, 72);
        }
        if (start <= 6)
        {
            var suspectIds = RequireTruthReferenceIds(truth.CaseSeed.SuspectIds, "caseSeed.suspectIds");
            var traceIds = RequireTruthReferenceIds(truth.TraceLedger.Select(item => item.TraceId), "traceLedger.traceId");
            var statementIds = RequireTruthReferenceIds(
                truth.StatementLedger.Select(item => item.StatementId), "statementLedger.statementId");
            var artifact = await GenerateTruthStageAsync<GeneratedProofArtifact>(
                draft, "BuildProofGraph", AiGenerationSchemaVersions.ProofGraph,
                AiStrictSchemaProvider.ProofGraphSchema(budget, suspectIds, traceIds, statementIds), BuildTruthStagePrompt(draft, CaseTruthArtifacts.ProofGraph, truth, StageCorrection(6)));
            truth.ProofGraph = artifact.ProofGraph;
            truth.RedHerringLedger = artifact.RedHerringLedger;
            if (persistCheckpoints) await SaveTruthCheckpointAsync(draft, truth, CaseTruthArtifacts.ProofGraph, 84);
        }
        return truth;
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
        if (validation.IsValid)
            return new TimelineReferenceGenerationResult(artifact, validation, 1);

        var correction = $"""
            {initialCorrection}
            ONE SCOPED TIMELINE REFERENCE REPAIR:
            Copy every distinct core action ID verbatim into exactly one trueTimeline.eventId.
            Never place a replacement causal ID in action prose. Keep CASE_SEED and CORE_TRUTH unchanged.
            Fix these errors:
            {FormatValidation(validation)}
            """;
        artifact = await generate(correction);
        validation = validate(artifact);
        return new TimelineReferenceGenerationResult(artifact, validation, 2);
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
        var budget = AiTruthGenerationBudget.For(draft.Settings);
        var instruction = artifact switch
        {
            CaseTruthArtifacts.CaseSeed => "Lock crime type, era, technology constraints, difficulty, duration, stable suspect IDs, location IDs, and a complete travel-time graph. Do not choose a culprit yet.",
            CaseTruthArtifacts.CoreTruth => "Using only the locked seed, choose one culprit and lock target, motive, method, and IDs for preparation, crime, concealment, and culprit-mistake actions. Every generated action ID becomes a canonical timeline eventId in the next stage. Do not write evidence or gameplay.",
            CaseTruthArtifacts.Timeline => $"Build the true minute-based timeline for every core action plus necessary alibi/witness events. Every distinct core action ID must be copied verbatim exactly once into eventId; auxiliary alibi and witness eventIds are allowed. The action field is prose and prose must never define, embed, normalize, or alias a second causal ID. Include actor, location, duration, travel, required access/tools/knowledge, witnesses, SIGHT/HEARING observation conditions, and planned trace IDs. No actor can overlap or teleport. Declare no more than {budget.MaxTraces} trace IDs total and no more than two per event; every trace must have a distinct investigative purpose.",
            CaseTruthArtifacts.Opportunity => "Build one opportunity row per suspect from the locked timeline: motive, access, tools, knowledge, available window, verified alibi, identity linkage, and a causal elimination reason for every non-culprit. Every alibiEventIds item must copy an exact timeline eventId, case-sensitively.",
            CaseTruthArtifacts.Evidence => "Create every trace declared by timeline actions. sourceActionId must copy an exact timeline eventId, case-sensitively; never derive it from action prose. traceId must copy one planned trace ID exactly once. Each trace must name its creator, exact time/location, physical cause, persistence, bounded proves/does-not-prove statements, independent group, and one or two IDs from the locked proof-ID contract below.",
            CaseTruthArtifacts.Statements => "Create statements only from locked events and knowledge sources. eventIds must copy exact timeline eventIds and contradictedByTraceIds must copy exact trace-ledger IDs, case-sensitively. Mark TRUE/FALSE/MISLEADING, provide a reason for every lie, independent source group, and one or two IDs from the locked proof-ID contract below.",
            _ => "Build exactly five proof conclusions using the locked ID/category pairs below, plus the red-herring ledger. supportingTraceIds and clearingTraceIds must copy exact locked trace-ledger IDs; supportingStatementIds and clearingStatementIds must copy exact locked statement-ledger IDs; excluded and red-herring suspect IDs must copy exact locked suspect IDs. Aggregate all relevant support under those five conclusions; cover each category with at least two independent source groups; identity must connect culprit to a crime action; eliminate every other suspect; every red herring needs clearing evidence."
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
            You are producing only the {artifact} artifact of CaseTruthPackage v1.
            {instruction}
            {proofIdContract}
            All upstream JSON is immutable. Never rewrite, rename, or reinterpret upstream IDs or facts.
            HARD GENERATION BUDGET: suspects <= {budget.MaxSuspects}; locations <= {budget.MaxLocations};
            timeline events <= {budget.MaxTimelineEvents}; traces <= {budget.MaxTraces}; statements <= {budget.MaxStatements};
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
        AiTruthGenerationBudget.For(draft.Settings).MaxTraces;

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

    private async Task<CaseTruthFeasibilityReview> ReviewTruthFeasibilityAsync(AiCaseDraft draft, CaseTruthPackage truth)
    {
        var canonical = _truthService.Canonicalize(truth);
        var raw = await GenerateJsonWithOpenAiAsync(
            draft.Id, "ReviewCaseTruthFeasibility", $"""
                Independently audit this locked detective-case truth. Do not repair or embellish it.
                Check time/travel feasibility, physical trace causality, witness observability, access/tools/knowledge,
                verified alibis, five-category proof coverage, and whether exactly one suspect fits all facts.
                PASSED is allowed only when every check succeeds and confidence is at least 0.80.
                Return issues without proposing story changes.

                LOCKED TRUTH:
                {canonical}
                """, 5000,
            AiGenerationSchemaVersions.CaseTruthReview,
            AiStrictSchemaProvider.CaseTruthFeasibilityReviewSchema(),
            await NextGenerationAttemptNumberAsync(draft.Id, AiGenerationSchemaVersions.CaseTruthReview),
            mockResponseFactory: () => JsonSerializer.Serialize(AiCaseMockFactory.BuildMockTruthReview(), PrettyJson),
            generationRunId: string.IsNullOrWhiteSpace(draft.GenerationRunId) ? null : draft.GenerationRunId);
        var review = JsonSerializer.Deserialize<CaseTruthFeasibilityReview>(StripMarkdownFences(raw), PrettyJson)
            ?? new CaseTruthFeasibilityReview { Status = CaseTruthReviewStatuses.Failed, Issues = { "Reviewer returned no result." } };
        review.ReviewedAt = DateTime.UtcNow;
        return review;
    }

    private async Task<BlindSolvabilityReview> ReviewBlindSolvabilityAsync(AiCaseDraft draft, GameCase gameCase)
    {
        if (draft.CaseTruth is null) throw ApiException.Conflict("Approved truth is missing.");
        var playerKnowledge = _truthService.BuildBlindPlayerKnowledge(gameCase).ToJsonString(PrettyJson);
        var raw = await GenerateJsonWithOpenAiAsync(
            draft.Id, "ReviewBlindSolvability", $"""
                Act as a blind detective-game solver. Use only the player-visible information below.
                Infer culpritId, the exact motive and method strings, a concrete crime timeline, and a five-claim evidence chain.
                Do not assume hidden truth, success text, red-herring flags, or final answer metadata.
                PASSED requires exactly one reasonable solution and confidence >= 0.80.

                PLAYER-VISIBLE KNOWLEDGE:
                {playerKnowledge}
                """, 5000,
            AiGenerationSchemaVersions.BlindSolvabilityReview,
            AiStrictSchemaProvider.BlindSolvabilityReviewSchema(),
            await NextGenerationAttemptNumberAsync(draft.Id, AiGenerationSchemaVersions.BlindSolvabilityReview),
            mockResponseFactory: () => JsonSerializer.Serialize(AiCaseMockFactory.BuildMockBlindReview(draft.CaseTruth, gameCase), PrettyJson),
            generationRunId: draft.GenerationRunId);
        var review = JsonSerializer.Deserialize<BlindSolvabilityReview>(StripMarkdownFences(raw), PrettyJson)
            ?? new BlindSolvabilityReview { Status = CaseTruthReviewStatuses.Failed, Issues = { "Reviewer returned no result." } };
        review.ReviewedAt = DateTime.UtcNow;
        return review;
    }

    private void RequireApprovedTruth(AiCaseDraft draft)
    {
        if (draft.LogicContractVersion < CaseLogicContractVersions.CausalFiveClaim) return;
        if (draft.CaseTruth is null || string.IsNullOrWhiteSpace(draft.TruthHash))
            throw ApiException.Conflict("This draft has no approved case truth.", "CASE_TRUTH_REQUIRED", "ai.caseTruth.required");
        var validation = _truthService.Validate(
            draft.CaseTruth,
            AiTruthGenerationBudget.For(draft.Settings));
        validation.Errors.AddRange(_truthService.ValidateFeasibilityReview(draft.TruthReviewerResult).Errors);
        if (_truthService.ComputeHash(draft.CaseTruth) != draft.TruthHash)
            validation.Add("TruthHashMismatch", "truthHash", "The saved truth no longer matches its approved hash.");
        if (!validation.IsValid)
            throw ApiException.Unprocessable("Approved case truth no longer passes its gate.", validation.Errors);
    }

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
        await UpdateActiveRunAsync(draft, Builders<AiCaseDraft>.Update
            .Set(item => item.Status, AiDraftStatus.CaseTruthInvalid)
            .Set(item => item.CaseTruth, truth)
            .Set(item => item.CaseTruthJson, canonical)
            .Set(item => item.TruthSchemaVersion, truth.SchemaVersion)
            .Set(item => item.TruthHash, hash)
            .Set(item => item.TruthReviewerResult, review ?? new CaseTruthFeasibilityReview())
            .Set(item => item.TruthValidationReport, ValidationMessages(validation))
            .Set(item => item.ValidationErrors, ValidationMessages(validation))
            .Set(item => item.LastGenerationErrorCode,
                validation.Errors.Any(error => error.Code == "TRUTH_BUDGET_EXCEEDED")
                    ? "TRUTH_BUDGET_EXCEEDED"
                    : "CASE_TRUTH_INVALID")
            .Set(item => item.FailurePhase, AiFailurePhases.CaseTruth)
            .Set(item => item.UpdatedAt, DateTime.UtcNow));
    }

    private Task MarkTruthGenerationFailedAsync(AiCaseDraft draft, string message) =>
        UpdateActiveRunAsync(draft, Builders<AiCaseDraft>.Update
            .Set(item => item.Status, AiDraftStatus.CaseTruthInvalid)
            .Set(item => item.TruthValidationReport, new List<string> { message })
            .Set(item => item.ValidationErrors, new List<string> { message })
            .Set(item => item.FailurePhase, AiFailurePhases.CaseTruth)
            .Set(item => item.UpdatedAt, DateTime.UtcNow));

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

        APPROVED CANONICAL CASE TRUTH (server will hash-check conformance):
        {draft.CaseTruthJson}
        """;

    private static string FormatValidation(CaseValidationResult validation) =>
        string.Join("\n", validation.Errors.Take(40).Select(error =>
            $"- {error.Code} {error.Path}{(string.IsNullOrWhiteSpace(error.RefId) ? string.Empty : $" [ref: {error.RefId}]")}: {error.Message}"));

    private static List<string> ValidationMessages(CaseValidationResult validation) =>
        validation.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}").ToList();
}
