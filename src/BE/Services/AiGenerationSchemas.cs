using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Model-owned case fields. Persistence/runtime/style fields are injected by the server after generation.
/// </summary>
public sealed class GeneratedCaseLogic
{
    public string CaseId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; }
    public List<CaseStage> Stages { get; set; } = new();
    public List<CaseCharacter> Characters { get; set; } = new();
    public List<CaseItem> Items { get; set; } = new();
    public List<CaseClue> Clues { get; set; } = new();
    public List<CaseDialogue> Dialogues { get; set; } = new();
    public List<TestimonyFragment> TestimonyFragments { get; set; } = new();
    public List<ConversationNode> ConversationNodes { get; set; } = new();
    public List<EvidenceChallenge> EvidenceChallenges { get; set; } = new();
    public List<DeductionChallenge> Deductions { get; set; } = new();
    public List<RequiredTeamworkChain> RequiredTeamworkChains { get; set; } = new();
    public List<CaseHint> Hints { get; set; } = new();
    public List<CaseInteraction> Interactions { get; set; } = new();
    public List<CasePuzzle> Puzzles { get; set; } = new();
    public List<AlternateRewardPath> AlternateRewardPaths { get; set; } = new();
    public FinalLogic FinalLogic { get; set; } = new();

    public static GeneratedCaseLogic FromGameCase(GameCase value) => new()
    {
        CaseId = value.CaseId,
        Title = value.Title,
        Summary = value.Summary,
        EstimatedMinutes = value.EstimatedMinutes,
        Stages = value.Stages,
        Characters = value.Characters,
        Items = value.Items,
        Clues = value.Clues,
        Dialogues = value.Dialogues,
        TestimonyFragments = value.TestimonyFragments,
        ConversationNodes = value.ConversationNodes,
        EvidenceChallenges = value.EvidenceChallenges,
        Deductions = value.Deductions,
        RequiredTeamworkChains = value.RequiredTeamworkChains,
        Hints = value.Hints,
        Interactions = value.Interactions,
        Puzzles = value.Puzzles,
        AlternateRewardPaths = value.AlternateRewardPaths,
        FinalLogic = value.FinalLogic
    };

    public GameCase ToGameCase(AiDraftSettings settings) => new()
    {
        CaseId = CaseId,
        Title = Title,
        Summary = Summary,
        Language = CaseLanguages.Normalize(settings.Language),
        ArtStyle = AiVisualStyleDefaults.ArtStyle,
        SubStyle = AiVisualStyleDefaults.SubStyle,
        CharacterStyle = AiVisualStyleDefaults.CharacterStyle,
        Status = CaseStatus.Draft,
        MechanicsVersion = settings.MechanicsVersion,
        GenerationMode = settings.GenerationMode,
        GenerationPreset = settings.GenerationPreset,
        EstimatedMinutes = EstimatedMinutes,
        CoverImageUrl = string.Empty,
        Stages = Stages,
        Characters = Characters,
        Items = Items,
        Clues = Clues,
        Dialogues = Dialogues,
        TestimonyFragments = TestimonyFragments,
        ConversationNodes = ConversationNodes,
        EvidenceChallenges = EvidenceChallenges,
        Deductions = Deductions,
        RequiredTeamworkChains = RequiredTeamworkChains,
        Hints = Hints,
        Interactions = Interactions,
        Puzzles = Puzzles,
        AlternateRewardPaths = AlternateRewardPaths,
        FinalLogic = FinalLogic
    };
}

public sealed class GeneratedV3SemanticReview
{
    public List<AiV3CrackReview> Cracks { get; set; } = new();
    // Legacy single-Crack mock/response compatibility.
    public List<AiV3PairEvaluation> PairEvaluations { get; set; } = new();
}

