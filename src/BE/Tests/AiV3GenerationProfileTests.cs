using System.Text.Json;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiV3GenerationProfileTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public void CanonicalPreset_HasNineAttemptsAndPassesDeterministicValidation()
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);

        var validation = AiGenerationContract.For(AiGenerationPresets.CrackTheLieV3, 1)
            .Validate(gameCase, CreateSettings());

        Assert.True(validation.IsValid, Format(validation));
        Assert.Equal(9, challenge.CandidateEvidenceIds
            .SelectMany(_ => challenge.CandidateTestimonyFragmentIds).Count());
        Assert.Single(challenge.CandidateEvidenceIds, id => id == challenge.CorrectEvidenceId);
        Assert.Single(challenge.CandidateTestimonyFragmentIds, id => id == challenge.TestimonyFragmentId);
        Assert.Equal(1, gameCase.Clues.Count(clue => clue.IsEvidence && EvidenceDiscoveryMethods.IsCamera(clue)));
        Assert.Equal(2, gameCase.Clues.Count(clue => clue.IsEvidence && EvidenceDiscoveryMethods.IsItemInspect(clue)));
        Assert.Equal(2, gameCase.Items.Count);
    }

    [Fact]
    public void FragmentOutsideDialogueAnswer_IsRejectedAfterUnicodeNormalization()
    {
        var gameCase = CreateCanonicalCase();
        gameCase.TestimonyFragments[1].Text = "This claim was never spoken anywhere in the source answer.";

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.Contains(validation.Errors, error =>
            error.Path.Contains("testimony:", StringComparison.Ordinal)
            && error.Message.Contains("exact claim", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void CandidateSetsMustBeUniqueCompleteAndContainDeclaredAnswer()
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        challenge.CandidateEvidenceIds[2] = challenge.CandidateEvidenceIds[1];
        challenge.CandidateTestimonyFragmentIds.Remove(challenge.TestimonyFragmentId);

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.Contains(validation.Errors, error => error.Path.EndsWith("candidateEvidenceIds", StringComparison.Ordinal));
        Assert.Contains(validation.Errors, error => error.Path.EndsWith("candidateTestimonyFragmentIds", StringComparison.Ordinal));
        Assert.Contains(validation.Errors, error => error.Path.EndsWith("testimonyFragmentId", StringComparison.Ordinal));
    }

    [Fact]
    public void ItemEvidenceMappingMustBeBijectiveAndRevealMustNotBeReachableEarly()
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        gameCase.Items[1].UnlockClueIds[0] = gameCase.Items[0].UnlockClueIds[0];
        gameCase.Dialogues[0].UnlockClueIds.Add(Assert.Single(challenge.UnlockClueIds));

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.Contains(validation.Errors, error =>
            error.Path.Contains("clue:", StringComparison.Ordinal)
            && error.Message.Contains("one-to-one", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(validation.Errors, error =>
            error.Message.Contains("only be unlocked", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void PresetRejectsThreeCutoutsOrMissingCameraEvidence()
    {
        var gameCase = CreateCanonicalCase();
        var camera = gameCase.Clues.Single(clue => clue.IsEvidence && EvidenceDiscoveryMethods.IsCamera(clue));
        camera.SourceType = EvidenceDiscoveryMethods.ItemInspect;
        camera.DiscoverMethod = EvidenceDiscoveryMethods.ItemInspect;
        camera.Source = gameCase.Items[0].ItemId;
        gameCase.Items[0].UnlockClueIds.Add(camera.ClueId);

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.Contains(validation.Errors, error => error.Message.Contains("CAMERA_CAPTURE", StringComparison.Ordinal));
        Assert.Contains(validation.Errors, error => error.Message.Contains("ITEM_INSPECT", StringComparison.Ordinal));
    }

    [Fact]
    public void CorrectEvidenceMayBeAnItemWithoutChangingAcquisitionTopology()
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        challenge.CorrectEvidenceId = gameCase.Clues.First(clue => clue.IsEvidence && EvidenceDiscoveryMethods.IsItemInspect(clue)).ClueId;

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.True(validation.IsValid, Format(validation));
    }

    [Fact]
    public void GeneratedLayoutRequiresOneCameraZoneAndNoItemZone()
    {
        var gameCase = CreateCanonicalCase();
        var scene = Assert.Single(Assert.Single(gameCase.Stages).Scenes);
        var camera = gameCase.Clues.Single(clue => clue.IsEvidence && EvidenceDiscoveryMethods.IsCamera(clue));
        scene.Runtime = new SceneRuntime
        {
            ClueZones =
            {
                new ClueZone { ClueId = camera.ClueId },
                new ClueZone { ClueId = gameCase.Items[0].UnlockClueIds[0] }
            },
            ItemPlacements = gameCase.Items.Select(item => new ItemPlacement { ItemId = item.ItemId }).ToList(),
            CharacterPlacements = gameCase.Characters.Select(character => new CharacterPlacement { CharacterId = character.CharacterId }).ToList()
        };

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.Contains(validation.Errors, error => error.Path.EndsWith("runtime.clueZones", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("The correct evidence is the overlapping wax.")]
    [InlineData("Use the overlapping wax to solve this.")]
    public void FailureFeedbackCannotLeakAnswerOrReveal(string failureResponse)
    {
        var gameCase = CreateCanonicalCase();
        Assert.Single(gameCase.EvidenceChallenges).FailureResponse = failureResponse;

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.Contains(validation.Errors, error => error.Code == "SecretLeak");
    }

    [Fact]
    public void FailureFeedbackCannotQuoteTheGeneratedReveal()
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        var reveal = gameCase.Clues.Single(clue => challenge.UnlockClueIds.Contains(clue.ClueId));
        challenge.FailureResponse = $"Try again after considering {reveal.Title}.";

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.Contains(validation.Errors, error => error.Code == "SecretLeak");
    }

    [Fact]
    public void SemanticReviewPassesOnlyForOneHighConfidenceDeclaredPair()
    {
        var gameCase = CreateCanonicalCase();
        var review = CreateReview(gameCase);

        var evaluated = AiV3GenerationProfile.EvaluateReview(gameCase, review);

        Assert.Equal(AiV3SemanticReviewStatuses.Passed, evaluated.Status);
        Assert.Equal(AiGenerationSchemaVersions.V3SemanticReview, evaluated.SchemaVersion);
        Assert.NotNull(evaluated.ReviewedAt);
    }

    [Fact]
    public void SemanticReviewPassesWhenASecondPairIsAlsoValid()
    {
        // A real trace can refute more than one claim, so extra valid pairs are tolerated as long as
        // the authored answer is genuinely one of them.
        var gameCase = CreateCanonicalCase();
        var review = CreateReview(gameCase);
        review.PairEvaluations.First(item => !item.IsValidContradiction).IsValidContradiction = true;

        var evaluated = AiV3GenerationProfile.EvaluateReview(gameCase, review);

        Assert.Equal(AiV3SemanticReviewStatuses.Passed, evaluated.Status);
        Assert.DoesNotContain(
            AiV3SemanticReviewPolicy.Errors(gameCase, evaluated),
            error => error.StartsWith("AI_V3_AUTHORED_PAIR_MISMATCH", StringComparison.Ordinal));
    }

    [Fact]
    public void SemanticReviewFailsWhenOnlyANonAuthoredPairIsValid()
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        var review = CreateReview(gameCase);
        foreach (var evaluation in review.PairEvaluations)
            evaluation.IsValidContradiction = evaluation.EvidenceId != challenge.CorrectEvidenceId
                || evaluation.TestimonyFragmentId != challenge.TestimonyFragmentId;

        var evaluated = AiV3GenerationProfile.EvaluateReview(gameCase, review);

        Assert.Equal(AiV3SemanticReviewStatuses.Failed, evaluated.Status);
        Assert.Contains(
            AiV3SemanticReviewPolicy.Errors(gameCase, evaluated),
            error => error.StartsWith("AI_V3_AUTHORED_PAIR_MISMATCH", StringComparison.Ordinal));
    }

    [Fact]
    public void SemanticRepairFeedbackExplainsRejectedActorAttribution()
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        var review = CreateReview(gameCase);
        var authored = review.PairEvaluations.Single(item =>
            item.EvidenceId == challenge.CorrectEvidenceId
            && item.TestimonyFragmentId == challenge.TestimonyFragmentId);
        authored.IsValidContradiction = false;
        authored.Reason = "The tracks show that the trolley moved, but do not identify the witness as the mover.";
        var evaluated = AiV3GenerationProfile.EvaluateReview(gameCase, review);

        var feedback = AiV3SemanticReviewPolicy.BuildRepairFeedback(gameCase, evaluated);
        var errors = AiV3SemanticReviewPolicy.Errors(gameCase, evaluated);

        Assert.Contains("do not identify the witness as the mover", feedback, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Prefer a subject-neutral physical claim", feedback, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Movement, ownership, assignment", feedback, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(errors, error => error.StartsWith("AI_V3_NO_VALID_PAIR", StringComparison.Ordinal));
    }

    [Fact]
    public void SemanticReviewIsAmbiguousWhenPairIsMissingOrConfidenceIsLow()
    {
        var gameCase = CreateCanonicalCase();
        var missing = CreateReview(gameCase);
        missing.PairEvaluations.RemoveAt(0);
        var lowConfidence = CreateReview(gameCase);
        lowConfidence.PairEvaluations[0].Confidence = 0.69;

        Assert.Equal(AiV3SemanticReviewStatuses.Ambiguous,
            AiV3GenerationProfile.EvaluateReview(gameCase, missing).Status);
        Assert.Equal(AiV3SemanticReviewStatuses.Ambiguous,
            AiV3GenerationProfile.EvaluateReview(gameCase, lowConfidence).Status);
    }

    [Fact]
    public void SemanticReviewIsAmbiguousWhenAnEvaluationHasNoReason()
    {
        var gameCase = CreateCanonicalCase();
        var review = CreateReview(gameCase);
        review.PairEvaluations[0].Reason = "  ";

        Assert.Equal(AiV3SemanticReviewStatuses.Ambiguous,
            AiV3GenerationProfile.EvaluateReview(gameCase, review).Status);
    }

    [Theory]
    [InlineData(AiGenerationPresets.NormalRandom, 2, 1)]
    [InlineData(AiGenerationPresets.FullFeature, 3, 1)]
    public void AdditivePreset_AllowsAiChosenEvidenceSourcesAndMultiCrackMatrices(
        string preset,
        int crackCount,
        int expectedCameraCracks)
    {
        var gameCase = CreateAdditiveProfileCase(preset, crackCount);

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.True(validation.IsValid, Format(validation));
        Assert.Equal(crackCount, gameCase.EvidenceChallenges.Count);
        Assert.Single(gameCase.EvidenceChallenges, challenge => challenge.IsSignature);
        Assert.Equal(expectedCameraCracks, gameCase.EvidenceChallenges.Count(challenge =>
            challenge.CandidateEvidenceIds.Any(id => id.StartsWith("evidence-camera-", StringComparison.Ordinal))));
        Assert.All(gameCase.EvidenceChallenges, challenge =>
            Assert.Equal(9, challenge.CandidateEvidenceIds
                .SelectMany(_ => challenge.CandidateTestimonyFragmentIds).Count()));
    }

    [Fact]
    public void AdditivePreset_RejectsAcquisitionMethodThatDoesNotMatchItsSourceGraph()
    {
        var gameCase = CreateAdditiveProfileCase(AiGenerationPresets.NormalRandom, 2);
        var puzzleEvidence = gameCase.Clues.First(clue =>
            clue.AcquisitionMethod == EvidenceAcquisitionMethods.PuzzleResult);
        puzzleEvidence.SourceType = "item";

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.Contains(validation.Errors, error => error.Code == "UndiscoverableEvidence"
            && error.RefId == puzzleEvidence.ClueId);
    }

    [Fact]
    public void MultiCrackSemanticReview_PersistsAndEvaluatesOneMatrixPerChallenge()
    {
        var gameCase = CreateAdditiveProfileCase(AiGenerationPresets.NormalRandom, 2);
        var generated = JsonSerializer.Deserialize<GeneratedV3SemanticReview>(
            AiV3SemanticReviewPolicy.BuildMockResponse(gameCase), JsonOptions)!;

        var evaluated = AiV3GenerationProfile.EvaluateReview(gameCase, new AiV3SemanticReview
        {
            Cracks = generated.Cracks
        });

        Assert.Equal(AiV3SemanticReviewStatuses.Passed, evaluated.Status);
        Assert.Equal(2, evaluated.Cracks.Count);
        Assert.All(evaluated.Cracks, crack => Assert.Equal(9, crack.PairEvaluations.Count));
        Assert.Empty(evaluated.PairEvaluations);
    }

    [Theory]
    [InlineData(AiGenerationPresets.ShortDemo, 1, 2, 3)]
    [InlineData(AiGenerationPresets.NormalRandom, 1, 2, 6)]
    [InlineData(AiGenerationPresets.NormalRandom, 1, 3, 4)]
    [InlineData(AiGenerationPresets.NormalRandom, 1, 3, 6)]
    [InlineData(AiGenerationPresets.NormalRandom, 1, 4, 4)]
    [InlineData(AiGenerationPresets.FullFeature, 2, 4, 6)]
    public void DynamicMatricesWithinPresetBudget_AreAcceptedAndFullyReviewed(
        string preset,
        int crackCount,
        int testimonyCount,
        int evidenceCount)
    {
        var gameCase = CreateAdditiveProfileCase(preset, crackCount);
        ResizeChallenge(gameCase, gameCase.EvidenceChallenges[0], testimonyCount, evidenceCount);

        var validation = AiV3GenerationProfile.Validate(gameCase);
        var generated = JsonSerializer.Deserialize<GeneratedV3SemanticReview>(
            AiV3SemanticReviewPolicy.BuildMockResponse(gameCase), JsonOptions)!;
        var evaluated = AiV3GenerationProfile.EvaluateReview(gameCase, new AiV3SemanticReview
        {
            Cracks = generated.Cracks
        });

        Assert.True(validation.IsValid, Format(validation));
        var reviewed = evaluated.Cracks.Single(crack => crack.ChallengeId == gameCase.EvidenceChallenges[0].ChallengeId);
        Assert.Equal(testimonyCount * evidenceCount, reviewed.ExpectedPairCount);
        Assert.Equal(testimonyCount * evidenceCount, reviewed.PairEvaluations.Count);
        Assert.Equal(AiV3SemanticReviewStatuses.Passed, evaluated.Status);
    }

    [Theory]
    [InlineData(2, 3)]
    [InlineData(3, 4)]
    [InlineData(4, 6)]
    public void FullLogicValidator_AcceptsDynamicCandidateMatrixBounds(int testimonyCount, int evidenceCount)
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        ResizeChallenge(gameCase, challenge, testimonyCount, evidenceCount);
        gameCase.TestimonyFragments.RemoveAll(fragment =>
            fragment.DialogueId == challenge.DialogueId
            && !challenge.CandidateTestimonyFragmentIds.Contains(fragment.Id, StringComparer.Ordinal));

        var validation = new CaseValidationService().ValidateFullLogic(gameCase);

        Assert.True(validation.IsValid, Format(validation));
    }

    [Theory]
    [InlineData(1, 3, "candidateTestimonyFragmentIds")]
    [InlineData(5, 3, "candidateTestimonyFragmentIds")]
    [InlineData(2, 2, "candidateEvidenceIds")]
    [InlineData(2, 7, "candidateEvidenceIds")]
    public void FullLogicValidator_RejectsDynamicCandidateMatrixOutsideAbsoluteBounds(
        int testimonyCount,
        int evidenceCount,
        string expectedPath)
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        ResizeChallenge(gameCase, challenge, testimonyCount, evidenceCount);

        var validation = new CaseValidationService().ValidateFullLogic(gameCase);

        Assert.Contains(validation.Errors, error => error.Path.EndsWith(expectedPath, StringComparison.Ordinal));
    }

    [Fact]
    public void FullLogicValidator_RejectsPartialDynamicCandidateContract()
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        challenge.CandidateEvidenceIds.Clear();

        var validation = new CaseValidationService().ValidateFullLogic(gameCase);

        Assert.Contains(validation.Errors, error => error.Path == "evidenceChallenges[0]"
                                                    && error.Message.Contains("both", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void FullLogicValidator_PreservesLegacyCandidateListCompatibility()
    {
        var gameCase = CreateCanonicalCase();
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        challenge.CandidateTestimonyFragmentIds.Clear();
        challenge.CandidateEvidenceIds.Clear();
        challenge.StartRequiredTestimonyFragmentIds.Clear();
        challenge.StartRequiredEvidenceIds.Clear();

        var validation = new CaseValidationService().ValidateFullLogic(gameCase);

        Assert.True(validation.IsValid, Format(validation));
    }

    [Theory]
    [InlineData(AiFailurePhases.VisualQa, true)]
    [InlineData(AiFailurePhases.SceneLayout, true)]
    [InlineData(AiFailurePhases.FinalAssets, true)]
    [InlineData(AiFailurePhases.FullLogicJson, false)]
    [InlineData(AiFailurePhases.V3SemanticReview, false)]
    public void FailurePhaseClassification_KeepsAssetIdsOnlyForAssetFailures(string phase, bool expected)
    {
        Assert.Equal(expected, AiCaseService.IsAssetFailurePhase(phase));
    }

    [Fact]
    public void DynamicMatrixRejectsInvalidReadinessAndCasePairBudget()
    {
        var gameCase = CreateAdditiveProfileCase(AiGenerationPresets.NormalRandom, 2);
        foreach (var challenge in gameCase.EvidenceChallenges)
            ResizeChallenge(gameCase, challenge, 3, 6);
        var first = gameCase.EvidenceChallenges[0];
        first.StartRequiredEvidenceIds = ["evidence-does-not-exist"];
        first.StartRequiredTestimonyFragmentIds = [first.CandidateTestimonyFragmentIds[1]];

        var validation = AiV3GenerationProfile.Validate(gameCase);

        Assert.Contains(validation.Errors, error => error.Message.Contains("30", StringComparison.Ordinal));
        Assert.Contains(validation.Errors, error => error.Path.EndsWith("startRequiredEvidenceIds", StringComparison.Ordinal));
        Assert.Contains(validation.Errors, error => error.Path.EndsWith("startRequiredTestimonyFragmentIds", StringComparison.Ordinal));
    }

    [Fact]
    public void PresetBudgetsExposeTheApprovedSemanticLimits()
    {
        Assert.Equal((1, 1, 2, 3, 12, 12), Summarize(CrackGenerationBudgets.For(AiGenerationPresets.ShortDemo)));
        Assert.Equal((1, 2, 3, 3, 18, 30), Summarize(CrackGenerationBudgets.For(AiGenerationPresets.NormalRandom)));
        Assert.Equal((2, 3, 3, 5, 24, 60), Summarize(CrackGenerationBudgets.For(AiGenerationPresets.FullFeature)));

        static (int, int, int, int, int, int) Summarize(CrackGenerationBudget budget) =>
            (budget.MinCracks, budget.MaxCracks, budget.TargetTestimonies, budget.TargetEvidence,
                budget.MaxPairsPerCrack, budget.MaxPairsPerCase);
    }

    [Fact]
    public void SemanticReviewBatchesNeverSplitACrackAndDetectIncompleteCartesianOutput()
    {
        var gameCase = CreateAdditiveProfileCase(AiGenerationPresets.FullFeature, 3);
        ResizeChallenge(gameCase, gameCase.EvidenceChallenges[0], 4, 6);
        var batches = AiCaseService.BuildSemanticReviewBatches(gameCase);

        Assert.Equal(2, batches.Count);
        Assert.All(batches, batch => Assert.InRange(
            batch.Sum(challenge => challenge.CandidateEvidenceIds.Count * challenge.CandidateTestimonyFragmentIds.Count),
            1,
            24));
        Assert.Equal(gameCase.EvidenceChallenges.Count, batches.Sum(batch => batch.Count));

        var firstResult = JsonSerializer.Deserialize<GeneratedV3SemanticReview>(
            AiV3SemanticReviewPolicy.BuildMockResponse(gameCase, batches[0].Select(item => item.ChallengeId).ToArray()),
            JsonOptions)!;
        Assert.True(AiCaseService.SemanticBatchComplete(batches[0], firstResult));
        firstResult.Cracks[0].PairEvaluations.RemoveAt(0);
        Assert.False(AiCaseService.SemanticBatchComplete(batches[0], firstResult));
    }

    [Fact]
    public void BlueprintConformanceHashRejectsSemanticDriftInFullCase()
    {
        var settings = new AiDraftSettings
        {
            StageCount = 4,
            Difficulty = "medium",
            Language = CaseLanguages.English,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            GenerationPreset = AiGenerationPresets.NormalRandom,
            IncludeCrackTheLie = true
        };
        var draft = new AiCaseDraft { Id = ObjectId.GenerateNewId().ToString(), Settings = settings };
        var blueprint = JsonSerializer.Deserialize<AiCaseBlueprint>(AiCaseMockFactory.BuildMockBlueprintJson(draft), JsonOptions)!;
        var gameCase = AiCaseMockFactory.CreateMockAdditiveV3GeneratedLogic(settings).ToGameCase(settings);

        var blueprintValidation = AiCaseBlueprintPolicy.Validate(blueprint, settings);
        var conformance = AiCaseBlueprintPolicy.ValidateConformance(blueprint, gameCase);
        Assert.True(blueprintValidation.IsValid, Format(blueprintValidation));
        Assert.True(conformance.IsValid, Format(conformance));

        gameCase.EvidenceChallenges[0].SuccessResponse += " Semantic drift.";

        Assert.Contains(AiCaseBlueprintPolicy.ValidateConformance(blueprint, gameCase).Errors,
            error => error.Message.Contains("contract", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void BlueprintValidationRejectsDescriptiveSourceTypeInsteadOfRuntimeTopology()
    {
        var settings = new AiDraftSettings
        {
            StageCount = 4,
            Difficulty = "medium",
            Language = CaseLanguages.English,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            GenerationPreset = AiGenerationPresets.NormalRandom,
            IncludeCrackTheLie = true
        };
        var draft = new AiCaseDraft { Id = ObjectId.GenerateNewId().ToString(), Settings = settings };
        var blueprint = JsonSerializer.Deserialize<AiCaseBlueprint>(AiCaseMockFactory.BuildMockBlueprintJson(draft), JsonOptions)!;
        var cameraEvidence = blueprint.Cracks.SelectMany(crack => crack.Evidences)
            .First(evidence => evidence.AcquisitionMethod == EvidenceAcquisitionMethods.CameraCapture);
        cameraEvidence.SourceType = "CHARACTER_WORN_ITEM";
        cameraEvidence.SourceId = "item-worn-key-ribbon";

        var validation = AiCaseBlueprintPolicy.Validate(blueprint, settings);
        var canonical = AiCaseBlueprintPolicy.CanonicalizeForFullGeneration(blueprint);
        var canonicalEvidence = canonical.Cracks.SelectMany(crack => crack.Evidences)
            .Single(evidence => evidence.ClueId == cameraEvidence.ClueId);

        Assert.Contains(validation.Errors,
            error => error.Code == "BlueprintSourceTopology" && error.Path.EndsWith(".sourceType"));
        Assert.Contains(validation.Errors,
            error => error.Code == "BlueprintSourceTopology" && error.Path.EndsWith(".sourceId"));
        Assert.Equal("camera", canonicalEvidence.SourceType);
        Assert.Equal(canonicalEvidence.SceneId, canonicalEvidence.SourceId);
    }

    [Fact]
    public void BlueprintValidationRejectsShortDialogueAndMissingSignatureCameraBeforeFullGeneration()
    {
        var settings = new AiDraftSettings
        {
            StageCount = 4,
            Difficulty = "medium",
            Language = CaseLanguages.English,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            GenerationPreset = AiGenerationPresets.ShortDemo,
            IncludeCrackTheLie = true
        };
        var draft = new AiCaseDraft { Id = ObjectId.GenerateNewId().ToString(), Settings = settings };
        var blueprint = JsonSerializer.Deserialize<AiCaseBlueprint>(AiCaseMockFactory.BuildMockBlueprintJson(draft), JsonOptions)!;
        var signature = blueprint.Cracks.Single(crack => crack.IsSignature);
        signature.DialogueAnswer = "This answer is intentionally too short for a playable Crack source dialogue.";
        foreach (var (evidence, index) in signature.Evidences.Select((value, index) => (value, index)))
        {
            evidence.AcquisitionMethod = EvidenceAcquisitionMethods.ItemInspect;
            evidence.SourceType = "item";
            evidence.SourceId = $"item-repaired-{index + 1}";
        }

        var validation = AiCaseBlueprintPolicy.Validate(blueprint, settings);
        var prompt = AiCaseBlueprintPolicy.BuildPrompt(draft);

        Assert.Contains(validation.Errors,
            error => error.Path.EndsWith(".dialogueAnswer")
                     && error.Message.Contains("45-100", StringComparison.Ordinal));
        Assert.Contains(validation.Errors,
            error => error.Path.EndsWith(".isSignature")
                     && error.Message.Contains("CAMERA_CAPTURE", StringComparison.Ordinal));
        Assert.Contains(validation.Errors,
            error => error.Path == "blueprint.cracks"
                     && error.Message.Contains("camera-containing", StringComparison.Ordinal));
        Assert.Contains(validation.Errors,
            error => error.Path.EndsWith(".evidences")
                     && error.Message.Contains("two distinct", StringComparison.Ordinal));
        Assert.Contains("45-100 whitespace-delimited words", prompt, StringComparison.Ordinal);
        Assert.Contains("signature Crack must contain a CAMERA_CAPTURE", prompt, StringComparison.Ordinal);
        Assert.Contains("at least two distinct acquisitionMethod", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void LockedCrackContractRestoresFullGeneratorDriftBeforeHashValidation()
    {
        var settings = new AiDraftSettings
        {
            StageCount = 4,
            Difficulty = "medium",
            Language = CaseLanguages.English,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            GenerationPreset = AiGenerationPresets.NormalRandom,
            IncludeCrackTheLie = true
        };
        var draft = new AiCaseDraft { Id = ObjectId.GenerateNewId().ToString(), Settings = settings };
        var blueprint = JsonSerializer.Deserialize<AiCaseBlueprint>(AiCaseMockFactory.BuildMockBlueprintJson(draft), JsonOptions)!;
        var gameCase = AiCaseMockFactory.CreateMockAdditiveV3GeneratedLogic(settings).ToGameCase(settings);
        var expectedCrack = blueprint.Cracks[0];
        var challenge = gameCase.EvidenceChallenges.Single(item => item.ChallengeId == expectedCrack.ChallengeId);
        var dialogue = gameCase.Dialogues.Single(item => item.DialogueId == expectedCrack.DialogueId);
        var expectedEvidence = expectedCrack.Evidences[0];
        var clue = gameCase.Clues.Single(item => item.ClueId == expectedEvidence.ClueId);
        var reveal = gameCase.Clues.Single(item => item.ClueId == expectedCrack.RevealClueId);

        dialogue.Answer = $"Added generator prefix. {dialogue.Answer} Added generator suffix.";
        challenge.SuccessResponse = "Changed by full generation.";
        clue.Title = "Changed title";
        clue.SourceType = "CHARACTER_ITEM";
        clue.DiscoverMethod = "CHARACTER_ITEM";
        clue.Source = "wrong-source";
        clue.IsEvidence = false;
        reveal.SourceType = "CRACK_REVEAL";
        reveal.DiscoverMethod = "CRACK_REVEAL";
        reveal.Source = "wrong-dialogue";

        Assert.False(AiCaseBlueprintPolicy.ValidateConformance(blueprint, gameCase).IsValid);

        AiCaseBlueprintPolicy.ApplyLockedCrackContract(blueprint, gameCase);

        var canonicalBlueprint = AiCaseBlueprintPolicy.CanonicalizeForFullGeneration(blueprint);
        var canonicalEvidence = canonicalBlueprint.Cracks[0].Evidences[0];
        Assert.Equal(expectedCrack.DialogueAnswer, dialogue.Answer);
        Assert.Equal(expectedCrack.SuccessResponse, challenge.SuccessResponse);
        Assert.Equal(canonicalEvidence.Title, clue.Title);
        Assert.Equal(canonicalEvidence.SourceType, clue.SourceType);
        Assert.Equal(canonicalEvidence.SourceType, clue.DiscoverMethod);
        Assert.Equal(canonicalEvidence.SourceId, clue.Source);
        Assert.True(clue.IsEvidence);
        Assert.Equal("dialogue", reveal.SourceType);
        Assert.Equal("dialogue", reveal.DiscoverMethod);
        Assert.Equal(expectedCrack.DialogueId, reveal.Source);
        Assert.True(AiCaseBlueprintPolicy.ValidateConformance(blueprint, gameCase).IsValid);
    }

    [Fact]
    public void CandidateListsAndReviewMetadataRoundTripThroughBson()
    {
        var gameCase = CreateCanonicalCase();
        gameCase.Id = ObjectId.GenerateNewId().ToString();
        gameCase.SourceAiDraftId = ObjectId.GenerateNewId().ToString();
        gameCase.AiSemanticReviewStatus = AiV3SemanticReviewStatuses.Passed;

        var restored = BsonSerializer.Deserialize<GameCase>(gameCase.ToBson());

        Assert.Equal(3, Assert.Single(restored.EvidenceChallenges).CandidateEvidenceIds.Count);
        Assert.Equal(3, Assert.Single(restored.EvidenceChallenges).CandidateTestimonyFragmentIds.Count);
        Assert.Equal(gameCase.GenerationPreset, restored.GenerationPreset);
        Assert.Equal(gameCase.SourceAiDraftId, restored.SourceAiDraftId);
        Assert.Equal(AiV3SemanticReviewStatuses.Passed, restored.AiSemanticReviewStatus);
    }

    [Fact]
    public void LegacyDocumentsWithoutV3FieldsKeepSafeDefaults()
    {
        var challenge = BsonSerializer.Deserialize<EvidenceChallenge>(new BsonDocument
        {
            ["ChallengeId"] = "legacy-challenge",
            ["DialogueId"] = "legacy-dialogue",
            ["TestimonyFragmentId"] = "legacy-fragment",
            ["CorrectEvidenceId"] = "legacy-evidence"
        });
        var settings = BsonSerializer.Deserialize<AiDraftSettings>(new BsonDocument
        {
            ["StageCount"] = 4,
            ["GenerationPreset"] = AiGenerationPresets.NormalRandom
        });

        Assert.Empty(challenge.CandidateEvidenceIds);
        Assert.Empty(challenge.CandidateTestimonyFragmentIds);
        Assert.Equal(CaseMechanicsVersions.InvestigationV2, settings.MechanicsVersion);
    }

    [Fact]
    public void DryRunMockUsesTheRealStrictContractAndSemanticReviewPipeline()
    {
        var draft = new AiCaseDraft
        {
            Id = ObjectId.GenerateNewId().ToString(),
            Settings = CreateSettings()
        };
        var generated = AiCaseMockFactory.CreateMockV3GeneratedLogic();
        var providerJson = JsonSerializer.Serialize(generated, JsonOptions);
        var parsed = JsonSerializer.Deserialize<GeneratedCaseLogic>(providerJson, JsonOptions)
            ?? throw new InvalidOperationException("The V3 dry-run mock did not deserialize.");
        var gameCase = parsed.ToGameCase(draft.Settings);
        AiV3GenerationProfile.ApplyServerOwnedFields(draft, gameCase);
        AiV3GenerationProfile.NormalizePresentation(gameCase);

        var fullLogic = new CaseValidationService().ValidateFullLogic(gameCase);
        fullLogic.Errors.AddRange(AiGenerationContract.For(AiGenerationPresets.CrackTheLieV3, 1)
            .Validate(gameCase, draft.Settings).Errors);
        var mockReview = JsonSerializer.Deserialize<GeneratedV3SemanticReview>(
            AiV3SemanticReviewPolicy.BuildMockResponse(gameCase), JsonOptions)
            ?? throw new InvalidOperationException("The V3 dry-run review did not deserialize.");
        var evaluated = AiV3GenerationProfile.EvaluateReview(gameCase, new AiV3SemanticReview
        {
            PairEvaluations = mockReview.PairEvaluations
        });

        Assert.True(fullLogic.IsValid, Format(fullLogic));
        Assert.Equal(AiV3SemanticReviewStatuses.Passed, evaluated.Status);
        Assert.Equal(9, evaluated.PairEvaluations.Count);
        Assert.DoesNotContain("backgroundUrl", AiStrictSchemaProvider
            .CaseLogicSchema(CaseMechanicsVersions.InvestigationV3PairedConfrontation).ToJsonString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(AiGenerationPresets.ShortDemo, 2)]
    [InlineData(AiGenerationPresets.NormalRandom, 4)]
    [InlineData(AiGenerationPresets.PuzzleHeavy, 5)]
    [InlineData(AiGenerationPresets.DialogueHeavy, 5)]
    [InlineData(AiGenerationPresets.FullFeature, 6)]
    public void AdditiveDryRunMock_UsesTheSelectedV2PresetAndPassesTheRealPipeline(
        string preset,
        int stageCount)
    {
        var settings = new AiDraftSettings
        {
            StageCount = stageCount,
            Difficulty = "medium",
            Language = CaseLanguages.English,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            GenerationPreset = preset,
            IncludeCrackTheLie = true
        };
        var draft = new AiCaseDraft { Id = ObjectId.GenerateNewId().ToString(), Settings = settings };
        var gameCase = AiCaseMockFactory.CreateMockAdditiveV3GeneratedLogic(settings).ToGameCase(settings);
        AiV3GenerationProfile.ApplyServerOwnedFields(draft, gameCase);
        AiV3GenerationProfile.NormalizePresentation(gameCase);

        var validation = new CaseValidationService().ValidateFullLogic(gameCase);
        validation.Errors.AddRange(AiGenerationContract.For(settings).Validate(gameCase, settings).Errors);

        Assert.True(validation.IsValid, Format(validation));
        Assert.Equal(preset, gameCase.GenerationPreset);
        Assert.Equal(stageCount, gameCase.Stages.Count);
    }

    [Fact]
    public void ServerOwnershipRemovesProviderRuntimeAndAssetUrls()
    {
        var draft = new AiCaseDraft { Id = ObjectId.GenerateNewId().ToString(), Settings = CreateSettings() };
        var gameCase = CreateCanonicalCase();
        gameCase.CoverImageUrl = "https://provider.invalid/cover.png";
        var scene = Assert.Single(Assert.Single(gameCase.Stages).Scenes);
        scene.BackgroundUrl = "https://provider.invalid/background.png";
        scene.PlacementPlan = new ScenePlacementPlan();
        scene.Runtime = new SceneRuntime();
        gameCase.Characters[0].ImageUrl = "https://provider.invalid/npc.png";
        gameCase.Items[0].ImageUrl = "https://provider.invalid/item.png";

        AiV3GenerationProfile.ApplyServerOwnedFields(draft, gameCase, resetGeneratedAssets: true);

        Assert.Empty(gameCase.CoverImageUrl);
        Assert.Empty(scene.BackgroundUrl);
        Assert.Null(scene.PlacementPlan);
        Assert.Null(scene.Runtime);
        Assert.All(gameCase.Characters, character => Assert.Empty(character.ImageUrl));
        Assert.All(gameCase.Items, item => Assert.Empty(item.ImageUrl));
        Assert.Equal(AiGenerationPresets.CrackTheLieV3, gameCase.GenerationPreset);
        Assert.Equal(draft.Id, gameCase.SourceAiDraftId);
    }

    [Fact]
    public void CaseSummaryCarriesTheV3AdminGateMetadataWithoutSourceId()
    {
        var gameCase = CreateCanonicalCase();
        gameCase.SourceAiDraftId = ObjectId.GenerateNewId().ToString();
        gameCase.AiSemanticReviewStatus = AiV3SemanticReviewStatuses.Passed;

        var summary = CaseSummaryResponse.From(gameCase);
        var json = JsonSerializer.Serialize(summary, JsonOptions);

        Assert.Equal(3, summary.MechanicsVersion);
        Assert.Equal(CaseGenerationModes.PlacementFirst, summary.GenerationMode);
        Assert.Equal(AiGenerationPresets.CrackTheLieV3, summary.GenerationPreset);
        Assert.Equal(AiV3SemanticReviewStatuses.Passed, summary.AiSemanticReviewStatus);
        Assert.True(summary.HasSourceAiDraft);
        Assert.DoesNotContain(gameCase.SourceAiDraftId, json, StringComparison.Ordinal);
    }

    private static AiV3SemanticReview CreateReview(GameCase gameCase)
    {
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        return new AiV3SemanticReview
        {
            PairEvaluations = challenge.CandidateEvidenceIds.SelectMany(evidenceId =>
                challenge.CandidateTestimonyFragmentIds.Select(fragmentId => new AiV3PairEvaluation
                {
                    EvidenceId = evidenceId,
                    TestimonyFragmentId = fragmentId,
                    IsValidContradiction = evidenceId == challenge.CorrectEvidenceId
                        && fragmentId == challenge.TestimonyFragmentId,
                    Reason = "Independent matrix evaluation.",
                    Confidence = 0.90
                })).ToList()
        };
    }

    private static void ResizeChallenge(
        GameCase gameCase,
        EvidenceChallenge challenge,
        int testimonyCount,
        int evidenceCount)
    {
        var dialogue = gameCase.Dialogues.Single(item => item.DialogueId == challenge.DialogueId);
        var fragments = gameCase.TestimonyFragments
            .Where(item => item.DialogueId == challenge.DialogueId)
            .ToList();
        while (fragments.Count < testimonyCount)
        {
            var index = fragments.Count + 1;
            var text = $"Optional claim {index} remained literally compatible with every physical trace.";
            var fragment = new TestimonyFragment
            {
                Id = $"{challenge.ChallengeId}-fragment-{index}",
                DialogueId = dialogue.DialogueId,
                Text = text
            };
            fragments.Add(fragment);
            gameCase.TestimonyFragments.Add(fragment);
            dialogue.Answer += $" {text}";
        }

        var evidences = gameCase.Clues.Where(clue => clue.IsEvidence).ToList();
        while (evidences.Count < evidenceCount)
        {
            var source = evidences[0];
            var index = evidences.Count + 1;
            var evidence = new CaseClue
            {
                ClueId = $"{challenge.ChallengeId}-optional-evidence-{index}",
                Title = $"Optional evidence {index}",
                Content = $"Optional evidence {index} remains compatible with every distractor claim.",
                NarrativeMeaning = $"Optional evidence {index} provides a distinct but non-contradictory observation.",
                AcquisitionMethod = source.AcquisitionMethod,
                SourceType = source.SourceType,
                DiscoverMethod = source.DiscoverMethod,
                Source = source.Source,
                SceneId = source.SceneId,
                IsEvidence = true,
                VisualDescription = source.VisualDescription,
                VisualTextPolicy = source.VisualTextPolicy,
                InventoryDescription = source.InventoryDescription,
                HintLevel = source.HintLevel,
                Tags = source.Tags.ToList(),
                RelatedCharacterIds = source.RelatedCharacterIds.ToList()
            };
            evidences.Add(evidence);
            gameCase.Clues.Add(evidence);
        }

        challenge.CandidateTestimonyFragmentIds = fragments.Take(testimonyCount).Select(item => item.Id).ToList();
        challenge.TestimonyFragmentId = challenge.CandidateTestimonyFragmentIds[0];
        challenge.CandidateEvidenceIds = evidences
            .Select(clue => clue.ClueId)
            .Take(evidenceCount)
            .ToList();
        challenge.CorrectEvidenceId = challenge.CandidateEvidenceIds[0];
        challenge.StartRequiredTestimonyFragmentIds = challenge.CandidateTestimonyFragmentIds.Take(2).ToList();
        challenge.StartRequiredEvidenceIds = challenge.CandidateEvidenceIds.Take(2).ToList();
    }

    private static GameCase CreateCanonicalCase()
    {
        var settings = CreateSettings();
        var gameCase = AiCaseMockFactory.CreateMockV3GeneratedLogic().ToGameCase(settings);
        var draft = new AiCaseDraft { Id = ObjectId.GenerateNewId().ToString(), Settings = settings };
        AiV3GenerationProfile.ApplyServerOwnedFields(draft, gameCase);
        AiV3GenerationProfile.NormalizePresentation(gameCase);
        return gameCase;
    }

    private static GameCase CreateAdditiveProfileCase(string preset, int crackCount)
    {
        const string sceneId = "scene-additive-v3";
        var gameCase = new GameCase
        {
            CaseId = "case-additive-v3",
            Title = "Additive V3 contract case",
            Summary = "A deterministic profile fixture.",
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            GenerationPreset = preset
        };
        var scene = new CaseScene { SceneId = sceneId, Title = "Archive", Description = "An archive." };
        gameCase.Stages.Add(new CaseStage { StageId = "stage-additive-v3", Title = "Archive", Order = 1, Scenes = { scene } });

        void AddCamera(string suffix)
        {
            gameCase.Clues.Add(new CaseClue
            {
                ClueId = $"evidence-camera-{suffix}",
                Title = $"Camera trace {suffix}",
                Content = "A scene-scale physical trace.",
                IsEvidence = true,
                Source = sceneId,
                SourceType = "camera",
                DiscoverMethod = "camera",
                AcquisitionMethod = EvidenceAcquisitionMethods.CameraCapture,
                SceneId = sceneId
            });
        }
        void AddPuzzle(string suffix)
        {
            var clueId = $"evidence-puzzle-{suffix}";
            var puzzleId = $"puzzle-{suffix}";
            gameCase.Clues.Add(new CaseClue
            {
                ClueId = clueId,
                Title = $"Puzzle trace {suffix}",
                Content = "A bounded mechanism reveals a physical trace.",
                IsEvidence = true,
                Source = puzzleId,
                SourceType = "puzzle",
                DiscoverMethod = "puzzle",
                AcquisitionMethod = EvidenceAcquisitionMethods.PuzzleResult,
                SceneId = sceneId
            });
            gameCase.Puzzles.Add(new CasePuzzle { PuzzleId = puzzleId, UnlockClueIds = { clueId } });
        }
        void AddEnvironment(string suffix)
        {
            var clueId = $"evidence-environment-{suffix}";
            var interactionId = $"interaction-environment-{suffix}";
            gameCase.Clues.Add(new CaseClue
            {
                ClueId = clueId,
                Title = $"Environment trace {suffix}",
                Content = "An inspected surface reveals a physical trace.",
                IsEvidence = true,
                Source = interactionId,
                SourceType = "interaction",
                DiscoverMethod = "interaction",
                AcquisitionMethod = EvidenceAcquisitionMethods.EnvironmentInteraction,
                SceneId = sceneId
            });
            gameCase.Interactions.Add(new CaseInteraction
            {
                InteractionId = interactionId,
                Type = CaseInteractionTypes.InspectEnvironment,
                TargetId = interactionId,
                UnlockClueIds = { clueId }
            });
            scene.Hotspots.Add(new SceneHotspot
            {
                HotspotId = $"hotspot-environment-{suffix}",
                Type = "ENVIRONMENT",
                TargetId = interactionId,
                X = 40,
                Y = 50,
                Width = 8,
                Height = 8
            });
        }
        void AddItem(string suffix)
        {
            var clueId = $"evidence-item-{suffix}";
            var itemId = $"item-{suffix}";
            gameCase.Items.Add(new CaseItem { ItemId = itemId, Name = $"Item {suffix}", UnlockClueIds = { clueId } });
            scene.ItemIds.Add(itemId);
            gameCase.Clues.Add(new CaseClue
            {
                ClueId = clueId,
                Title = $"Item trace {suffix}",
                Content = "Inspecting the object reveals a physical trace.",
                IsEvidence = true,
                Source = itemId,
                SourceType = "item",
                DiscoverMethod = "item",
                AcquisitionMethod = EvidenceAcquisitionMethods.ItemInspect,
                SceneId = sceneId
            });
        }

        AddCamera("a");
        AddCamera("b");
        AddPuzzle("a");
        AddPuzzle("b");
        AddEnvironment("a");
        AddEnvironment("b");
        AddItem("a");
        AddItem("b");

        var cameraCracks = crackCount >= 4 ? 2 : 1;
        for (var index = 0; index < crackCount; index++)
        {
            var dialogueId = $"dialogue-crack-{index + 1}";
            var fragments = new[]
            {
                new TestimonyFragment { Id = $"fragment-{index + 1}-a", DialogueId = dialogueId, Text = "I remained beside the archive window throughout the final inspection." },
                new TestimonyFragment { Id = $"fragment-{index + 1}-b", DialogueId = dialogueId, Text = "I never carried a sealed package through the eastern passage." },
                new TestimonyFragment { Id = $"fragment-{index + 1}-c", DialogueId = dialogueId, Text = "The brass cabinet stayed untouched until the night guard arrived." }
            };
            gameCase.TestimonyFragments.AddRange(fragments);
            gameCase.Dialogues.Add(new CaseDialogue
            {
                DialogueId = dialogueId,
                Answer = "I remained beside the archive window throughout the final inspection. "
                    + "I never carried a sealed package through the eastern passage. "
                    + "The brass cabinet stayed untouched until the night guard arrived. "
                    + "Before midnight I checked every latch twice and recorded nothing unusual near the storage desk. "
                    + "No visitor spoke to me after the final bell rang in the empty corridor."
            });
            var candidates = index < cameraCracks
                ? new List<string>
                {
                    $"evidence-camera-{(index == 0 ? "a" : "b")}",
                    $"evidence-puzzle-{(index % 2 == 0 ? "a" : "b")}",
                    $"evidence-environment-{(index % 2 == 0 ? "a" : "b")}"
                }
                : new List<string>
                {
                    $"evidence-puzzle-{(index % 2 == 0 ? "a" : "b")}",
                    $"evidence-environment-{(index % 2 == 0 ? "a" : "b")}",
                    $"evidence-item-{(index % 2 == 0 ? "a" : "b")}"
                };
            var revealId = $"reveal-crack-{index + 1}";
            gameCase.Clues.Add(new CaseClue
            {
                ClueId = revealId,
                Title = $"Shared reveal {index + 1}",
                Content = "The contradiction establishes a new shared truth.",
                Source = dialogueId,
                SourceType = "dialogue",
                DiscoverMethod = "dialogue"
            });
            gameCase.EvidenceChallenges.Add(new EvidenceChallenge
            {
                ChallengeId = $"challenge-{index + 1}",
                DialogueId = dialogueId,
                Order = index + 1,
                IsSignature = index == 0,
                TestimonyFragmentId = fragments[0].Id,
                CandidateTestimonyFragmentIds = fragments.Select(fragment => fragment.Id).ToList(),
                CorrectEvidenceId = candidates[0],
                CandidateEvidenceIds = candidates,
                Prompt = "Which physical trace directly disproves this claim?",
                SuccessResponse = "The selected physical trace directly disproves the statement.",
                FailureResponse = "This pair does not directly disprove the selected claim.",
                RevealTitle = $"Crack {index + 1} resolved",
                UnlockClueIds = { revealId }
            });
        }

        return gameCase;
    }

    private static AiDraftSettings CreateSettings() => new()
    {
        StageCount = 1,
        Difficulty = "medium",
        Language = CaseLanguages.English,
        MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
        GenerationMode = CaseGenerationModes.PlacementFirst,
        GenerationPreset = AiGenerationPresets.CrackTheLieV3
    };

    private static string Format(SirLocked.Api.DTOs.Case.CaseValidationResult result) =>
        string.Join(Environment.NewLine, result.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}"));
}
