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
    public void GeneratedProjectionNormalizer_RepairsOnlyUniquelyTruthDerivedFields()
    {
        var truth = ValidTruth();
        var gameCase = MockProjection(truth);
        var canonicalBefore = _service.Canonicalize(truth);
        var hashBefore = _service.ComputeHash(truth);
        gameCase.FinalLogic.CulpritId = "char-wrong";
        gameCase.FinalLogic.Motive = "Wrong motive";
        gameCase.FinalLogic.Method = "Wrong method";
        var clue = gameCase.Clues[0];
        var expectedTrace = truth.TraceLedger.Single(trace =>
            trace.SourceActionId == clue.SourceActionId
            && trace.IndependentSourceGroup == clue.IndependentSourceGroup);
        clue.SceneId = "scene-wrong";
        clue.SupportsConclusionIds.Clear();
        var dialogue = gameCase.Dialogues[0];
        var mismatchedStatement = truth.StatementLedger.First(statement =>
            statement.SpeakerId != dialogue.CharacterId);
        dialogue.StatementIds = new List<string> { mismatchedStatement.StatementId };

        var corrections = CausalProjectionNormalizer.NormalizeGenerated(truth, gameCase);

        Assert.Equal(truth.CoreTruth.CulpritId, gameCase.FinalLogic.CulpritId);
        Assert.Equal(truth.CoreTruth.Motive, gameCase.FinalLogic.Motive);
        Assert.Equal(truth.CoreTruth.Method, gameCase.FinalLogic.Method);
        Assert.Equal(expectedTrace.LocationId, clue.SceneId);
        Assert.Equal(expectedTrace.SupportsConclusionIds, clue.SupportsConclusionIds);
        Assert.Equal(new[] { mismatchedStatement.StatementId }, dialogue.StatementIds);
        Assert.Contains(corrections, item => item.Code == "LOCKED_FINAL_CULPRIT");
        Assert.Contains(corrections, item => item.Code == "CLUE_SCENE_FROM_SOURCE_ACTION");
        Assert.Contains(corrections, item => item.Code == "CLUE_PROOF_LINKS_FROM_UNIQUE_TRACE");
        Assert.Equal(canonicalBefore, _service.Canonicalize(truth));
        Assert.Equal(hashBefore, _service.ComputeHash(truth));
    }

    [Fact]
    public void GeneratedProjectionNormalizer_DoesNotGuessAmbiguousTraceMetadata()
    {
        var truth = ValidTruth();
        var source = truth.TrueTimeline[0];
        var traces = truth.TraceLedger.Where(trace => trace.SourceActionId == source.EventId).Take(2).ToList();
        if (traces.Count < 2)
        {
            var clone = JsonSerializer.Deserialize<TraceLedgerEntry>(
                JsonSerializer.Serialize(truth.TraceLedger.First(), JsonOptions),
                JsonOptions)!;
            clone.TraceId = "trace-ambiguous-second";
            clone.SourceActionId = source.EventId;
            clone.LocationId = source.LocationId;
            clone.IndependentSourceGroup = "ambiguous-second-group";
            truth.TraceLedger.Add(clone);
        }
        var gameCase = new GameCase
        {
            FinalLogic = new FinalLogic
            {
                CulpritId = truth.CoreTruth.CulpritId,
                Motive = truth.CoreTruth.Motive,
                Method = truth.CoreTruth.Method
            },
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-ambiguous",
                    SourceActionId = source.EventId,
                    SceneId = "wrong-scene"
                }
            }
        };

        CausalProjectionNormalizer.NormalizeGenerated(truth, gameCase);

        Assert.Equal(source.LocationId, gameCase.Clues[0].SceneId);
        Assert.Empty(gameCase.Clues[0].IndependentSourceGroup);
        Assert.Empty(gameCase.Clues[0].SupportsConclusionIds);
    }

    [Fact]
    public void ProjectionValidation_RequiresEveryUsedTruthLocationAsScene()
    {
        var truth = ValidTruth();
        var gameCase = MockProjection(truth);
        var usedLocation = truth.TrueTimeline.Select(item => item.LocationId)
            .First(location => gameCase.Stages.SelectMany(stage => stage.Scenes)
                .Any(scene => scene.SceneId == location));
        foreach (var stage in gameCase.Stages)
            stage.Scenes.RemoveAll(scene => scene.SceneId == usedLocation);

        var result = _service.ValidateProjection(truth, gameCase);

        Assert.Contains(result.Errors, error => error.Code == "MissingTruthLocationScene"
            && error.RefId == usedLocation);
    }

    [Fact]
    public void ProjectionRepairFeedback_IncludesExactSceneProofAndSpeakerMappings()
    {
        var truth = ValidTruth();
        var gameCase = MockProjection(truth);
        var clue = gameCase.Clues[0];
        var expectedScene = truth.TrueTimeline.Single(item => item.EventId == clue.SourceActionId).LocationId;
        clue.SceneId = "scene-wrong";
        clue.SupportsConclusionIds.Clear();
        var dialogue = gameCase.Dialogues[0];
        var wrongStatement = truth.StatementLedger.First(item => item.SpeakerId != dialogue.CharacterId);
        dialogue.StatementIds = new List<string> { wrongStatement.StatementId };
        gameCase.FinalLogic.Method = "Wrong method";
        var validation = _service.ValidateProjection(truth, gameCase);

        var feedback = AiCaseService.BuildProjectionRepairFeedback(truth, gameCase, validation);

        Assert.Contains($"[ref: {clue.ClueId}]", feedback, StringComparison.Ordinal);
        Assert.Contains($"expected sceneId={JsonSerializer.Serialize(expectedScene)}", feedback, StringComparison.Ordinal);
        Assert.Contains("actual supportsConclusionIds=", feedback, StringComparison.Ordinal);
        Assert.Contains("allowed supportsConclusionIds=", feedback, StringComparison.Ordinal);
        Assert.Contains($"[ref: {wrongStatement.StatementId}]", feedback, StringComparison.Ordinal);
        Assert.Contains("actual statementIds=", feedback, StringComparison.Ordinal);
        Assert.Contains("allowed statementIds=", feedback, StringComparison.Ordinal);
        Assert.Contains("Expected exact locked value=", feedback, StringComparison.Ordinal);
    }

    [Fact]
    public void LamGiangRegression_NormalizationLeavesOnlyAmbiguousSpeakerRepair()
    {
        var truth = ValidTruth();
        var gameCase = MockProjection(truth);
        gameCase.FinalLogic.CulpritId = "char-wrong";
        gameCase.FinalLogic.Method = "Wrong method";
        foreach (var clue in gameCase.Clues.Take(6))
            clue.SceneId = "scene-wrong";
        var missingProofClue = gameCase.Clues[3];
        missingProofClue.SupportsConclusionIds.Clear();
        foreach (var dialogue in gameCase.Dialogues.Take(2))
        {
            var wrong = truth.StatementLedger.First(statement =>
                statement.SpeakerId != dialogue.CharacterId);
            dialogue.StatementIds = new List<string> { wrong.StatementId };
        }

        var before = _service.ValidateProjection(truth, gameCase);
        CausalProjectionNormalizer.NormalizeGenerated(truth, gameCase);
        var after = _service.ValidateProjection(truth, gameCase);

        Assert.Contains(before.Errors, error => error.Code == "TruthConformance"
            && error.Path is "finalLogic.culpritId" or "finalLogic.method");
        Assert.True(before.Errors.Count(error => error.Code == "TraceLocationMismatch") >= 6);
        Assert.Contains(before.Errors, error => error.Code == "MissingProofLink"
            && error.RefId == missingProofClue.ClueId);
        Assert.DoesNotContain(after.Errors, error => error.Code == "TruthConformance"
            && error.Path is "finalLogic.culpritId" or "finalLogic.motive" or "finalLogic.method");
        Assert.DoesNotContain(after.Errors, error => error.Code == "TraceLocationMismatch"
            && gameCase.Clues.Take(6).Any(clue => clue.ClueId == error.RefId));
        Assert.DoesNotContain(after.Errors, error => error.Code == "MissingProofLink"
            && error.RefId == missingProofClue.ClueId);
        Assert.True(after.Errors.Count(error => error.Code == "StatementSpeakerMismatch") >= 2);
    }

    [Fact]
    public void ProjectionValidationErrors_AreDeduplicatedByCodePathAndReference()
    {
        var result = new SirLocked.Api.DTOs.Case.CaseValidationResult();
        result.Add("MissingProofLink", "clues[3].supportsConclusionIds", "First message.", "clue-four");
        result.Add("MissingProofLink", "clues[3].supportsConclusionIds", "Second message.", "clue-four");
        result.Add("MissingProofLink", "clues[4].supportsConclusionIds", "Different path.", "clue-five");

        result.Deduplicate();

        Assert.Equal(2, result.Errors.Count);
        Assert.Single(result.Errors, error => error.Path == "clues[3].supportsConclusionIds");
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
        Assert.NotNull(detailResponse.TruthRepairPlan);
        Assert.Equal(CaseTruthArtifacts.CoreTruth,
            detailResponse.TruthRepairPlan.RecommendedStartArtifact);
    }

    [Fact]
    public void FailedAdvisoryTruthReview_DoesNotBlockDeterministicallyValidDraft()
    {
        var truth = ValidTruth();
        var draft = new AiCaseDraft
        {
            Status = AiDraftStatus.CaseTruthAwaitingApproval,
            CaseTruth = truth,
            TruthSchemaVersion = truth.SchemaVersion,
            TruthHash = _service.ComputeHash(truth),
            TruthReviewerResult = new CaseTruthFeasibilityReview
            {
                SchemaVersion = CaseTruthSchemaVersions.FeasibilityReviewV2,
                Status = CaseTruthReviewStatuses.Failed,
                Confidence = 0.97,
                TimelineFeasible = false,
                PhysicalCausalityFeasible = false,
                UniqueSolution = false,
                Findings =
                {
                    new CaseTruthReviewFinding
                    {
                        FindingId = "advisory-only",
                        Code = CaseTruthReviewFindingCodes.PhysicalCausality,
                        Message = "A subjective feasibility concern."
                    }
                }
            }
        };

        var response = SirLocked.Api.DTOs.Ai.AiDraftResponse.From(draft, includeJson: true);

        Assert.True(response.CanContinue);
        Assert.True(response.TruthReviewIsAdvisory);
        Assert.True(response.BlindReviewIsAdvisory);
        Assert.Empty(response.TruthValidationReport);
        Assert.Equal(CaseTruthReviewStatuses.Failed, response.TruthReviewerResult!.Status);
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
    public void TimelineStage_RejectsWitnessWhosePresenceOnlyTouchesEventBoundary()
    {
        var truth = ValidTruth();
        var location = truth.CaseSeed.LocationIds[0];
        var actor = truth.CaseSeed.SuspectIds[0];
        var witness = truth.CaseSeed.SuspectIds[1];
        truth.TrueTimeline.Add(new TrueTimelineEvent
        {
            EventId = "event-boundary-witnessed",
            ActorId = actor,
            LocationId = location,
            StartMinute = 500,
            EndMinute = 501,
            TravelFromPreviousMinutes = 500,
            Action = "The actor performs a witnessed action.",
            WitnessIds = { witness },
            WitnessObservations =
            {
                new WitnessObservation
                {
                    WitnessId = witness,
                    Mode = "SIGHT",
                    LineOfSightOrHearingClear = true,
                    ObservableDetail = "The witness sees the action."
                }
            }
        });
        truth.TrueTimeline.Add(new TrueTimelineEvent
        {
            EventId = "event-witness-leaves-at-boundary",
            ActorId = witness,
            LocationId = location,
            StartMinute = 499,
            EndMinute = 500,
            TravelFromPreviousMinutes = 500,
            Action = "The witness leaves before the action begins."
        });

        var result = _service.ValidateTimelineReferences(truth, AiTruthGenerationBudget.Maximum);

        Assert.Contains(result.Errors, error => error.Code == "WitnessNotObservable"
            && error.RefId == witness);
    }

    [Fact]
    public void TraceStage_RejectsCreatorDifferentFromSourceActionActor()
    {
        var truth = ValidTruth();
        var trace = truth.TraceLedger[0];
        var source = truth.TrueTimeline.Single(item => item.EventId == trace.SourceActionId);
        trace.CreatedByCharacterId = truth.CaseSeed.SuspectIds.First(id => id != source.ActorId);

        var result = _service.ValidateTraceArtifact(truth);

        Assert.Contains(result.Errors, error => error.Code == "TraceActorMismatch"
            && error.RefId == trace.TraceId);
    }

    [Fact]
    public void StatementStage_RejectsSourcelessStatementAndMissingIndependentCoverage()
    {
        var truth = ValidTruth();
        var statement = truth.StatementLedger[0];
        statement.EventIds.Clear();
        statement.KnowledgeSourceIds.Clear();
        foreach (var trace in truth.TraceLedger)
            trace.SupportsConclusionIds.Remove(ProofConclusionIds.Motive);
        foreach (var item in truth.StatementLedger)
            item.SupportsConclusionIds.Remove(ProofConclusionIds.Motive);
        statement.SupportsConclusionIds.Add(ProofConclusionIds.Motive);

        var result = _service.ValidateStatementArtifact(truth);

        Assert.Contains(result.Errors, error => error.Code == "InvalidKnowledge"
            && error.RefId == statement.StatementId);
        Assert.Contains(result.Errors, error => error.Code == "InsufficientIndependentProof"
            && error.RefId == ProofConclusionIds.Motive);
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
    public void AdvisoryBlindReviewStatus_DoesNotFailDeterministicMetadataGate()
    {
        var truth = ValidTruth();
        var gameCase = MockProjection(truth);
        gameCase.LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim;
        gameCase.LogicVerificationStatus = CaseLogicVerificationStatuses.CausalVerified;
        gameCase.TruthSchemaVersion = truth.SchemaVersion;
        gameCase.TruthHash = _service.ComputeHash(truth);
        gameCase.BlindReviewStatus = CaseTruthReviewStatuses.Failed;

        var advisory = new CaseValidationService().ValidateSceneLayout(gameCase);
        Assert.DoesNotContain(advisory.Errors, error => error.Code == "BlindReviewMetadataInvalid");

        gameCase.BlindReviewStatus = "UNKNOWN";
        var invalidMetadata = new CaseValidationService().ValidateSceneLayout(gameCase);
        Assert.Contains(invalidMetadata.Errors, error => error.Code == "BlindReviewMetadataInvalid");
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
    public void IdentityTraceFailure_RepairsFromEvidenceInsteadOfProofGraph()
    {
        var truth = ValidTruth();
        var eligibleTraceIds = truth.TraceLedger
            .Where(trace => trace.CreatedByCharacterId == truth.CoreTruth.CulpritId
                && truth.CoreTruth.CrimeActionIds.Contains(trace.SourceActionId)
                && trace.SupportsConclusionIds.Contains(ProofConclusionIds.Identity))
            .Select(trace => trace.TraceId)
            .ToHashSet(StringComparer.Ordinal);
        Assert.NotEmpty(eligibleTraceIds);

        foreach (var trace in truth.TraceLedger.Where(trace => eligibleTraceIds.Contains(trace.TraceId)))
            trace.SupportsConclusionIds.RemoveAll(id => id == ProofConclusionIds.Identity);
        var identity = truth.ProofGraph.Conclusions
            .Single(conclusion => conclusion.ConclusionId == ProofConclusionIds.Identity);
        identity.SupportingTraceIds.RemoveAll(eligibleTraceIds.Contains);

        var validation = _service.Validate(truth);
        var plan = _service.PlanRepair(validation.Errors);

        Assert.Contains(validation.Errors, error => error.Code == "MissingIdentityTrace"
            && error.Path == "traceLedger");
        Assert.Equal(CaseTruthArtifacts.Evidence, plan.RegenerateFromArtifact);
        Assert.Contains(CaseTruthArtifacts.ProofGraph, plan.StaleArtifacts);
    }

    [Fact]
    public void ProofGraphValidation_RejectsMissingReciprocalIdentityEdgeWithoutMutation()
    {
        var truth = ValidTruth();
        var eligibleTrace = truth.TraceLedger.First(trace =>
            trace.CreatedByCharacterId == truth.CoreTruth.CulpritId
            && truth.CoreTruth.CrimeActionIds.Contains(trace.SourceActionId)
            && trace.SupportsConclusionIds.Contains(ProofConclusionIds.Identity));
        var identity = truth.ProofGraph.Conclusions.Single(conclusion =>
            conclusion.ConclusionId == ProofConclusionIds.Identity);
        identity.SupportingTraceIds.Remove(eligibleTrace.TraceId);
        Assert.Contains(_service.Validate(truth).Errors, error =>
            error.Code is "MissingIdentityEvidence" or "ProofLinkMismatch");

        var validation = _service.Validate(truth);

        Assert.DoesNotContain(eligibleTrace.TraceId, identity.SupportingTraceIds);
        Assert.Contains(validation.Errors, error =>
            error.Code is "MissingIdentityEvidence" or "ProofLinkMismatch");
    }

    [Fact]
    public void ProofGraphValidation_DoesNotInventIdentityEvidence()
    {
        var truth = ValidTruth();
        foreach (var trace in truth.TraceLedger)
            trace.SupportsConclusionIds.RemoveAll(id => id == ProofConclusionIds.Identity);
        var identity = truth.ProofGraph.Conclusions.Single(conclusion =>
            conclusion.ConclusionId == ProofConclusionIds.Identity);
        var originalLinks = identity.SupportingTraceIds.ToList();

        Assert.Equal(originalLinks, identity.SupportingTraceIds);
        Assert.Contains(_service.Validate(truth).Errors, error => error.Code == "MissingIdentityTrace");
    }

    [Fact]
    public void Timeline_RequiresIdentityTraceToBePlannedOnCulpritCrimeAction()
    {
        var truth = ValidTruth();
        foreach (var crimeAction in truth.TrueTimeline
                     .Where(item => truth.CoreTruth.CrimeActionIds.Contains(item.EventId)))
            crimeAction.TraceIds.Clear();

        var validation = _service.ValidateTimelineReferences(
            truth,
            AiTruthGenerationBudget.For(new AiDraftSettings()));

        Assert.Contains(validation.Errors, error => error.Code == "MissingIdentityTracePlan"
            && error.Path == "trueTimeline.traceIds");
        Assert.Equal(
            CaseTruthArtifacts.Timeline,
            _service.PlanRepair(validation.Errors).RegenerateFromArtifact);
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
    public async Task TimelineGeneration_DoesNotAutoRepairNamespaceMismatch()
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

        Assert.False(result.Validation.IsValid);
        Assert.Equal(1, result.Attempts);
        Assert.Equal(1, attempts);
        Assert.Equal(0, downstreamCalls);
        Assert.Equal(coreId, truth.CoreTruth.CrimeActionIds[0]);
        Assert.Single(corrections);
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
        Assert.Equal(1, result.Attempts);
        Assert.Equal(1, attempts);
        Assert.Equal(0, downstreamCalls);
        Assert.Contains(result.Validation.Errors, error => error.Code == "MissingCoreTimelineEvent");
    }

    [Fact]
    public async Task TruthArtifactGeneration_DoesNotAutoRepairSemanticFailure()
    {
        var attempts = 0;
        var corrections = new List<string>();

        var result = await AiCaseService.GenerateTruthArtifactWithScopedRepairAsync(
            correction =>
            {
                corrections.Add(correction);
                return Task.FromResult(++attempts == 1 ? "invalid" : "valid");
            },
            value =>
            {
                var validation = new SirLocked.Api.DTOs.Case.CaseValidationResult();
                if (value == "invalid")
                    validation.Add("TraceActorMismatch", "traceLedger[0].createdByCharacterId",
                        "Trace creator differs from source actor.", "trace-a");
                return validation;
            },
            CaseTruthArtifacts.Evidence);

        Assert.False(result.Validation.IsValid);
        Assert.Equal(1, result.Attempts);
        Assert.Equal(1, attempts);
        Assert.Single(corrections);
        Assert.Contains(result.Validation.Errors, error => error.Code == "TraceActorMismatch");
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

    [Theory]
    [InlineData(CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthArtifacts.Evidence)]
    [InlineData(CaseTruthArtifacts.ProofGraph)]
    public void TruthStagePrompt_LocksIdentityEvidenceAtItsOwningStages(string artifact)
    {
        var truth = ValidTruth();
        var draft = new AiCaseDraft
        {
            StoryPreview = new AiStoryPreview { Title = "Identity invariant", Summary = "Test" },
            Settings = new AiDraftSettings()
        };

        var prompt = AiCaseService.BuildTruthStagePrompt(draft, artifact, truth, string.Empty);

        Assert.Contains("HARD IDENTITY INVARIANT", prompt, StringComparison.Ordinal);
        Assert.Contains(truth.CoreTruth.CulpritId, prompt, StringComparison.Ordinal);
        Assert.Contains(truth.CoreTruth.CrimeActionIds[0], prompt, StringComparison.Ordinal);
        if (artifact == CaseTruthArtifacts.Evidence)
            Assert.Contains(ProofConclusionIds.Identity, prompt, StringComparison.Ordinal);
        if (artifact == CaseTruthArtifacts.ProofGraph)
        {
            var eligibleTrace = truth.TraceLedger.First(trace =>
                trace.CreatedByCharacterId == truth.CoreTruth.CulpritId
                && truth.CoreTruth.CrimeActionIds.Contains(trace.SourceActionId)
                && trace.SupportsConclusionIds.Contains(ProofConclusionIds.Identity));
            Assert.Contains(eligibleTrace.TraceId, prompt, StringComparison.Ordinal);
        }
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
        Assert.Contains("between 5 and 14 distinct trace IDs total", prompt, StringComparison.Ordinal);
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

        Assert.Contains(result.Errors, error => error.Code == "BlindReviewConfidenceLow");
    }

    [Fact]
    public void FailedHighConfidenceCausalityReview_IsRejectedAndRoutesRepairFromTimeline()
    {
        var review = new CaseTruthFeasibilityReview
        {
            SchemaVersion = CaseTruthSchemaVersions.FeasibilityReviewV2,
            Status = CaseTruthReviewStatuses.Failed,
            Confidence = 0.96,
            TimelineFeasible = true,
            PhysicalCausalityFeasible = false,
            UniqueSolution = true,
            Findings =
            {
                new CaseTruthReviewFinding
                {
                    FindingId = "finding-clock-reset",
                    Code = CaseTruthReviewFindingCodes.PhysicalCausality,
                    RelatedIds = { "action-clock-reset", "trace-seven-minute-delay" },
                    Message = "The reset removes the mechanism required for the later delay."
                }
            }
        };

        var validation = _service.ValidateFeasibilityReview(review);
        var plan = CaseTruthRepairPolicy.PlanReview(review);
        var feedback = AiCaseService.BuildTruthReviewFeedback(review);

        Assert.Contains(validation.Errors, error => error.Code == "TruthReviewStatusFailed");
        Assert.Contains(validation.Errors, error => error.Code == "TruthCausalityBlocked");
        Assert.DoesNotContain(validation.Errors, error => error.Code == "TruthReviewConfidenceLow");
        Assert.Equal(CaseTruthArtifacts.Timeline, plan.RegenerateFromArtifact);
        Assert.Contains(CaseTruthReviewFindingCodes.PhysicalCausality, plan.ReasonCodes);
        Assert.Contains("confidence=0.96", feedback, StringComparison.Ordinal);
        Assert.Contains("action-clock-reset", feedback, StringComparison.Ordinal);
        Assert.Contains("The reset removes the mechanism", feedback, StringComparison.Ordinal);
    }

    [Fact]
    public void FailedV2Review_RequiresFindingButPersistedV1DoesNot()
    {
        var v2 = new CaseTruthFeasibilityReview
        {
            SchemaVersion = CaseTruthSchemaVersions.FeasibilityReviewV2,
            Status = CaseTruthReviewStatuses.Failed,
            Confidence = 0.90,
            TimelineFeasible = false,
            PhysicalCausalityFeasible = true,
            UniqueSolution = true
        };
        var v1 = new CaseTruthFeasibilityReview
        {
            SchemaVersion = CaseTruthSchemaVersions.FeasibilityReviewV1,
            Status = CaseTruthReviewStatuses.Failed,
            Confidence = 0.90,
            TimelineFeasible = false,
            PhysicalCausalityFeasible = true,
            UniqueSolution = true,
            Issues = { "Legacy issue." }
        };

        Assert.Contains(_service.ValidateFeasibilityReview(v2).Errors,
            error => error.Code == "MissingReviewFindings");
        Assert.DoesNotContain(_service.ValidateFeasibilityReview(v1).Errors,
            error => error.Code == "MissingReviewFindings");
    }

    [Theory]
    [InlineData(CaseTruthReviewFindingCodes.TimelineFeasibility, CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthReviewFindingCodes.TravelFeasibility, CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthReviewFindingCodes.PhysicalCausality, CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthReviewFindingCodes.WitnessObservability, CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthReviewFindingCodes.AlibiSupport, CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthReviewFindingCodes.MissingCausalAntecedent, CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthReviewFindingCodes.Other, CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthReviewFindingCodes.OpportunityConsistency, CaseTruthArtifacts.Opportunity)]
    [InlineData(CaseTruthReviewFindingCodes.SolutionAmbiguity, CaseTruthArtifacts.Opportunity)]
    [InlineData(CaseTruthReviewFindingCodes.TracePersistence, CaseTruthArtifacts.Evidence)]
    [InlineData(CaseTruthReviewFindingCodes.ProofScope, CaseTruthArtifacts.Evidence)]
    public void ReviewRepairPolicy_MapsFindingToEarliestArtifact(string code, string expected)
    {
        var review = new CaseTruthFeasibilityReview
        {
            Status = CaseTruthReviewStatuses.Failed,
            Findings = { new CaseTruthReviewFinding { Code = code } }
        };

        Assert.Equal(expected, CaseTruthRepairPolicy.PlanReview(review).RegenerateFromArtifact);
    }

    [Fact]
    public void ReviewRepairPolicy_UsesEarliestFindingAndConservativeLegacyFallback()
    {
        var review = new CaseTruthFeasibilityReview
        {
            SchemaVersion = CaseTruthSchemaVersions.FeasibilityReviewV2,
            Status = CaseTruthReviewStatuses.Failed,
            Findings =
            {
                new CaseTruthReviewFinding { Code = CaseTruthReviewFindingCodes.ProofScope },
                new CaseTruthReviewFinding { Code = CaseTruthReviewFindingCodes.OpportunityConsistency },
                new CaseTruthReviewFinding { Code = CaseTruthReviewFindingCodes.TravelFeasibility }
            }
        };
        var legacy = new CaseTruthFeasibilityReview
        {
            SchemaVersion = CaseTruthSchemaVersions.FeasibilityReviewV1,
            Status = CaseTruthReviewStatuses.Failed,
            Issues = { "Legacy prose-only issue." }
        };

        Assert.Equal(CaseTruthArtifacts.Timeline,
            CaseTruthRepairPolicy.PlanReview(review).RegenerateFromArtifact);
        var legacyPlan = CaseTruthRepairPolicy.PlanReview(legacy);
        Assert.Equal(CaseTruthArtifacts.Timeline, legacyPlan.RegenerateFromArtifact);
        Assert.Contains("LEGACY_REVIEW_FALLBACK", legacyPlan.ReasonCodes);
        Assert.Contains("Legacy prose-only issue.", AiCaseService.BuildTruthReviewFeedback(legacy), StringComparison.Ordinal);
        Assert.True(CaseTruthRepairPolicy.IsAtOrBefore(CaseTruthArtifacts.CoreTruth, CaseTruthArtifacts.Timeline));
        Assert.False(CaseTruthRepairPolicy.IsAtOrBefore(CaseTruthArtifacts.Evidence, CaseTruthArtifacts.Timeline));

        var deterministic = CaseTruthRepairPolicy.BuildPlan(CaseTruthArtifacts.CoreTruth);
        deterministic.ReasonCodes.Add("MissingCoreTimelineEvent");
        var semantic = CaseTruthRepairPolicy.BuildPlan(CaseTruthArtifacts.Timeline);
        semantic.ReasonCodes.Add(CaseTruthReviewFindingCodes.PhysicalCausality);
        var combined = CaseTruthRepairPolicy.Earliest(deterministic, semantic);
        Assert.Equal(CaseTruthArtifacts.CoreTruth, combined.RegenerateFromArtifact);
        Assert.Contains("MissingCoreTimelineEvent", combined.ReasonCodes);
        Assert.Contains(CaseTruthReviewFindingCodes.PhysicalCausality, combined.ReasonCodes);
    }

    [Fact]
    public void PersistedV1Review_StillDeserializesAndDoesNotRequireStructuredFindings()
    {
        const string json = """
            {
              "schemaVersion": "case-truth-feasibility-review-v1",
              "status": "FAILED",
              "confidence": 0.91,
              "timelineFeasible": false,
              "physicalCausalityFeasible": true,
              "uniqueSolution": true,
              "issues": ["A legacy timeline issue."]
            }
            """;
        var review = JsonSerializer.Deserialize<CaseTruthFeasibilityReview>(json, JsonOptions)!;

        var validation = _service.ValidateFeasibilityReview(review);

        Assert.Equal(CaseTruthSchemaVersions.FeasibilityReviewV1, review.SchemaVersion);
        Assert.Contains("A legacy timeline issue.", review.Issues);
        Assert.DoesNotContain(validation.Errors, error => error.Code is "InvalidReviewSchema" or "MissingReviewFindings");
        Assert.Contains(validation.Errors, error => error.Code == "TruthTimelineBlocked");
    }

    [Fact]
    public void VerifiedSelfReportedAlibi_RequiresObjectiveCorroboration()
    {
        var truth = ValidTruth();
        var characterId = truth.CaseSeed.SuspectIds.First(id => id != truth.CoreTruth.CulpritId);
        var opportunity = truth.OpportunityMatrix.Single(item => item.CharacterId == characterId);
        var alibi = new TrueTimelineEvent
        {
            EventId = "event-self-reported-alibi",
            ActorId = characterId,
            LocationId = truth.CaseSeed.LocationIds[0],
            StartMinute = 220,
            EndMinute = 225,
            TravelFromPreviousMinutes = 0,
            Action = "The suspect claims to have remained alone in the archive."
        };
        truth.TrueTimeline.Add(alibi);
        opportunity.AlibiEventIds.Add(alibi.EventId);
        opportunity.AlibiVerified = true;

        var unsupported = _service.Validate(truth);

        Assert.Contains(unsupported.Errors, error => error.Code == "UncorroboratedAlibi"
            && error.Path == $"opportunityMatrix[{truth.OpportunityMatrix.IndexOf(opportunity)}].alibiEventIds"
            && error.RefId == alibi.EventId);

        alibi.TraceIds.Add("trace-alibi-register");
        truth.TraceLedger.Add(new TraceLedgerEntry
        {
            TraceId = "trace-alibi-register",
            SourceActionId = alibi.EventId,
            CreatedByCharacterId = characterId,
            CreatedAtMinute = 223,
            LocationId = alibi.LocationId,
            PhysicalCause = "The suspect signs a bound register during the alibi event.",
            PersistenceReason = "The bound register remains in supervised custody.",
            Proves = "The signature was made during the recorded interval.",
            DoesNotProve = "It does not establish the crime method.",
            IndependentSourceGroup = "archive-register",
            SupportsConclusionIds = { ProofConclusionIds.Opportunity }
        });

        var corroborated = _service.Validate(truth);

        Assert.DoesNotContain(corroborated.Errors, error => error.Code == "UncorroboratedAlibi"
            && error.RefId == alibi.EventId);
    }

    [Fact]
    public void OpportunityPrompt_DefinesAvailabilityAsWholeCrimeActionWindow()
    {
        var draft = new AiCaseDraft
        {
            StoryPreview = new AiStoryPreview { Title = "Clock case", Summary = "Test" },
            Settings = new AiDraftSettings()
        };

        var prompt = AiCaseService.BuildTruthStagePrompt(
            draft,
            CaseTruthArtifacts.Opportunity,
            ValidTruth(),
            string.Empty);

        Assert.Contains("interval in which that suspect could execute the complete locked crime-action chain", prompt,
            StringComparison.OrdinalIgnoreCase);
        Assert.Contains("not the character's full presence schedule", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ContractV2FullCasePrompt_UsesFiveClaimsAndExactProjectionMapWithoutReviewerOutput()
    {
        var truth = ValidTruth();
        var draft = new AiCaseDraft
        {
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.ShortDemo },
            StoryPreview = new AiStoryPreview { Title = "Lam Giang", Summary = "Test" },
            CaseTruth = truth,
            CaseTruthJson = _service.Canonicalize(truth),
            TruthReviewerResult = new CaseTruthFeasibilityReview
            {
                Status = CaseTruthReviewStatuses.Passed,
                Confidence = 0.91,
                Issues = { "private reviewer text must not enter the projection prompt" }
            }
        };

        var prompt = AiCaseService.BuildFullCasePrompt(draft);

        Assert.Contains("exactly five distinct entries: MOTIVE, METHOD, OPPORTUNITY, IDENTITY, and TIMELINE",
            prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("exactly one MOTIVE, one METHOD, and one OPPORTUNITY entry",
            prompt, StringComparison.Ordinal);
        Assert.Contains("LOCKED PROJECTION MAP", prompt, StringComparison.Ordinal);
        Assert.Contains(truth.TrueTimeline[0].EventId, prompt, StringComparison.Ordinal);
        Assert.Contains(truth.StatementLedger[0].StatementId, prompt, StringComparison.Ordinal);
        Assert.Contains(truth.ProofGraph.Conclusions[0].ConclusionId, prompt, StringComparison.Ordinal);
        Assert.Contains("Copy every truth-owned sceneId/locationId and characterId exactly",
            prompt, StringComparison.Ordinal);
        Assert.Contains("JSON shape example are placeholders, never authoritative truth values",
            prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("sceneId \"scene-\", characterId \"char-\"",
            prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("private reviewer text", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void BlindReviewFindings_AlwaysPlanGameplayProjectionAndEnterRepairFeedback()
    {
        var review = new BlindSolvabilityReview
        {
            SchemaVersion = CaseTruthSchemaVersions.BlindReviewV2,
            Status = CaseTruthReviewStatuses.Ambiguous,
            Confidence = 0.88,
            UniqueSolution = false,
            Findings =
            {
                new CaseTruthReviewFinding
                {
                    FindingId = "blind-ambiguous-clue",
                    Code = CaseTruthReviewFindingCodes.SolutionAmbiguity,
                    RelatedIds = { "clue-clock-face" },
                    Message = "The visible clue chain permits two suspects."
                }
            }
        };

        var plan = CaseTruthRepairPolicy.PlanBlindReview(review);
        var feedback = AiCaseService.BuildBlindReviewFeedback(review);

        Assert.Equal(CaseTruthArtifacts.Projection, plan.RegenerateFromArtifact);
        Assert.Contains(CaseTruthReviewFindingCodes.SolutionAmbiguity, plan.ReasonCodes);
        Assert.Contains("clue-clock-face", feedback, StringComparison.Ordinal);
        Assert.Contains("permits two suspects", feedback, StringComparison.Ordinal);
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
