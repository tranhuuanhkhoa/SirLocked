using System.Text.Json;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Services;

/// <summary>
/// The deterministic rules of each truth stage, in one place: the generation run applies them after a stage answers,
/// and the bridge applies them when the bot submits that answer (<see cref="CheckAnswer"/>). A wrong answer is then
/// refused with its errors while the request is still open and the bot still has its context, so it never reaches the
/// draft as an invalid truth.
/// </summary>
public sealed class TruthStageRules(ICaseTruthService truthService, IGameplayProjectionPlanner planner)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public CaseValidationResult Timeline(CaseTruthPackage truth, AiTruthGenerationBudget budget) =>
        truthService.ValidateTimelineReferences(truth, budget);

    public CaseValidationResult Evidence(CaseTruthPackage truth, IReadOnlyCollection<string> plannedTraceIds)
    {
        var validation = AiCaseService.ValidateGeneratedTraceSet(truth.TraceLedger, plannedTraceIds);
        validation.Errors.AddRange(truthService.ValidateTraceArtifact(truth).Errors);
        return validation;
    }

    public CaseValidationResult Statements(CaseTruthPackage truth, AiDraftSettings settings) =>
        truthService.ValidateStatementArtifact(truth, settings);

    public CaseValidationResult ProofGraph(AiCaseDraft draft, CaseTruthPackage truth, AiTruthGenerationBudget budget)
    {
        var validation = truthService.Validate(truth, budget);
        validation.Errors.AddRange(planner.ValidateProjectability(draft, truth).Errors);
        validation.Deduplicate();
        return validation;
    }

    /// <summary>
    /// Checks a bridge answer to a first-run truth stage against the draft's saved upstream truth. Returns null when the
    /// answer cannot be checked here (another run, a truth repair whose base is the candidate, a checkpoint that is not
    /// the stage's upstream, or a stage without deterministic rules): the generation run still checks it then.
    /// </summary>
    public CaseValidationResult? CheckAnswer(AiCaseDraft draft, AiBridgeRequest request, string json)
    {
        if (request.OwnerType != AiBridgeOwnerTypes.CaseDraft
            || draft.CaseTruth is null
            || draft.QueuedOperation != AiQueuedOperations.CaseTruth
            || string.IsNullOrEmpty(request.GenerationRunId)
            || request.GenerationRunId != draft.GenerationRunId)
            return null;
        var (upstream, index) = request.SchemaVersion switch
        {
            AiGenerationSchemaVersions.TrueTimeline => (CaseTruthArtifacts.CoreTruth, 2),
            AiGenerationSchemaVersions.TraceLedger => (CaseTruthArtifacts.Opportunity, 4),
            AiGenerationSchemaVersions.StatementLedger => (CaseTruthArtifacts.Evidence, 5),
            AiGenerationSchemaVersions.ProofGraph => (CaseTruthArtifacts.Statements, 6),
            _ => (string.Empty, -1)
        };
        if (index < 0 || draft.TruthCheckpointArtifact != upstream) return null;

        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(JsonSerializer.Serialize(draft.CaseTruth, Json), Json)!;
        AiCaseService.ClearInvalidatedTruthArtifacts(truth, index);
        var budget = AiCaseService.TruthBudgetForDraft(draft);
        try
        {
            switch (index)
            {
                case 2:
                    truth.TrueTimeline = Parse<GeneratedTimelineArtifact>(json).TrueTimeline;
                    return Timeline(truth, budget);
                case 4:
                    var planned = CaseTruthReferenceContract.PlannedTraceIds(truth.TrueTimeline)
                        .Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToList();
                    truth.TraceLedger = Parse<GeneratedTraceArtifact>(json).TraceLedger;
                    return Evidence(truth, planned);
                case 5:
                    truth.StatementLedger = Parse<GeneratedStatementArtifact>(json).StatementLedger;
                    return Statements(truth, draft.Settings);
                default:
                    var proof = Parse<GeneratedProofArtifact>(json);
                    truth.ProofGraph = proof.ProofGraph;
                    truth.RedHerringLedger = proof.RedHerringLedger;
                    return ProofGraph(draft, truth, budget);
            }
        }
        catch (JsonException)
        {
            return null; // the schema check already passed; the run reports anything stranger
        }
    }

    /// <summary>The errors as the draft's validation report writes them: <c>Code path [ref: id]: message</c>.</summary>
    public static List<string> Describe(CaseValidationResult validation) =>
        validation.Errors
            .Select(error => $"{error.Code} {error.Path}{(string.IsNullOrWhiteSpace(error.RefId) ? string.Empty : $" [ref: {error.RefId}]")}: {error.Message}")
            .ToList();

    private static T Parse<T>(string json) =>
        JsonSerializer.Deserialize<T>(AiBridgeSchemaValidator.StripMarkdownFences(json), Json) ?? throw new JsonException("empty answer");
}