public sealed class GeneratedCaseSeedArtifact { public CaseSeed CaseSeed { get; set; } = new(); }
public sealed class GeneratedCoreTruthArtifact { public CoreCaseTruth CoreTruth { get; set; } = new(); }
public sealed class GeneratedTimelineArtifact { public List<TrueTimelineEvent> TrueTimeline { get; set; } = new(); }
public sealed class GeneratedOpportunityArtifact { public List<CharacterOpportunity> OpportunityMatrix { get; set; } = new(); }
public sealed class GeneratedTraceArtifact { public List<TraceLedgerEntry> TraceLedger { get; set; } = new(); }
public sealed class GeneratedStatementArtifact { public List<StatementLedgerEntry> StatementLedger { get; set; } = new(); }
public sealed class GeneratedProofArtifact
{
    public ProofGraph ProofGraph { get; set; } = new();
    public List<RedHerringLedgerEntry> RedHerringLedger { get; set; } = new();
}

/// <summary>
/// Deterministic guard for the subset of JSON Schema that OpenAI accepts with <c>strict: true</c>.
/// Every schema this project sends is validated by tests, because an unsupported keyword only
/// surfaces as an <c>invalid_json_schema</c> HTTP error at request time and mock-mode runs never
/// exercise it.
/// </summary>
public static class AiStrictSchemaLinter
{
    public static IReadOnlyList<string> Validate(JsonNode? schema)
    {
        var violations = new List<string>();
        Visit(schema, "$", violations);
        return violations;
    }

    private static void Visit(JsonNode? node, string path, ICollection<string> violations)
    {
        switch (node)
        {
            case JsonObject obj:
                Inspect(obj, path, violations);
                foreach (var (name, child) in obj) Visit(child, $"{path}.{name}", violations);
                break;
            case JsonArray array:
                for (var index = 0; index < array.Count; index++)
                    Visit(array[index], $"{path}[{index}]", violations);
                break;
        }
    }

    private static void Inspect(JsonObject schema, string path, ICollection<string> violations)
    {
        if (schema.ContainsKey("const"))
        {
            var type = schema["type"] is JsonValue value && value.TryGetValue<string>(out var name)
                ? name
                : string.Empty;
            if (string.IsNullOrEmpty(type))
                violations.Add($"{path}: const requires an explicit scalar type.");
            else if (type != "string")
                violations.Add($"{path}: const is only supported on string schemas, not '{type}'.");
        }
        if (schema["enum"] is JsonArray enumValues && enumValues.Count == 0)
            violations.Add($"{path}: enum cannot be empty.");
        if (schema["properties"] is not JsonObject properties) return;

        if (schema["additionalProperties"] is not JsonValue additional
            || !additional.TryGetValue<bool>(out var allowed) || allowed)
            violations.Add($"{path}: strict object schemas must set additionalProperties to false.");
        var required = schema["required"] is JsonArray requiredNames
            ? requiredNames.Select(item => item?.GetValue<string>() ?? string.Empty)
                .ToHashSet(StringComparer.Ordinal)
            : new HashSet<string>(StringComparer.Ordinal);
        foreach (var missing in properties.Select(pair => pair.Key).Where(key => !required.Contains(key)))
            violations.Add($"{path}: property '{missing}' must be listed in required.");
    }
}

public static class AiStrictSchemaProvider
{
    private static readonly NullabilityInfoContext Nullability = new();

    private static readonly IReadOnlyDictionary<Type, HashSet<string>> ExcludedProperties =
        new Dictionary<Type, HashSet<string>>
        {
            [typeof(CaseScene)] = new(StringComparer.Ordinal)
            {
                nameof(CaseScene.BackgroundUrl), nameof(CaseScene.PlacementPlan), nameof(CaseScene.Runtime)
            },
            [typeof(CaseCharacter)] = new(StringComparer.Ordinal) { nameof(CaseCharacter.ImageUrl) },
            [typeof(CaseItem)] = new(StringComparer.Ordinal) { nameof(CaseItem.ImageUrl) },
            [typeof(CaseTruthFeasibilityReview)] = new(StringComparer.Ordinal) { nameof(CaseTruthFeasibilityReview.ReviewedAt) },
            [typeof(BlindSolvabilityReview)] = new(StringComparer.Ordinal) { nameof(BlindSolvabilityReview.ReviewedAt) }
        };

    public static JsonObject StoryPreviewSchema() => BuildObjectSchema(typeof(AiStoryPreview), includeV3Fields: false);

