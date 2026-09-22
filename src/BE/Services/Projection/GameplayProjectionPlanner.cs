using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Services.Interfaces;
using MongoDB.Bson;

namespace SirLocked.Api.Services.Projection;

public sealed class GameplayProjectionPlanner : IGameplayProjectionPlanner
{
    private readonly ICaseTruthService _truthService;
    private readonly IProjectionReadinessAnalyzer _readinessAnalyzer;

    public GameplayProjectionPlanner(
        ICaseTruthService truthService,
        IProjectionReadinessAnalyzer? readinessAnalyzer = null)
    {
        _truthService = truthService;
        _readinessAnalyzer = readinessAnalyzer ?? new ProjectionReadinessAnalyzer();
    }

    public GameplayProjectionPlan Build(AiCaseDraft draft, CaseTruthPackage truth)
    {
        var contract = AiGenerationContract.For(draft.Settings);
        var projectability = ValidateProjectability(draft, truth, contract);
        if (!projectability.IsValid)
            throw new ProjectionPlanningException(projectability.Errors.Select(FormatError).ToList());
        var finalEvidence = _readinessAnalyzer.MatchFinalEvidence(truth).EvidenceByCategory;
        var dialogueAllocation = _readinessAnalyzer.AllocateDialogues(truth, contract);
        var challengeStatementIds = new Dictionary<string, string>(StringComparer.Ordinal);

        var truthHash = _truthService.ComputeHash(truth);
        var plan = new GameplayProjectionPlan
        {
            CaseId = $"case-ai-{draft.Id}",
            TruthHash = truthHash,
            SettingsHash = ProjectionCanonicalizer.HashObject(draft.Settings),
            BlueprintHash = draft.BlueprintHash,
            Skeleton = CreateSkeleton(
                draft,
                truth,
                contract,
                finalEvidence,
                dialogueAllocation,
                challengeStatementIds)
        };
        plan.Skeleton.TruthHash = truthHash;

        IndexProvenance(plan, truth, challengeStatementIds);
        plan.PlanHash = ProjectionCanonicalizer.ComputePlanHash(plan);
        return plan;
    }

    public CaseValidationResult ValidateProjectability(AiCaseDraft draft, CaseTruthPackage truth) =>
        ValidateProjectability(draft, truth, AiGenerationContract.For(draft.Settings));

    private CaseValidationResult ValidateProjectability(
        AiCaseDraft draft,
        CaseTruthPackage truth,
        AiGenerationContract contract)
    {
        var result = new CaseValidationResult();
        var capacity = _readinessAnalyzer.AnalyzeCapacity(draft.Settings);
        var locations = OrderedLocations(truth);
        if (locations.Count < contract.MinScenes || locations.Count > contract.MaxScenes)
            result.Add("ProjectionLocationCount", "caseSeed.locationIds",
                $"Gameplay preset requires {contract.MinScenes}-{contract.MaxScenes} used truth locations; truth provides {locations.Count}.");
        if (locations.Count < draft.Settings.StageCount)
            result.Add("ProjectionStageCoverage", "caseSeed.locationIds",
                $"{draft.Settings.StageCount} stages cannot be populated by {locations.Count} used truth locations.");

        var characters = OrderedCharacters(truth);
        if (characters.Count < contract.MinCharacters || characters.Count > contract.MaxCharacters)
            result.Add("ProjectionCharacterCount", "caseSeed.suspectIds",
                $"Gameplay preset requires {contract.MinCharacters}-{contract.MaxCharacters} referenced characters; truth provides {characters.Count}.");

        var finalEvidence = _readinessAnalyzer.MatchFinalEvidence(truth);
        result.Errors.AddRange(finalEvidence.Validation.Errors);

        if (truth.TraceLedger.Count == 0)
            result.Add("ProjectionMissingTrace", "trueTimeline.traceIds",
                "Truth has no causal trace that can become a clue.");
        if (truth.StatementLedger.Count == 0)
            result.Add("ProjectionMissingStatement", "statementLedger",
                "Truth has no approved statement that can become dialogue.");
        var dialogueAllocation = _readinessAnalyzer.AllocateDialogues(truth, contract);
        result.Errors.AddRange(dialogueAllocation.Validation.Errors);
        var validContradictionCount = truth.StatementLedger.Sum(statement =>
            statement.ContradictedByTraceIds.Count(traceId =>
                truth.TraceLedger.Any(trace => trace.TraceId == traceId)));
        if (contract.EvidenceChallenges > 0 && validContradictionCount == 0)
            result.Add("ProjectionMissingContradiction", "statementLedger",
                "The selected preset requires at least one truth-backed contradiction pair.");
        var contradictionTraceCount = truth.StatementLedger
            .SelectMany(statement => statement.ContradictedByTraceIds)
            .Where(traceId => truth.TraceLedger.Any(trace => trace.TraceId == traceId))
            .Distinct(StringComparer.Ordinal)
            .Count();
        if (contradictionTraceCount > capacity.MaxChallengeSlots)
            result.Add("ProjectionContradictionBudget", "statementLedger",
                $"Truth uses {contradictionTraceCount} contradiction sources but the preset allows {capacity.MaxChallengeSlots}.");
        if (truth.RedHerringLedger.Count > capacity.MaxRedHerringSlots)
            result.Add("ProjectionRedHerringBudget", "redHerringLedger",
                $"Truth uses {truth.RedHerringLedger.Count} red herrings but the preset allows {capacity.MaxRedHerringSlots}.");
        if (finalEvidence.Validation.IsValid)
        {
            var requiredTraceIds = truth.RedHerringLedger.SelectMany(item => item.ClearingTraceIds)
                .Concat(truth.StatementLedger.SelectMany(item => item.ContradictedByTraceIds))
                .Concat(finalEvidence.EvidenceByCategory.Values.Select(item => item.TraceId))
                .ToHashSet(StringComparer.Ordinal);
            if (requiredTraceIds.Count > capacity.BaseTraceCapacity)
            {
                var hasRedHerringTrace = truth.RedHerringLedger.Any(item => item.ClearingTraceIds.Count > 0);
                result.Add(
                    hasRedHerringTrace ? "ProjectionRedHerringClosureBudget" : "ProjectionClueClosureBudget",
                    hasRedHerringTrace ? "redHerringLedger" : "statementLedger",
                    $"Truth closure requires {requiredTraceIds.Count} trace clues but the preset allows {capacity.BaseTraceCapacity} base trace clues.");
            }
            var challengeCount = contract.MaxEvidenceChallenges > 0
                ? Math.Clamp(validContradictionCount, contract.EvidenceChallenges, contract.MaxEvidenceChallenges)
                : contract.EvidenceChallenges;
            var redHerringPresentationCount = truth.RedHerringLedger.Count(item =>
                item.ClearingTraceIds.Any(traceId => truth.TraceLedger.Any(trace => trace.TraceId == traceId)));
            var conclusionIds = truth.ProofGraph.Conclusions.Select(item => item.ConclusionId)
                .ToHashSet(StringComparer.Ordinal);
            var invalidRequiredTrace = truth.TraceLedger.FirstOrDefault(trace =>
                requiredTraceIds.Contains(trace.TraceId)
                && !trace.SupportsConclusionIds.Any(conclusionIds.Contains));
            if (invalidRequiredTrace is not null)
                result.Add("ProjectionOrphanRequiredTrace", "traceLedger",
                    "A required trace is not on a path to any proof conclusion.", invalidRequiredTrace.TraceId);
            var minimumTraceSlots = Math.Max(
                5,
                contract.MinClues - challengeCount - redHerringPresentationCount);
            var eligibleTraceCount = truth.TraceLedger.Count(trace =>
                trace.SupportsConclusionIds.Any(conclusionIds.Contains));
            if (eligibleTraceCount < minimumTraceSlots)
                result.Add("ProjectionProofLinkedTraceCount", "trueTimeline.traceIds",
                    $"The preset requires {minimumTraceSlots} proof-linked trace slots but truth provides {eligibleTraceCount}.");
            var projectedClueCount = Math.Max(
                requiredTraceIds.Count,
                minimumTraceSlots) + challengeCount + redHerringPresentationCount;
            if (projectedClueCount > capacity.MaxProjectedClues)
                result.Add("ProjectionClueBudget", "statementLedger",
                    $"Required causal traces plus {challengeCount} reveal slots need {projectedClueCount} clues but the preset allows {capacity.MaxProjectedClues}.");
        }
        result.Deduplicate();
        return result;
    }

