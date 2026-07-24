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
