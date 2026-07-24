using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public sealed class CaseTruthServiceTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly CaseTruthService _service = new();

    [Fact]
    public void CanonicalTruth_IsValid_AndHashIsStable()
    {
        var truth = ValidTruth();

        var validation = _service.Validate(truth);
        var first = _service.ComputeHash(truth);
        var roundTrip = JsonSerializer.Deserialize<CaseTruthPackage>(JsonSerializer.Serialize(truth, JsonOptions), JsonOptions)!;
        var second = _service.ComputeHash(roundTrip);

        Assert.True(validation.IsValid, Messages(validation.Errors));
        Assert.Equal(64, first.Length);
        Assert.Equal(first, second);
    }

    [Fact]
    public void ProjectionValidationAndMechanicalRepair_DoNotMutateTruthSnapshot()
    {
        var truth = ValidTruth();
        var gameCase = MockProjection(truth);
        var canonicalBefore = _service.Canonicalize(truth);
        var hashBefore = _service.ComputeHash(truth);

        CaseAutoRepair.RepairMechanicalMetadata(gameCase);
        _service.ValidateProjection(truth, gameCase);

        Assert.Equal(canonicalBefore, _service.Canonicalize(truth));
        Assert.Equal(hashBefore, _service.ComputeHash(truth));
    }

    [Fact]
    public void IndependentStageArtifacts_AssembleIntoOneValidTruthPackage()
    {
        var draft = new AiCaseDraft { Settings = new AiDraftSettings { Difficulty = "medium" } };
        T Stage<T>(string schema) => JsonSerializer.Deserialize<T>(AiCaseMockFactory.BuildMockTruthStageJson(draft, schema), JsonOptions)!;
        var seed = Stage<GeneratedCaseSeedArtifact>(AiGenerationSchemaVersions.CaseSeed);
        var core = Stage<GeneratedCoreTruthArtifact>(AiGenerationSchemaVersions.CoreTruth);
        var timeline = Stage<GeneratedTimelineArtifact>(AiGenerationSchemaVersions.TrueTimeline);
        var opportunity = Stage<GeneratedOpportunityArtifact>(AiGenerationSchemaVersions.OpportunityMatrix);
        var traces = Stage<GeneratedTraceArtifact>(AiGenerationSchemaVersions.TraceLedger);
        var statements = Stage<GeneratedStatementArtifact>(AiGenerationSchemaVersions.StatementLedger);
        var proof = Stage<GeneratedProofArtifact>(AiGenerationSchemaVersions.ProofGraph);
        var truth = new CaseTruthPackage
        {
            CaseSeed = seed.CaseSeed,
            CoreTruth = core.CoreTruth,
            TrueTimeline = timeline.TrueTimeline,
            OpportunityMatrix = opportunity.OpportunityMatrix,
            TraceLedger = traces.TraceLedger,
            StatementLedger = statements.StatementLedger,
            ProofGraph = proof.ProofGraph,
            RedHerringLedger = proof.RedHerringLedger
        };

        var result = _service.Validate(truth);

        Assert.True(result.IsValid, Messages(result.Errors));
    }

    [Fact]
    public void ShortDemoBudget_IsIdenticalInSchemaAndValidator()
    {
        var budget = AiTruthGenerationBudget.For(AiGenerationPresets.ShortDemo, 2);
        var schema = AiStrictSchemaProvider.TraceLedgerSchema(budget);
        var maxItems = schema["properties"]!["traceLedger"]!["maxItems"]!.GetValue<int>();
        var truth = ValidTruth();
        while (truth.TraceLedger.Count <= budget.MaxTraces)
        {
            var clone = JsonSerializer.Deserialize<TraceLedgerEntry>(
                JsonSerializer.Serialize(truth.TraceLedger[0], JsonOptions), JsonOptions)!;
            clone.TraceId = $"trace-over-budget-{truth.TraceLedger.Count}";
            truth.TraceLedger.Add(clone);
        }

        var result = _service.Validate(truth, budget);

        Assert.Equal(10, maxItems);
        Assert.Contains(result.Errors, error => error.Code == "TRUTH_BUDGET_EXCEEDED"
            && error.Path == "traceLedger");
    }

    [Fact]
    public void PresetBudget_RejectsTimelineStatementsAndLongIds()
    {
        var budget = AiTruthGenerationBudget.For(AiGenerationPresets.ShortDemo, 1);
        var truth = ValidTruth();
        while (truth.TrueTimeline.Count <= budget.MaxTimelineEvents)
        {
            truth.TrueTimeline.Add(new TrueTimelineEvent
            {
                EventId = $"event-budget-{truth.TrueTimeline.Count}",
                ActorId = truth.CoreTruth.CulpritId,
                LocationId = truth.CaseSeed.LocationIds[0],
                StartMinute = 500 + truth.TrueTimeline.Count * 10,
                EndMinute = 505 + truth.TrueTimeline.Count * 10,
                Action = "Budget test event."
            });
        }
        while (truth.StatementLedger.Count <= budget.MaxStatements)
        {
            truth.StatementLedger.Add(new StatementLedgerEntry
            {
                StatementId = $"statement-budget-{truth.StatementLedger.Count}",
                SpeakerId = truth.CaseSeed.SuspectIds[0],
                Content = "Budget test statement.",
                EventIds = { truth.TrueTimeline[0].EventId },
                IndependentSourceGroup = $"group-budget-{truth.StatementLedger.Count}"
            });
        }
        truth.CaseSeed.SuspectIds[0] = new string('x', budget.MaxIdLength + 1);

        var result = _service.Validate(truth, budget);

        Assert.Contains(result.Errors, error => error.Code == "TRUTH_BUDGET_EXCEEDED" && error.Path == "trueTimeline");
        Assert.Contains(result.Errors, error => error.Code == "TRUTH_BUDGET_EXCEEDED" && error.Path == "statementLedger");
        Assert.Contains(result.Errors, error => error.Code == "TRUTH_BUDGET_EXCEEDED"
            && error.Path.Contains("suspectIds", StringComparison.Ordinal));
    }

    [Fact]
    public void DraftListProjection_DoesNotExposeSpoilerTruthOrReviewerSecrets()
    {
        var truth = ValidTruth();
        var draft = new AiCaseDraft
        {
            CaseTruth = truth,
            TruthSchemaVersion = truth.SchemaVersion,
            TruthHash = _service.ComputeHash(truth),
            TruthValidationReport = { "culprit-specific validation detail" },
            ValidationErrors = { "culprit-specific error" },
            FailurePhase = AiFailurePhases.CaseTruth,
            TruthReviewerResult = AiCaseMockFactory.BuildMockTruthReview(),
            BlindSolvabilityReview = AiCaseMockFactory.BuildMockBlindReview(truth, MockProjection(truth)),
            ArtifactProvenance =
            {
                new AiArtifactProvenance { Artifact = CaseTruthArtifacts.CoreTruth, InputHash = "secret-input", OutputHash = "secret-output" }
            }
        };

        var response = SirLocked.Api.DTOs.Ai.AiDraftResponse.From(draft, includeJson: false);

        Assert.Null(response.CaseTruth);
        Assert.Null(response.TruthReviewerResult);
        Assert.Null(response.BlindSolvabilityReview);
        Assert.Empty(response.TruthValidationReport);
        Assert.Empty(response.ValidationErrors);
        Assert.Empty(response.ArtifactProvenance);
        Assert.NotNull(response.TruthSummary);

        var detailResponse = SirLocked.Api.DTOs.Ai.AiDraftResponse.From(draft, includeJson: true);
        Assert.Single(detailResponse.ArtifactProvenance);
        Assert.Equal(CaseTruthArtifacts.CoreTruth, detailResponse.ArtifactProvenance[0].Artifact);
    }

    [Fact]
    public void Timeline_RejectsOverlapAndInsufficientTravelTime()
    {
        var truth = ValidTruth();
        var culprit = truth.CoreTruth.CulpritId;
        truth.TrueTimeline.Add(new TrueTimelineEvent
        {
            EventId = "action-overlap", ActorId = culprit,
            LocationId = truth.CaseSeed.LocationIds.Last(), StartMinute = 35, EndMinute = 45,
            TravelFromPreviousMinutes = 0, Action = "Impossible overlapping movement."
        });
        truth.TrueTimeline.Add(new TrueTimelineEvent
        {
            EventId = "action-too-soon", ActorId = culprit,
            LocationId = truth.CaseSeed.LocationIds.Last(), StartMinute = 41, EndMinute = 42,
            TravelFromPreviousMinutes = 0, Action = "Arrives too soon."
        });

        var result = _service.Validate(truth);

        Assert.Contains(result.Errors, error => error.Code == "TimelineOverlap");
        Assert.Contains(result.Errors, error => error.Code == "InsufficientTravelTime");
    }

    [Fact]
    public void CrimeAction_RejectsMissingAccessToolKnowledgeAndVerifiedAlibiConflict()
    {
        var truth = ValidTruth();
        var culprit = truth.OpportunityMatrix.Single(item => item.CharacterId == truth.CoreTruth.CulpritId);
        culprit.AccessIds.Clear();
        culprit.ToolIds.Clear();
        culprit.KnowledgeIds.Clear();
        culprit.AlibiVerified = true;
        culprit.AlibiEventIds.Add("action-alibi");
        truth.TrueTimeline.Add(new TrueTimelineEvent
        {
            EventId = "action-alibi", ActorId = "char-alibi-witness",
            LocationId = truth.CaseSeed.LocationIds.Last(), StartMinute = 30, EndMinute = 40,
            Action = "Verified elsewhere."
        });

        var result = _service.Validate(truth);

        Assert.True(result.Errors.Count(error => error.Code == "MissingCrimeCapability") >= 3);
        Assert.Contains(result.Errors, error => error.Code == "VerifiedAlibiConflict");
    }

    [Fact]
    public void WitnessStatementAndRedHerring_MustHaveCausalSupport()
    {
        var truth = ValidTruth();
        truth.TrueTimeline[0].WitnessIds.Add("char-absent");
        truth.StatementLedger[0].KnowledgeSourceIds.Clear();
        truth.StatementLedger[0].EventIds.Clear();
        truth.StatementLedger[0].ReasonForLie = string.Empty;
        truth.RedHerringLedger[0].ClearingTraceIds.Clear();
        truth.RedHerringLedger[0].ClearingStatementIds.Clear();

        var result = _service.Validate(truth);

        Assert.Contains(result.Errors, error => error.Code == "WitnessNotObservable");
        Assert.Contains(result.Errors, error => error.Code == "InvalidKnowledge");
        Assert.Contains(result.Errors, error => error.Code == "MissingLieReason");
        Assert.Contains(result.Errors, error => error.Code == "MissingClearingEvidence");
    }

    [Fact]
    public void OpportunityMatrix_RejectsSecondSuspectWhoStillFitsCompleteChain()
    {
        var truth = ValidTruth();
        var alternate = truth.OpportunityMatrix.First(item => item.CharacterId != truth.CoreTruth.CulpritId);
        alternate.HasMotive = true;
        alternate.AccessIds.Add("archive-key");
        alternate.ToolIds.Add("copied-key");
        alternate.KnowledgeIds.Add("clock-window");
        alternate.IdentityLinkedToCrime = true;
        alternate.AlibiVerified = false;

        var result = _service.Validate(truth);

        Assert.Contains(result.Errors, error => error.Code == "AmbiguousSuspect" && error.RefId == alternate.CharacterId);
    }

    [Fact]
    public void Projection_RejectsMissingCausalClueAndWrongFiveClaimEvidence()
    {
        var truth = ValidTruth();
        var draft = new AiCaseDraft
        {
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            Settings = new AiDraftSettings(),
            CaseTruth = truth
        };
        var generated = JsonSerializer.Deserialize<GeneratedCaseLogic>(AiCaseMockFactory.BuildMockFullCaseJson(draft), JsonOptions)!;
        var gameCase = generated.ToGameCase(draft.Settings);
        gameCase.LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim;
        gameCase.TruthSchemaVersion = truth.SchemaVersion;
        gameCase.TruthHash = _service.ComputeHash(truth);
        gameCase.BlindReviewStatus = CaseTruthReviewStatuses.Passed;
        var baseline = _service.ValidateProjection(truth, gameCase);
        Assert.True(baseline.IsValid, Messages(baseline.Errors));
        gameCase.Clues[0].SourceActionId = string.Empty;
        gameCase.FinalLogic.RequiredEvidenceLinks.RemoveAt(gameCase.FinalLogic.RequiredEvidenceLinks.Count - 1);

        var result = _service.ValidateProjection(truth, gameCase);

        Assert.Contains(result.Errors, error => error.Code == "MissingCausalSource");
        Assert.Contains(result.Errors, error => error.Path == "finalLogic.requiredEvidenceLinks");
    }

    [Fact]
    public void CausalProjection_HasCanonicalStateGraphWinPathAndFiveClaims()
    {
        var truth = ValidTruth();
        var gameCase = MockProjection(truth);
        gameCase.LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim;
        gameCase.LogicVerificationStatus = CaseLogicVerificationStatuses.CausalVerified;
        gameCase.TruthSchemaVersion = truth.SchemaVersion;
        gameCase.TruthHash = _service.ComputeHash(truth);
        gameCase.BlindReviewStatus = CaseTruthReviewStatuses.Passed;

        var result = new CaseValidationService().ValidateFullLogic(gameCase);

        Assert.True(result.IsValid, Messages(result.Errors));
        Assert.Equal(EvidenceClaimTypes.Causal.Count, gameCase.FinalLogic.RequiredEvidenceLinks.Count);
    }

    [Fact]
    public void Projection_RejectsDuplicateRewardConsumedItemEarlyDialogueAndOptionalWithoutPayoff()
    {
        var truth = ValidTruth();
        var gameCase = MockProjection(truth);
        gameCase.LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim;
        gameCase.TruthSchemaVersion = truth.SchemaVersion;
        gameCase.TruthHash = _service.ComputeHash(truth);
        gameCase.BlindReviewStatus = CaseTruthReviewStatuses.Passed;
        var duplicateReward = gameCase.Clues[0].ClueId;
        gameCase.Dialogues[0].UnlockClueIds.Add(duplicateReward);
        gameCase.Dialogues[1].UnlockClueIds.Add(duplicateReward);
        var wrongScene = gameCase.Stages.SelectMany(stage => stage.Scenes).First();
        wrongScene.CharacterIds.Remove(gameCase.Dialogues[0].CharacterId);
        gameCase.Dialogues[0].AvailableSceneIds = new List<string> { wrongScene.SceneId };
        gameCase.Items.Add(new CaseItem { ItemId = "item-consumed-proof", Name = "Consumed proof" });
        gameCase.Interactions.Add(new CaseInteraction
        {
            InteractionId = "interaction-consume-proof",
            Type = CaseInteractionTypes.CombineItems,
            RequiredItemIds = { "item-consumed-proof" },
            ConsumeItemIds = { "item-consumed-proof" }
        });
        gameCase.Puzzles.Add(new CasePuzzle
        {
            PuzzleId = "puzzle-required-proof", Type = CasePuzzleTypes.CodePuzzle,
            TargetId = wrongScene.SceneId, Prompt = "Required",
            RequiredItemIds = { "item-consumed-proof" },
            BasedOnTruthIds = { truth.CoreTruth.CrimeActionIds[0] },
            InvestigationPurpose = "Reconstruct the crime action",
            RevealsConclusionIds = { truth.ProofGraph.Conclusions[0].ConclusionId },
            ProgressionRole = PuzzleProgressionRoles.Required
        });
        gameCase.Puzzles.Add(new CasePuzzle
        {
            PuzzleId = "puzzle-optional-empty", Type = CasePuzzleTypes.CodePuzzle,
            TargetId = wrongScene.SceneId, Prompt = "Optional",
            BasedOnTruthIds = { truth.CoreTruth.CrimeActionIds[0] },
            InvestigationPurpose = "Optional check", ProgressionRole = PuzzleProgressionRoles.Optional
        });

        var result = _service.ValidateProjection(truth, gameCase);

        Assert.Contains(result.Errors, error => error.Code == "DuplicateReward");
        Assert.Contains(result.Errors, error => error.Code == "ConsumedItemDeadEnd");
        Assert.Contains(result.Errors, error => error.Code == "DialogueSceneMismatch");
        Assert.Contains(result.Errors, error => error.Code == "OptionalWithoutPayoff");
    }

    [Fact]
    public void RepairPlanner_InvalidatesOnlyAffectedDownstreamArtifacts()
    {
        var plan = _service.PlanRepair(new[]
        {
            new SirLocked.Api.DTOs.Case.CaseValidationError { Code = "TraceTimeMismatch", Path = "traceLedger[0].createdAtMinute" }
        });

        Assert.Equal(CaseTruthArtifacts.Evidence, plan.RegenerateFromArtifact);
        Assert.DoesNotContain(CaseTruthArtifacts.CoreTruth, plan.StaleArtifacts);
        Assert.DoesNotContain(CaseTruthArtifacts.Timeline, plan.StaleArtifacts);
        Assert.Contains(CaseTruthArtifacts.Projection, plan.StaleArtifacts);
        Assert.Contains(CaseTruthArtifacts.Assets, plan.StaleArtifacts);
    }

    [Fact]
    public void NamespaceDrift_InProseDoesNotDefineCoreOrTraceReferences_AndRepairsFromTimeline()
    {
        var truth = ValidTruth();
        var originalId = truth.CoreTruth.CrimeActionIds[0];
        const string coreId = "action-pryce-prepares-jam";
        const string timelineId = "event-pryce-prepares-jam";
        truth.CoreTruth.PreparationActionIds = truth.CoreTruth.PreparationActionIds
            .Select(id => id == originalId ? coreId : id).ToList();
        truth.CoreTruth.CrimeActionIds = truth.CoreTruth.CrimeActionIds
            .Select(id => id == originalId ? coreId : id).ToList();
        truth.CoreTruth.ConcealmentActionIds = truth.CoreTruth.ConcealmentActionIds
            .Select(id => id == originalId ? coreId : id).ToList();
        truth.CoreTruth.CulpritMistakeActionIds = truth.CoreTruth.CulpritMistakeActionIds
            .Select(id => id == originalId ? coreId : id).ToList();
        var timeline = truth.TrueTimeline.Single(item => item.EventId == originalId);
        timeline.EventId = timelineId;
        timeline.Action = $"Pryce prepares the jam ({coreId}) but prose is not an ID definition.";
        var trace = truth.TraceLedger.First(item => item.SourceActionId == originalId);
        trace.SourceActionId = coreId;

        var validation = _service.Validate(truth);
        var plan = _service.PlanRepair(validation.Errors);

        Assert.Contains(validation.Errors, error => error.Code == "MissingCoreTimelineEvent"
            && error.Path == "trueTimeline"
            && error.RefId == coreId);
        Assert.Contains(validation.Errors, error => error.Code == "MissingReference"
            && error.Path == $"traceLedger[{truth.TraceLedger.IndexOf(trace)}].sourceActionId"
            && error.RefId == coreId);
        Assert.Equal(CaseTruthArtifacts.Timeline, plan.RegenerateFromArtifact);
        Assert.DoesNotContain(CaseTruthArtifacts.CaseSeed, plan.StaleArtifacts);
        Assert.DoesNotContain(CaseTruthArtifacts.CoreTruth, plan.StaleArtifacts);
        Assert.Contains(CaseTruthArtifacts.Opportunity, plan.StaleArtifacts);
        Assert.Contains(CaseTruthArtifacts.Evidence, plan.StaleArtifacts);
        Assert.Contains(CaseTruthArtifacts.Statements, plan.StaleArtifacts);
        Assert.Contains(CaseTruthArtifacts.ProofGraph, plan.StaleArtifacts);
    }

    [Fact]
    public void ReferenceContract_PreservesStableOrdinalOrderAndCrossCategoryOverlap()
    {
        var core = new CoreCaseTruth
        {
            PreparationActionIds = { "action-b", "action-a" },
            CrimeActionIds = { "action-a", "Action-a" },
            ConcealmentActionIds = { "action-c" },
            CulpritMistakeActionIds = { "action-b" }
        };

        var ids = CaseTruthReferenceContract.CoreActionIds(core);

        Assert.Equal(new[] { "action-b", "action-a", "Action-a", "action-c" }, ids);
    }

    [Fact]
    public void ReferenceContract_UsesOrdinalCaseSensitiveTimelineAndTraceIds()
    {
        var timeline = new[]
        {
            new TrueTimelineEvent { EventId = "event-a", TraceIds = { "trace-b", "trace-a" } },
            new TrueTimelineEvent { EventId = "Event-a", TraceIds = { "trace-a", "Trace-a" } },
            new TrueTimelineEvent { EventId = "event-a", TraceIds = { "trace-c" } }
        };

        Assert.Equal(new[] { "event-a", "Event-a" }, CaseTruthReferenceContract.TimelineEventIds(timeline));
        Assert.Equal(new[] { "trace-b", "trace-a", "Trace-a", "trace-c" },
            CaseTruthReferenceContract.PlannedTraceIds(timeline));
    }

    [Fact]
    public void TimelineReferenceValidation_AllowsCrossCategoryOverlapAndAuxiliaryEvents()
    {
        var truth = ValidTruth();
        truth.TrueTimeline.Add(new TrueTimelineEvent
        {
            EventId = "event-auxiliary-alibi",
            ActorId = truth.CaseSeed.SuspectIds.Last(),
            LocationId = truth.CaseSeed.LocationIds[0],
            StartMinute = 200,
            EndMinute = 205,
            Action = "An auxiliary alibi event."
        });

        var validation = _service.ValidateTimelineReferences(truth, AiTruthGenerationBudget.Maximum);

        Assert.True(validation.IsValid, Messages(validation.Errors));
    }

    [Fact]
    public void TimelineReferenceValidation_ReportsBlankDuplicateAndCaseSensitiveIdsAtStablePaths()
    {
        var truth = ValidTruth();
        var canonical = truth.CoreTruth.CrimeActionIds[0];
        truth.CoreTruth.PreparationActionIds.Add(string.Empty);
        truth.CoreTruth.PreparationActionIds.Add("action-preparation-duplicate");
        truth.CoreTruth.PreparationActionIds.Add("action-preparation-duplicate");
        var duplicateSource = truth.TrueTimeline.First(item => item.EventId != canonical);
        truth.TrueTimeline.Add(JsonSerializer.Deserialize<TrueTimelineEvent>(
            JsonSerializer.Serialize(duplicateSource, JsonOptions), JsonOptions)!);
        truth.TrueTimeline[0].TraceIds.Add(truth.TrueTimeline[0].TraceIds[0]);
        truth.TrueTimeline.Single(item => item.EventId == canonical).EventId = canonical.ToUpperInvariant();

        var validation = _service.ValidateTimelineReferences(truth, AiTruthGenerationBudget.Maximum);

        Assert.Contains(validation.Errors, error => error.Code == "MissingField"
            && error.Path.StartsWith("coreTruth.preparationActionIds[", StringComparison.Ordinal));
        Assert.Contains(validation.Errors, error => error.Code == "DuplicateId"
            && error.Path == "coreTruth.preparationActionIds");
        Assert.Contains(validation.Errors, error => error.Code == "DuplicateId"
            && error.Path == "trueTimeline");
        Assert.Contains(validation.Errors, error => error.Code == "DuplicateId"
            && error.Path == "trueTimeline.traceIds");
        Assert.Contains(validation.Errors, error => error.Code == "MissingCoreTimelineEvent"
            && error.Path == "trueTimeline" && error.RefId == canonical);
    }

    [Fact]
    public async Task TimelineGeneration_RepairsNamespaceMismatchOnceBeforeDownstream()
    {
        var truth = ValidTruth();
        var validTimeline = new GeneratedTimelineArtifact
        {
            TrueTimeline = CloneTimeline(truth.TrueTimeline)
        };
        var invalidTimeline = new GeneratedTimelineArtifact
        {
            TrueTimeline = CloneTimeline(truth.TrueTimeline)
        };
        var coreId = truth.CoreTruth.CrimeActionIds[0];
        var invalidEvent = invalidTimeline.TrueTimeline.Single(item => item.EventId == coreId);
        invalidEvent.EventId = "event-pryce-prepares-jam";
        invalidEvent.Action = $"Prose mentions {coreId}, but that does not define it.";
        var attempts = 0;
        var downstreamCalls = 0;
        var corrections = new List<string>();

        var result = await AiCaseService.GenerateTimelineWithReferenceRepairAsync(
            correction =>
            {
                corrections.Add(correction);
                return Task.FromResult(++attempts == 1 ? invalidTimeline : validTimeline);
            },
            artifact =>
            {
                truth.TrueTimeline = artifact.TrueTimeline;
                return _service.ValidateTimelineReferences(truth, AiTruthGenerationBudget.Maximum);
            });
        if (result.Validation.IsValid) downstreamCalls++;

        Assert.True(result.Validation.IsValid, Messages(result.Validation.Errors));
        Assert.Equal(2, result.Attempts);
        Assert.Equal(2, attempts);
        Assert.Equal(1, downstreamCalls);
        Assert.Equal(coreId, truth.CoreTruth.CrimeActionIds[0]);
        Assert.Contains(coreId, corrections[1], StringComparison.Ordinal);
        Assert.Contains("Copy every distinct core action ID verbatim", corrections[1], StringComparison.Ordinal);
    }

    [Fact]
    public async Task TimelineGeneration_SecondNamespaceMismatchIsTerminalBeforeDownstream()
    {
        var truth = ValidTruth();
        var invalidTimeline = new GeneratedTimelineArtifact
        {
            TrueTimeline = CloneTimeline(truth.TrueTimeline)
        };
        var coreId = truth.CoreTruth.CrimeActionIds[0];
        invalidTimeline.TrueTimeline.Single(item => item.EventId == coreId).EventId = "event-pryce-prepares-jam";
        var attempts = 0;
        var downstreamCalls = 0;

        var result = await AiCaseService.GenerateTimelineWithReferenceRepairAsync(
            _ =>
            {
                attempts++;
                return Task.FromResult(new GeneratedTimelineArtifact
                {
                    TrueTimeline = CloneTimeline(invalidTimeline.TrueTimeline)
                });
            },
            artifact =>
            {
                truth.TrueTimeline = artifact.TrueTimeline;
                return _service.ValidateTimelineReferences(truth, AiTruthGenerationBudget.Maximum);
            });
        if (result.Validation.IsValid) downstreamCalls++;

        Assert.False(result.Validation.IsValid);
        Assert.Equal(2, result.Attempts);
        Assert.Equal(2, attempts);
        Assert.Equal(0, downstreamCalls);
        Assert.Contains(result.Validation.Errors, error => error.Code == "MissingCoreTimelineEvent");
    }

    [Fact]
    public void FailedStageCandidate_DoesNotAdvanceCompletedCheckpointOrSkipRecoveryStage()
    {
        var invalidTimeline = new SirLocked.Api.DTOs.Case.CaseValidationResult();
        invalidTimeline.Add("MissingCoreTimelineEvent", "trueTimeline", "Missing canonical event.", "action-a");
        var invalidTrace = AiCaseService.ValidateGeneratedTraceSet(
            [new TraceLedgerEntry { TraceId = "trace-wrong" }],
            ["trace-planned"]);

        var timelineCheckpoint = AiCaseService.CompletedArtifactAfterValidation(
            CaseTruthArtifacts.CoreTruth,
            CaseTruthArtifacts.Timeline,
            invalidTimeline);
        var evidenceCheckpoint = AiCaseService.CompletedArtifactAfterValidation(
            CaseTruthArtifacts.Opportunity,
            CaseTruthArtifacts.Evidence,
            invalidTrace);

        Assert.Equal(CaseTruthArtifacts.CoreTruth, timelineCheckpoint);
        Assert.Equal(CaseTruthArtifacts.Timeline, AiCaseService.NextTruthArtifact(timelineCheckpoint));
        Assert.Equal(CaseTruthArtifacts.Opportunity, evidenceCheckpoint);
        Assert.Equal(CaseTruthArtifacts.Evidence, AiCaseService.NextTruthArtifact(evidenceCheckpoint));
    }

    [Fact]
    public void ValidStageCandidate_AdvancesCompletedCheckpoint()
    {
        var validTimeline = new SirLocked.Api.DTOs.Case.CaseValidationResult();
        var validTrace = AiCaseService.ValidateGeneratedTraceSet(
            [new TraceLedgerEntry { TraceId = "trace-planned" }],
            ["trace-planned"]);

        Assert.Equal(
            CaseTruthArtifacts.Timeline,
            AiCaseService.CompletedArtifactAfterValidation(
                CaseTruthArtifacts.CoreTruth,
                CaseTruthArtifacts.Timeline,
                validTimeline));
        Assert.Equal(
            CaseTruthArtifacts.Evidence,
            AiCaseService.CompletedArtifactAfterValidation(
                CaseTruthArtifacts.Opportunity,
                CaseTruthArtifacts.Evidence,
                validTrace));
    }

    [Theory]
    [InlineData(CaseTruthArtifacts.CoreTruth, "canonical timeline eventId")]
    [InlineData(CaseTruthArtifacts.Timeline, "copied verbatim exactly once")]
    [InlineData(CaseTruthArtifacts.Timeline, "prose must never define")]
    [InlineData(CaseTruthArtifacts.Opportunity, "exact timeline eventId")]
    [InlineData(CaseTruthArtifacts.Evidence, "sourceActionId must copy an exact timeline eventId")]
    [InlineData(CaseTruthArtifacts.Statements, "eventIds must copy exact timeline eventIds")]
    public void TruthStagePrompt_StatesCanonicalReferenceContract(string artifact, string expected)
    {
        var draft = new AiCaseDraft
        {
            StoryPreview = new AiStoryPreview { Title = "Canonical IDs", Summary = "Test" },
            Settings = new AiDraftSettings()
        };

        var prompt = AiCaseService.BuildTruthStagePrompt(draft, artifact, ValidTruth(), string.Empty);

        Assert.Contains(expected, prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ProofIdNamespaceDrift_RegeneratesFromEvidenceAndAllDownstreamStages()
    {
        var truth = ValidTruth();
        var motive = truth.ProofGraph.Conclusions.Single(item => item.Category == ProofConclusionCategories.Motive);
        motive.ConclusionId = "conclusion-motive-private-sale";

        var validation = _service.Validate(truth);
        var plan = _service.PlanRepair(validation.Errors);

        Assert.Contains(validation.Errors, error => error.Code == "NonCanonicalProofId");
        Assert.Contains(validation.Errors, error => error.Code == "MissingReference"
            && error.Path.StartsWith("traceLedger", StringComparison.Ordinal));
        Assert.Equal(CaseTruthArtifacts.Evidence, plan.RegenerateFromArtifact);
        Assert.Contains(CaseTruthArtifacts.Statements, plan.StaleArtifacts);
        Assert.Contains(CaseTruthArtifacts.ProofGraph, plan.StaleArtifacts);
    }

    [Fact]
    public void ProofGraph_RequiresExactlyFiveCanonicalBidirectionalConclusions()
    {
        var truth = ValidTruth();
        var conclusion = truth.ProofGraph.Conclusions[0];
        var removedTraceId = conclusion.SupportingTraceIds[0];
        conclusion.SupportingTraceIds.RemoveAt(0);
        truth.ProofGraph.Conclusions.Add(new ProofConclusion
        {
            ConclusionId = "conclusion-motive-extra",
            Category = ProofConclusionCategories.Motive,
            Proposition = "A second motive conclusion must not be created."
        });

        var validation = _service.Validate(truth);

        Assert.Contains(validation.Errors, error => error.Code == "InvalidProofShape");
        Assert.Contains(validation.Errors, error => error.Code == "DuplicateProofCategory");
        Assert.Contains(validation.Errors, error => error.Code == "NonCanonicalProofId");
        Assert.Contains(validation.Errors, error => error.Code == "ProofLinkMismatch" && error.RefId == removedTraceId);
    }

    [Theory]
    [InlineData(CaseTruthArtifacts.Evidence)]
    [InlineData(CaseTruthArtifacts.Statements)]
    [InlineData(CaseTruthArtifacts.ProofGraph)]
    public void TruthStagePrompt_PredeclaresCanonicalProofIds(string artifact)
    {
        var draft = new AiCaseDraft
        {
            StoryPreview = new AiStoryPreview { Title = "Locked IDs", Summary = "Test" },
            Settings = new AiDraftSettings()
        };

        var prompt = AiCaseService.BuildTruthStagePrompt(draft, artifact, ValidTruth(), string.Empty);

        foreach (var pair in ProofConclusionIds.ByCategory)
        {
            Assert.Contains(pair.Key, prompt, StringComparison.Ordinal);
            Assert.Contains(pair.Value, prompt, StringComparison.Ordinal);
        }
        Assert.Contains("no other conclusion IDs", prompt, StringComparison.Ordinal);
        Assert.Contains("must be reciprocal", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void TimelinePromptAndValidator_BoundTruthTraceScopeByPreset()
    {
        var draft = new AiCaseDraft
        {
            StoryPreview = new AiStoryPreview { Title = "Bounded", Summary = "Test" },
            Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.NormalRandom }
        };
        var prompt = AiCaseService.BuildTruthStagePrompt(
            draft,
            CaseTruthArtifacts.Timeline,
            ValidTruth(),
            string.Empty);
        var truth = ValidTruth();
        while (truth.TraceLedger.Count <= CaseTruthScopeLimits.MaxTraceEntries)
        {
            var source = truth.TraceLedger[0];
            truth.TraceLedger.Add(new TraceLedgerEntry
            {
                TraceId = $"trace-over-budget-{truth.TraceLedger.Count}",
                SourceActionId = source.SourceActionId,
                CreatedByCharacterId = source.CreatedByCharacterId,
                CreatedAtMinute = source.CreatedAtMinute,
                LocationId = source.LocationId,
                PhysicalCause = "Extra trace.",
                PersistenceReason = "Persists.",
                Proves = "Extra.",
                DoesNotProve = "Everything.",
                IndependentSourceGroup = $"extra-{truth.TraceLedger.Count}",
                SupportsConclusionIds = { ProofConclusionIds.Motive }
            });
        }

        var validation = _service.Validate(truth);

        Assert.Equal(14, AiCaseService.TruthTraceBudget(draft));
        Assert.Contains("no more than 14 trace IDs total", prompt, StringComparison.Ordinal);
        Assert.Contains(validation.Errors, error => error.Code == "TruthScopeExceeded");
    }

    [Fact]
    public void BlindReview_RequiresExactTruthAndMinimumConfidence()
    {
        var truth = ValidTruth();
        var review = new BlindSolvabilityReview
        {
            Status = CaseTruthReviewStatuses.Passed,
            SchemaVersion = CaseTruthSchemaVersions.BlindReviewV1,
            CulpritId = truth.CoreTruth.CulpritId,
            Motive = truth.CoreTruth.Motive,
            Method = truth.CoreTruth.Method,
            TimelineSummary = "Reconstructed.",
            EvidenceChainIds = { "a", "b", "c", "d", "e" },
            UniqueSolution = true,
            Confidence = 0.79
        };

        var result = _service.ValidateBlindReview(truth, review);

        Assert.Contains(result.Errors, error => error.Code == "BlindReviewFailed");
    }

    private static CaseTruthPackage ValidTruth()
    {
        var draft = new AiCaseDraft { Settings = new AiDraftSettings { Difficulty = "medium" } };
        return JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!;
    }

    private static GameCase MockProjection(CaseTruthPackage truth)
    {
        var draft = new AiCaseDraft
        {
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            Settings = new AiDraftSettings(),
            CaseTruth = truth
        };
        return JsonSerializer.Deserialize<GeneratedCaseLogic>(AiCaseMockFactory.BuildMockFullCaseJson(draft), JsonOptions)!
            .ToGameCase(draft.Settings);
    }

    private static List<TrueTimelineEvent> CloneTimeline(IEnumerable<TrueTimelineEvent> timeline) =>
        JsonSerializer.Deserialize<List<TrueTimelineEvent>>(
            JsonSerializer.Serialize(timeline, JsonOptions), JsonOptions)!;

    private static string Messages(IEnumerable<SirLocked.Api.DTOs.Case.CaseValidationError> errors) =>
        string.Join("\n", errors.Select(error => $"{error.Code} {error.Path}: {error.Message}"));
}