    private static string FormatError(CaseValidationError error) =>
        $"{error.Code} {error.Path}" +
        $"{(string.IsNullOrWhiteSpace(error.RefId) ? string.Empty : $" [ref: {error.RefId}]")}: {error.Message}";

    private static GameCase CreateSkeleton(
        AiCaseDraft draft,
        CaseTruthPackage truth,
        AiGenerationContract contract,
        IReadOnlyDictionary<string, TraceLedgerEntry> finalEvidence,
        DialogueAllocation dialogueAllocation,
        IDictionary<string, string> challengeStatementIds)
    {
        var locations = OrderedLocations(truth);
        var characters = OrderedCharacters(truth);
        var skeleton = new GameCase
        {
            // The typed plan is a Mongo subdocument and GameCase.Id uses an
            // ObjectId serializer. This deterministic value is storage-only;
            // the compiler clears it from the publishable GameCase.
            Id = ObjectId.TryParse(draft.Id, out _)
                ? draft.Id
                : ProjectionCanonicalizer.HashObject(draft.Id)[..24],
            CaseId = $"case-ai-{draft.Id}",
            Language = CaseLanguages.Normalize(draft.Settings.Language),
            ArtStyle = AiVisualStyleDefaults.ArtStyle,
            SubStyle = AiVisualStyleDefaults.SubStyle,
            CharacterStyle = AiVisualStyleDefaults.CharacterStyle,
            Status = CaseStatus.Draft,
            MechanicsVersion = draft.Settings.MechanicsVersion,
            GenerationMode = draft.Settings.GenerationMode,
            GenerationPreset = draft.Settings.GenerationPreset,
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            LogicVerificationStatus = CaseLogicVerificationStatuses.CausalVerified,
            TruthSchemaVersion = truth.SchemaVersion,
            TruthHash = draft.TruthHash,
            BlindReviewStatus = CaseTruthReviewStatuses.NotRun,
            EstimatedMinutes = truth.CaseSeed.EstimatedMinutes,
            ProjectionSchemaVersion = GameplayProjectionVersions.Plan,
            ProjectionCompilerVersion = GameplayProjectionVersions.Compiler,
            ProjectionBuildMode = ProjectionBuildModes.AiCompiled,
            CreatedAt = DateTime.UnixEpoch,
            UpdatedAt = DateTime.UnixEpoch
        };

        var stageCount = Math.Clamp(draft.Settings.StageCount, contract.MinStages, contract.MaxStages);
        for (var index = 0; index < stageCount; index++)
        {
            skeleton.Stages.Add(new CaseStage
            {
                StageId = $"stage-{index + 1:00}",
                Order = index + 1
            });
        }
        for (var index = 0; index < locations.Count; index++)
        {
            var stageIndex = index < stageCount ? index : index % stageCount;
            skeleton.Stages[stageIndex].Scenes.Add(new CaseScene
            {
                SceneId = locations[index],
                CompleteCondition = new CompleteCondition { Logic = "AND" }
            });
        }

        foreach (var characterId in characters)
            skeleton.Characters.Add(new CaseCharacter { CharacterId = characterId });

        PlaceCharacters(skeleton, truth, dialogueAllocation);
        var plannedChallengeCount = PlannedChallengeCount(truth, contract);
        var plannedRedHerringCount = truth.RedHerringLedger.Count(item =>
            item.ClearingTraceIds.Any(traceId => truth.TraceLedger.Any(trace => trace.TraceId == traceId)));
        var selectedTraces = SelectTraces(
            truth,
            Math.Max(5, contract.MinClues - plannedChallengeCount - plannedRedHerringCount),
            finalEvidence);
        var clueByTrace = new Dictionary<string, CaseClue>(StringComparer.Ordinal);
        foreach (var trace in selectedTraces)
        {
            var clue = CreateTraceClue(trace, $"clue-{trace.TraceId}");
            skeleton.Clues.Add(clue);
            clueByTrace.TryAdd(trace.TraceId, clue);
        }

        var conclusionByCategory = truth.ProofGraph.Conclusions
            .ToDictionary(item => item.Category, StringComparer.Ordinal);
        foreach (var category in EvidenceClaimTypes.OrderedForContract(CaseLogicContractVersions.CausalFiveClaim))
        {
            var conclusion = conclusionByCategory[category];
            var trace = finalEvidence[category];
            var clue = clueByTrace[trace.TraceId];
            clue.IsCritical = true;
            clue.IsEvidence = true;
            skeleton.FinalLogic.RequiredEvidenceLinks.Add(new RequiredEvidenceLink
            {
                ClaimType = category,
                ConclusionId = conclusion.ConclusionId,
                EvidenceId = clue.ClueId
            });
        }
        skeleton.FinalLogic.RequiredEvidenceIds =
            skeleton.FinalLogic.RequiredEvidenceLinks.Select(item => item.EvidenceId).ToList();

        CreateV3EvidenceSources(skeleton, truth, clueByTrace, contract);
        CreateDialogues(skeleton, dialogueAllocation);
        CreateChallenges(skeleton, truth, clueByTrace, contract, challengeStatementIds);
        FillClueBudget(skeleton, truth, contract.MinClues);
        CreatePuzzles(skeleton, truth, contract, characters[0]);
        CreateInteractions(skeleton, contract);
        CreateDeductionsAndTeamwork(skeleton, truth, contract);
        CreateHints(skeleton);
        CreateFinalLogic(skeleton, truth);
        ApplyRedHerrings(skeleton, truth, clueByTrace);
        AddSceneCompletionRequirements(skeleton);
        return skeleton;
    }

