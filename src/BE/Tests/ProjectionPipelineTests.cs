using System.Text.Json;
using System.Text.Json.Nodes;
using MongoDB.Bson;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

public sealed class ProjectionPipelineTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly CaseTruthService _truthService = new();

    [Fact]
    public void BlindSolvabilityReview_IsDisabledByDefault()
    {
        Assert.False(new OpenAiSettings().EnableBlindSolvabilityReview);
    }

    [Fact]
    public void ProjectionContentFailure_CanRetryFromPersistedPlanWithoutCaseJson()
    {
        var draft = new AiCaseDraft
        {
            Status = AiDraftStatus.GeneratedInvalid,
            FailurePhase = AiFailurePhases.ProjectionContentJson,
            ProjectionPlan = new GameplayProjectionPlan(),
            ProjectionPlanHash = new string('a', 64),
            GeneratedJson = string.Empty,
            ProjectionContentJson = string.Empty
        };

        var response = AiDraftResponse.From(draft);

        Assert.True(response.CanContinue);
    }

    [Fact]
    public void Planner_IsDeterministic_AndSettingsAffectHash()
    {
        var (draft, truth) = BuildDraft();
        var planner = new GameplayProjectionPlanner(_truthService);

        var first = planner.Build(draft, truth);
        var second = planner.Build(draft, truth);
        var changedDraft = CloneDraft(draft);
        changedDraft.Settings.Language = CaseLanguages.Vietnamese;
        var changed = planner.Build(changedDraft, truth);
        var changedTruth = JsonSerializer.Deserialize<CaseTruthPackage>(
            JsonSerializer.Serialize(truth, JsonOptions), JsonOptions)!;
        changedTruth.CoreTruth.Motive += " with a changed approved detail";
        var truthChanged = planner.Build(draft, changedTruth);

        Assert.Equal(first.PlanHash, second.PlanHash);
        Assert.Equal(
            ProjectionCanonicalizer.Canonicalize(first),
            ProjectionCanonicalizer.Canonicalize(second));
        Assert.NotEqual(first.PlanHash, changed.PlanHash);
        Assert.NotEqual(first.PlanHash, truthChanged.PlanHash);
        Assert.Equal($"case-ai-{draft.Id}", first.CaseId);
        Assert.True(ObjectId.TryParse(first.Skeleton.Id, out _));
        Assert.All(first.Scenes, pair => Assert.Equal(pair.Key, pair.Value.TruthLocationId));
    }

    [Fact]
    public void Projectability_ReportsPresetMismatchAgainstRepairableTruthPaths()
    {
        var (draft, truth) = BuildDraft();
        draft.Settings.GenerationPreset = AiGenerationPresets.ShortDemo;
        draft.Settings.StageCount = 2;
        var onlyLocation = truth.CaseSeed.LocationIds[0];
        truth.CaseSeed.LocationIds = [onlyLocation];
        foreach (var timelineEvent in truth.TrueTimeline)
            timelineEvent.LocationId = onlyLocation;

        var result = new GameplayProjectionPlanner(_truthService)
            .ValidateProjectability(draft, truth);

        Assert.Contains(result.Errors, error =>
            error.Code == "ProjectionLocationCount"
            && error.Path == "caseSeed.locationIds");
    }

    [Fact]
    public void ShortDemoSeedSchema_RequiresEnoughSuspectsAndLocationsForProjection()
    {
        var settings = new AiDraftSettings
        {
            GenerationPreset = AiGenerationPresets.ShortDemo,
            StageCount = 2
        };
        var budget = AiTruthGenerationBudget.For(settings);
        var contract = AiGenerationContract.For(settings);
        var schema = AiStrictSchemaProvider.CaseSeedSchema(
            budget,
            contract.MinCharacters - 1,
            contract.MinScenes);

        Assert.Equal(3, schema["properties"]!["caseSeed"]!["properties"]!["suspectIds"]!["minItems"]!.GetValue<int>());
        Assert.Equal(2, schema["properties"]!["caseSeed"]!["properties"]!["locationIds"]!["minItems"]!.GetValue<int>());
    }

    [Theory]
    [InlineData(AiCaseTypes.Fraud, CaseTargetKinds.Asset, 4)]
    [InlineData(AiCaseTypes.Kidnapping, CaseTargetKinds.Character, 3)]
    public void ShortDemo_TargetAllocationLocksExactSuspectCountAndTargetKind(
        string caseType,
        string expectedTargetKind,
        int expectedSuspects)
    {
        var settings = new AiDraftSettings
        {
            GenerationPreset = AiGenerationPresets.ShortDemo,
            StageCount = 2,
            CaseType = caseType
        };
        var contract = AiGenerationContract.For(settings);
        var budget = AiTruthGenerationBudget.ForProjection(settings);
        var targetKind = CaseTargetAllocationPolicy.ForCaseType(caseType);
        var exactSuspects = CaseTargetAllocationPolicy.RequiredSuspects(contract, targetKind);
        var seedSchema = AiStrictSchemaProvider.CaseSeedSchema(
            budget,
            exactSuspects,
            contract.MinScenes,
            exactSuspects);
        var suspectSchema = seedSchema["properties"]!["caseSeed"]!["properties"]!["suspectIds"]!;
        var coreSchema = AiStrictSchemaProvider.CoreTruthSchema(
            budget,
            Enumerable.Range(1, exactSuspects).Select(index => $"character-{index}"),
            targetKind);

        Assert.Equal(expectedTargetKind, targetKind);
        Assert.Equal(expectedSuspects, exactSuspects);
        Assert.True(budget.MaxSuspects >= exactSuspects);
        Assert.Equal(expectedSuspects, suspectSchema["minItems"]!.GetValue<int>());
        Assert.Equal(expectedSuspects, suspectSchema["maxItems"]!.GetValue<int>());
        Assert.Equal(
            expectedTargetKind,
            coreSchema["properties"]!["coreTruth"]!["properties"]!["targetKind"]!["const"]!
                .GetValue<string>());
    }

    [Theory]
    [InlineData(AiCaseTypes.Fraud, CaseTargetKinds.Asset, 4)]
    [InlineData(AiCaseTypes.Kidnapping, CaseTargetKinds.Character, 3)]
    public void ShortDemo_PlannerProducesExactlyFourCharacters(
        string caseType,
        string targetKind,
        int expectedSuspects)
    {
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f10",
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = targetKind,
            Settings = new AiDraftSettings
            {
                GenerationPreset = AiGenerationPresets.ShortDemo,
                StageCount = 2,
                CaseType = caseType
            }
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(
            AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!;
        draft.CaseTruth = truth;
        draft.TruthHash = _truthService.ComputeHash(truth);

        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);

        Assert.Equal(expectedSuspects, truth.CaseSeed.SuspectIds.Count);
        Assert.Equal(4, plan.Characters.Count);
        Assert.Equal(targetKind == CaseTargetKinds.Character,
            plan.Characters.ContainsKey(truth.CoreTruth.TargetId));
    }

    [Fact]
    public void ShortDemo_CapacityIsSharedBySchemaAndPlannerForV2AndV3()
    {
        var v2Settings = new AiDraftSettings
        {
            GenerationPreset = AiGenerationPresets.ShortDemo,
            StageCount = 2,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV2
        };
        var v3Settings = new AiDraftSettings
        {
            GenerationPreset = AiGenerationPresets.ShortDemo,
            StageCount = 2,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            IncludeCrackTheLie = true
        };
        var v2 = ProjectionCapacityPolicy.For(v2Settings);
        var v3 = ProjectionCapacityPolicy.For(v3Settings);
        var v2Budget = AiTruthGenerationBudget.ForProjection(v2Settings);
        var v3Budget = AiTruthGenerationBudget.ForProjection(v3Settings);
        var proofSchema = AiStrictSchemaProvider.ProofGraphSchema(
            v2Budget,
            ["character-a", "character-b", "character-c", "character-d"],
            ["trace-a", "trace-b", "trace-c", "trace-d", "trace-e"],
            ["statement-a"]);
        var statementSchema = AiStrictSchemaProvider.StatementLedgerSchema(
            v2Budget,
            ["character-a", "character-b"],
            ["event-a"],
            ["trace-a", "trace-b", "trace-c", "trace-d", "trace-e"]);

        Assert.Equal(new ProjectionCapacity(5, 2, 1, 5, 8), v2);
        Assert.Equal(new ProjectionCapacity(5, 1, 1, 6, 8), v3);
        Assert.Equal(v2.BaseTraceCapacity, v2Budget.MaxTraces);
        Assert.Equal(v3.BaseTraceCapacity, v3Budget.MaxTraces);
        Assert.Equal(1, proofSchema["properties"]!["redHerringLedger"]!["maxItems"]!.GetValue<int>());
        Assert.Equal(1, proofSchema["properties"]!["redHerringLedger"]!["items"]!["properties"]!
            ["clearingTraceIds"]!["maxItems"]!.GetValue<int>());
        Assert.Equal(1, statementSchema["properties"]!["statementLedger"]!["items"]!["properties"]!
            ["contradictedByTraceIds"]!["maxItems"]!.GetValue<int>());
    }

    [Theory]
    [InlineData(false, 5, 2, 1)]
    [InlineData(true, 6, 1, 1)]
    public void ShortDemo_PlannerConsumesTheExactEightClueCapacity(
        bool includeV3,
        int expectedBaseTraces,
        int expectedChallenges,
        int expectedRedHerrings)
    {
        var draft = new AiCaseDraft
        {
            Id = includeV3 ? "64b64c0f0f0f0f0f0f0f0f12" : "64b64c0f0f0f0f0f0f0f0f11",
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            Settings = new AiDraftSettings
            {
                GenerationPreset = AiGenerationPresets.ShortDemo,
                StageCount = 2,
                CaseType = AiCaseTypes.Fraud,
                IncludeCrackTheLie = includeV3,
                MechanicsVersion = includeV3
                    ? CaseMechanicsVersions.InvestigationV3PairedConfrontation
                    : CaseMechanicsVersions.InvestigationV2
            }
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(
            AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!;
        draft.CaseTruth = truth;
        draft.TruthHash = _truthService.ComputeHash(truth);

        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);

        Assert.Equal(expectedBaseTraces, truth.TraceLedger.Count);
        Assert.Equal(expectedChallenges, plan.Challenges.Count);
        Assert.Equal(expectedRedHerrings, plan.RedHerrings.Count);
        Assert.Equal(8, plan.Clues.Count);
    }

    [Fact]
    public void TruthV2Schemas_RequireTargetKindAndTraceBackedConclusions()
    {
        var budget = AiTruthGenerationBudget.Maximum;
        var coreSchema = AiStrictSchemaProvider.CoreTruthSchema(
            budget,
            ["character-a", "character-b"]);
        var targetKinds = coreSchema["properties"]!["coreTruth"]!["properties"]!["targetKind"]!["enum"]!
            .AsArray().Select(item => item!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);
        var proofSchema = AiStrictSchemaProvider.ProofGraphSchema(
            budget,
            ["character-a", "character-b"],
            ["trace-a", "trace-b", "trace-c", "trace-d", "trace-e"],
            ["statement-a"]);
        var supportingTraces = proofSchema["properties"]!["proofGraph"]!["properties"]!["conclusions"]!
            ["items"]!["properties"]!["supportingTraceIds"]!;

        Assert.Equal(CaseTargetKinds.All, targetKinds);
        Assert.Equal(1, supportingTraces["minItems"]!.GetValue<int>());
    }

    [Fact]
    public void TruthGate_RequiresTargetCharacterDistinctFromSuspects()
    {
        var (draft, truth) = BuildDraft();
        truth.CoreTruth.TargetId = truth.CoreTruth.CulpritId;

        var result = _truthService.Validate(
            truth,
            AiTruthGenerationBudget.For(draft.Settings));

        Assert.Contains(result.Errors, error =>
            error.Code == "TargetIsSuspect"
            && error.Path == "coreTruth.targetId");
    }

    [Fact]
    public void Schema_LocksExactSlotsAndCausalFields()
    {
        var (draft, truth) = BuildDraft();
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var schema = new ProjectionContentSchemaFactory().Build(plan);
        var clue = plan.Clues.First();
        var clueSchema = schema["properties"]!["clues"]!["properties"]![clue.Key]!;

        Assert.Equal(plan.PlanHash, schema["properties"]!["planHash"]!["const"]!.GetValue<string>());
        Assert.False(schema["properties"]!["clues"]!["additionalProperties"]!.GetValue<bool>());
        Assert.Equal(clue.Value.SceneId, clueSchema["properties"]!["sceneId"]!["const"]!.GetValue<string>());
        Assert.Equal(clue.Value.SourceActionId, clueSchema["properties"]!["sourceActionId"]!["const"]!.GetValue<string>());
        Assert.Empty(AiStrictSchemaLinter.Validate(schema));
    }

    [Fact]
    public void Schema_OmitsPlanOwnedArraySlots()
    {
        // OpenAI strict schemas reject const on arrays, so these slots are never requested from the
        // model; ProjectionContentLocks restores them from the plan instead.
        var (draft, truth) = BuildDraft();
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var schema = new ProjectionContentSchemaFactory().Build(plan);

        var clueSchema = schema["properties"]!["clues"]!["properties"]![plan.Clues.First().Key]!;
        Assert.Null(clueSchema["properties"]!["supportsConclusionIds"]);
        var dialogueSchema = schema["properties"]!["dialogues"]!["properties"]![plan.Dialogues.First().Key]!;
        Assert.Null(dialogueSchema["properties"]!["statementIds"]);
        foreach (var puzzle in plan.Puzzles.Keys)
        {
            var puzzleSchema = schema["properties"]!["puzzles"]!["properties"]![puzzle]!;
            Assert.Null(puzzleSchema["properties"]!["basedOnTruthIds"]);
            Assert.Null(puzzleSchema["properties"]!["revealsConclusionIds"]);
            Assert.Null(puzzleSchema["properties"]!["options"]);
            Assert.Null(puzzleSchema["properties"]!["correctSequence"]);
        }
    }

    [Fact]
    public void Schema_ForcesAsciiArtDirection()
    {
        // Vietnamese cases still need English/ASCII visualDescription, because
        // AiGenerationContract.ValidateSafeVisualText rejects anything above U+007F.
        var (draft, truth) = BuildDraft();
        draft.Settings.Language = CaseLanguages.Vietnamese;
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var schema = new ProjectionContentSchemaFactory().Build(plan);

        foreach (var group in new[] { "scenes", "characters", "items", "clues" })
        {
            var slots = schema["properties"]![group]!["properties"]!.AsObject();
            Assert.NotEmpty(slots);
            foreach (var (id, slot) in slots)
            {
                var visual = slot!["properties"]!["visualDescription"];
                Assert.NotNull(visual);
                Assert.Equal("^[ -~]+$", visual!["pattern"]!.GetValue<string>());
            }
        }

        Assert.Empty(AiStrictSchemaLinter.Validate(schema));
    }

    [Fact]
    public void MockContent_KeepsArtDirectionAscii()
    {
        var (draft, truth) = BuildDraft();
        draft.Settings.Language = CaseLanguages.Vietnamese;
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var content = ProjectionContentMockFactory.Build(plan);

        var visuals = content.Scenes.Values.Select(item => item.VisualDescription)
            .Concat(content.Characters.Values.Select(item => item.VisualDescription))
            .Concat(content.Items.Values.Select(item => item.VisualDescription))
            .Concat(content.Clues.Values.Select(item => item.VisualDescription));
        foreach (var visual in visuals)
            Assert.DoesNotContain(visual, value => value > (char)127);
    }

    [Fact]
    public void Locks_RestorePlanOwnedSlots_SoSchemaShapedContentCompiles()
    {
        var (draft, truth) = BuildDraft();
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var content = ProjectionContentMockFactory.Build(plan);

        // Exactly what the model now returns: every locked array absent.
        foreach (var clue in content.Clues.Values) clue.SupportsConclusionIds = new List<string>();
        foreach (var dialogue in content.Dialogues.Values) dialogue.StatementIds = new List<string>();
        foreach (var puzzle in content.Puzzles.Values)
        {
            puzzle.BasedOnTruthIds = new List<string>();
            puzzle.RevealsConclusionIds = new List<string>();
            puzzle.Options = new List<string>();
            puzzle.CorrectSequence = new List<string>();
        }

        ProjectionContentLocks.Apply(plan, content);
        var gameCase = new GameCaseProjectionCompiler().Compile(plan, content, draft.Settings);

        Assert.Equal(plan.PlanHash, gameCase.ProjectionPlanHash);
        foreach (var (id, slot) in plan.Clues)
            Assert.Equal(slot.SupportsConclusionIds, content.Clues[id].SupportsConclusionIds);
        foreach (var (id, slot) in plan.Dialogues)
            Assert.Equal(slot.StatementIds, content.Dialogues[id].StatementIds);
    }

    [Fact]
    public void Locks_DoNotRepairSlotMembership()
    {
        var (draft, truth) = BuildDraft();
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var compiler = new GameCaseProjectionCompiler();

        var missing = ProjectionContentMockFactory.Build(plan);
        missing.Clues.Remove(missing.Clues.Keys.First());
        ProjectionContentLocks.Apply(plan, missing);
        Assert.Throws<ProjectionCompilationException>(() => compiler.Compile(plan, missing, draft.Settings));

        var forged = ProjectionContentMockFactory.Build(plan);
        forged.Clues.First().Value.SceneId = "location-forged";
        ProjectionContentLocks.Apply(plan, forged);
        Assert.Throws<ProjectionCompilationException>(() => compiler.Compile(plan, forged, draft.Settings));
    }

    [Theory]
    [MemberData(nameof(StrictSchemas))]
    public void AllStrictSchemas_UseOnlySupportedKeywords(string name, JsonObject schema)
    {
        var violations = AiStrictSchemaLinter.Validate(schema);

        Assert.True(violations.Count == 0, $"{name}: {string.Join(" | ", violations)}");
    }

    public static TheoryData<string, JsonObject> StrictSchemas()
    {
        var budget = AiTruthGenerationBudget.Maximum;
        return new TheoryData<string, JsonObject>
        {
            { "StoryPreview", AiStrictSchemaProvider.StoryPreviewSchema() },
            { "CaseLogicV2", AiStrictSchemaProvider.CaseLogicSchema(CaseMechanicsVersions.InvestigationV2) },
            { "CaseLogicV3", AiStrictSchemaProvider.CaseLogicSchema(CaseMechanicsVersions.InvestigationV3PairedConfrontation) },
            { "V3SemanticReview", AiStrictSchemaProvider.V3SemanticReviewSchema() },
            { "V3CaseBlueprint", AiStrictSchemaProvider.V3CaseBlueprintSchema() },
            { "CaseTruth", AiStrictSchemaProvider.CaseTruthSchema() },
            { "CaseSeed", AiStrictSchemaProvider.CaseSeedSchema(budget) },
            { "CoreTruth", AiStrictSchemaProvider.CoreTruthSchema(budget) },
            { "TrueTimeline", AiStrictSchemaProvider.TrueTimelineSchema(budget) },
            { "OpportunityMatrix", AiStrictSchemaProvider.OpportunityMatrixSchema(budget, budget.MaxSuspects) },
            { "TraceLedger", AiStrictSchemaProvider.TraceLedgerSchema(budget) },
            { "StatementLedger", AiStrictSchemaProvider.StatementLedgerSchema(budget) },
            { "ProofGraph", AiStrictSchemaProvider.ProofGraphSchema(budget) },
            { "CaseTruthFeasibilityReview", AiStrictSchemaProvider.CaseTruthFeasibilityReviewSchema() },
            { "BlindSolvabilityReview", AiStrictSchemaProvider.BlindSolvabilityReviewSchema() }
        };
    }

    [Fact]
    public void Compiler_RejectsForgedLockedField()
    {
        var (draft, truth) = BuildDraft();
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var content = ProjectionContentMockFactory.Build(plan);
        content.Clues.First().Value.SceneId = "location-forged";

        var exception = Assert.Throws<ProjectionCompilationException>(
            () => new GameCaseProjectionCompiler().Compile(plan, content, draft.Settings));

        Assert.Contains(exception.Errors, error => error.Contains("PROJECTION_LOCKED_FIELD", StringComparison.Ordinal));
    }

    [Fact]
    public void Compiler_RejectsMissingExtraSlotsAndWrongPlanHash()
    {
        var (draft, truth) = BuildDraft();
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var compiler = new GameCaseProjectionCompiler();

        var missing = ProjectionContentMockFactory.Build(plan);
        missing.Clues.Remove(missing.Clues.Keys.First());
        Assert.Throws<ProjectionCompilationException>(() => compiler.Compile(plan, missing, draft.Settings));

        var extra = ProjectionContentMockFactory.Build(plan);
        extra.Hints["hint-forged"] = new HintProjectionContent { HintId = "hint-forged", Text = "Forged." };
        Assert.Throws<ProjectionCompilationException>(() => compiler.Compile(plan, extra, draft.Settings));

        var wrongHash = ProjectionContentMockFactory.Build(plan);
        wrongHash.PlanHash = new string('f', 64);
        Assert.Throws<ProjectionCompilationException>(() => compiler.Compile(plan, wrongHash, draft.Settings));
    }

    [Fact]
    public void Compiler_UsesPlanStructure_AndGraphConforms()
    {
        var (draft, truth) = BuildDraft();
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var content = ProjectionContentMockFactory.Build(plan);
        var gameCase = new GameCaseProjectionCompiler().Compile(plan, content, draft.Settings);

        var result = new ProjectionGraphValidator(_truthService).Validate(truth, plan, gameCase);
        result.Errors.AddRange(new CaseValidationService().ValidateFullLogic(gameCase).Errors);
        result.Errors.AddRange(AiGenerationContract.For(draft.Settings)
            .Validate(gameCase, draft.Settings).Errors);
        result.Errors.AddRange(_truthService.ValidateProjection(truth, gameCase).Errors);
        result.Deduplicate();

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(
            error => $"{error.Code} {error.Path}: {error.Message}")));
        Assert.Equal(string.Empty, gameCase.Id);
        Assert.Equal(ProjectionBuildModes.AiCompiled, gameCase.ProjectionBuildMode);
        Assert.Equal(plan.PlanHash, gameCase.ProjectionPlanHash);
        Assert.Equal(
            plan.Skeleton.FinalLogic.RequiredEvidenceLinks.Select(link => (link.ClaimType, link.ConclusionId, link.EvidenceId)),
            gameCase.FinalLogic.RequiredEvidenceLinks.Select(link => (link.ClaimType, link.ConclusionId, link.EvidenceId)));
    }

    [Fact]
    public void GraphValidator_RejectsWrongClueScene()
    {
        var (draft, truth) = BuildDraft();
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var gameCase = new GameCaseProjectionCompiler().Compile(
            plan,
            ProjectionContentMockFactory.Build(plan),
            draft.Settings);
        gameCase.Clues[0].SceneId = truth.CaseSeed.LocationIds
            .First(id => id != gameCase.Clues[0].SceneId);

        var result = new ProjectionGraphValidator(_truthService).Validate(truth, plan, gameCase);

        Assert.Contains(result.Errors, error =>
            error.Code is "ClueSceneMismatch" or "ProjectionSlotMismatch" or "ProjectionCompiledClueMismatch");
    }

    [Fact]
    public void GraphValidator_RejectsSpeakerChallengeAndFinalClaimRemaps()
    {
        var (draft, truth) = BuildDraft();
        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var gameCase = new GameCaseProjectionCompiler().Compile(
            plan,
            ProjectionContentMockFactory.Build(plan),
            draft.Settings);
        gameCase.Dialogues[0].CharacterId = "character-forged";
        gameCase.EvidenceChallenges[0].CorrectEvidenceId = gameCase.Clues
            .First(item => item.ClueId != gameCase.EvidenceChallenges[0].CorrectEvidenceId).ClueId;
        gameCase.FinalLogic.RequiredEvidenceLinks[0].ConclusionId =
            gameCase.FinalLogic.RequiredEvidenceLinks[1].ConclusionId;

        var result = new ProjectionGraphValidator(_truthService).Validate(truth, plan, gameCase);

        Assert.Contains(result.Errors, error => error.Code == "ProjectionCompiledDialogueMismatch");
        Assert.Contains(result.Errors, error => error.Code == "ProjectionCompiledChallengeMismatch");
        Assert.Contains(result.Errors, error => error.Code == "ProjectionFinalEvidenceMismatch");
    }

    [Fact]
    public void Canonicalizer_DetectsDuplicateJsonProperties()
    {
        var duplicates = ProjectionCanonicalizer.FindDuplicatePropertyPaths(
            """{"planHash":"a","clues":{"clue-1":{},"clue-1":{}}}""");

        Assert.Contains("$.clues.clue-1", duplicates);
    }

    [Fact]
    public void V3Plan_OwnsCrackIdsAndCorrectPairs()
    {
        var (draft, truth) = BuildDraft();
        draft.Settings.MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation;
        draft.Settings.GenerationPreset = AiGenerationPresets.NormalRandom;
        draft.Settings.IncludeCrackTheLie = true;
        var planner = new GameplayProjectionPlanner(_truthService);

        var plan = planner.Build(draft, truth);
        var content = ProjectionContentMockFactory.Build(plan);
        var firstChallenge = plan.Challenges.First();
        content.EvidenceChallenges[firstChallenge.Key].Prompt = "A different presentation of the same locked pair.";
        var gameCase = new GameCaseProjectionCompiler().Compile(plan, content, draft.Settings);
        var challenge = gameCase.EvidenceChallenges.Single(item => item.ChallengeId == firstChallenge.Key);

        Assert.Equal(firstChallenge.Value.CorrectEvidenceId, challenge.CorrectEvidenceId);
        Assert.Equal(firstChallenge.Value.CandidateEvidenceIds, challenge.CandidateEvidenceIds);
        Assert.Equal(
            firstChallenge.Value.DialogueId,
            challenge.DialogueId);
        Assert.Equal(
            firstChallenge.Value.CorrectTraceId,
            plan.Clues[challenge.CorrectEvidenceId].TraceId);
        var validation = new CaseValidationService().ValidateFullLogic(gameCase);
        validation.Errors.AddRange(AiGenerationContract.For(draft.Settings)
            .Validate(gameCase, draft.Settings).Errors);
        validation.Errors.AddRange(new ProjectionGraphValidator(_truthService)
            .Validate(truth, plan, gameCase).Errors);
        validation.Deduplicate();
        Assert.True(validation.IsValid, string.Join("\n", validation.Errors.Select(
            error => $"{error.Code} {error.Path}: {error.Message}")));
    }

    [Fact]
    public void V3Plan_ClampsCracksToContradictionsAndOwnsAcquisitionMix()
    {
        var (draft, truth) = BuildDraft();
        draft.Settings.MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation;
        draft.Settings.IncludeCrackTheLie = true;
        var usedContradictions = truth.StatementLedger.SelectMany(item => item.ContradictedByTraceIds)
            .ToHashSet(StringComparer.Ordinal);
        var secondStatement = truth.StatementLedger.First(item => item.ContradictedByTraceIds.Count == 0);
        var secondTrace = truth.TraceLedger.First(item => !usedContradictions.Contains(item.TraceId));
        secondStatement.ContradictedByTraceIds.Add(secondTrace.TraceId);
        secondStatement.TruthStatus = StatementTruthStatuses.False;
        secondStatement.ReasonForLie = "Protecting a private but non-culpable action.";
        draft.TruthHash = _truthService.ComputeHash(truth);

        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var gameCase = new GameCaseProjectionCompiler().Compile(
            plan,
            ProjectionContentMockFactory.Build(plan),
            draft.Settings);
        var validation = new CaseValidationService().ValidateFullLogic(gameCase);
        validation.Errors.AddRange(AiGenerationContract.For(draft.Settings)
            .Validate(gameCase, draft.Settings).Errors);
        validation.Errors.AddRange(new ProjectionGraphValidator(_truthService)
            .Validate(truth, plan, gameCase).Errors);
        validation.Deduplicate();

        Assert.Equal(2, plan.Challenges.Count);
        Assert.Equal(1, gameCase.EvidenceChallenges.Count(challenge =>
            challenge.CandidateEvidenceIds.Any(id =>
                AiV3GenerationProfile.ResolveAcquisitionMethod(
                    gameCase,
                    gameCase.Clues.Single(clue => clue.ClueId == id))
                == EvidenceAcquisitionMethods.CameraCapture)));
        Assert.True(validation.IsValid, string.Join("\n", validation.Errors.Select(
            error => $"{error.Code} {error.Path}: {error.Message}")));
    }

    [Fact]
    public void Readiness_MissingMotiveTraceFailsAtEvidenceAndRoutesRepair()
    {
        var (_, truth) = BuildDraft();
        foreach (var trace in truth.TraceLedger)
            trace.SupportsConclusionIds.RemoveAll(id => id == ProofConclusionIds.Motive);
        var service = new CaseTruthService(new ProjectionReadinessAnalyzer());

        var validation = service.ValidateTraceArtifact(truth);
        var repair = service.PlanRepair(validation.Errors);

        Assert.Contains(validation.Errors, error =>
            error.Code == "ProjectionMissingConclusionTrace"
            && error.RefId == ProofConclusionIds.Motive);
        Assert.Equal(CaseTruthArtifacts.Evidence, repair.RegenerateFromArtifact);
    }

    [Fact]
    public void RepairRouting_UsesEarliestArtifactAcrossCharacterClueAndRedHerringFailures()
    {
        var service = new CaseTruthService(new ProjectionReadinessAnalyzer());
        var repair = service.PlanRepair(
        [
            new CaseValidationError
            {
                Code = "ProjectionRedHerringClosureBudget",
                Path = "redHerringLedger"
            },
            new CaseValidationError
            {
                Code = "ProjectionClueBudget",
                Path = "statementLedger"
            },
            new CaseValidationError
            {
                Code = "ProjectionCharacterCount",
                Path = "caseSeed.suspectIds"
            }
        ]);

        Assert.Equal(CaseTruthArtifacts.CaseSeed, repair.RegenerateFromArtifact);
        Assert.Contains("ProjectionCharacterCount", repair.ReasonCodes);
        Assert.Contains("ProjectionClueBudget", repair.ReasonCodes);
        Assert.Contains("ProjectionRedHerringClosureBudget", repair.ReasonCodes);
    }

    [Fact]
    public void Readiness_MatchesFiveDistinctFinalTraces()
    {
        var (_, truth) = BuildDraft();

        var allocation = new ProjectionReadinessAnalyzer().MatchFinalEvidence(truth);

        Assert.True(allocation.Validation.IsValid, string.Join("\n",
            allocation.Validation.Errors.Select(error => $"{error.Code}: {error.Message}")));
        Assert.Equal(5, allocation.EvidenceByCategory.Count);
        Assert.Equal(5, allocation.EvidenceByCategory.Values
            .Select(trace => trace.TraceId)
            .Distinct(StringComparer.Ordinal)
            .Count());
    }

    [Fact]
    public void DialogueAllocator_GroupsNineCompatibleStatementsWithinShortDemoBudget()
    {
        var (_, truth) = BuildDraft();
        var source = truth.StatementLedger[0];
        var eventId = source.EventIds.FirstOrDefault() ?? truth.TrueTimeline[0].EventId;
        var traceId = truth.TraceLedger[0].TraceId;
        truth.RedHerringLedger.Clear();
        truth.StatementLedger = Enumerable.Range(1, 9).Select(index => new StatementLedgerEntry
        {
            StatementId = $"statement-greyfen-{index:00}",
            SpeakerId = source.SpeakerId,
            TruthStatus = StatementTruthStatuses.False,
            Content = $"Compatible statement {index}.",
            EventIds = { eventId },
            KnowledgeSourceIds = { eventId },
            ReasonForLie = "Protect a private interest.",
            ContradictedByTraceIds = { traceId },
            IndependentSourceGroup = $"statement-group-{index:00}",
            SupportsConclusionIds = { ProofConclusionIds.Timeline }
        }).ToList();
        var contract = AiGenerationContract.For(AiGenerationPresets.ShortDemo, 2);

        var allocation = new ProjectionReadinessAnalyzer().AllocateDialogues(truth, contract);

        Assert.True(allocation.Validation.IsValid, string.Join("\n",
            allocation.Validation.Errors.Select(error => $"{error.Code}: {error.Message}")));
        Assert.InRange(allocation.Slots.Count, contract.MinDialogues, contract.MaxDialogues);
        Assert.Contains(allocation.Slots, slot => slot.StatementIds.Count > 1);
        Assert.Equal(9, allocation.Slots.SelectMany(slot => slot.StatementIds)
            .Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void DialogueAllocator_DoesNotMergeDifferentSpeakerScenePairs()
    {
        var (_, truth) = BuildDraft();
        var speakers = truth.CaseSeed.SuspectIds.Take(3).ToList();
        var scenes = truth.CaseSeed.LocationIds.Take(3).ToList();
        var traceId = truth.TraceLedger[0].TraceId;
        truth.RedHerringLedger.Clear();
        truth.StatementLedger.Clear();
        var index = 0;
        foreach (var speaker in speakers)
        foreach (var scene in scenes)
        {
            index++;
            var eventId = $"event-dialogue-budget-{index:00}";
            truth.TrueTimeline.Add(new TrueTimelineEvent
            {
                EventId = eventId,
                ActorId = speaker,
                LocationId = scene,
                StartMinute = 300 + index * 5,
                EndMinute = 304 + index * 5,
                Action = "Provides a location-specific observation."
            });
            truth.StatementLedger.Add(new StatementLedgerEntry
            {
                StatementId = $"statement-dialogue-budget-{index:00}",
                SpeakerId = speaker,
                TruthStatus = StatementTruthStatuses.False,
                Content = $"Statement {index}.",
                EventIds = { eventId },
                KnowledgeSourceIds = { eventId },
                ReasonForLie = "Protect a private interest.",
                ContradictedByTraceIds = { traceId },
                IndependentSourceGroup = $"statement-budget-group-{index:00}",
                SupportsConclusionIds = { ProofConclusionIds.Timeline }
            });
        }
        var contract = AiGenerationContract.For(AiGenerationPresets.ShortDemo, 2);

        var allocation = new ProjectionReadinessAnalyzer().AllocateDialogues(truth, contract);

        Assert.Contains(allocation.Validation.Errors, error =>
            error.Code == "ProjectionDialogueBudget");
        Assert.DoesNotContain(allocation.Slots, slot => slot.StatementIds.Count > 1);
    }

    [Fact]
    public void DialogueAllocator_RejectsStatementWhenSpeakerIsNotPresentAtReferencedEvent()
    {
        var (_, truth) = BuildDraft();
        var eventItem = truth.TrueTimeline.First();
        var absentSpeaker = truth.CaseSeed.SuspectIds.First(id => id != eventItem.ActorId);
        eventItem.WitnessIds.RemoveAll(id => id == absentSpeaker);
        truth.RedHerringLedger.Clear();
        truth.StatementLedger =
        [
            new StatementLedgerEntry
            {
                StatementId = "statement-absent-speaker",
                SpeakerId = absentSpeaker,
                TruthStatus = StatementTruthStatuses.False,
                Content = "Claims knowledge of an event where the speaker was not present.",
                EventIds = { eventItem.EventId },
                KnowledgeSourceIds = { eventItem.EventId },
                ReasonForLie = "Protect a private interest.",
                ContradictedByTraceIds = { truth.TraceLedger[0].TraceId },
                IndependentSourceGroup = "statement-absent-speaker-group",
                SupportsConclusionIds = { ProofConclusionIds.Timeline }
            }
        ];

        var allocation = new ProjectionReadinessAnalyzer().AllocateDialogues(
            truth,
            AiGenerationContract.For(AiGenerationPresets.ShortDemo, 2));

        Assert.Contains(allocation.Validation.Errors, error =>
            error.Code == "ProjectionStatementSceneUnavailable"
            && error.RefId == "statement-absent-speaker");
        Assert.Contains(allocation.Validation.Errors, error =>
            error.Code == "ProjectionDialogueBudget");
        Assert.Empty(allocation.Slots);
    }

    [Fact]
    public void GroupedDialogue_ChallengesKeepTheirExactContradictionStatements()
    {
        var (draft, truth) = BuildDraft();
        var source = truth.StatementLedger[0];
        var eventId = source.EventIds.FirstOrDefault() ?? truth.TrueTimeline[0].EventId;
        var traceId = truth.TraceLedger[0].TraceId;
        truth.RedHerringLedger.Clear();
        truth.StatementLedger = Enumerable.Range(1, 13).Select(index => new StatementLedgerEntry
        {
            StatementId = $"statement-grouped-challenge-{index:00}",
            SpeakerId = source.SpeakerId,
            TruthStatus = StatementTruthStatuses.False,
            Content = $"Contradiction statement {index}.",
            EventIds = { eventId },
            KnowledgeSourceIds = { eventId },
            ReasonForLie = "Protect a private interest.",
            ContradictedByTraceIds = { traceId },
            IndependentSourceGroup = $"challenge-statement-group-{index:00}",
            SupportsConclusionIds = { ProofConclusionIds.Timeline }
        }).ToList();
        draft.TruthHash = _truthService.ComputeHash(truth);

        var plan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        var challenges = plan.Challenges.Values.OrderBy(item => item.ChallengeId).Take(2).ToList();

        Assert.Equal("statement-grouped-challenge-01", challenges[0].StatementId);
        Assert.Equal("statement-grouped-challenge-02", challenges[1].StatementId);
        Assert.Equal(challenges[0].DialogueId, challenges[1].DialogueId);
        Assert.Contains(challenges[0].StatementId, plan.Dialogues[challenges[0].DialogueId].StatementIds);
        Assert.Contains(challenges[1].StatementId, plan.Dialogues[challenges[1].DialogueId].StatementIds);
    }

    [Fact]
    public void TargetKind_AssetIsNotCharacterButCharacterTargetIsProjected()
    {
        var (draft, truth) = BuildDraft();
        Assert.Equal(CaseTargetKinds.Asset, truth.CoreTruth.TargetKind);

        var assetPlan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        Assert.DoesNotContain(truth.CoreTruth.TargetId, assetPlan.Characters.Keys);

        truth.CoreTruth.TargetKind = CaseTargetKinds.Character;
        draft.TruthHash = _truthService.ComputeHash(truth);
        var characterPlan = new GameplayProjectionPlanner(_truthService).Build(draft, truth);
        Assert.Contains(truth.CoreTruth.TargetId, characterPlan.Characters.Keys);
    }

    [Fact]
    public void TruthV1Canonicalization_OmitsTargetKindForHashCompatibility()
    {
        var (_, truth) = BuildDraft();
        truth.SchemaVersion = CaseTruthSchemaVersions.V1;
        truth.CoreTruth.TargetKind = string.Empty;

        var canonical = _truthService.Canonicalize(truth);

        Assert.DoesNotContain("\"targetKind\"", canonical, StringComparison.Ordinal);
        Assert.True(_truthService.Validate(truth).IsValid,
            string.Join("\n", _truthService.Validate(truth).Errors.Select(error => error.Message)));
    }

    private (AiCaseDraft Draft, CaseTruthPackage Truth) BuildDraft()
    {
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f0f",
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            Settings = new AiDraftSettings
            {
                StageCount = 4,
                Difficulty = "medium",
                GenerationPreset = AiGenerationPresets.NormalRandom,
                MechanicsVersion = CaseMechanicsVersions.InvestigationV2,
                Language = CaseLanguages.English
            }
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(
            AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!;
        draft.CaseTruth = truth;
        draft.TruthHash = _truthService.ComputeHash(truth);
        return (draft, truth);
    }

    private static AiCaseDraft CloneDraft(AiCaseDraft draft) =>
        JsonSerializer.Deserialize<AiCaseDraft>(
            JsonSerializer.Serialize(draft, JsonOptions), JsonOptions)!;
}
