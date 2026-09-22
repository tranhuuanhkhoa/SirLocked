using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Services;

public sealed class CaseTruthService : ICaseTruthService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };
    private readonly IProjectionReadinessAnalyzer _readinessAnalyzer;

    public CaseTruthService(IProjectionReadinessAnalyzer? readinessAnalyzer = null)
    {
        _readinessAnalyzer = readinessAnalyzer ?? new ProjectionReadinessAnalyzer();
    }

    public string Canonicalize(CaseTruthPackage truth)
    {
        var node = JsonSerializer.SerializeToNode(truth, JsonOptions)
            ?? throw new InvalidOperationException("Case truth could not be serialized.");
        if (node is JsonObject root
            && root["coreTruth"] is JsonObject coreTruth
            && string.IsNullOrWhiteSpace(coreTruth["targetKind"]?.GetValue<string>()))
        {
            coreTruth.Remove("targetKind");
        }
        return SortNode(node).ToJsonString(JsonOptions);
    }

    public string ComputeHash(CaseTruthPackage truth) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonicalize(truth)))).ToLowerInvariant();

    public CaseValidationResult Validate(CaseTruthPackage truth) =>
        Validate(truth, AiTruthGenerationBudget.Maximum);

    public CaseValidationResult Validate(CaseTruthPackage truth, AiTruthGenerationBudget budget)
    {
        var result = new CaseValidationResult();
        if (truth.SchemaVersion is not (CaseTruthSchemaVersions.V1 or CaseTruthSchemaVersions.V2))
            result.Add("InvalidTruthSchema", "schemaVersion",
                $"schemaVersion must be '{CaseTruthSchemaVersions.V1}' or '{CaseTruthSchemaVersions.V2}'.");

        var seed = truth.CaseSeed;
        Require(result, seed.CrimeType, "caseSeed.crimeType");
        Require(result, seed.Era, "caseSeed.era");
        Require(result, seed.Difficulty, "caseSeed.difficulty");
        if (seed.EstimatedMinutes <= 0) result.Add("InvalidValue", "caseSeed.estimatedMinutes", "Estimated duration must be positive.");
        CheckDuplicates(result, "caseSeed.suspectIds", seed.SuspectIds);
        CheckDuplicates(result, "caseSeed.locationIds", seed.LocationIds);
        if (seed.SuspectIds.Count < 2) result.Add("MissingField", "caseSeed.suspectIds", "At least two suspects are required.");
        if (seed.LocationIds.Count == 0) result.Add("MissingField", "caseSeed.locationIds", "At least one location is required.");
        ValidateBudget(truth, budget, result);
        var locationIds = seed.LocationIds.ToHashSet(StringComparer.Ordinal);
        foreach (var (edge, index) in seed.LocationGraph.Select((item, index) => (item, index)))
        {
            if (!locationIds.Contains(edge.FromLocationId) || !locationIds.Contains(edge.ToLocationId))
                result.Add("MissingReference", $"caseSeed.locationGraph[{index}]", "Travel edge must connect locked locations.");
            if (edge.FromLocationId == edge.ToLocationId || edge.TravelMinutes <= 0)
                result.Add("InvalidTravelEdge", $"caseSeed.locationGraph[{index}]", "Travel edge requires distinct locations and positive minutes.");
        }

        var eventById = UniqueBy(result, "trueTimeline", truth.TrueTimeline, item => item.EventId);
        var traceById = UniqueBy(result, "traceLedger", truth.TraceLedger, item => item.TraceId);
        var statementById = UniqueBy(result, "statementLedger", truth.StatementLedger, item => item.StatementId);
        var conclusionById = UniqueBy(result, "proofGraph.conclusions", truth.ProofGraph.Conclusions, item => item.ConclusionId);
        var opportunityByCharacter = UniqueBy(result, "opportunityMatrix", truth.OpportunityMatrix, item => item.CharacterId);
        UniqueBy(result, "redHerringLedger", truth.RedHerringLedger, item => item.RedHerringId);

        ValidateCoreTruth(truth, result, eventById);
        ValidatePlannedTraceIds(truth, budget, result);
        ValidateTimeline(truth, result, eventById, traceById);
        ValidateOpportunities(truth, result, eventById, opportunityByCharacter, traceById);
        ValidateTraces(truth, result, eventById, conclusionById);
        ValidateStatements(truth, result, eventById, traceById, conclusionById);
        ValidateProofGraph(truth, result, traceById, statementById);
        ValidateRedHerrings(truth, result, traceById, statementById);
        ValidateUniqueCulprit(truth, result, eventById, opportunityByCharacter);
        return result;
    }

    public CaseValidationResult ValidateTimelineReferences(
        CaseTruthPackage truth,
        AiTruthGenerationBudget budget)
    {
        var result = new CaseValidationResult();
        var eventById = UniqueBy(result, "trueTimeline", truth.TrueTimeline, item => item.EventId);
        ValidateCoreTruth(truth, result, eventById);
        ValidatePlannedTraceIds(truth, budget, result);
        var plannedTraceById = truth.TrueTimeline
            .SelectMany(item => item.TraceIds)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToDictionary(id => id, id => new TraceLedgerEntry { TraceId = id }, StringComparer.Ordinal);
        ValidateTimeline(truth, result, eventById, plannedTraceById);
        return result;
    }

    public CaseValidationResult ValidateTraceArtifact(CaseTruthPackage truth)
    {
        var result = new CaseValidationResult();
        var eventById = UniqueBy(result, "trueTimeline", truth.TrueTimeline, item => item.EventId);
        UniqueBy(result, "traceLedger", truth.TraceLedger, item => item.TraceId);
        ValidateTraces(truth, result, eventById, CanonicalConclusionIndex());
        result.Errors.AddRange(_readinessAnalyzer.MatchFinalEvidence(truth).Validation.Errors);
        result.Deduplicate();
        return result;
    }

    public CaseValidationResult ValidateStatementArtifact(CaseTruthPackage truth)
    {
        var result = new CaseValidationResult();
        var eventById = UniqueBy(result, "trueTimeline", truth.TrueTimeline, item => item.EventId);
        var traceById = UniqueBy(result, "traceLedger", truth.TraceLedger, item => item.TraceId);
        UniqueBy(result, "statementLedger", truth.StatementLedger, item => item.StatementId);
        ValidateStatements(truth, result, eventById, traceById, CanonicalConclusionIndex());
        ValidateAvailableProofCoverage(truth, result);
        return result;
    }

    public CaseValidationResult ValidateStatementArtifact(
        CaseTruthPackage truth,
        AiGenerationContract contract)
    {
        var result = ValidateStatementArtifact(truth);
        result.Errors.AddRange(_readinessAnalyzer.AllocateDialogues(truth, contract).Validation.Errors);
        result.Deduplicate();
        return result;
    }

    public CaseValidationResult ValidateStatementArtifact(
        CaseTruthPackage truth,
        AiDraftSettings settings)
    {
        var result = ValidateStatementArtifact(truth, AiGenerationContract.For(settings));
        var capacity = _readinessAnalyzer.AnalyzeCapacity(settings);
        var contradictionTraceIds = truth.StatementLedger
            .SelectMany(item => item.ContradictedByTraceIds)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (contradictionTraceIds.Count > capacity.MaxChallengeSlots)
        {
            result.Add(
                "ProjectionContradictionBudget",
                "statementLedger.contradictedByTraceIds",
                $"Statements use {contradictionTraceIds.Count} contradiction traces but the preset allows {capacity.MaxChallengeSlots} challenge sources.");
        }
        result.Deduplicate();
        return result;
    }

    private static IReadOnlyDictionary<string, ProofConclusion> CanonicalConclusionIndex() =>
        ProofConclusionIds.ByCategory.ToDictionary(
            pair => pair.Value,
            pair => new ProofConclusion { ConclusionId = pair.Value, Category = pair.Key },
            StringComparer.Ordinal);

    private static void ValidateAvailableProofCoverage(CaseTruthPackage truth, CaseValidationResult result)
    {
        foreach (var conclusionId in ProofConclusionIds.All)
        {
            var groups = truth.TraceLedger
                .Where(item => item.SupportsConclusionIds.Contains(conclusionId))
                .Select(item => item.IndependentSourceGroup)
                .Concat(truth.StatementLedger
                    .Where(item => item.SupportsConclusionIds.Contains(conclusionId))
                    .Select(item => item.IndependentSourceGroup))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.Ordinal)
                .ToList();
            if (groups.Count < 2)
                result.Add(
                    "InsufficientIndependentProof",
                    "statementLedger.supportsConclusionIds",
                    "Evidence and statements must provide at least two independent source groups for every locked proof conclusion.",
                    conclusionId);
        }
    }

    public CaseValidationResult ValidateProjection(CaseTruthPackage truth, GameCase gameCase)
    {
        var result = new CaseValidationResult();
        var truthBudget = gameCase.ProjectionBuildMode == ProjectionBuildModes.AiCompiled
            ? AiTruthGenerationBudget.ForProjection(new AiDraftSettings
            {
                GenerationPreset = gameCase.GenerationPreset,
                StageCount = Math.Max(1, gameCase.Stages.Count),
                MechanicsVersion = gameCase.MechanicsVersion,
                IncludeCrackTheLie =
                    gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation
            })
            : AiTruthGenerationBudget.For(
                gameCase.GenerationPreset,
                Math.Max(1, gameCase.Stages.Count));
        var truthValidation = Validate(truth, truthBudget);
        result.Errors.AddRange(truthValidation.Errors);
        if (!truthValidation.IsValid) return result;

        var expectedHash = ComputeHash(truth);
        if (gameCase.LogicContractVersion != CaseLogicContractVersions.CausalFiveClaim)
            result.Add("InvalidLogicContract", "logicContractVersion", "A truth-backed AI case must use logicContractVersion 2.");
        if (gameCase.TruthSchemaVersion != truth.SchemaVersion)
            result.Add("TruthConformance", "truthSchemaVersion", "Projection truth schema does not match the approved truth.");
        if (!string.Equals(gameCase.TruthHash, expectedHash, StringComparison.Ordinal))
            result.Add("TruthHashMismatch", "truthHash", "Projection does not reference the approved canonical truth hash.");
        if (gameCase.FinalLogic.CulpritId != truth.CoreTruth.CulpritId)
            result.Add("TruthConformance", "finalLogic.culpritId", "Projection changed the approved culprit.");
        if (!SameText(gameCase.FinalLogic.Motive, truth.CoreTruth.Motive))
            result.Add("TruthConformance", "finalLogic.motive", "Projection changed the approved motive.");
        if (!SameText(gameCase.FinalLogic.Method, truth.CoreTruth.Method))
            result.Add("TruthConformance", "finalLogic.method", "Projection changed the approved method.");

        var eventIds = truth.TrueTimeline.Select(item => item.EventId).ToHashSet(StringComparer.Ordinal);
        var statementIds = truth.StatementLedger.Select(item => item.StatementId).ToHashSet(StringComparer.Ordinal);
        var statementById = truth.StatementLedger.ToDictionary(item => item.StatementId, StringComparer.Ordinal);
        var traceByAction = truth.TraceLedger.GroupBy(item => item.SourceActionId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);
        var conclusions = truth.ProofGraph.Conclusions.ToDictionary(item => item.ConclusionId, StringComparer.Ordinal);
        var truthIds = eventIds
            .Concat(truth.TraceLedger.Select(item => item.TraceId))
            .Concat(statementIds)
            .Concat(conclusions.Keys)
            .ToHashSet(StringComparer.Ordinal);
        var sceneIds = gameCase.Stages.SelectMany(stage => stage.Scenes).Select(scene => scene.SceneId).ToHashSet(StringComparer.Ordinal);
        foreach (var locationId in truth.TrueTimeline.Select(item => item.LocationId)
                     .Concat(truth.TraceLedger.Select(item => item.LocationId))
                     .Distinct(StringComparer.Ordinal)
                     .Where(locationId => !sceneIds.Contains(locationId)))
            result.Add("MissingTruthLocationScene", "stages[].scenes[].sceneId",
                "Every truth location used by an event or trace must be projected as a gameplay scene.", locationId);

        for (var i = 0; i < gameCase.Clues.Count; i++)
        {
            var clue = gameCase.Clues[i];
            var path = $"clues[{i}]";
            if (!eventIds.Contains(clue.SourceActionId))
                result.Add("MissingCausalSource", $"{path}.sourceActionId", "Every contract-v2 clue must reference a true timeline action.", clue.ClueId);
            if (clue.SupportsConclusionIds.Count == 0)
                result.Add("MissingProofLink", $"{path}.supportsConclusionIds", "Every contract-v2 clue must state the conclusion(s) it supports.", clue.ClueId);
            foreach (var id in clue.SupportsConclusionIds.Where(id => !conclusions.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.supportsConclusionIds", "Conclusion does not exist in the approved proof graph.", id);
            if (string.IsNullOrWhiteSpace(clue.IndependentSourceGroup))
                result.Add("MissingField", $"{path}.independentSourceGroup", "Clue independent-source grouping is required.", clue.ClueId);
            if (traceByAction.TryGetValue(clue.SourceActionId, out var causalTraces))
            {
                if (!causalTraces.Any(trace => trace.IndependentSourceGroup == clue.IndependentSourceGroup))
                    result.Add("CausalSourceMismatch", path, "Clue source group was not created by its source action.", clue.ClueId);
                if (!causalTraces.Any(trace => trace.LocationId == clue.SceneId))
                    result.Add("TraceLocationMismatch", $"{path}.sceneId", "Clue is projected into a scene different from its causal trace.", clue.ClueId);
                foreach (var conclusionId in clue.SupportsConclusionIds.Where(id => !causalTraces.Any(trace => trace.SupportsConclusionIds.Contains(id))))
                    result.Add("ClaimOverreach", $"{path}.supportsConclusionIds", "Clue claims more than its physical causal trace supports.", conclusionId);
            }
        }

        for (var i = 0; i < gameCase.Dialogues.Count; i++)
        {
            var dialogue = gameCase.Dialogues[i];
            var path = $"dialogues[{i}]";
            if (dialogue.StatementIds.Count == 0)
                result.Add("MissingStatementLink", $"{path}.statementIds", "Dialogue must project at least one approved statement.", dialogue.DialogueId);
            foreach (var id in dialogue.StatementIds.Where(id => !statementIds.Contains(id)))
                result.Add("MissingReference", $"{path}.statementIds", "Statement does not exist in the approved ledger.", id);
            foreach (var id in dialogue.StatementIds.Where(statementById.ContainsKey)
                         .Where(id => statementById[id].SpeakerId != dialogue.CharacterId))
                result.Add("StatementSpeakerMismatch", $"{path}.statementIds", "Dialogue projects a statement authored by a different speaker.", id);
            if (dialogue.AvailableSceneIds.Count == 0)
                result.Add("MissingField", $"{path}.availableSceneIds", "Dialogue must declare where it is available.", dialogue.DialogueId);
            foreach (var id in dialogue.AvailableSceneIds.Where(id => !sceneIds.Contains(id)))
                result.Add("MissingReference", $"{path}.availableSceneIds", "Dialogue scene does not exist.", id);
            foreach (var id in dialogue.AvailableSceneIds)
            {
                var scene = gameCase.Stages.SelectMany(stage => stage.Scenes).FirstOrDefault(item => item.SceneId == id);
                if (scene is not null && !scene.CharacterIds.Contains(dialogue.CharacterId))
                    result.Add("DialogueSceneMismatch", $"{path}.availableSceneIds", "Dialogue character is not present in the declared scene.", id);
            }
        }

        for (var i = 0; i < gameCase.ConversationNodes.Count; i++)
        {
            var node = gameCase.ConversationNodes[i];
            if (node.StatementIds.Count == 0)
                result.Add("MissingStatementLink", $"conversationNodes[{i}].statementIds", "Conversation node must project at least one approved statement.", node.NodeId);
            if (node.AvailableSceneIds.Count == 0)
                result.Add("MissingField", $"conversationNodes[{i}].availableSceneIds", "Conversation node must declare its available scenes.", node.NodeId);
            foreach (var id in node.StatementIds.Where(id => !statementIds.Contains(id)))
                result.Add("MissingReference", $"conversationNodes[{i}].statementIds", "Statement does not exist in the approved ledger.", id);
            foreach (var id in node.StatementIds.Where(statementById.ContainsKey)
                         .Where(id => statementById[id].SpeakerId != node.CharacterId))
                result.Add("StatementSpeakerMismatch", $"conversationNodes[{i}].statementIds", "Conversation node projects a statement authored by a different speaker.", id);
            foreach (var sceneId in node.AvailableSceneIds)
            {
                var scene = gameCase.Stages.SelectMany(stage => stage.Scenes).FirstOrDefault(item => item.SceneId == sceneId);
                if (scene is not null && !scene.CharacterIds.Contains(node.CharacterId))
                    result.Add("DialogueSceneMismatch", $"conversationNodes[{i}].availableSceneIds", "Conversation character is not present in the declared scene.", sceneId);
            }
        }
        foreach (var group in gameCase.ConversationNodes.GroupBy(node => node.CharacterId, StringComparer.Ordinal))
        {
            var root = group.FirstOrDefault(node => node.IsRoot);
            if (root is null) continue;
            var rootScenes = root.AvailableSceneIds.ToHashSet(StringComparer.Ordinal);
            foreach (var node in group.Where(node => !rootScenes.SetEquals(node.AvailableSceneIds)))
                result.Add("ConversationSceneMismatch", "conversationNodes.availableSceneIds", "Every node in one conversation tree must share the root's available scenes.", node.NodeId);
        }

        for (var i = 0; i < gameCase.Puzzles.Count; i++)
        {
            var puzzle = gameCase.Puzzles[i];
            var path = $"puzzles[{i}]";
            if (puzzle.BasedOnTruthIds.Count == 0)
                result.Add("MissingTruthBasis", $"{path}.basedOnTruthIds", "Puzzle must be derived from approved truth facts.", puzzle.PuzzleId);
            foreach (var id in puzzle.BasedOnTruthIds.Where(id => !truthIds.Contains(id)))
                result.Add("MissingReference", $"{path}.basedOnTruthIds", "Puzzle truth basis does not exist.", id);
            if (string.IsNullOrWhiteSpace(puzzle.InvestigationPurpose))
                result.Add("MissingField", $"{path}.investigationPurpose", "Puzzle must have an investigation purpose.", puzzle.PuzzleId);
            if (string.IsNullOrWhiteSpace(puzzle.ProgressionRole))
                result.Add("MissingField", $"{path}.progressionRole", "Puzzle must declare its progression role.", puzzle.PuzzleId);
            else if (!PuzzleProgressionRoles.All.Contains(puzzle.ProgressionRole))
                result.Add("InvalidValue", $"{path}.progressionRole", "Puzzle progressionRole must be REQUIRED, OPTIONAL, or ALTERNATE.", puzzle.PuzzleId);
            if (puzzle.ProgressionRole == PuzzleProgressionRoles.Optional
                && puzzle.UnlockItemIds.Count == 0 && puzzle.UnlockClueIds.Count == 0
                && puzzle.UnlockSceneIds.Count == 0 && puzzle.RevealsConclusionIds.Count == 0)
                result.Add("OptionalWithoutPayoff", path, "Optional puzzle must have a distinct useful investigation payoff.", puzzle.PuzzleId);
            foreach (var id in puzzle.RevealsConclusionIds.Where(id => !conclusions.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.revealsConclusionIds", "Puzzle conclusion does not exist.", id);
        }

        for (var i = 0; i < gameCase.Deductions.Count; i++)
        {
            var deduction = gameCase.Deductions[i];
            if (!conclusions.ContainsKey(deduction.ConclusionId))
                result.Add("MissingProofLink", $"deductions[{i}].conclusionId", "Deduction must reference an approved proof conclusion.", deduction.DeductionId);
        }

        var expectedClaims = ProofConclusionCategories.All;
        var links = gameCase.FinalLogic.RequiredEvidenceLinks;
        var claims = links.Select(link => link.ClaimType.Trim().ToUpperInvariant()).ToList();
        if (links.Count != expectedClaims.Count || claims.Distinct().Count() != expectedClaims.Count || !expectedClaims.SetEquals(claims))
            result.Add("InvalidValue", "finalLogic.requiredEvidenceLinks", "Contract-v2 final logic requires MOTIVE, METHOD, OPPORTUNITY, IDENTITY, and TIMELINE.");

        var clueById = gameCase.Clues.ToDictionary(item => item.ClueId, StringComparer.Ordinal);
        foreach (var link in links)
        {
            if (!clueById.TryGetValue(link.EvidenceId, out var clue)) continue;
            var category = link.ClaimType.Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(link.ConclusionId))
            {
                result.Add("MissingProofLink", "finalLogic.requiredEvidenceLinks.conclusionId",
                    "Contract-v2 final evidence must name its exact approved conclusion.", link.EvidenceId);
                continue;
            }
            if (!conclusions.TryGetValue(link.ConclusionId, out var conclusion)
                || !string.Equals(conclusion.Category, category, StringComparison.Ordinal))
            {
                result.Add("ClaimOverreach", "finalLogic.requiredEvidenceLinks.conclusionId",
                    "Final evidence conclusion does not exist in the requested claim category.", link.EvidenceId);
                continue;
            }
            if (!clue.SupportsConclusionIds.Contains(link.ConclusionId, StringComparer.Ordinal))
                result.Add("ClaimOverreach", "finalLogic.requiredEvidenceLinks", "Selected evidence does not support the exact final conclusion.", link.EvidenceId);
        }

        ValidateProjectionRewardUniqueness(gameCase, result);
        return result;
    }

    private static void ValidateBudget(
        CaseTruthPackage truth,
        AiTruthGenerationBudget budget,
        CaseValidationResult result)
    {
        AddBudgetError(result, "caseSeed.suspectIds", truth.CaseSeed.SuspectIds.Count,
            budget.MaxSuspects, "suspects");
        AddBudgetError(result, "caseSeed.locationIds", truth.CaseSeed.LocationIds.Count,
            budget.MaxLocations, "locations");
        AddBudgetError(result, "trueTimeline", truth.TrueTimeline.Count,
            budget.MaxTimelineEvents, "timeline events");
        AddBudgetError(result, "traceLedger", truth.TraceLedger.Count,
            budget.MaxTraces, "causal traces");
        if (truth.TraceLedger.Count > CaseTruthScopeLimits.MaxTraceEntries)
            result.Add("TruthScopeExceeded", "traceLedger",
                $"Trace ledger cannot exceed {CaseTruthScopeLimits.MaxTraceEntries} entries.");
        AddBudgetError(result, "statementLedger", truth.StatementLedger.Count,
            budget.MaxStatements, "statements");
        AddBudgetError(result, "redHerringLedger", truth.RedHerringLedger.Count,
            budget.MaxRedHerrings, "red herrings");

        if (truth.OpportunityMatrix.Count != truth.CaseSeed.SuspectIds.Count)
        {
            result.Add("TRUTH_BUDGET_EXCEEDED", "opportunityMatrix",
                $"Opportunity matrix must contain exactly one row for each of the {truth.CaseSeed.SuspectIds.Count} suspects.");
        }
        if (truth.ProofGraph.Conclusions.Count != budget.ProofConclusionCount)
        {
            result.Add("TRUTH_BUDGET_EXCEEDED", "proofGraph.conclusions",
                $"Proof graph must contain exactly {budget.ProofConclusionCount} conclusions.");
        }

        var node = JsonSerializer.SerializeToNode(truth, JsonOptions);
        if (node is not null)
            ValidateStringLimits(node, string.Empty, string.Empty, budget, result);
    }

    private static void AddBudgetError(
        CaseValidationResult result,
        string path,
        int actual,
        int maximum,
        string label)
    {
        if (actual <= maximum) return;
        result.Add("TRUTH_BUDGET_EXCEEDED", path,
            $"Truth contains {actual} {label}; this preset allows at most {maximum}.");
    }

    private static void ValidateStringLimits(
        JsonNode node,
        string path,
        string propertyName,
        AiTruthGenerationBudget budget,
        CaseValidationResult result)
    {
        if (node is JsonObject obj)
        {
            foreach (var pair in obj)
            {
                if (pair.Value is not null)
                    ValidateStringLimits(
                        pair.Value,
                        string.IsNullOrEmpty(path) ? pair.Key : $"{path}.{pair.Key}",
                        pair.Key,
                        budget,
                        result);
            }
            return;
        }

        if (node is JsonArray array)
        {
            for (var index = 0; index < array.Count; index++)
            {
                if (array[index] is not null)
                    ValidateStringLimits(array[index]!, $"{path}[{index}]", propertyName, budget, result);
            }
            return;
        }

        if (node is not JsonValue value || !value.TryGetValue<string>(out var text)) return;
        var identifier = propertyName.EndsWith("Id", StringComparison.OrdinalIgnoreCase)
            || propertyName.EndsWith("Ids", StringComparison.OrdinalIgnoreCase);
        var maximum = identifier ? budget.MaxIdLength : budget.MaxDescriptionLength;
        if (text.Length > maximum)
        {
            result.Add("TRUTH_BUDGET_EXCEEDED", path,
                $"{(identifier ? "Identifier" : "Description")} length {text.Length} exceeds the limit of {maximum} characters.");
        }
    }

    public CaseValidationResult ValidateFeasibilityReview(CaseTruthFeasibilityReview review)
    {
        var result = new CaseValidationResult();
        if (review.SchemaVersion is not (CaseTruthSchemaVersions.FeasibilityReviewV1
            or CaseTruthSchemaVersions.FeasibilityReviewV2))
            result.Add("InvalidReviewSchema", "truthReview.schemaVersion", "Unexpected truth review schema.");
        if (review.Status is not (CaseTruthReviewStatuses.Passed
            or CaseTruthReviewStatuses.Failed
            or CaseTruthReviewStatuses.Ambiguous))
            result.Add("InvalidReviewStatus", "truthReview.status", "Truth reviewer returned an unknown status.");
        else if (review.Status != CaseTruthReviewStatuses.Passed)
            result.Add("TruthReviewStatusFailed", "truthReview.status", "Independent feasibility review did not pass.");
        if (!review.TimelineFeasible)
            result.Add("TruthTimelineBlocked", "truthReview.timelineFeasible", "Independent review found the locked timeline infeasible.");
        if (!review.PhysicalCausalityFeasible)
            result.Add("TruthCausalityBlocked", "truthReview.physicalCausalityFeasible", "Independent review found unsupported physical causality.");
        if (!review.UniqueSolution)
            result.Add("TruthSolutionNotUnique", "truthReview.uniqueSolution", "Independent review did not find exactly one solution.");
        if (review.Confidence is < 0 or > 1)
            result.Add("InvalidReviewConfidence", "truthReview.confidence", "Review confidence must be between 0 and 1.");
        else if (review.Status == CaseTruthReviewStatuses.Passed && review.Confidence < 0.80)
            result.Add("TruthReviewConfidenceLow", "truthReview.confidence", "A passing review requires confidence >= 0.80.");
        if (review.Status == CaseTruthReviewStatuses.Passed && review.Findings.Count > 0)
            result.Add("TruthReviewHasBlockingFindings", "truthReview.findings", "A passing review cannot contain blocking findings.");
        if (review.SchemaVersion == CaseTruthSchemaVersions.FeasibilityReviewV2
            && review.Status is (CaseTruthReviewStatuses.Failed or CaseTruthReviewStatuses.Ambiguous)
            && review.Findings.Count == 0)
            result.Add("MissingReviewFindings", "truthReview.findings", "A failed or ambiguous V2 review must explain at least one finding.");
        return result;
    }

    public CaseValidationResult ValidateBlindReview(CaseTruthPackage truth, BlindSolvabilityReview review)
    {
        var result = new CaseValidationResult();
        if (review.SchemaVersion is not (CaseTruthSchemaVersions.BlindReviewV1
            or CaseTruthSchemaVersions.BlindReviewV2))
            result.Add("InvalidReviewSchema", "blindReview.schemaVersion", "Unexpected blind review schema.");
        if (review.Status != CaseTruthReviewStatuses.Passed)
            result.Add("BlindReviewStatusFailed", "blindReview.status", "Blind reviewer did not pass the projection.");
        if (!review.UniqueSolution)
            result.Add("BlindReviewSolutionNotUnique", "blindReview.uniqueSolution", "Blind reviewer did not find exactly one solution.");
        if (review.Confidence is < 0 or > 1)
            result.Add("InvalidReviewConfidence", "blindReview.confidence", "Review confidence must be between 0 and 1.");
        else if (review.Status == CaseTruthReviewStatuses.Passed && review.Confidence < 0.80)
            result.Add("BlindReviewConfidenceLow", "blindReview.confidence", "A passing blind review requires confidence >= 0.80.");
        if (review.Status == CaseTruthReviewStatuses.Passed && review.Findings.Count > 0)
            result.Add("BlindReviewHasBlockingFindings", "blindReview.findings", "A passing blind review cannot contain blocking findings.");
        if (review.SchemaVersion == CaseTruthSchemaVersions.BlindReviewV2
            && review.Status is (CaseTruthReviewStatuses.Failed or CaseTruthReviewStatuses.Ambiguous)
            && review.Findings.Count == 0)
            result.Add("MissingReviewFindings", "blindReview.findings", "A failed or ambiguous V2 blind review must explain at least one finding.");
        if (review.CulpritId != truth.CoreTruth.CulpritId)
            result.Add("BlindReviewMismatch", "blindReview.culpritId", "Blind reviewer did not infer the approved culprit.");
        if (!SameText(review.Motive, truth.CoreTruth.Motive))
            result.Add("BlindReviewMismatch", "blindReview.motive", "Blind reviewer did not infer the approved motive.");
        if (!SameText(review.Method, truth.CoreTruth.Method))
            result.Add("BlindReviewMismatch", "blindReview.method", "Blind reviewer did not infer the approved method.");
        if (string.IsNullOrWhiteSpace(review.TimelineSummary))
            result.Add("BlindReviewMismatch", "blindReview.timelineSummary", "Blind reviewer did not reconstruct a crime timeline.");
        if (review.EvidenceChainIds.Count < ProofConclusionCategories.All.Count)
            result.Add("BlindReviewInsufficientProof", "blindReview.evidenceChainIds", "Blind reviewer must identify an evidence chain covering all five claims.");
        return result;
    }

    public JsonObject BuildBlindPlayerKnowledge(GameCase gameCase)
    {
        return new JsonObject
        {
            ["characters"] = JsonSerializer.SerializeToNode(gameCase.Characters.Select(item => new
            {
                item.CharacterId, item.Name, item.Role, item.Description
            }), JsonOptions),
            ["scenes"] = JsonSerializer.SerializeToNode(gameCase.Stages.SelectMany(stage => stage.Scenes).Select(scene => new
            {
                scene.SceneId, scene.Title, scene.Description
            }), JsonOptions),
            ["clues"] = JsonSerializer.SerializeToNode(gameCase.Clues.Select(item => new
            {
                item.ClueId, item.Title, item.Content, item.NarrativeMeaning
            }), JsonOptions),
            ["dialogues"] = JsonSerializer.SerializeToNode(gameCase.Dialogues.Select(item => new
            {
                item.DialogueId, item.CharacterId, item.Question, item.Answer
            }), JsonOptions),
            ["deductions"] = JsonSerializer.SerializeToNode(gameCase.Deductions.Select(item => new
            {
                item.DeductionId, item.Prompt, item.Options
            }), JsonOptions)
        };
    }

    public CaseTruthRepairPlan PlanRepair(IEnumerable<CaseValidationError> errors)
    {
        var errorList = errors.ToList();
        var mappedPlans = errorList
            .Select(error => CaseTruthRepairPolicy.BuildPlan(RepairArtifactFor(error)))
            .ToArray();
        var truthPlans = mappedPlans
            .Where(item => CaseTruthRepairPolicy.IsTruthArtifact(item.RegenerateFromArtifact))
            .ToArray();
        var plan = truthPlans.Length > 0
            ? CaseTruthRepairPolicy.Earliest(truthPlans)
            : CaseTruthRepairPolicy.BuildPlan(CaseTruthArtifacts.Projection);
        plan.ReasonCodes = errorList.Select(error => error.Code)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return plan;
    }

    private static string RepairArtifactFor(CaseValidationError error)
    {
        if (error.Code == "ProjectionCharacterCount")
            return CaseTruthArtifacts.CaseSeed;
        if (error.Code == "InsufficientPlannedFinalTraces")
            return CaseTruthArtifacts.Timeline;
        if (error.Code is "ProjectionMissingConclusionTrace"
            or "ProjectionFinalEvidenceDiversity"
            or "MissingIdentityTrace")
            return CaseTruthArtifacts.Evidence;
        if (error.Code is "ProjectionStatementSceneUnavailable"
            or "ProjectionDialogueBudget"
            or "ProjectionContradictionBudget"
            or "ProjectionClueBudget")
            return CaseTruthArtifacts.Statements;
        if (error.Code is "ProjectionRedHerringClosureBudget"
            or "ProjectionRedHerringBudget")
            return CaseTruthArtifacts.ProofGraph;

        var path = error.Path ?? string.Empty;
        if (path.StartsWith("caseSeed", StringComparison.Ordinal) || path == "schemaVersion")
            return CaseTruthArtifacts.CaseSeed;
        if (path.StartsWith("coreTruth", StringComparison.Ordinal))
            return CaseTruthArtifacts.CoreTruth;
        if (path.StartsWith("trueTimeline", StringComparison.Ordinal))
            return CaseTruthArtifacts.Timeline;
        if (path.StartsWith("opportunityMatrix", StringComparison.Ordinal))
            return CaseTruthArtifacts.Opportunity;
        if (path.StartsWith("traceLedger", StringComparison.Ordinal))
            return CaseTruthArtifacts.Evidence;
        if (path.StartsWith("statementLedger", StringComparison.Ordinal))
            return CaseTruthArtifacts.Statements;
        if (path.StartsWith("proofGraph", StringComparison.Ordinal)
            || path.StartsWith("redHerringLedger", StringComparison.Ordinal))
            return CaseTruthArtifacts.ProofGraph;
        return CaseTruthArtifacts.Projection;
    }

    private static void ValidateCoreTruth(CaseTruthPackage truth, CaseValidationResult result,
        IReadOnlyDictionary<string, TrueTimelineEvent> eventById)
    {
        var core = truth.CoreTruth;
        Require(result, core.CulpritId, "coreTruth.culpritId");
        Require(result, core.TargetId, "coreTruth.targetId");
        Require(result, core.Motive, "coreTruth.motive");
        Require(result, core.Method, "coreTruth.method");
        if (!truth.CaseSeed.SuspectIds.Contains(core.CulpritId))
            result.Add("MissingReference", "coreTruth.culpritId", "Culprit must be one of the locked suspects.", core.CulpritId);
        if (truth.CaseSeed.SuspectIds.Contains(core.TargetId))
            result.Add("TargetIsSuspect", "coreTruth.targetId",
                "Target must have a stable ID distinct from every suspect.", core.TargetId);
        if (truth.SchemaVersion == CaseTruthSchemaVersions.V2)
        {
            if (!CaseTargetKinds.All.Contains(core.TargetKind))
                result.Add("InvalidTargetKind", "coreTruth.targetKind",
                    "targetKind must be CHARACTER or ASSET.", core.TargetKind);
            if (CaseTargetKinds.IsAsset(core))
            {
                if (truth.TrueTimeline.Any(item =>
                        item.ActorId == core.TargetId || item.WitnessIds.Contains(core.TargetId, StringComparer.Ordinal))
                    || truth.StatementLedger.Any(item => item.SpeakerId == core.TargetId))
                {
                    result.Add("AssetTargetUsedAsCharacter", "coreTruth.targetId",
                        "An ASSET target cannot be a timeline actor, witness, or statement speaker.", core.TargetId);
                }
            }
        }
        ValidateCoreActionList(result, "coreTruth.preparationActionIds", core.PreparationActionIds);
        ValidateCoreActionList(result, "coreTruth.crimeActionIds", core.CrimeActionIds);
        ValidateCoreActionList(result, "coreTruth.concealmentActionIds", core.ConcealmentActionIds);
        ValidateCoreActionList(result, "coreTruth.culpritMistakeActionIds", core.CulpritMistakeActionIds);
        if (core.CrimeActionIds.Count == 0)
            result.Add("MissingField", "coreTruth.crimeActionIds", "At least one crime action is required.");
        foreach (var id in CaseTruthReferenceContract.CoreActionIds(core)
                     .Where(id => !string.IsNullOrWhiteSpace(id) && !eventById.ContainsKey(id)))
            result.Add("MissingCoreTimelineEvent", "trueTimeline",
                "Every distinct core action ID must be defined verbatim by exactly one timeline eventId.", id);
        foreach (var id in core.CrimeActionIds.Where(id => eventById.TryGetValue(id, out var item) && item.ActorId != core.CulpritId))
            result.Add("CulpritActionMismatch", "coreTruth.crimeActionIds", "Every crime action must be performed by the culprit.", id);
    }

    private static void ValidateCoreActionList(
        CaseValidationResult result,
        string path,
        IReadOnlyList<string> ids)
    {
        for (var index = 0; index < ids.Count; index++)
            Require(result, ids[index], $"{path}[{index}]");
        CheckDuplicates(result, path, ids);
    }

    private static void ValidatePlannedTraceIds(
        CaseTruthPackage truth,
        AiTruthGenerationBudget budget,
        CaseValidationResult result)
    {
        var planned = truth.TrueTimeline.SelectMany(item => item.TraceIds).ToList();
        foreach (var (item, eventIndex) in truth.TrueTimeline.Select((item, index) => (item, index)))
        {
            for (var traceIndex = 0; traceIndex < item.TraceIds.Count; traceIndex++)
                Require(result, item.TraceIds[traceIndex], $"trueTimeline[{eventIndex}].traceIds[{traceIndex}]");
        }
        foreach (var id in planned.Where(id => !string.IsNullOrWhiteSpace(id))
                     .GroupBy(id => id, StringComparer.Ordinal)
                     .Where(group => group.Count() > 1)
                     .Select(group => group.Key))
            result.Add("DuplicateId", "trueTimeline.traceIds", "A planned trace ID must be declared exactly once.", id);
        var distinctCount = CaseTruthReferenceContract.PlannedTraceIds(truth.TrueTimeline)
            .Count(id => !string.IsNullOrWhiteSpace(id));
        if (distinctCount < ProofConclusionIds.ByCategory.Count)
            result.Add("InsufficientPlannedFinalTraces", "trueTimeline.traceIds",
                $"Timeline must plan at least {ProofConclusionIds.ByCategory.Count} distinct causal traces for the five final claims.");
        if (distinctCount > budget.MaxTraces)
            result.Add("TRUTH_BUDGET_EXCEEDED", "trueTimeline.traceIds",
                $"Timeline plans {distinctCount} traces; this preset allows at most {budget.MaxTraces}.");
    }

    private static void ValidateTimeline(CaseTruthPackage truth, CaseValidationResult result,
        IReadOnlyDictionary<string, TrueTimelineEvent> eventById,
        IReadOnlyDictionary<string, TraceLedgerEntry> traceById)
    {
        var locations = truth.CaseSeed.LocationIds.ToHashSet(StringComparer.Ordinal);
        foreach (var (item, index) in truth.TrueTimeline.Select((item, index) => (item, index)))
        {
            var path = $"trueTimeline[{index}]";
            Require(result, item.EventId, $"{path}.eventId");
            Require(result, item.ActorId, $"{path}.actorId");
            Require(result, item.Action, $"{path}.action");
            if (!locations.Contains(item.LocationId)) result.Add("MissingReference", $"{path}.locationId", "Timeline location is not in the case seed.", item.LocationId);
            if (item.StartMinute < 0 || item.EndMinute <= item.StartMinute)
                result.Add("InvalidTimeline", path, "Timeline event must have startMinute >= 0 and endMinute > startMinute.", item.EventId);
            foreach (var id in item.TraceIds.Where(id => !traceById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.traceIds", "Timeline trace does not exist in the trace ledger.", id);
        }

        foreach (var actorGroup in truth.TrueTimeline.GroupBy(item => item.ActorId, StringComparer.Ordinal))
        {
            var ordered = actorGroup.OrderBy(item => item.StartMinute).ThenBy(item => item.EndMinute).ToList();
            for (var i = 1; i < ordered.Count; i++)
            {
                var previous = ordered[i - 1];
                var current = ordered[i];
                if (current.StartMinute < previous.EndMinute)
                    result.Add("TimelineOverlap", "trueTimeline", "A character cannot be in two events at the same time.", current.EventId);
                if (current.LocationId == previous.LocationId) continue;
                var gap = current.StartMinute - previous.EndMinute;
                var required = TravelMinutes(truth.CaseSeed.LocationGraph, previous.LocationId, current.LocationId);
                if (required is null)
                    result.Add("MissingTravelEdge", "caseSeed.locationGraph", "No travel rule connects consecutive character locations.", current.EventId);
                else if (gap < required || current.TravelFromPreviousMinutes < required)
                    result.Add("InsufficientTravelTime", "trueTimeline", $"Only {gap} minute(s) are available but travel requires {required}.", current.EventId);
            }
        }

        foreach (var item in truth.TrueTimeline)
        foreach (var witnessId in item.WitnessIds)
        {
            var observation = item.WitnessObservations.FirstOrDefault(value => value.WitnessId == witnessId);
            var observable = truth.TrueTimeline.Any(witnessEvent => witnessEvent.ActorId == witnessId
                && witnessEvent.LocationId == item.LocationId
                && witnessEvent.StartMinute < item.EndMinute && witnessEvent.EndMinute > item.StartMinute);
            if (!observable || observation is null || !observation.LineOfSightOrHearingClear
                || observation.Mode is not ("SIGHT" or "HEARING")
                || string.IsNullOrWhiteSpace(observation.ObservableDetail))
                result.Add("WitnessNotObservable", "trueTimeline.witnessIds", "Witness is not present at the event location and time.", witnessId);
        }
        foreach (var item in truth.TrueTimeline)
        foreach (var observation in item.WitnessObservations.Where(value => !item.WitnessIds.Contains(value.WitnessId)))
            result.Add("WitnessNotObservable", "trueTimeline.witnessObservations", "Witness observation must correspond to a declared witness.", observation.WitnessId);

        var hasIdentityTracePlan = truth.CoreTruth.CrimeActionIds.Any(actionId =>
            eventById.TryGetValue(actionId, out var action)
            && action.ActorId == truth.CoreTruth.CulpritId
            && action.TraceIds.Any(id => !string.IsNullOrWhiteSpace(id)));
        if (!hasIdentityTracePlan)
            result.Add(
                "MissingIdentityTracePlan",
                "trueTimeline.traceIds",
                "At least one culprit crime action must plan a trace capable of identifying its actor.");
    }

    private static void ValidateOpportunities(CaseTruthPackage truth, CaseValidationResult result,
        IReadOnlyDictionary<string, TrueTimelineEvent> eventById,
        IReadOnlyDictionary<string, CharacterOpportunity> opportunityByCharacter,
        IReadOnlyDictionary<string, TraceLedgerEntry> traceById)
    {
        foreach (var suspect in truth.CaseSeed.SuspectIds.Where(id => !opportunityByCharacter.ContainsKey(id)))
            result.Add("MissingOpportunity", "opportunityMatrix", "Every suspect needs an opportunity row.", suspect);

        foreach (var (item, index) in truth.OpportunityMatrix.Select((item, index) => (item, index)))
        {
            var path = $"opportunityMatrix[{index}]";
            if (item.AvailableToMinute < item.AvailableFromMinute)
                result.Add("InvalidWindow", path, "availableToMinute must not be before availableFromMinute.", item.CharacterId);
            foreach (var id in item.AlibiEventIds.Where(id => !eventById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.alibiEventIds", "Alibi event does not exist.", id);
            foreach (var id in item.AlibiEventIds.Where(eventById.ContainsKey)
                         .Where(id => eventById[id].ActorId != item.CharacterId && !eventById[id].WitnessIds.Contains(item.CharacterId)))
                result.Add("InvalidAlibi", $"{path}.alibiEventIds", "Alibi event does not place this character at the event.", id);
            if (item.AlibiVerified && item.AlibiEventIds.Count == 0)
                result.Add("InvalidAlibi", path, "A verified alibi requires at least one timeline event.", item.CharacterId);
            if (item.AlibiVerified)
            {
                foreach (var id in item.AlibiEventIds.Where(eventById.ContainsKey))
                {
                    var alibi = eventById[id];
                    var independentlyCorroborated = alibi.ActorId != item.CharacterId
                        || alibi.WitnessIds.Any(witnessId => witnessId != item.CharacterId)
                        || traceById.Values.Any(trace => trace.SourceActionId == id);
                    if (!independentlyCorroborated)
                        result.Add("UncorroboratedAlibi", $"{path}.alibiEventIds",
                            "A verified alibi requires another observable actor or a causal trace linked to the alibi event.", id);
                }
            }
        }

        if (!opportunityByCharacter.TryGetValue(truth.CoreTruth.CulpritId, out var culprit)) return;
        foreach (var actionId in truth.CoreTruth.CrimeActionIds)
        {
            if (!eventById.TryGetValue(actionId, out var action)) continue;
            if (action.StartMinute < culprit.AvailableFromMinute || action.EndMinute > culprit.AvailableToMinute)
                result.Add("CrimeOutsideWindow", "opportunityMatrix", "Culprit is not available for a crime action.", actionId);
            foreach (var id in action.RequiredAccessIds.Where(id => !culprit.AccessIds.Contains(id)))
                result.Add("MissingCrimeCapability", "opportunityMatrix.accessIds", "Culprit lacks required access.", id);
            foreach (var id in action.RequiredToolIds.Where(id => !culprit.ToolIds.Contains(id)))
                result.Add("MissingCrimeCapability", "opportunityMatrix.toolIds", "Culprit lacks a required tool.", id);
            foreach (var id in action.RequiredKnowledgeIds.Where(id => !culprit.KnowledgeIds.Contains(id)))
                result.Add("MissingCrimeCapability", "opportunityMatrix.knowledgeIds", "Culprit lacks required knowledge.", id);
            if (culprit.AlibiVerified && culprit.AlibiEventIds.Any(id => eventById.TryGetValue(id, out var alibi)
                    && alibi.StartMinute < action.EndMinute && alibi.EndMinute > action.StartMinute
                    && alibi.LocationId != action.LocationId))
                result.Add("VerifiedAlibiConflict", "opportunityMatrix.alibiEventIds", "Verified alibi conflicts with a crime action.", actionId);
        }
    }

    private static void ValidateTraces(CaseTruthPackage truth, CaseValidationResult result,
        IReadOnlyDictionary<string, TrueTimelineEvent> eventById,
        IReadOnlyDictionary<string, ProofConclusion> conclusionById)
    {
        foreach (var (trace, index) in truth.TraceLedger.Select((item, index) => (item, index)))
        {
            var path = $"traceLedger[{index}]";
            if (!eventById.TryGetValue(trace.SourceActionId, out var action))
                result.Add("MissingReference", $"{path}.sourceActionId", "Trace must reference the action that physically created it.", trace.SourceActionId);
            else
            {
                if (trace.LocationId != action.LocationId) result.Add("TraceLocationMismatch", $"{path}.locationId", "Trace location differs from its source action.", trace.TraceId);
                if (trace.CreatedAtMinute < action.StartMinute || trace.CreatedAtMinute > action.EndMinute)
                    result.Add("TraceTimeMismatch", $"{path}.createdAtMinute", "Trace creation time is outside its source action.", trace.TraceId);
                if (trace.CreatedByCharacterId != action.ActorId)
                    result.Add("TraceActorMismatch", $"{path}.createdByCharacterId", "Trace creator differs from the source action actor.", trace.TraceId);
            }
            Require(result, trace.PhysicalCause, $"{path}.physicalCause");
            Require(result, trace.PersistenceReason, $"{path}.persistenceReason");
            Require(result, trace.Proves, $"{path}.proves");
            Require(result, trace.DoesNotProve, $"{path}.doesNotProve");
            Require(result, trace.IndependentSourceGroup, $"{path}.independentSourceGroup");
            if (trace.SupportsConclusionIds.Count == 0)
                result.Add("MissingProofLink", $"{path}.supportsConclusionIds", "Every causal trace must support at least one locked proof conclusion.", trace.TraceId);
            foreach (var id in trace.SupportsConclusionIds.Where(id => !conclusionById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.supportsConclusionIds", "Trace conclusion does not exist.", id);
            var categories = trace.SupportsConclusionIds.Where(conclusionById.ContainsKey)
                .Select(id => conclusionById[id].Category).Distinct(StringComparer.Ordinal).ToList();
            if (categories.Count > 2)
                result.Add("ClaimOverreach", $"{path}.supportsConclusionIds", "One physical trace cannot independently prove more than two claim categories.", trace.TraceId);
        }

        var hasIdentityTrace = truth.TraceLedger.Any(trace =>
            trace.CreatedByCharacterId == truth.CoreTruth.CulpritId
            && truth.CoreTruth.CrimeActionIds.Contains(trace.SourceActionId)
            && trace.SupportsConclusionIds.Contains(ProofConclusionIds.Identity));
        if (!hasIdentityTrace)
            result.Add(
                "MissingIdentityTrace",
                "traceLedger",
                "At least one IDENTITY trace must be created by the culprit during a locked crime action.");
    }

    private static void ValidateStatements(CaseTruthPackage truth, CaseValidationResult result,
        IReadOnlyDictionary<string, TrueTimelineEvent> eventById,
        IReadOnlyDictionary<string, TraceLedgerEntry> traceById,
        IReadOnlyDictionary<string, ProofConclusion> conclusionById)
    {
        var knowledgeIds = eventById.Keys.Concat(traceById.Keys).ToHashSet(StringComparer.Ordinal);
        foreach (var (statement, index) in truth.StatementLedger.Select((item, index) => (item, index)))
        {
            var path = $"statementLedger[{index}]";
            if (!StatementTruthStatuses.All.Contains(statement.TruthStatus))
                result.Add("InvalidValue", $"{path}.truthStatus", "truthStatus must be TRUE, FALSE, or MISLEADING.", statement.StatementId);
            Require(result, statement.Content, $"{path}.content");
            Require(result, statement.IndependentSourceGroup, $"{path}.independentSourceGroup");
            foreach (var id in statement.EventIds.Where(id => !eventById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.eventIds", "Statement event does not exist.", id);
            foreach (var id in statement.KnowledgeSourceIds.Where(id => !knowledgeIds.Contains(id)))
                result.Add("InvalidKnowledge", $"{path}.knowledgeSourceIds", "Statement knowledge has no valid source.", id);
            if (statement.EventIds.Count == 0 && statement.KnowledgeSourceIds.Count == 0)
                result.Add("InvalidKnowledge", path, "Statement must originate from an event or knowledge source.", statement.StatementId);
            if (statement.TruthStatus != StatementTruthStatuses.True && string.IsNullOrWhiteSpace(statement.ReasonForLie))
                result.Add("MissingLieReason", $"{path}.reasonForLie", "False or misleading statements require a reason.", statement.StatementId);
            foreach (var id in statement.ContradictedByTraceIds.Where(id => !traceById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.contradictedByTraceIds", "Contradicting trace does not exist.", id);
            foreach (var id in statement.SupportsConclusionIds.Where(id => !conclusionById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.supportsConclusionIds", "Statement conclusion does not exist.", id);
        }
    }

    private static void ValidateProofGraph(CaseTruthPackage truth, CaseValidationResult result,
        IReadOnlyDictionary<string, TraceLedgerEntry> traceById,
        IReadOnlyDictionary<string, StatementLedgerEntry> statementById)
    {
        var categories = truth.ProofGraph.Conclusions.Select(item => item.Category).ToList();
        if (truth.ProofGraph.Conclusions.Count != ProofConclusionIds.ByCategory.Count)
            result.Add("InvalidProofShape", "proofGraph.conclusions", "Proof graph must contain exactly five canonical conclusions.");
        foreach (var invalid in categories.Where(category => !ProofConclusionCategories.All.Contains(category)))
            result.Add("InvalidValue", "proofGraph.conclusions.category", "Unknown proof conclusion category.", invalid);
        foreach (var category in ProofConclusionCategories.All)
        {
            var categoryConclusions = truth.ProofGraph.Conclusions.Where(item => item.Category == category).ToList();
            if (categoryConclusions.Count == 0)
                result.Add("MissingProofCategory", "proofGraph.conclusions", "Proof graph is missing a required category.", category);
            else if (categoryConclusions.Count > 1)
                result.Add("DuplicateProofCategory", "proofGraph.conclusions", "Proof graph must contain exactly one conclusion per category.", category);
            foreach (var conclusion in categoryConclusions.Where(item => item.ConclusionId != ProofConclusionIds.ForCategory(category)))
                result.Add("NonCanonicalProofId", "proofGraph.conclusions.conclusionId", "Conclusion ID does not match its locked category ID.", conclusion.ConclusionId);
        }

        foreach (var (conclusion, index) in truth.ProofGraph.Conclusions.Select((item, index) => (item, index)))
        {
            var path = $"proofGraph.conclusions[{index}]";
            Require(result, conclusion.Proposition, $"{path}.proposition");
            foreach (var id in conclusion.SupportingTraceIds.Where(id => !traceById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.supportingTraceIds", "Supporting trace does not exist.", id);
            foreach (var id in conclusion.SupportingTraceIds.Where(traceById.ContainsKey)
                         .Where(id => !traceById[id].SupportsConclusionIds.Contains(conclusion.ConclusionId)))
                result.Add("ProofLinkMismatch", $"{path}.supportingTraceIds", "Proof conclusion lists a trace that does not claim support for this conclusion.", id);
            foreach (var id in conclusion.SupportingStatementIds.Where(id => !statementById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.supportingStatementIds", "Supporting statement does not exist.", id);
            foreach (var id in conclusion.SupportingStatementIds.Where(statementById.ContainsKey)
                         .Where(id => !statementById[id].SupportsConclusionIds.Contains(conclusion.ConclusionId)))
                result.Add("ProofLinkMismatch", $"{path}.supportingStatementIds", "Proof conclusion lists a statement that does not claim support for this conclusion.", id);
        }

        var conclusionById = truth.ProofGraph.Conclusions
            .Where(item => !string.IsNullOrWhiteSpace(item.ConclusionId))
            .GroupBy(item => item.ConclusionId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        foreach (var trace in traceById.Values)
        foreach (var id in trace.SupportsConclusionIds.Where(conclusionById.ContainsKey)
                     .Where(id => !conclusionById[id].SupportingTraceIds.Contains(trace.TraceId)))
            result.Add("ProofLinkMismatch", "proofGraph.conclusions.supportingTraceIds", "A trace claims a conclusion but the proof graph does not link back to that trace.", trace.TraceId);
        foreach (var statement in statementById.Values)
        foreach (var id in statement.SupportsConclusionIds.Where(conclusionById.ContainsKey)
                     .Where(id => !conclusionById[id].SupportingStatementIds.Contains(statement.StatementId)))
            result.Add("ProofLinkMismatch", "proofGraph.conclusions.supportingStatementIds", "A statement claims a conclusion but the proof graph does not link back to that statement.", statement.StatementId);

        foreach (var category in ProofConclusionCategories.All)
        {
            var groupIds = truth.ProofGraph.Conclusions.Where(item => item.Category == category)
                .SelectMany(item => item.SupportingTraceIds.Where(traceById.ContainsKey).Select(id => traceById[id].IndependentSourceGroup)
                    .Concat(item.SupportingStatementIds.Where(statementById.ContainsKey).Select(id => statementById[id].IndependentSourceGroup)))
                .Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToList();
            if (groupIds.Count < 2)
                result.Add("InsufficientIndependentProof", "proofGraph.conclusions", "Each proof category requires at least two independent source groups.", category);
        }

        var identityTraces = truth.ProofGraph.Conclusions.Where(item => item.Category == ProofConclusionCategories.Identity)
            .SelectMany(item => item.SupportingTraceIds).Where(traceById.ContainsKey).Select(id => traceById[id]).ToList();
        if (!identityTraces.Any(trace => trace.CreatedByCharacterId == truth.CoreTruth.CulpritId
            && truth.CoreTruth.CrimeActionIds.Contains(trace.SourceActionId)))
            result.Add("MissingIdentityEvidence", "proofGraph.conclusions", "Identity proof must connect the culprit to a crime action.");

        var otherSuspects = truth.CaseSeed.SuspectIds.Where(id => id != truth.CoreTruth.CulpritId).ToHashSet(StringComparer.Ordinal);
        var excluded = truth.ProofGraph.Conclusions.SelectMany(item => item.ExcludesSuspectIds).ToHashSet(StringComparer.Ordinal);
        foreach (var id in otherSuspects.Where(id => !excluded.Contains(id)))
            result.Add("AmbiguousSuspect", "proofGraph.conclusions.excludesSuspectIds", "Proof graph does not eliminate another suspect.", id);
    }

    private static void ValidateRedHerrings(CaseTruthPackage truth, CaseValidationResult result,
        IReadOnlyDictionary<string, TraceLedgerEntry> traceById,
        IReadOnlyDictionary<string, StatementLedgerEntry> statementById)
    {
        foreach (var (redHerring, index) in truth.RedHerringLedger.Select((item, index) => (item, index)))
        {
            var path = $"redHerringLedger[{index}]";
            Require(result, redHerring.SuspiciousReason, $"{path}.suspiciousReason");
            Require(result, redHerring.InnocentExplanation, $"{path}.innocentExplanation");
            if (redHerring.ClearingTraceIds.Count == 0 && redHerring.ClearingStatementIds.Count == 0)
                result.Add("MissingClearingEvidence", path, "Red herring must have clearing evidence.", redHerring.RedHerringId);
            foreach (var id in redHerring.ClearingTraceIds.Where(id => !traceById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.clearingTraceIds", "Clearing trace does not exist.", id);
            foreach (var id in redHerring.ClearingStatementIds.Where(id => !statementById.ContainsKey(id)))
                result.Add("MissingReference", $"{path}.clearingStatementIds", "Clearing statement does not exist.", id);
        }
    }

    private static void ValidateUniqueCulprit(CaseTruthPackage truth, CaseValidationResult result,
        IReadOnlyDictionary<string, TrueTimelineEvent> eventById,
        IReadOnlyDictionary<string, CharacterOpportunity> opportunityByCharacter)
    {
        var actions = truth.CoreTruth.CrimeActionIds.Where(eventById.ContainsKey).Select(id => eventById[id]).ToList();
        var requiredAccess = actions.SelectMany(item => item.RequiredAccessIds).ToHashSet(StringComparer.Ordinal);
        var requiredTools = actions.SelectMany(item => item.RequiredToolIds).ToHashSet(StringComparer.Ordinal);
        var requiredKnowledge = actions.SelectMany(item => item.RequiredKnowledgeIds).ToHashSet(StringComparer.Ordinal);
        foreach (var suspect in truth.CaseSeed.SuspectIds.Where(id => id != truth.CoreTruth.CulpritId))
        {
            if (!opportunityByCharacter.TryGetValue(suspect, out var item)) continue;
            var fitsWindow = actions.All(action => action.StartMinute >= item.AvailableFromMinute && action.EndMinute <= item.AvailableToMinute);
            var stillFits = item.HasMotive && item.IdentityLinkedToCrime && !item.AlibiVerified && fitsWindow
                && requiredAccess.IsSubsetOf(item.AccessIds)
                && requiredTools.IsSubsetOf(item.ToolIds)
                && requiredKnowledge.IsSubsetOf(item.KnowledgeIds);
            if (stillFits)
                result.Add("AmbiguousSuspect", "opportunityMatrix", "Another suspect still satisfies the complete causal chain.", suspect);
            if (string.IsNullOrWhiteSpace(item.EliminationReason))
                result.Add("MissingEliminationReason", "opportunityMatrix.eliminationReason", "Every non-culprit suspect needs a causal elimination reason.", suspect);
        }
    }

    private static void ValidateProjectionRewardUniqueness(GameCase gameCase, CaseValidationResult result)
    {
        var producers = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        void Add(string reward, string producer)
        {
            if (string.IsNullOrWhiteSpace(reward)) return;
            if (!producers.TryGetValue(reward, out var list)) producers[reward] = list = new List<string>();
            list.Add(producer);
        }
        foreach (var item in gameCase.Items) foreach (var id in item.UnlockClueIds) Add(id, $"item:{item.ItemId}");
        foreach (var dialogue in gameCase.Dialogues) foreach (var id in dialogue.UnlockClueIds) Add(id, $"dialogue:{dialogue.DialogueId}");
        foreach (var puzzle in gameCase.Puzzles)
        {
            foreach (var id in puzzle.UnlockClueIds) Add(id, $"puzzle:{puzzle.PuzzleId}");
            foreach (var id in puzzle.UnlockItemIds) Add(id, $"puzzle:{puzzle.PuzzleId}");
            foreach (var id in puzzle.UnlockSceneIds) Add(id, $"puzzle:{puzzle.PuzzleId}");
        }
        foreach (var interaction in gameCase.Interactions)
        {
            foreach (var id in interaction.UnlockClueIds) Add(id, $"interaction:{interaction.InteractionId}");
            foreach (var id in interaction.UnlockItemIds) Add(id, $"interaction:{interaction.InteractionId}");
            foreach (var id in interaction.UnlockSceneIds) Add(id, $"interaction:{interaction.InteractionId}");
        }
        foreach (var challenge in gameCase.EvidenceChallenges) foreach (var id in challenge.UnlockClueIds) Add(id, $"challenge:{challenge.ChallengeId}");
        foreach (var deduction in gameCase.Deductions) foreach (var id in deduction.UnlockClueIds) Add(id, $"deduction:{deduction.DeductionId}");

        foreach (var pair in producers.Where(pair => pair.Value.Count > 1))
        {
            var alternate = gameCase.AlternateRewardPaths.Any(path => path.RewardId == pair.Key
                && pair.Value.All(path.ProducerIds.Contains));
            if (!alternate)
                result.Add("DuplicateReward", "progression", "A reward has multiple producers without an explicit alternate path.", pair.Key);
        }

        var consumed = gameCase.Interactions.SelectMany(item => item.ConsumeItemIds).ToHashSet(StringComparer.Ordinal);
        var requiredLater = gameCase.Puzzles.SelectMany(item => item.RequiredItemIds)
            .Concat(gameCase.Interactions.SelectMany(item => item.RequiredItemIds))
            .Concat(gameCase.Stages.SelectMany(stage => stage.Scenes).SelectMany(scene => scene.CompleteCondition.RequiredItemIds))
            .ToHashSet(StringComparer.Ordinal);
        foreach (var id in consumed.Intersect(requiredLater))
            result.Add("ConsumedItemDeadEnd", "interactions.consumeItemIds", "A consumed item is still required by progression.", id);
    }

    private static int? TravelMinutes(IEnumerable<LocationTravelEdge> edges, string from, string to) =>
        edges.Where(edge => (edge.FromLocationId == from && edge.ToLocationId == to)
                            || (edge.FromLocationId == to && edge.ToLocationId == from))
            .Select(edge => (int?)edge.TravelMinutes).OrderBy(value => value).FirstOrDefault();

    private static Dictionary<string, T> UniqueBy<T>(CaseValidationResult result, string path, IEnumerable<T> items, Func<T, string> key)
    {
        var dictionary = new Dictionary<string, T>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            var id = key(item);
            if (string.IsNullOrWhiteSpace(id))
            {
                result.Add("MissingField", path, "ID is required.");
                continue;
            }
            if (!dictionary.TryAdd(id, item)) result.Add("DuplicateId", path, "Duplicate ID.", id);
        }
        return dictionary;
    }

    private static void CheckDuplicates(CaseValidationResult result, string path, IEnumerable<string> ids)
    {
        foreach (var id in ids.Where(id => !string.IsNullOrWhiteSpace(id)).GroupBy(id => id, StringComparer.Ordinal).Where(group => group.Count() > 1).Select(group => group.Key))
            result.Add("DuplicateId", path, "Duplicate ID.", id);
    }

    private static void Require(CaseValidationResult result, string value, string path)
    {
        if (string.IsNullOrWhiteSpace(value)) result.Add("MissingField", path, "Value is required.");
    }

    private static bool SameText(string left, string right) =>
        string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);

    private static JsonNode SortNode(JsonNode node)
    {
        if (node is JsonObject obj)
        {
            var sorted = new JsonObject();
            foreach (var pair in obj.OrderBy(pair => pair.Key, StringComparer.Ordinal))
                sorted[pair.Key] = pair.Value is null ? null : SortNode(pair.Value);
            return sorted;
        }
        if (node is JsonArray array)
        {
            var sorted = new JsonArray();
            foreach (var item in array) sorted.Add(item is null ? null : SortNode(item));
            return sorted;
        }
        return node.DeepClone();
    }
}
