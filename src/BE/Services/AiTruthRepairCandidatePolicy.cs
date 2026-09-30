using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Services;

internal static class AiTruthRepairCandidatePolicy
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly string[][] StageFields =
    [
        ["schemaVersion", "caseSeed"], ["coreTruth"], ["trueTimeline"], ["opportunityMatrix"],
        ["traceLedger"], ["statementLedger"], ["proofGraph", "redHerringLedger"]
    ];

    internal static CaseTruthRepairPlan Plan(ICaseTruthService service, CaseValidationResult validation,
        CaseTruthFeasibilityReview review)
    {
        var plans = new List<CaseTruthRepairPlan>();
        if (!validation.IsValid) plans.Add(service.PlanRepair(validation.Errors));
        if (review.Status is CaseTruthReviewStatuses.Failed or CaseTruthReviewStatuses.Ambiguous)
            plans.Add(CaseTruthRepairPolicy.PlanReview(review));
        return plans.Count > 0 ? CaseTruthRepairPolicy.Earliest(plans.ToArray())
            : CaseTruthRepairPolicy.BuildPlan(CaseTruthArtifacts.ProofGraph);
    }

    internal static CaseTruthRepairPlan PlanCurrent(AiCaseDraft draft, ICaseTruthService service,
        CaseValidationResult validation)
    {
        if (!validation.IsValid) return service.PlanRepair(validation.Errors);
        var next = AiCaseService.NextTruthArtifact(draft.TruthCheckpointArtifact);
        if (next is not null) return CaseTruthRepairPolicy.BuildPlan(next);
        if (draft.TruthReviewerResult.Status is CaseTruthReviewStatuses.Failed or CaseTruthReviewStatuses.Ambiguous)
            return CaseTruthRepairPolicy.PlanReview(draft.TruthReviewerResult);
        return CaseTruthRepairPolicy.BuildPlan(CaseTruthArtifacts.CoreTruth);
    }

    internal static CaseValidationResult ValidateCandidate(AiCaseDraft draft, CaseTruthPackage candidate,
        ICaseTruthService service, IGameplayProjectionPlanner planner)
    {
        var budget = Budget(draft);
        var failedIndex = Array.IndexOf(CaseTruthRepairPolicy.OrderedArtifacts, draft.TruthRepairFailedArtifact);
        if (failedIndex is >= 0 and < 6)
        {
            var next = CaseTruthRepairPolicy.OrderedArtifacts[failedIndex + 1];
            var validation = service.ValidateRepairPrefix(candidate, budget, draft.Settings, next);
            // Earlier failed stages leave downstream empty. If a repaired validator
            // now validates that stage, resume at the next stage instead of replaying it.
            if (validation.IsValid)
                validation.Add("IncompleteTruthArtifact", StageFields[failedIndex + 1][0],
                    $"The candidate is ready to generate {next}; downstream artifacts have not been validated.");
            return validation;
        }
        return ValidateForGameplay(draft, candidate, budget, service, planner);
    }

    internal static AiTruthGenerationBudget Budget(AiCaseDraft draft) =>
        CaseTargetKinds.All.Contains(draft.PlannedTargetKind)
            ? AiTruthGenerationBudget.ForProjection(draft.Settings)
            : AiTruthGenerationBudget.For(draft.Settings);

    internal static CaseValidationResult ValidateForGameplay(AiCaseDraft draft, CaseTruthPackage truth,
        AiTruthGenerationBudget budget, ICaseTruthService service, IGameplayProjectionPlanner planner)
    {
        var validation = service.Validate(truth, budget);
        if (!validation.IsValid) return validation;
        validation.Errors.AddRange(planner.ValidateProjectability(draft, truth).Errors);
        if (!validation.IsValid) return validation;
        try { planner.Build(draft, truth); }
        catch (ProjectionPlanningException ex)
        {
            foreach (var error in ex.Errors)
                validation.Add("ProjectionAllocationFailure",
                    error.Contains("challenge", StringComparison.OrdinalIgnoreCase) ? "statementLedger" : "trueTimeline.traceIds",
                    error);
        }
        validation.Deduplicate();
        return validation;
    }

    internal static string OriginalScope(AiCaseDraft draft) =>
        CaseTruthRepairPolicy.IsTruthArtifact(draft.TruthRepairOriginalFromArtifact)
            ? draft.TruthRepairOriginalFromArtifact : draft.TruthRepairFromArtifact;

    internal static void ValidateSavedCandidate(AiCaseDraft draft, ICaseTruthService service)
    {
        if (draft.TruthRepairStatus != AiRepairStatus.CandidateInvalid || draft.TruthRepairCandidate is null
            || draft.CaseTruth is null || string.IsNullOrWhiteSpace(draft.CaseTruthJson))
            throw ApiException.Conflict("There is no invalid repair candidate to continue.",
                "AI_TRUTH_REPAIR_CANDIDATE_UNAVAILABLE", "ai.caseTruth.repairCandidateUnavailable");
        ValidateSnapshot(draft, draft.TruthRepairCandidate, draft.TruthRepairCandidateHash,
            OriginalScope(draft), service);
        CaseTruthPackage? persisted;
        try { persisted = JsonSerializer.Deserialize<CaseTruthPackage>(draft.TruthRepairCandidateJson, JsonOptions); }
        catch (JsonException) { throw Stale(); }
        if (persisted is null || service.ComputeHash(persisted) != service.ComputeHash(draft.TruthRepairCandidate))
            throw Stale();
    }

    internal static void ValidateSnapshot(AiCaseDraft draft, CaseTruthPackage candidate, string hash,
        string originalScope, ICaseTruthService service)
    {
        if (draft.CaseTruth is null || !CaseTruthRepairPolicy.IsTruthArtifact(originalScope)
            || (!string.IsNullOrWhiteSpace(hash) && service.ComputeHash(candidate) != hash)
            || (!string.IsNullOrWhiteSpace(draft.TruthRepairBaseHash)
                && (string.IsNullOrWhiteSpace(hash)
                    || service.ComputeHash(draft.CaseTruth) != draft.TruthRepairBaseHash)))
            throw Stale();
        // Legacy candidates have no historical base hash. Bootstrap only against a
        // self-consistent current checkpoint; do not invent historical provenance.
        if (!string.IsNullOrWhiteSpace(draft.CaseTruthJson))
        {
            CaseTruthPackage? savedBase;
            try { savedBase = JsonSerializer.Deserialize<CaseTruthPackage>(draft.CaseTruthJson, JsonOptions); }
            catch (JsonException) { throw Stale(); }
            if (savedBase is null || service.ComputeHash(savedBase) != service.ComputeHash(draft.CaseTruth)) throw Stale();
        }
        if (!string.IsNullOrWhiteSpace(draft.TruthHash) && service.ComputeHash(draft.CaseTruth) != draft.TruthHash)
            throw Stale();
        var active = JsonSerializer.SerializeToNode(draft.CaseTruth, JsonOptions)!;
        var proposed = JsonSerializer.SerializeToNode(candidate, JsonOptions)!;
        var boundary = Array.IndexOf(CaseTruthRepairPolicy.OrderedArtifacts, originalScope);
        foreach (var field in StageFields.Take(boundary).SelectMany(fields => fields))
            if (!JsonNode.DeepEquals(active[field], proposed[field])) throw Stale();
    }

    internal static void ValidateReusedUpstream(CaseTruthPackage candidate, string selected,
        ICaseTruthService service, CaseValidationResult validation)
    {
        var boundary = Array.IndexOf(CaseTruthRepairPolicy.OrderedArtifacts, selected);
        var node = JsonSerializer.SerializeToNode(candidate, JsonOptions)!;
        var incomplete = StageFields.Take(boundary).SelectMany(fields => fields)
            .Any(field => node[field] is null || node[field] is JsonArray { Count: 0 });
        var invalid = validation.Errors.Any(error =>
        {
            var artifact = service.PlanRepair([error]).RegenerateFromArtifact;
            return CaseTruthRepairPolicy.IsTruthArtifact(artifact)
                && Array.IndexOf(CaseTruthRepairPolicy.OrderedArtifacts, artifact) < boundary;
        });
        if (incomplete || invalid)
            throw ApiException.Unprocessable("Candidate artifacts before the selected repair scope are incomplete or invalid.",
                new ApiErrorDetails("AI_TRUTH_REPAIR_CANDIDATE_UPSTREAM_INVALID", "ai.caseTruth.repairCandidateUpstreamInvalid"));
    }

    private static ApiException Stale() => ApiException.Conflict(
        "The repair candidate no longer matches its saved checkpoint. Repair the current truth instead.",
        "AI_TRUTH_REPAIR_CANDIDATE_STALE", "ai.caseTruth.repairCandidateStale");
}