    private static void PlaceCharacters(
        GameCase skeleton,
        CaseTruthPackage truth,
        DialogueAllocation dialogueAllocation)
    {
        var scenes = skeleton.Stages.SelectMany(stage => stage.Scenes)
            .ToDictionary(scene => scene.SceneId, StringComparer.Ordinal);
        foreach (var timelineEvent in truth.TrueTimeline)
        {
            if (!scenes.TryGetValue(timelineEvent.LocationId, out var scene)) continue;
            AddUnique(scene.CharacterIds, timelineEvent.ActorId);
            foreach (var witnessId in timelineEvent.WitnessIds) AddUnique(scene.CharacterIds, witnessId);
        }
        foreach (var dialogue in dialogueAllocation.Slots)
        {
            foreach (var sceneId in dialogue.AvailableSceneIds.Where(scenes.ContainsKey))
                AddUnique(scenes[sceneId].CharacterIds, dialogue.CharacterId);
        }

        var orderedScenes = skeleton.Stages.SelectMany(stage => stage.Scenes).ToList();
        var placedCharacters = orderedScenes.SelectMany(scene => scene.CharacterIds)
            .ToHashSet(StringComparer.Ordinal);
        var unplacedIndex = 0;
        foreach (var character in skeleton.Characters.Where(item => !placedCharacters.Contains(item.CharacterId)))
        {
            AddUnique(orderedScenes[unplacedIndex % orderedScenes.Count].CharacterIds, character.CharacterId);
            unplacedIndex++;
        }

        foreach (var scene in scenes.Values)
        {
            for (var index = 0; index < scene.CharacterIds.Count; index++)
            {
                var characterId = scene.CharacterIds[index];
                scene.Hotspots.Add(new SceneHotspot
                {
                    HotspotId = $"hotspot-{scene.SceneId}-{characterId}",
                    Type = "CHARACTER",
                    TargetId = characterId,
                    X = 70 + index * 5,
                    Y = 45,
                    Width = 10,
                    Height = 30,
                    ZIndex = 5
                });
            }
        }
    }

    private static List<TraceLedgerEntry> SelectTraces(
        CaseTruthPackage truth,
        int minimum,
        IReadOnlyDictionary<string, TraceLedgerEntry> finalEvidence)
    {
        var selected = new List<TraceLedgerEntry>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Add(string traceId)
        {
            var trace = truth.TraceLedger.FirstOrDefault(item => item.TraceId == traceId);
            if (trace is not null && seen.Add(trace.TraceId)) selected.Add(trace);
        }

        foreach (var redHerring in truth.RedHerringLedger)
            foreach (var traceId in redHerring.ClearingTraceIds) Add(traceId);
        foreach (var statement in truth.StatementLedger)
            foreach (var traceId in statement.ContradictedByTraceIds) Add(traceId);

        foreach (var category in EvidenceClaimTypes.OrderedForContract(CaseLogicContractVersions.CausalFiveClaim))
            Add(finalEvidence[category].TraceId);
        foreach (var trace in truth.TraceLedger)
        {
            if (selected.Count >= minimum) break;
            if (trace.SupportsConclusionIds.Count > 0) Add(trace.TraceId);
        }
        return selected;
    }

    private static CaseClue CreateTraceClue(TraceLedgerEntry trace, string clueId) => new()
    {
        ClueId = clueId,
        IsCritical = false,
        IsEvidence = trace.SupportsConclusionIds.Count > 0,
        Source = trace.LocationId,
        SourceType = "camera",
        DiscoverMethod = "camera",
        AcquisitionMethod = EvidenceAcquisitionMethods.CameraCapture,
        SceneId = trace.LocationId,
        SourceActionId = trace.SourceActionId,
        SupportsConclusionIds = trace.SupportsConclusionIds.Distinct(StringComparer.Ordinal).ToList(),
        IndependentSourceGroup = trace.IndependentSourceGroup,
        VisualTextPolicy = ClueVisualTextPolicies.NoText,
        HintLevel = 1,
        RelatedCharacterIds = { trace.CreatedByCharacterId }
    };

