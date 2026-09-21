using System.Text.Json.Nodes;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface ICaseTruthService
{
    string Canonicalize(CaseTruthPackage truth);
    string ComputeHash(CaseTruthPackage truth);
    CaseValidationResult Validate(CaseTruthPackage truth);
    CaseValidationResult Validate(CaseTruthPackage truth, AiTruthGenerationBudget budget);
    CaseValidationResult ValidateTimelineReferences(CaseTruthPackage truth, AiTruthGenerationBudget budget);
    CaseValidationResult ValidateTraceArtifact(CaseTruthPackage truth);
    CaseValidationResult ValidateStatementArtifact(CaseTruthPackage truth);
    CaseValidationResult ValidateStatementArtifact(CaseTruthPackage truth, AiGenerationContract contract);
    CaseValidationResult ValidateStatementArtifact(CaseTruthPackage truth, AiDraftSettings settings);
    CaseValidationResult ValidateProjection(CaseTruthPackage truth, GameCase gameCase);
    CaseValidationResult ValidateFeasibilityReview(CaseTruthFeasibilityReview review);
    CaseValidationResult ValidateBlindReview(CaseTruthPackage truth, BlindSolvabilityReview review);
    JsonObject BuildBlindPlayerKnowledge(GameCase gameCase);
    CaseTruthRepairPlan PlanRepair(IEnumerable<CaseValidationError> errors);
}

public sealed class CaseTruthRepairPlan
{
    public string RegenerateFromArtifact { get; set; } = CaseTruthArtifacts.Projection;
    public List<string> InvalidArtifacts { get; set; } = new();
    public List<string> StaleArtifacts { get; set; } = new();
    public List<string> ReasonCodes { get; set; } = new();
}

public static class CaseTruthArtifacts
{
    public const string CaseSeed = "CASE_SEED";
    public const string CoreTruth = "CORE_TRUTH";
    public const string Timeline = "TIMELINE";
    public const string Opportunity = "OPPORTUNITY";
    public const string Evidence = "EVIDENCE";
    public const string Statements = "STATEMENTS";
    public const string ProofGraph = "PROOF_GRAPH";
    public const string Projection = "GAMEPLAY_PROJECTION";
    public const string Layout = "LAYOUT";
    public const string Assets = "ASSETS";
}

public static class CaseTruthRepairPolicy
{
    public static readonly string[] OrderedArtifacts =
    [
        CaseTruthArtifacts.CaseSeed, CaseTruthArtifacts.CoreTruth, CaseTruthArtifacts.Timeline,
        CaseTruthArtifacts.Opportunity, CaseTruthArtifacts.Evidence, CaseTruthArtifacts.Statements,
        CaseTruthArtifacts.ProofGraph, CaseTruthArtifacts.Projection, CaseTruthArtifacts.Layout,
        CaseTruthArtifacts.Assets
    ];

    public static CaseTruthRepairPlan PlanReview(CaseTruthFeasibilityReview review)
    {
        var codes = review.Findings.Select(finding => finding.Code)
            .Where(CaseTruthReviewFindingCodes.All.Contains)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var artifact = codes.Count == 0
            ? CaseTruthArtifacts.Timeline
            : codes.Select(ArtifactForFinding).OrderBy(ArtifactIndex).First();
        var plan = BuildPlan(artifact);
        plan.ReasonCodes.AddRange(codes.Count == 0 ? ["LEGACY_REVIEW_FALLBACK"] : codes);
        return plan;
    }

    public static CaseTruthRepairPlan PlanBlindReview(BlindSolvabilityReview review)
    {
        var plan = BuildPlan(CaseTruthArtifacts.Projection);
        plan.ReasonCodes.AddRange(review.Findings.Select(finding => finding.Code)
            .Where(CaseTruthReviewFindingCodes.All.Contains)
            .Concat(review.Findings.Count == 0 ? ["LEGACY_BLIND_REVIEW_FALLBACK"] : [])
            .Distinct(StringComparer.Ordinal));
        return plan;
    }

    public static CaseTruthRepairPlan BuildPlan(string artifact)
    {
        var index = ArtifactIndex(artifact);
        if (index < 0) artifact = CaseTruthArtifacts.Timeline;
        index = ArtifactIndex(artifact);
        return new CaseTruthRepairPlan
        {
            RegenerateFromArtifact = artifact,
            InvalidArtifacts = { artifact },
            StaleArtifacts = OrderedArtifacts.Skip(index + 1).ToList()
        };
    }

    public static CaseTruthRepairPlan Earliest(params CaseTruthRepairPlan[] plans)
    {
        var usable = plans.Where(plan => IsTruthArtifact(plan.RegenerateFromArtifact)).ToList();
        if (usable.Count == 0) return BuildPlan(CaseTruthArtifacts.Timeline);
        var artifact = usable.Select(plan => plan.RegenerateFromArtifact)
            .OrderBy(ArtifactIndex)
            .First();
        var combined = BuildPlan(artifact);
        combined.InvalidArtifacts = usable.SelectMany(plan => plan.InvalidArtifacts)
            .Where(IsTruthArtifact)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(ArtifactIndex)
            .ToList();
        combined.ReasonCodes = usable.SelectMany(plan => plan.ReasonCodes)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return combined;
    }

    public static bool IsTruthArtifact(string artifact) =>
        ArtifactIndex(artifact) is >= 0 and <= 6;

    public static bool IsAtOrBefore(string requested, string recommended) =>
        IsTruthArtifact(requested)
        && IsTruthArtifact(recommended)
        && ArtifactIndex(requested) <= ArtifactIndex(recommended);

    public static string Normalize(string? artifact) =>
        (artifact ?? string.Empty).Trim().ToUpperInvariant();

    private static string ArtifactForFinding(string code) => code switch
    {
        CaseTruthReviewFindingCodes.OpportunityConsistency
            or CaseTruthReviewFindingCodes.SolutionAmbiguity => CaseTruthArtifacts.Opportunity,
        CaseTruthReviewFindingCodes.TracePersistence
            or CaseTruthReviewFindingCodes.ProofScope => CaseTruthArtifacts.Evidence,
        _ => CaseTruthArtifacts.Timeline
    };

    private static int ArtifactIndex(string artifact) =>
        Array.IndexOf(OrderedArtifacts, artifact);
}
