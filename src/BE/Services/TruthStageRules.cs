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

    public CaseValidationResult Timeline(CaseTruthPackage truth, AiTruthGenerationBudget budget, AiDraftSettings settings)
    {
        CaseTruthService.FillMissingTravelDurations(truth);
        var result = truthService.ValidateTimelineReferences(truth, budget);
        if (AiPipelineVersions.IsOpenCoop(settings))
        {
            var puzzleCount = AiDifficultyProfiles.PuzzleCount(AiDifficultyProfiles.For(settings.Difficulty), settings.Leaning);
            var plannedCount = CaseTruthReferenceContract.PlannedTraceIds(truth.TrueTimeline).Distinct(StringComparer.Ordinal).Count();
            var minimum = ProofConclusionIds.ByCategory.Count + puzzleCount;
            if (plannedCount < minimum)
                result.Add("InsufficientPlannedPuzzleTraces", "trueTimeline.traceIds",
                    $"Plan at least {minimum} distinct traces: five final evidence sources and {puzzleCount} optional puzzle rewards.");
        }
        return result;
    }

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
    /// Checks against the exact upstream truth used to request the answer. A first run uses the draft checkpoint;
    /// a repair uses the request's snapshot of the repair being built.
    /// </summary>
    public CaseValidationResult? CheckAnswer(AiCaseDraft draft, AiBridgeRequest request, string json)
    {
        if (request.OwnerType != AiBridgeOwnerTypes.CaseDraft
            || string.IsNullOrEmpty(request.GenerationRunId)
            || request.GenerationRunId != draft.GenerationRunId)
            return null;
        if (request.SchemaVersion == TruthFindingRepair.Version && draft.QueuedOperation == AiQueuedOperations.TruthRepair
            && request.TruthRepairUpstream is { } input && request.TruthEditScope is { } scope)
        {
            // An explicit empty list requests structural regeneration. A nonempty invalid edit stays on this lease.
            using var edits = JsonDocument.Parse(json);
            if (edits.RootElement.TryGetProperty("edits", out var rows) && rows.ValueKind == JsonValueKind.Array && rows.GetArrayLength() == 0)
                return null;
            var editBudget = AiCaseService.TruthBudgetForDraft(draft);
            var corrected = TruthFindingRepair.Apply(input, scope, json, editBudget.MaxDescriptionLength);
            if (corrected is not null)
                return AiTruthRepairCandidatePolicy.ValidateForGameplay(draft, corrected, editBudget, truthService, planner);
            var invalid = new CaseValidationResult();
            invalid.Add("InvalidTruthEdit", "edits", "Use an existing editable row and field, with a changed value. Return [] for edits only when a structural change is required.");
            return invalid;
        }
        var (upstream, index) = request.SchemaVersion switch
        {
            AiGenerationSchemaVersions.TrueTimeline => (CaseTruthArtifacts.CoreTruth, 2),
            AiGenerationSchemaVersions.TraceLedger => (CaseTruthArtifacts.Opportunity, 4),
            AiGenerationSchemaVersions.StatementLedger => (CaseTruthArtifacts.Evidence, 5),
            AiGenerationSchemaVersions.ProofGraph => (CaseTruthArtifacts.Statements, 6),
            _ => (string.Empty, -1)
        };
        if (index < 0) return null;
        var upstreamTruth = draft.QueuedOperation switch
        {
            AiQueuedOperations.CaseTruth when draft.TruthCheckpointArtifact == upstream => draft.CaseTruth,
            AiQueuedOperations.TruthRepair => request.TruthRepairUpstream,
            _ => null
        };
        if (upstreamTruth is null) return null; // older repair requests may not carry a snapshot

        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(JsonSerializer.Serialize(upstreamTruth, Json), Json)!;
        AiCaseService.ClearInvalidatedTruthArtifacts(truth, index);
        var budget = AiCaseService.TruthBudgetForDraft(draft);
        CaseValidationResult validation;
        try
        {
            switch (index)
            {
                case 2:
                    truth.TrueTimeline = Parse<GeneratedTimelineArtifact>(json).TrueTimeline;
                    validation = Timeline(truth, budget, draft.Settings);
                    break;
                case 4:
                    var planned = CaseTruthReferenceContract.PlannedTraceIds(truth.TrueTimeline)
                        .Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToList();
                    truth.TraceLedger = Parse<GeneratedTraceArtifact>(json).TraceLedger;
                    validation = Evidence(truth, planned);
                    break;
                case 5:
                    truth.StatementLedger = Parse<GeneratedStatementArtifact>(json).StatementLedger;
                    validation = Statements(truth, draft.Settings);
                    break;
                default:
                    var proof = Parse<GeneratedProofArtifact>(json);
                    truth.ProofGraph = proof.ProofGraph;
                    truth.RedHerringLedger = proof.RedHerringLedger;
                    validation = ProofGraph(draft, truth, budget);
                    break;
            }
        }
        catch (JsonException)
        {
            return null; // the schema check already passed; the run reports anything stranger
        }
        return ErrorsThisStageCanFix(validation, index);
    }

    /// <summary>
    /// Keeps only the errors the submitted answer can fix: those whose repair starts at this stage or a later one
    /// (<see cref="ICaseTruthService.PlanRepair"/>). An error of an earlier, locked step cannot be fixed by answering
    /// this stage again. In run 8, an opportunity row's alibi that nobody else witnessed was found only by the whole-truth
    /// check at the proof graph, and refusing it made the bot resubmit until it gave up. Such an error passes here; the
    /// run then reports the truth invalid and the repair starts at that earlier step.
    /// </summary>
    private CaseValidationResult ErrorsThisStageCanFix(CaseValidationResult validation, int stage)
    {
        var own = new CaseValidationResult();
        own.Errors.AddRange(validation.Errors.Where(error => Array.IndexOf(CaseTruthRepairPolicy.OrderedArtifacts,
            truthService.PlanRepair([error]).RegenerateFromArtifact) >= stage));
        own.Warnings.AddRange(validation.Warnings);
        return own;
    }

    /// <summary>The errors as the draft's validation report writes them: <c>Code path [ref: id]: message</c>.</summary>
    public static List<string> Describe(CaseValidationResult validation) =>
        validation.Errors
            .Select(error => $"{error.Code} {error.Path}{(string.IsNullOrWhiteSpace(error.RefId) ? string.Empty : $" [ref: {error.RefId}]")}: {error.Message}")
            .ToList();

    private static T Parse<T>(string json) =>
        JsonSerializer.Deserialize<T>(AiBridgeSchemaValidator.StripMarkdownFences(json), Json) ?? throw new JsonException("empty answer");
}