    private static void CreateV3EvidenceSources(
        GameCase skeleton,
        CaseTruthPackage truth,
        IReadOnlyDictionary<string, CaseClue> clueByTrace,
        AiGenerationContract contract)
    {
        if (skeleton.MechanicsVersion < CaseMechanicsVersions.InvestigationV3PairedConfrontation)
            return;
        var challengeCount = PlannedChallengeCount(truth, contract);
        var maximumCameraChallenges = challengeCount <= 1 ? 1 : (challengeCount + 1) / 2;
        var contradictionPairs = truth.StatementLedger.SelectMany(statement =>
                statement.ContradictedByTraceIds.Where(clueByTrace.ContainsKey)
                    .Select(traceId => (statement.StatementId, TraceId: traceId)))
            .Take(challengeCount).ToList();
        var forcedNonCameraTraceIds = contradictionPairs.Skip(maximumCameraChallenges)
            .Select(item => item.TraceId).ToHashSet(StringComparer.Ordinal);
        var itemTraceIds = forcedNonCameraTraceIds.ToHashSet(StringComparer.Ordinal);
        if (itemTraceIds.Count == 0)
        {
            var itemTraceId = clueByTrace.Keys.Skip(1).FirstOrDefault() ?? clueByTrace.Keys.First();
            itemTraceIds.Add(itemTraceId);
        }
        var allContradictionTraceIds = truth.StatementLedger.SelectMany(item => item.ContradictedByTraceIds)
            .ToHashSet(StringComparer.Ordinal);
        if (forcedNonCameraTraceIds.Count > 0)
        {
            var desiredItemCount = Math.Max(
                1,
                CrackGenerationBudgets.For(skeleton.GenerationPreset).TargetEvidence - 1);
            foreach (var traceId in clueByTrace.Keys.Where(traceId =>
                         !itemTraceIds.Contains(traceId) && !allContradictionTraceIds.Contains(traceId)))
            {
                if (itemTraceIds.Count >= desiredItemCount) break;
                itemTraceIds.Add(traceId);
            }
        }
        var interactionTraceId = forcedNonCameraTraceIds.Count == 0
            ? string.Empty
            : clueByTrace.Keys.FirstOrDefault(traceId =>
                  !itemTraceIds.Contains(traceId) && !allContradictionTraceIds.Contains(traceId))
              ?? clueByTrace.Keys.FirstOrDefault(traceId => !itemTraceIds.Contains(traceId))
              ?? throw new ProjectionPlanningException(
                  ["PROJECTABILITY challenges: no trace remains for a non-camera interaction evidence source."]);
        var scenes = skeleton.Stages.SelectMany(stage => stage.Scenes)
            .ToDictionary(scene => scene.SceneId, StringComparer.Ordinal);
        var sharedInteractionId = "interaction-v3-evidence-source";
        foreach (var (traceId, clue, index) in clueByTrace.Select((pair, index) =>
                     (pair.Key, pair.Value, index)))
        {
            var sourceKind = itemTraceIds.Contains(traceId)
                ? 1
                : !string.IsNullOrWhiteSpace(interactionTraceId) && traceId == interactionTraceId ? 2 : 0;
            if (sourceKind == 0) continue;
            if (sourceKind == 2)
            {
                var scene = scenes[clue.SceneId];
                if (scene.Hotspots.All(item => item.TargetId != sharedInteractionId))
                {
                    scene.Hotspots.Add(new SceneHotspot
                    {
                        HotspotId = $"hotspot-{scene.SceneId}-{sharedInteractionId}",
                        Type = "ENVIRONMENT",
                        TargetId = sharedInteractionId,
                        X = 82,
                        Y = 64,
                        Width = 8,
                        Height = 10,
                        ZIndex = 4
                    });
                }
                var interaction = skeleton.Interactions.FirstOrDefault(item =>
                    item.InteractionId == sharedInteractionId);
                if (interaction is null)
                {
                    interaction = new CaseInteraction
                    {
                        InteractionId = sharedInteractionId,
                        Type = CaseInteractionTypes.InspectEnvironment,
                        TargetId = sharedInteractionId,
                        SingleUse = true
                    };
                    skeleton.Interactions.Add(interaction);
                }
                AddUnique(interaction.UnlockClueIds, clue.ClueId);
                clue.Source = sharedInteractionId;
                clue.SourceType = "interaction";
                clue.DiscoverMethod = "interaction";
                clue.AcquisitionMethod = EvidenceAcquisitionMethods.EnvironmentInteraction;
                continue;
            }

            var itemId = $"item-evidence-{clue.ClueId}";
            var item = new CaseItem
            {
                ItemId = itemId,
                RenderMode = CaseItemRenderModes.Embedded,
                IsCollectible = false,
                IsInteractivePuzzleObject = true,
                InteractionPurpose = CaseItemInteractionPurposes.OperateMechanism,
                UnlockClueIds = { clue.ClueId }
            };
            skeleton.Items.Add(item);
            var itemScene = scenes[clue.SceneId];
            itemScene.ItemIds.Add(itemId);
            itemScene.Hotspots.Add(new SceneHotspot
            {
                HotspotId = $"hotspot-{itemScene.SceneId}-{itemId}",
                Type = "ITEM",
                TargetId = itemId,
                X = 18 + (index % 6) * 12,
                Y = 64,
                Width = 8,
                Height = 10,
                ZIndex = 4
            });
            clue.Source = itemId;
            clue.SourceType = EvidenceDiscoveryMethods.ItemInspect;
            clue.DiscoverMethod = EvidenceDiscoveryMethods.ItemInspect;
            clue.AcquisitionMethod = EvidenceAcquisitionMethods.ItemInspect;
        }
    }

    private static void CreateDialogues(GameCase skeleton, DialogueAllocation allocation)
    {
        foreach (var slot in allocation.Slots)
        {
            skeleton.Dialogues.Add(new CaseDialogue
            {
                DialogueId = slot.DialogueId,
                CharacterId = slot.CharacterId,
                StatementIds = slot.StatementIds.ToList(),
                AvailableSceneIds = slot.AvailableSceneIds.ToList()
            });
        }
    }