    public static JsonObject CaseLogicSchema() => CaseLogicSchema(CaseMechanicsVersions.InvestigationV2);

    public static JsonObject CaseLogicSchema(int mechanicsVersion) =>
        BuildObjectSchema(typeof(GeneratedCaseLogic), mechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation);

    public static JsonObject CaseLogicSchema(int mechanicsVersion, CaseTruthPackage truth)
    {
        var schema = CaseLogicSchema(mechanicsVersion);
        var locations = RequiredEnumValues(truth.CaseSeed.LocationIds, "truth location IDs");
        var events = RequiredEnumValues(
            CaseTruthReferenceContract.TimelineEventIds(truth.TrueTimeline),
            "truth timeline event IDs");
        var conclusions = RequiredEnumValues(
            truth.ProofGraph.Conclusions.Select(item => item.ConclusionId),
            "truth conclusion IDs");
        var sourceGroups = RequiredEnumValues(
            truth.TraceLedger.Select(item => item.IndependentSourceGroup),
            "truth independent source groups");
        var statements = RequiredEnumValues(
            truth.StatementLedger.Select(item => item.StatementId),
            "truth statement IDs");
        var truthIds = RequiredEnumValues(
            events
                .Concat(truth.TraceLedger.Select(item => item.TraceId))
                .Concat(statements)
                .Concat(conclusions),
            "truth projection IDs");
        var properties = schema["properties"]!.AsObject();

        properties["stages"]!["items"]!["properties"]!["scenes"]!["items"]!["properties"]!["sceneId"] =
            StringEnumSchema(locations);

        var clueProperties = properties["clues"]!["items"]!["properties"]!.AsObject();
        clueProperties["sceneId"] = StringEnumSchema(locations);
        clueProperties["sourceActionId"] = StringEnumSchema(events);
        clueProperties["independentSourceGroup"] = StringEnumSchema(sourceGroups);
        clueProperties["supportsConclusionIds"]!["minItems"] = 1;
        clueProperties["supportsConclusionIds"]!["maxItems"] = 2;
        clueProperties["supportsConclusionIds"]!["items"] = StringEnumSchema(conclusions);

        ConstrainStatementProjection(properties["dialogues"]!, locations, statements);
        ConstrainStatementProjection(properties["conversationNodes"]!, locations, statements);

        var puzzleProperties = properties["puzzles"]!["items"]!["properties"]!.AsObject();
        puzzleProperties["basedOnTruthIds"]!["minItems"] = 1;
        puzzleProperties["basedOnTruthIds"]!["items"] = StringEnumSchema(truthIds);
        puzzleProperties["revealsConclusionIds"]!["items"] = StringEnumSchema(conclusions);

        var deductionProperties = properties["deductions"]!["items"]!["properties"]!.AsObject();
        deductionProperties["conclusionId"] = StringEnumSchema(conclusions);

        var finalProperties = properties["finalLogic"]!["properties"]!.AsObject();
        finalProperties["culpritId"] = StringEnumSchema([truth.CoreTruth.CulpritId]);
        finalProperties["motive"] = StringEnumSchema([truth.CoreTruth.Motive]);
        finalProperties["method"] = StringEnumSchema([truth.CoreTruth.Method]);
        return schema;
    }

    public static JsonObject V3SemanticReviewSchema() =>
        BuildObjectSchema(typeof(GeneratedV3SemanticReview), includeV3Fields: true);

    public static JsonObject V3CaseBlueprintSchema() =>
        BuildObjectSchema(typeof(AiCaseBlueprint), includeV3Fields: true);

    public static JsonObject CaseTruthSchema() =>
        BuildObjectSchema(typeof(CaseTruthPackage), includeV3Fields: true);