    private static void CreateChallenges(
        GameCase skeleton,
        CaseTruthPackage truth,
        IReadOnlyDictionary<string, CaseClue> clueByTrace,
        AiGenerationContract contract,
        IDictionary<string, string> challengeStatementIds)
    {
        var contradictions = truth.StatementLedger
            .SelectMany(statement => statement.ContradictedByTraceIds
                .Where(clueByTrace.ContainsKey)
                .Select(traceId => (Statement: statement, TraceId: traceId)))
            .ToList();
        var challengeCount = PlannedChallengeCount(truth, contract);
        var maximumCameraChallenges = challengeCount <= 1 ? 1 : (challengeCount + 1) / 2;
        for (var index = 0; index < challengeCount; index++)
        {
            var pair = contradictions[index % contradictions.Count];
            var dialogue = skeleton.Dialogues.First(item =>
                item.StatementIds.Contains(pair.Statement.StatementId, StringComparer.Ordinal));
            var correct = clueByTrace[pair.TraceId];
            var traceIdByClueId = clueByTrace.ToDictionary(
                item => item.Value.ClueId,
                item => item.Key,
                StringComparer.Ordinal);
            var targetEvidenceCount = skeleton.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation
                ? CrackGenerationBudgets.For(skeleton.GenerationPreset).TargetEvidence
                : 3;
            var requiresCamera = skeleton.MechanicsVersion < CaseMechanicsVersions.InvestigationV3PairedConfrontation
                                 || index < maximumCameraChallenges;
            var eligibleCandidates = skeleton.Clues.Where(item =>
                    item.IsEvidence
                    && (item.ClueId == correct.ClueId
                        || (traceIdByClueId.TryGetValue(item.ClueId, out var traceId)
                            && !pair.Statement.ContradictedByTraceIds.Contains(traceId, StringComparer.Ordinal)))
                    && (requiresCamera
                        || EvidenceAcquisitionMethods.Normalize(item.AcquisitionMethod)
                        != EvidenceAcquisitionMethods.CameraCapture))
                .ToList();
            var candidates = new List<CaseClue> { correct };
            var correctMethod = EvidenceAcquisitionMethods.Normalize(correct.AcquisitionMethod);
            if (requiresCamera && correctMethod != EvidenceAcquisitionMethods.CameraCapture)
            {
                var camera = eligibleCandidates
                    .Where(item => item.ClueId != correct.ClueId)
                    .OrderBy(item => item.ClueId, StringComparer.Ordinal)
                    .FirstOrDefault(item =>
                        EvidenceAcquisitionMethods.Normalize(item.AcquisitionMethod)
                        == EvidenceAcquisitionMethods.CameraCapture);
                if (camera is not null) candidates.Add(camera);
            }
            var alternate = eligibleCandidates
                .Where(item => candidates.All(selected => selected.ClueId != item.ClueId))
                .OrderBy(item => item.ClueId, StringComparer.Ordinal)
                .FirstOrDefault(item =>
                    candidates.All(selected =>
                        EvidenceAcquisitionMethods.Normalize(selected.AcquisitionMethod)
                        != EvidenceAcquisitionMethods.Normalize(item.AcquisitionMethod)));
            if (alternate is not null) candidates.Add(alternate);
            candidates.AddRange(eligibleCandidates
                .Where(item => candidates.All(selected => selected.ClueId != item.ClueId))
                .OrderBy(item => item.ClueId, StringComparer.Ordinal)
                .Take(targetEvidenceCount - candidates.Count));
            var candidateIds = candidates.Select(item => item.ClueId).ToList();
            if (candidateIds.Count < targetEvidenceCount
                || (skeleton.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation
                    && candidates.Select(item => EvidenceAcquisitionMethods.Normalize(item.AcquisitionMethod))
                        .Distinct(StringComparer.Ordinal).Count() < 2)
                || (skeleton.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation
                    && candidates.Any(item =>
                        EvidenceAcquisitionMethods.Normalize(item.AcquisitionMethod)
                        == EvidenceAcquisitionMethods.CameraCapture) != requiresCamera))
                throw new ProjectionPlanningException(
                    [$"PROJECTABILITY challenges: contradiction {pair.Statement.StatementId}/{pair.TraceId} lacks stable non-contradicting distractor evidence."]);

            var challengeId = $"challenge-{index + 1:00}";
            challengeStatementIds[challengeId] = pair.Statement.StatementId;
            var targetTestimonyCount = skeleton.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation
                ? CrackGenerationBudgets.For(skeleton.GenerationPreset).TargetTestimonies
                : 3;
            var fragmentIds = Enumerable.Range(1, targetTestimonyCount)
                .Select(number => $"fragment-{challengeId}-{number:00}")
                .ToList();
            skeleton.TestimonyFragments.AddRange(fragmentIds.Select(id => new TestimonyFragment
            {
                Id = id,
                DialogueId = dialogue.DialogueId
            }));
            var reveal = CreateTraceClue(
                truth.TraceLedger.First(item => item.TraceId == pair.TraceId),
                $"clue-reveal-{challengeId}");
            reveal.IsEvidence = false;
            reveal.IsCritical = true;
            reveal.Source = dialogue.DialogueId;
            reveal.SourceType = "dialogue";
            reveal.DiscoverMethod = "dialogue";
            reveal.AcquisitionMethod = string.Empty;
            skeleton.Clues.Add(reveal);
            skeleton.EvidenceChallenges.Add(new EvidenceChallenge
            {
                ChallengeId = challengeId,
                Order = index + 1,
                IsSignature = index == 0,
                DialogueId = dialogue.DialogueId,
                TestimonyFragmentId = fragmentIds[0],
                CandidateTestimonyFragmentIds = fragmentIds,
                StartRequiredTestimonyFragmentIds = fragmentIds.Take(2).ToList(),
                CorrectEvidenceId = correct.ClueId,
                CandidateEvidenceIds = candidateIds,
                StartRequiredEvidenceIds = candidateIds.Take(2).Append(correct.ClueId)
                    .Distinct(StringComparer.Ordinal).ToList(),
                UnlockClueIds = { reveal.ClueId }
            });
        }
    }

    private static void FillClueBudget(GameCase skeleton, CaseTruthPackage truth, int minimum)
    {
        var index = 0;
        while (skeleton.Clues.Count < minimum)
        {
            var trace = truth.TraceLedger[index % truth.TraceLedger.Count];
            skeleton.Clues.Add(CreateTraceClue(trace, $"clue-{trace.TraceId}-view-{index + 1:00}"));
            index++;
        }
    }

    private static void CreatePuzzles(
        GameCase skeleton,
        CaseTruthPackage truth,
        AiGenerationContract contract,
        string targetCharacterId)
    {
        var count = AiGenerationPresets.Normalize(skeleton.GenerationPreset) switch
        {
            AiGenerationPresets.NormalRandom => 1,
            AiGenerationPresets.DialogueHeavy => 0,
            _ => contract.MinPuzzles
        };
        var types = new[]
        {
            CasePuzzleTypes.CodePuzzle,
            CasePuzzleTypes.SequencePuzzle,
            CasePuzzleTypes.SymbolMatchPuzzle
        };
        for (var index = 0; index < count; index++)
        {
            var conclusion = truth.ProofGraph.Conclusions[index % truth.ProofGraph.Conclusions.Count];
            skeleton.Puzzles.Add(new CasePuzzle
            {
                PuzzleId = $"puzzle-{index + 1:00}",
                Type = types[index % types.Length],
                TargetId = targetCharacterId,
                CorrectCode = index % types.Length == 0 ? "314" : string.Empty,
                Options = index % types.Length == 0 ? new() : ["alpha", "beta", "gamma"],
                CorrectSequence = index % types.Length == 0 ? new() : ["alpha", "gamma"],
                BasedOnTruthIds = { conclusion.ConclusionId },
                RevealsConclusionIds = { conclusion.ConclusionId },
                ProgressionRole = PuzzleProgressionRoles.Required
            });
        }
    }

    private static void CreateInteractions(GameCase skeleton, AiGenerationContract contract)
    {
        var targetCount = AiGenerationPresets.Normalize(skeleton.GenerationPreset) switch
        {
            AiGenerationPresets.NormalRandom => 1,
            AiGenerationPresets.DialogueHeavy => 0,
            _ => contract.MinInteractions
        };
        var count = Math.Max(0, targetCount - skeleton.Interactions.Count);
        if (count == 0) return;
        var scene = skeleton.Stages.SelectMany(stage => stage.Scenes).First();
        var itemIds = Enumerable.Range(1, Math.Max(3, count + 1))
            .Select(index => $"item-projection-{index:00}")
            .ToList();
        foreach (var (itemId, index) in itemIds.Select((value, index) => (value, index)))
        {
            var target = index == itemIds.Count - 1;
            skeleton.Items.Add(new CaseItem
            {
                ItemId = itemId,
                RenderMode = target ? CaseItemRenderModes.Embedded : CaseItemRenderModes.Cutout,
                IsCollectible = !target,
                IsInteractivePuzzleObject = true,
                InteractionPurpose = target
                    ? CaseItemInteractionPurposes.OperateMechanism
                    : CaseItemInteractionPurposes.CombineItem
            });
            scene.ItemIds.Add(itemId);
            scene.Hotspots.Add(new SceneHotspot
            {
                HotspotId = $"hotspot-{scene.SceneId}-{itemId}",
                Type = "ITEM",
                TargetId = itemId,
                X = 20 + index * 10,
                Y = 65,
                Width = 7,
                Height = 9,
                ZIndex = 4
            });
        }
        for (var index = 0; index < count; index++)
        {
            var combine = index % 2 == 1;
            skeleton.Interactions.Add(new CaseInteraction
            {
                InteractionId = $"interaction-{index + 1:00}",
                Type = combine ? CaseInteractionTypes.CombineItems : CaseInteractionTypes.UseItemOnTarget,
                TargetId = combine ? string.Empty : itemIds[^1],
                RequiredItemIds = combine ? itemIds.Take(2).ToList() : [itemIds[0]],
                SingleUse = true
            });
        }
    }

    private static void CreateDeductionsAndTeamwork(
        GameCase skeleton,
        CaseTruthPackage truth,
        AiGenerationContract contract)
    {
        var conclusions = truth.ProofGraph.Conclusions
            .OrderBy(item => Array.IndexOf(
                EvidenceClaimTypes.OrderedForContract(CaseLogicContractVersions.CausalFiveClaim).ToArray(),
                item.Category))
            .ToList();
        for (var index = 0; index < contract.Deductions; index++)
        {
            var conclusion = conclusions[index % conclusions.Count];
            var clue = skeleton.Clues.First(item =>
                item.SupportsConclusionIds.Contains(conclusion.ConclusionId, StringComparer.Ordinal));
            var deduction = new DeductionChallenge
            {
                DeductionId = $"deduction-{conclusion.ConclusionId}",
                ConclusionId = conclusion.ConclusionId,
                RequiredClueIds = { clue.ClueId },
                RequiredChallengeIds = skeleton.EvidenceChallenges.Skip(index).Take(1)
                    .Select(item => item.ChallengeId).ToList(),
                Options =
                {
                    new AccusationOption { Id = $"deduction-{index + 1:00}-correct" },
                    new AccusationOption { Id = $"deduction-{index + 1:00}-wrong-a" },
                    new AccusationOption { Id = $"deduction-{index + 1:00}-wrong-b" }
                },
                CorrectOptionId = $"deduction-{index + 1:00}-correct"
            };
            skeleton.Deductions.Add(deduction);
            skeleton.FinalLogic.RequiredDeductionIds.Add(deduction.DeductionId);
        }

        for (var index = 0; index < contract.TeamworkChains; index++)
        {
            var challenge = skeleton.EvidenceChallenges[index % skeleton.EvidenceChallenges.Count];
            var deduction = skeleton.Deductions[index % skeleton.Deductions.Count];
            var chain = new RequiredTeamworkChain
            {
                ChainId = $"chain-{index + 1:00}",
                InvestigatorClueId = challenge.CorrectEvidenceId,
                InterrogatorChallengeId = challenge.ChallengeId,
                DeductionId = deduction.DeductionId
            };
            skeleton.RequiredTeamworkChains.Add(chain);
            skeleton.FinalLogic.RequiredTeamworkChainIds.Add(chain.ChainId);
        }
    }

    private static void CreateHints(GameCase skeleton)
    {
        foreach (var scene in skeleton.Stages.SelectMany(stage => stage.Scenes))
            skeleton.Hints.Add(new CaseHint
            {
                HintId = $"hint-scene-{scene.SceneId}",
                ContextType = HintContextTypes.Scene,
                TargetId = scene.SceneId,
                Order = 1
            });
        foreach (var challenge in skeleton.EvidenceChallenges)
            skeleton.Hints.Add(new CaseHint
            {
                HintId = $"hint-{challenge.ChallengeId}",
                ContextType = HintContextTypes.Confrontation,
                TargetId = challenge.ChallengeId,
                Order = 1
            });
        foreach (var deduction in skeleton.Deductions)
            skeleton.Hints.Add(new CaseHint
            {
                HintId = $"hint-{deduction.DeductionId}",
                ContextType = HintContextTypes.Deduction,
                TargetId = deduction.DeductionId,
                Order = 1
            });
    }

    private static void CreateFinalLogic(GameCase skeleton, CaseTruthPackage truth)
    {
        skeleton.FinalLogic.CulpritId = truth.CoreTruth.CulpritId;
        skeleton.FinalLogic.Motive = truth.CoreTruth.Motive;
        skeleton.FinalLogic.Method = truth.CoreTruth.Method;
        skeleton.FinalLogic.MotiveOptions =
        [
            new AccusationOption { Id = "motive-correct", Label = truth.CoreTruth.Motive },
            new AccusationOption { Id = "motive-distractor-01" },
            new AccusationOption { Id = "motive-distractor-02" }
        ];
        skeleton.FinalLogic.MethodOptions =
        [
            new AccusationOption { Id = "method-correct", Label = truth.CoreTruth.Method },
            new AccusationOption { Id = "method-distractor-01" },
            new AccusationOption { Id = "method-distractor-02" }
        ];
        skeleton.FinalLogic.CorrectMotiveId = "motive-correct";
        skeleton.FinalLogic.CorrectMethodId = "method-correct";
    }