    public static JsonObject CaseSeedSchema() => CaseSeedSchema(AiTruthGenerationBudget.Maximum);
    public static JsonObject CoreTruthSchema() => CoreTruthSchema(AiTruthGenerationBudget.Maximum);
    public static JsonObject TrueTimelineSchema() => TrueTimelineSchema(AiTruthGenerationBudget.Maximum);
    public static JsonObject OpportunityMatrixSchema() => OpportunityMatrixSchema(
        AiTruthGenerationBudget.Maximum, AiTruthGenerationBudget.Maximum.MaxSuspects);
    public static JsonObject TraceLedgerSchema() => TraceLedgerSchema(AiTruthGenerationBudget.Maximum);
    public static JsonObject StatementLedgerSchema() => StatementLedgerSchema(AiTruthGenerationBudget.Maximum);
    public static JsonObject ProofGraphSchema() => ProofGraphSchema(AiTruthGenerationBudget.Maximum);

    public static JsonObject CaseSeedSchema(AiTruthGenerationBudget budget) =>
        CaseSeedSchema(budget, minSuspects: 2, minLocations: 1);

    public static JsonObject CaseSeedSchema(
        AiTruthGenerationBudget budget,
        int minSuspects,
        int minLocations,
        int? exactSuspects = null)
    {
        var schema = TruthSchema(typeof(GeneratedCaseSeedArtifact), budget);
        var suspectMinimum = exactSuspects ?? minSuspects;
        var suspectMaximum = exactSuspects ?? budget.MaxSuspects;
        SetArrayBounds(schema, ["caseSeed", "suspectIds"],
            Math.Clamp(suspectMinimum, 2, budget.MaxSuspects),
            Math.Clamp(suspectMaximum, 2, budget.MaxSuspects));
        SetArrayBounds(schema, ["caseSeed", "locationIds"],
            Math.Clamp(minLocations, 1, budget.MaxLocations), budget.MaxLocations);
        SetArrayBounds(schema, ["caseSeed", "locationGraph"], 0,
            budget.MaxLocations * Math.Max(0, budget.MaxLocations - 1));
        return schema;
    }

    public static JsonObject CoreTruthSchema(AiTruthGenerationBudget budget) =>
        TruthSchema(typeof(GeneratedCoreTruthArtifact), budget);

    public static JsonObject CoreTruthSchema(
        AiTruthGenerationBudget budget,
        IEnumerable<string> suspectIds,
        string? lockedTargetKind = null)
    {
        var suspects = RequiredEnumValues(suspectIds, nameof(suspectIds));
        var schema = CoreTruthSchema(budget);
        var properties = schema["properties"]!["coreTruth"]!["properties"]!.AsObject();
        properties["culpritId"] = StringEnumSchema(suspects);
        properties["targetKind"] = string.IsNullOrWhiteSpace(lockedTargetKind)
            ? StringEnumSchema(CaseTargetKinds.All)
            : ConstSchema(lockedTargetKind);
        SetArrayBounds(schema, ["coreTruth", "preparationActionIds"], 0, budget.MaxTimelineEvents);
        SetArrayBounds(schema, ["coreTruth", "crimeActionIds"], 1, budget.MaxTimelineEvents);
        SetArrayBounds(schema, ["coreTruth", "concealmentActionIds"], 0, budget.MaxTimelineEvents);
        SetArrayBounds(schema, ["coreTruth", "culpritMistakeActionIds"], 0, budget.MaxTimelineEvents);
        return schema;
    }

    public static JsonObject TrueTimelineSchema(AiTruthGenerationBudget budget)
    {
        var schema = TruthSchema(typeof(GeneratedTimelineArtifact), budget);
        SetArrayBounds(schema, ["trueTimeline"], 1, budget.MaxTimelineEvents);
        return schema;
    }

    public static JsonObject TrueTimelineSchema(
        AiTruthGenerationBudget budget,
        IEnumerable<string> suspectIds,
        string targetId,
        IEnumerable<string> locationIds)
        => TrueTimelineSchema(
            budget,
            suspectIds,
            targetId,
            CaseTargetKinds.Character,
            locationIds);

    public static JsonObject TrueTimelineSchema(
        AiTruthGenerationBudget budget,
        IEnumerable<string> suspectIds,
        string targetId,
        string targetKind,
        IEnumerable<string> locationIds)
    {
        var actorIds = CaseTargetKinds.IsAsset(new CoreCaseTruth { TargetKind = targetKind })
            ? suspectIds
            : suspectIds.Append(targetId);
        var actors = RequiredEnumValues(actorIds, "timeline actor IDs");
        var locations = RequiredEnumValues(locationIds, nameof(locationIds));
        var schema = TrueTimelineSchema(budget);
        var properties = schema["properties"]!["trueTimeline"]!["items"]!["properties"]!.AsObject();
        properties["actorId"] = StringEnumSchema(actors);
        properties["locationId"] = StringEnumSchema(locations);
        properties["witnessIds"]!["items"] = StringEnumSchema(actors);
        properties["witnessObservations"]!["items"]!["properties"]!["witnessId"] = StringEnumSchema(actors);
        properties["traceIds"]!["maxItems"] = 2;
        return schema;
    }

    public static JsonObject OpportunityMatrixSchema(AiTruthGenerationBudget budget, int suspectCount)
    {
        var schema = TruthSchema(typeof(GeneratedOpportunityArtifact), budget);
        var exactCount = Math.Clamp(suspectCount, 0, budget.MaxSuspects);
        SetArrayBounds(schema, ["opportunityMatrix"], exactCount, exactCount);
        return schema;
    }

    public static JsonObject OpportunityMatrixSchema(
        AiTruthGenerationBudget budget,
        IEnumerable<string> suspectIds,
        IEnumerable<string> timelineEventIds)
    {
        var suspects = RequiredEnumValues(suspectIds, nameof(suspectIds));
        var events = RequiredEnumValues(timelineEventIds, nameof(timelineEventIds));
        var schema = OpportunityMatrixSchema(budget, suspects.Count);
        var properties = schema["properties"]!["opportunityMatrix"]!["items"]!["properties"]!.AsObject();
        properties["characterId"] = StringEnumSchema(suspects);
        properties["alibiEventIds"]!["items"] = StringEnumSchema(events);
        return schema;
    }

    public static JsonObject TraceLedgerSchema(AiTruthGenerationBudget budget)
    {
        var schema = ConstrainProofReferences(
            TruthSchema(typeof(GeneratedTraceArtifact), budget), "traceLedger");
        SetArrayBounds(schema, ["traceLedger"], 1, budget.MaxTraces);
        return schema;
    }

    public static JsonObject TraceLedgerSchema(
        AiTruthGenerationBudget budget,
        IEnumerable<string> timelineEventIds,
        IEnumerable<string> plannedTraceIds)
    {
        var events = RequiredEnumValues(timelineEventIds, nameof(timelineEventIds));
        var traces = RequiredEnumValues(plannedTraceIds, nameof(plannedTraceIds));
        if (traces.Count > budget.MaxTraces)
            throw new ArgumentException("Planned trace IDs exceed the truth generation budget.", nameof(plannedTraceIds));
        var schema = TraceLedgerSchema(budget);
        SetArrayBounds(schema, ["traceLedger"], traces.Count, traces.Count);
        var properties = schema["properties"]!["traceLedger"]!["items"]!["properties"]!.AsObject();
        properties["traceId"] = StringEnumSchema(traces);
        properties["sourceActionId"] = StringEnumSchema(events);
        return schema;
    }

    public static JsonObject StatementLedgerSchema(AiTruthGenerationBudget budget)
    {
        var schema = ConstrainProofReferences(
            TruthSchema(typeof(GeneratedStatementArtifact), budget), "statementLedger");
        SetArrayBounds(schema, ["statementLedger"], 1, budget.MaxStatements);
        var properties = schema["properties"]!["statementLedger"]!["items"]!["properties"]!.AsObject();
        properties["knowledgeSourceIds"]!["minItems"] = 1;
        return schema;
    }