    private static void ApplyRedHerrings(
        GameCase skeleton,
        CaseTruthPackage truth,
        IReadOnlyDictionary<string, CaseClue> clueByTrace)
    {
        foreach (var redHerring in truth.RedHerringLedger)
        {
            var clearingClue = redHerring.ClearingTraceIds
                .Where(clueByTrace.ContainsKey)
                .Select(id => clueByTrace[id])
                .FirstOrDefault();
            if (clearingClue is null) continue;
            var trace = truth.TraceLedger.First(item =>
                item.TraceId == redHerring.ClearingTraceIds.First(clueByTrace.ContainsKey));
            var presentation = CreateTraceClue(trace, $"clue-red-herring-{redHerring.RedHerringId}");
            presentation.IsRedHerring = true;
            presentation.IsEvidence = false;
            presentation.IsCritical = false;
            skeleton.Clues.Add(presentation);
        }
    }

    private static int PlannedChallengeCount(CaseTruthPackage truth, AiGenerationContract contract)
    {
        var validContradictions = truth.StatementLedger.Sum(statement =>
            statement.ContradictedByTraceIds.Count(traceId =>
                truth.TraceLedger.Any(trace => trace.TraceId == traceId)));
        return contract.MaxEvidenceChallenges > 0
            ? Math.Clamp(validContradictions, contract.EvidenceChallenges, contract.MaxEvidenceChallenges)
            : contract.EvidenceChallenges;
    }

    private static void AddSceneCompletionRequirements(GameCase skeleton)
    {
        foreach (var scene in skeleton.Stages.SelectMany(stage => stage.Scenes))
        {
            scene.CompleteCondition.RequiredClueIds = skeleton.Clues
                .Where(clue => clue.SceneId == scene.SceneId
                               && clue.IsCritical
                               && clue.SourceType.Equals("camera", StringComparison.OrdinalIgnoreCase))
                .Select(clue => clue.ClueId)
                .ToList();
            scene.CompleteCondition.RequiredDialogueIds = skeleton.Dialogues
                .Where(dialogue => dialogue.AvailableSceneIds.Contains(scene.SceneId, StringComparer.Ordinal))
                .Take(1)
                .Select(dialogue => dialogue.DialogueId)
                .ToList();
        }
    }