    public static JsonObject StatementLedgerSchema(
        AiTruthGenerationBudget budget,
        IEnumerable<string> speakerIds,
        IEnumerable<string> timelineEventIds,
        IEnumerable<string> traceIds)
    {
        var speakers = RequiredEnumValues(speakerIds, nameof(speakerIds));
        var events = RequiredEnumValues(timelineEventIds, nameof(timelineEventIds));
        var traces = RequiredEnumValues(traceIds, nameof(traceIds));
        var knowledge = events.Concat(traces).Distinct(StringComparer.Ordinal).ToList();
        var schema = StatementLedgerSchema(budget);
        var properties = schema["properties"]!["statementLedger"]!["items"]!["properties"]!.AsObject();
        properties["speakerId"] = StringEnumSchema(speakers);
        properties["eventIds"]!["items"] = StringEnumSchema(events);
        properties["knowledgeSourceIds"]!["items"] = StringEnumSchema(knowledge);
        properties["contradictedByTraceIds"]!["items"] = StringEnumSchema(traces);
        properties["contradictedByTraceIds"]!["maxItems"] = 1;
        return schema;
    }

    public static JsonObject ProofGraphSchema(AiTruthGenerationBudget budget)
    {
        var schema = ConstrainProofGraph(
            TruthSchema(typeof(GeneratedProofArtifact), budget));
        SetArrayBounds(schema, ["proofGraph", "conclusions"],
            budget.ProofConclusionCount, budget.ProofConclusionCount);
        SetArrayBounds(schema, ["redHerringLedger"], 0, budget.MaxRedHerrings);
        return schema;
    }

    public static JsonObject ProofGraphSchema(
        AiTruthGenerationBudget budget,
        IEnumerable<string> suspectIds,
        IEnumerable<string> traceIds,
        IEnumerable<string> statementIds)
    {
        var suspects = RequiredEnumValues(suspectIds, nameof(suspectIds));
        var traces = RequiredEnumValues(traceIds, nameof(traceIds));
        var statements = RequiredEnumValues(statementIds, nameof(statementIds));
        var schema = ProofGraphSchema(budget);
        var conclusionProperties = schema["properties"]!["proofGraph"]!["properties"]!["conclusions"]!
            ["items"]!["properties"]!.AsObject();
        conclusionProperties["supportingTraceIds"]!["minItems"] = 1;
        conclusionProperties["supportingTraceIds"]!["items"] = StringEnumSchema(traces);
        conclusionProperties["supportingStatementIds"]!["items"] = StringEnumSchema(statements);
        conclusionProperties["excludesSuspectIds"]!["items"] = StringEnumSchema(suspects);
        var redHerringProperties = schema["properties"]!["redHerringLedger"]!["items"]!["properties"]!.AsObject();
        redHerringProperties["suspectId"] = StringEnumSchema(suspects);
        redHerringProperties["clearingTraceIds"]!["items"] = StringEnumSchema(traces);
        redHerringProperties["clearingTraceIds"]!["maxItems"] = 1;
        redHerringProperties["clearingStatementIds"]!["items"] = StringEnumSchema(statements);
        return schema;
    }

    public static JsonObject CaseTruthFeasibilityReviewSchema()
    {
        var schema = BuildObjectSchema(typeof(CaseTruthFeasibilityReview), includeV3Fields: true);
        ConstrainReviewEnvelope(schema, CaseTruthSchemaVersions.FeasibilityReviewV2);
        return schema;
    }

    public static JsonObject BlindSolvabilityReviewSchema()
    {
        var schema = BuildObjectSchema(typeof(BlindSolvabilityReview), includeV3Fields: true);
        ConstrainReviewEnvelope(schema, CaseTruthSchemaVersions.BlindReviewV2);
        var properties = schema["properties"]!.AsObject();
        properties["evidenceChainIds"]!["minItems"] = ProofConclusionCategories.All.Count;
        return schema;
    }

    private static void ConstrainReviewEnvelope(JsonObject schema, string schemaVersion)
    {
        var properties = schema["properties"]!.AsObject();
        properties["status"] = StringEnumSchema(
            [CaseTruthReviewStatuses.Passed, CaseTruthReviewStatuses.Failed, CaseTruthReviewStatuses.Ambiguous]);
        properties["schemaVersion"] = StringEnumSchema([schemaVersion]);
        properties["confidence"]!["minimum"] = 0;
        properties["confidence"]!["maximum"] = 1;
        properties["issues"]!["maxItems"] = 0;
        properties["findings"]!["maxItems"] = 24;

        var findingProperties = properties["findings"]!["items"]!["properties"]!.AsObject();
        findingProperties["findingId"]!["maxLength"] = 80;
        findingProperties["code"] = StringEnumSchema(CaseTruthReviewFindingCodes.All);
        findingProperties["relatedIds"]!["maxItems"] = 12;
        findingProperties["relatedIds"]!["items"]!["maxLength"] = AiTruthGenerationBudget.Maximum.MaxIdLength;
        findingProperties["message"]!["maxLength"] = 800;
    }

    private static void ConstrainStatementProjection(
        JsonNode ledgerSchema,
        IReadOnlyCollection<string> locations,
        IReadOnlyCollection<string> statements)
    {
        var properties = ledgerSchema["items"]!["properties"]!.AsObject();
        properties["statementIds"]!["minItems"] = 1;
        properties["statementIds"]!["items"] = StringEnumSchema(statements);
        properties["availableSceneIds"]!["minItems"] = 1;
        properties["availableSceneIds"]!["items"] = StringEnumSchema(locations);
    }

    private static JsonObject BuildObjectSchema(Type type, bool includeV3Fields)
    {
        var properties = new JsonObject();
        var required = new JsonArray();

        foreach (var property in type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
        {
            if (!property.CanRead || IsExcluded(type, property.Name)
                || (!includeV3Fields && type == typeof(GeneratedCaseLogic) && property.Name == nameof(GeneratedCaseLogic.TestimonyFragments)))
                continue;
            if (!includeV3Fields && type == typeof(EvidenceChallenge)
                && property.Name is nameof(EvidenceChallenge.Order)
                    or nameof(EvidenceChallenge.IsSignature)
                    or nameof(EvidenceChallenge.CandidateEvidenceIds)
                    or nameof(EvidenceChallenge.CandidateTestimonyFragmentIds)
                    or nameof(EvidenceChallenge.StartRequiredEvidenceIds)
                    or nameof(EvidenceChallenge.StartRequiredTestimonyFragmentIds))
                continue;
            if (!includeV3Fields && type == typeof(CaseClue)
                && property.Name == nameof(CaseClue.AcquisitionMethod))
                continue;

            var name = property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name
                ?? JsonNamingPolicy.CamelCase.ConvertName(property.Name);
            properties[name] = BuildSchema(property.PropertyType, Nullability.Create(property), includeV3Fields);
            required.Add(name);
        }

        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = required,
            ["additionalProperties"] = false
        };
    }

    private static JsonNode BuildSchema(Type type, NullabilityInfo? nullability = null, bool includeV3Fields = false)
    {
        var nullableUnderlying = Nullable.GetUnderlyingType(type);
        if (nullableUnderlying is not null)
        {
            return WithNull(BuildSchema(nullableUnderlying, includeV3Fields: includeV3Fields));
        }

        if (type == typeof(string))
        {
            var schema = new JsonObject { ["type"] = "string" };
            return nullability?.ReadState == NullabilityState.Nullable ? WithNull(schema) : schema;
        }
        if (type == typeof(bool)) return new JsonObject { ["type"] = "boolean" };
        if (type == typeof(int) || type == typeof(long)) return new JsonObject { ["type"] = "integer" };
        if (type == typeof(float) || type == typeof(double) || type == typeof(decimal))
            return new JsonObject { ["type"] = "number" };

        if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(List<>))
        {
            var elementType = type.GetGenericArguments()[0];
            return new JsonObject
            {
                ["type"] = "array",
                ["items"] = BuildSchema(elementType, nullability?.GenericTypeArguments.FirstOrDefault(), includeV3Fields)
            };
        }

        if (type.IsEnum)
        {
            return new JsonObject
            {
                ["type"] = "string",
                ["enum"] = new JsonArray(Enum.GetNames(type).Select(name => (JsonNode?)JsonValue.Create(name)).ToArray())
            };
        }