    private static void IndexProvenance(
        GameplayProjectionPlan plan,
        CaseTruthPackage truth,
        IReadOnlyDictionary<string, string> challengeStatementIds)
    {
        foreach (var stage in plan.Skeleton.Stages)
        {
            plan.Stages[stage.StageId] = new StageProjectionSlot
            {
                StageId = stage.StageId,
                Order = stage.Order,
                SceneIds = stage.Scenes.Select(item => item.SceneId).ToList()
            };
        foreach (var scene in stage.Scenes)
            plan.Scenes[scene.SceneId] = new SceneProjectionSlot
            {
                SceneId = scene.SceneId,
                TruthLocationId = scene.SceneId,
                StageId = stage.StageId,
                Order = stage.Order
            };
        }

        foreach (var character in plan.Skeleton.Characters)
            plan.Characters[character.CharacterId] = new CharacterProjectionSlot
            {
                CharacterId = character.CharacterId,
                SceneIds = plan.Skeleton.Stages.SelectMany(stage => stage.Scenes)
                    .Where(scene => scene.CharacterIds.Contains(character.CharacterId, StringComparer.Ordinal))
                    .Select(scene => scene.SceneId).ToList()
            };

        foreach (var item in plan.Skeleton.Items)
            plan.Items[item.ItemId] = new ItemProjectionSlot
            {
                ItemId = item.ItemId,
                SceneIds = plan.Skeleton.Stages.SelectMany(stage => stage.Scenes)
                    .Where(scene => scene.ItemIds.Contains(item.ItemId, StringComparer.Ordinal))
                    .Select(scene => scene.SceneId).ToList(),
                InteractionIds = plan.Skeleton.Interactions.Where(interaction =>
                        interaction.TargetId == item.ItemId
                        || interaction.RequiredItemIds.Contains(item.ItemId, StringComparer.Ordinal)
                        || interaction.UnlockItemIds.Contains(item.ItemId, StringComparer.Ordinal))
                    .Select(interaction => interaction.InteractionId).ToList(),
                UnlockClueIds = item.UnlockClueIds.ToList()
            };

        var traceBySource = truth.TraceLedger
            .GroupBy(item => (item.SourceActionId, item.LocationId, item.IndependentSourceGroup))
            .ToDictionary(group => group.Key, group => group.First());
        foreach (var clue in plan.Skeleton.Clues)
        {
            var trace = truth.TraceLedger.FirstOrDefault(item =>
                item.SourceActionId == clue.SourceActionId
                && item.LocationId == clue.SceneId
                && item.IndependentSourceGroup == clue.IndependentSourceGroup)
                ?? traceBySource.GetValueOrDefault((clue.SourceActionId, clue.SceneId, clue.IndependentSourceGroup));
            if (trace is null) continue;
            plan.Clues[clue.ClueId] = new ClueProjectionSlot
            {
                ClueId = clue.ClueId,
                TraceId = trace.TraceId,
                SourceActionId = trace.SourceActionId,
                SceneId = trace.LocationId,
                IndependentSourceGroup = trace.IndependentSourceGroup,
                SupportsConclusionIds = clue.SupportsConclusionIds.ToList(),
                AcquisitionSourceType = clue.SourceType,
                AcquisitionSourceId = clue.Source,
                AcquisitionMethod = clue.AcquisitionMethod
            };
        }

        foreach (var dialogue in plan.Skeleton.Dialogues)
            plan.Dialogues[dialogue.DialogueId] = new DialogueProjectionSlot
            {
                DialogueId = dialogue.DialogueId,
                CharacterId = dialogue.CharacterId,
                StatementIds = dialogue.StatementIds.ToList(),
                AvailableSceneIds = dialogue.AvailableSceneIds.ToList()
            };

        foreach (var fragment in plan.Skeleton.TestimonyFragments)
        {
            var dialogue = plan.Skeleton.Dialogues.First(item => item.DialogueId == fragment.DialogueId);
            plan.TestimonyFragments[fragment.Id] = new TestimonyProjectionSlot
            {
                FragmentId = fragment.Id,
                DialogueId = fragment.DialogueId,
                StatementIds = dialogue.StatementIds.ToList()
            };
        }

        foreach (var puzzle in plan.Skeleton.Puzzles)
            plan.Puzzles[puzzle.PuzzleId] = new PuzzleProjectionSlot
            {
                PuzzleId = puzzle.PuzzleId,
                BasedOnTruthIds = puzzle.BasedOnTruthIds.ToList(),
                RevealsConclusionIds = puzzle.RevealsConclusionIds.ToList()
            };

        foreach (var deduction in plan.Skeleton.Deductions)
            plan.Deductions[deduction.DeductionId] = new DeductionProjectionSlot
            {
                DeductionId = deduction.DeductionId,
                ConclusionId = deduction.ConclusionId,
                RequiredClueIds = deduction.RequiredClueIds.ToList()
            };

        foreach (var challenge in plan.Skeleton.EvidenceChallenges)
        {
            var dialogue = plan.Skeleton.Dialogues.First(item => item.DialogueId == challenge.DialogueId);
            var correctSlot = plan.Clues[challenge.CorrectEvidenceId];
            if (!challengeStatementIds.TryGetValue(challenge.ChallengeId, out var statementId)
                || !dialogue.StatementIds.Contains(statementId, StringComparer.Ordinal))
                throw new ProjectionPlanningException(
                    [$"PROJECTABILITY challenge {challenge.ChallengeId} lost its exact contradiction statement."]);
            plan.Challenges[challenge.ChallengeId] = new ChallengeProjectionSlot
            {
                ChallengeId = challenge.ChallengeId,
                DialogueId = challenge.DialogueId,
                StatementId = statementId,
                CorrectEvidenceId = challenge.CorrectEvidenceId,
                CorrectTraceId = correctSlot.TraceId,
                CandidateEvidenceIds = challenge.CandidateEvidenceIds.ToList(),
                CandidateStatementIds = dialogue.StatementIds.ToList()
            };
        }

        foreach (var node in plan.Skeleton.ConversationNodes)
            plan.ConversationNodes[node.NodeId] = new ConversationProjectionSlot
            {
                NodeId = node.NodeId,
                CharacterId = node.CharacterId,
                ChallengeId = node.ChallengeId ?? string.Empty,
                NextNodeIds = node.Choices.Select(choice => choice.NextNodeId).OfType<string>()
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .Distinct(StringComparer.Ordinal).ToList()
            };

        foreach (var interaction in plan.Skeleton.Interactions)
            plan.Interactions[interaction.InteractionId] = new InteractionProjectionSlot
            {
                InteractionId = interaction.InteractionId,
                TargetId = interaction.TargetId,
                RequiredItemIds = interaction.RequiredItemIds.ToList(),
                RequiredClueIds = interaction.RequiredClueIds.ToList(),
                UnlockItemIds = interaction.UnlockItemIds.ToList(),
                UnlockClueIds = interaction.UnlockClueIds.ToList(),
                UnlockSceneIds = interaction.UnlockSceneIds.ToList()
            };

        foreach (var chain in plan.Skeleton.RequiredTeamworkChains)
            plan.TeamworkChains[chain.ChainId] = new TeamworkProjectionSlot
            {
                ChainId = chain.ChainId,
                InvestigatorClueId = chain.InvestigatorClueId,
                InterrogatorChallengeId = chain.InterrogatorChallengeId,
                DeductionId = chain.DeductionId
            };

        foreach (var hint in plan.Skeleton.Hints)
            plan.Hints[hint.HintId] = new HintProjectionSlot
            {
                HintId = hint.HintId,
                ContextType = hint.ContextType,
                TargetId = hint.TargetId,
                Order = hint.Order
            };

        foreach (var redHerring in truth.RedHerringLedger)
        {
            var redClue = plan.Skeleton.Clues.FirstOrDefault(item =>
                item.ClueId == $"clue-red-herring-{redHerring.RedHerringId}");
            var clearingClues = plan.Clues.Values
                .Where(slot => redHerring.ClearingTraceIds.Contains(slot.TraceId, StringComparer.Ordinal))
                .Where(slot => redClue is null || slot.ClueId != redClue.ClueId)
                .Select(slot => slot.ClueId).ToList();
            var clearingDialogues = plan.Dialogues.Values
                .Where(slot => slot.StatementIds.Any(id =>
                    redHerring.ClearingStatementIds.Contains(id, StringComparer.Ordinal)))
                .Select(slot => slot.DialogueId).ToList();
            plan.RedHerrings[redHerring.RedHerringId] = new RedHerringProjectionSlot
            {
                RedHerringId = redHerring.RedHerringId,
                ClueId = redClue?.ClueId ?? string.Empty,
                ClearingClueIds = clearingClues,
                ClearingDialogueIds = clearingDialogues
            };
        }

        plan.FinalLogic = new FinalLogicProjectionSlot
        {
            CulpritId = truth.CoreTruth.CulpritId,
            Motive = truth.CoreTruth.Motive,
            Method = truth.CoreTruth.Method,
            EvidenceLinks = plan.Skeleton.FinalLogic.RequiredEvidenceLinks.Select(link =>
                new FinalEvidenceProjectionSlot
                {
                    ClaimType = link.ClaimType,
                    ConclusionId = link.ConclusionId,
                    EvidenceId = link.EvidenceId
                }).ToList()
        };
    }

    private static List<string> OrderedLocations(CaseTruthPackage truth)
    {
        var ordered = truth.TrueTimeline.OrderBy(item => item.StartMinute)
            .ThenBy(item => item.EndMinute)
            .Select(item => item.LocationId)
            .Concat(truth.TraceLedger.Select(item => item.LocationId))
            .Concat(truth.CaseSeed.LocationIds)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return ordered;
    }

    private static List<string> OrderedCharacters(CaseTruthPackage truth) =>
        truth.CaseSeed.SuspectIds
            .Concat(CaseTargetKinds.IsAsset(truth.CoreTruth)
                ? []
                : [truth.CoreTruth.TargetId])
            .Concat(truth.TrueTimeline.Select(item => item.ActorId))
            .Concat(truth.TrueTimeline.SelectMany(item => item.WitnessIds))
            .Concat(truth.StatementLedger.Select(item => item.SpeakerId))
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToList();

    private static void AddUnique(ICollection<string> values, string value)
    {
        if (!string.IsNullOrWhiteSpace(value) && !values.Contains(value, StringComparer.Ordinal))
            values.Add(value);
    }
}