        return BuildObjectSchema(type, includeV3Fields);
    }

    private static JsonObject WithNull(JsonNode schema)
    {
        var typeNode = schema["type"];
        schema["type"] = new JsonArray(typeNode?.DeepClone(), JsonValue.Create("null"));
        return (JsonObject)schema;
    }

    private static JsonObject ConstrainProofReferences(JsonObject schema, string ledgerProperty)
    {
        var ledger = schema["properties"]![ledgerProperty]!.AsObject();
        if (ledgerProperty == "traceLedger") ledger["maxItems"] = CaseTruthScopeLimits.MaxTraceEntries;
        var entryProperties = ledger["items"]!["properties"]!.AsObject();
        var references = entryProperties["supportsConclusionIds"]!.AsObject();
        references["minItems"] = 1;
        references["maxItems"] = 2;
        references["items"] = StringEnumSchema(ProofConclusionIds.All);
        return schema;
    }

    private static JsonObject ConstrainProofGraph(JsonObject schema)
    {
        var conclusions = schema["properties"]!["proofGraph"]!["properties"]!["conclusions"]!.AsObject();
        conclusions["minItems"] = ProofConclusionIds.ByCategory.Count;
        conclusions["maxItems"] = ProofConclusionIds.ByCategory.Count;
        var conclusionProperties = conclusions["items"]!["properties"]!.AsObject();
        conclusionProperties["conclusionId"] = StringEnumSchema(ProofConclusionIds.All);
        conclusionProperties["category"] = StringEnumSchema(ProofConclusionCategories.All);
        conclusionProperties["supportingTraceIds"]!["minItems"] = 1;
        return schema;
    }

    private static JsonObject TruthSchema(Type type, AiTruthGenerationBudget budget)
    {
        var schema = BuildObjectSchema(type, includeV3Fields: true);
        ApplyTruthStringLimits(schema, string.Empty, budget);
        return schema;
    }

    private static void SetArrayBounds(JsonObject schema, IReadOnlyList<string> path, int minimum, int maximum)
    {
        JsonNode current = schema;
        foreach (var segment in path)
            current = current["properties"]?[segment]
                ?? throw new InvalidOperationException($"Strict schema path '{string.Join('.', path)}' was not found.");
        var array = current.AsObject();
        array["minItems"] = minimum;
        array["maxItems"] = maximum;
    }

    private static void ApplyTruthStringLimits(JsonNode node, string propertyName, AiTruthGenerationBudget budget)
    {
        if (node is not JsonObject obj) return;
        if (IsStringSchema(obj))
        {
            var identifier = propertyName.EndsWith("Id", StringComparison.OrdinalIgnoreCase)
                || propertyName.EndsWith("Ids", StringComparison.OrdinalIgnoreCase);
            obj["maxLength"] = identifier ? budget.MaxIdLength : budget.MaxDescriptionLength;
        }

        if (obj["properties"] is JsonObject properties)
        {
            foreach (var pair in properties)
            {
                if (pair.Value is not null) ApplyTruthStringLimits(pair.Value, pair.Key, budget);
            }
        }
        if (obj["items"] is JsonNode items)
            ApplyTruthStringLimits(items, propertyName, budget);
    }

    private static bool IsStringSchema(JsonObject schema)
    {
        if (schema["type"] is JsonValue value
            && value.TryGetValue<string>(out var type)) return type == "string";
        return schema["type"] is JsonArray types
            && types.Any(item => item is JsonValue itemValue
                && itemValue.TryGetValue<string>(out var itemType)
                && itemType == "string");
    }

    private static JsonObject StringEnumSchema(IEnumerable<string> values) => new()
    {
        ["type"] = "string",
        ["enum"] = new JsonArray(values.OrderBy(value => value, StringComparer.Ordinal)
            .Select(value => (JsonNode?)JsonValue.Create(value)).ToArray())
    };

    private static JsonObject ConstSchema(string value) => new()
    {
        ["type"] = "string",
        ["const"] = value
    };

    private static IReadOnlyList<string> RequiredEnumValues(IEnumerable<string> values, string parameterName)
    {
        var result = values.Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal).ToList();
        if (result.Count == 0)
            throw new ArgumentException("A strict-schema enum cannot be empty.", parameterName);
        return result;
    }

    private static bool IsExcluded(Type type, string propertyName) =>
        ExcludedProperties.TryGetValue(type, out var names) && names.Contains(propertyName);
}
