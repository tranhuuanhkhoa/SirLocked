using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public class AiRequestValidationTests
{
    [Fact]
    public void EmptyPrompt_IsAllowed()
    {
        var request = new GenerateAiCaseRequest
        {
            Prompt = string.Empty,
            StageCount = 4,
            Difficulty = "medium"
        };
        var results = new List<ValidationResult>();

        var valid = Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true);

        Assert.True(valid, string.Join(Environment.NewLine, results.Select(result => result.ErrorMessage)));
    }

    [Fact]
    public void VisualStyle_DefaultsToFixedSirLockedTheme()
    {
        var request = new GenerateAiCaseRequest();
        var settings = new AiDraftSettings();

        Assert.Equal(AiVisualStyleDefaults.PixelDetectiveTheme, request.VisualStyle);
        Assert.Equal(AiVisualStyleDefaults.PixelDetectiveTheme, settings.VisualStyle);
        Assert.Contains("pixel-art", AiVisualStyleDefaults.PixelArtContract, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void GenerationPreset_DefaultsAndNormalizes()
    {
        var request = new GenerateAiCaseRequest();
        var settings = new AiDraftSettings();

        Assert.Equal(AiGenerationPresets.NormalRandom, request.GenerationPreset);
        Assert.Equal(AiGenerationPresets.NormalRandom, settings.GenerationPreset);
        Assert.Equal(AiGenerationPresets.FullFeature, AiGenerationPresets.Normalize("full_feature"));
        Assert.Equal(AiGenerationPresets.CrackTheLieV3, AiGenerationPresets.Normalize("crack_the_lie_v3"));
        Assert.Equal(AiGenerationPresets.NormalRandom, AiGenerationPresets.Normalize("unknown"));
        Assert.Equal(CaseGenerationModes.CameraEmbedded, settings.GenerationMode);
    }

    [Theory]
    [InlineData("en", "en")]
    [InlineData("EN", "en")]
    [InlineData("vi", "vi")]
    [InlineData("VI", "vi")]
    [InlineData("unknown", "en")]
    [InlineData(null, "en")]
    public void Language_NormalizesWithEnglishFallback(string? input, string expected)
    {
        Assert.Equal(expected, CaseLanguages.Normalize(input));
    }

    [Fact]
    public void GenerateRequest_RejectsUnsupportedLanguage()
    {
        var request = new GenerateAiCaseRequest { Language = "fr" };
        var results = new List<ValidationResult>();

        var valid = Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true);

        Assert.False(valid);
        Assert.Contains(results, result => result.MemberNames.Contains(nameof(GenerateAiCaseRequest.Language)));
    }

    [Theory]
    [InlineData("RANDOM", "RANDOM")]
    [InlineData("murder", "MURDER")]
    [InlineData("missing_person", "MISSING_PERSON")]
    [InlineData("unknown", "RANDOM")]
    [InlineData(null, "RANDOM")]
    public void CaseType_NormalizesWithRandomFallback(string? input, string expected)
    {
        Assert.Equal(expected, AiCaseTypes.Normalize(input));
    }

    [Fact]
    public void GenerateRequest_RejectsUnsupportedCaseType()
    {
        var request = new GenerateAiCaseRequest { CaseType = "ALIEN_INVASION" };
        var results = new List<ValidationResult>();

        var valid = Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true);

        Assert.False(valid);
        Assert.Contains(results, result => result.MemberNames.Contains(nameof(GenerateAiCaseRequest.CaseType)));
    }

    [Fact]
    public void DiversityProfile_IsStableForSeedAndDistinctFromRecentStructure()
    {
        var first = AiStoryDiversityPolicy.Create(AiCaseTypes.Random, "draft-seed-001");
        var replay = AiStoryDiversityPolicy.Create(AiCaseTypes.Random, "draft-seed-001");
        var second = AiStoryDiversityPolicy.CreateDistinct(
            AiCaseTypes.Random,
            "draft-seed-002",
            [first]);

        Assert.Equal(first.CoreFingerprint, replay.CoreFingerprint);
        Assert.Equal(first.CaseType, replay.CaseType);
        Assert.Equal(64, first.CoreFingerprint.Length);
        Assert.True(
            AiStoryDiversityPolicy.StructuralSimilarity(first, second)
            < AiStoryDiversityPolicy.StructuralDuplicateThreshold);
    }

    [Fact]
    public void DuplicatePolicy_RecognizesRepeatedPremiseAndProducesPreviewFingerprint()
    {
        var existing = new AiStoryPreview
        {
            Title = "Bí Ẩn Chiếc Chuông Câm",
            Setting = "Nhà ga Blackglass",
            OpeningIncident = "Chiếc chuông vang lên sau giờ đóng cửa.",
            Summary = "Hai điều tra viên phải dựng lại mốc thời gian."
        };
        var repeated = new AiStoryPreview
        {
            Title = "BÍ ẨN CHIẾC CHUÔNG CÂM",
            Setting = "Một nhà ga khác",
            OpeningIncident = "Một sự cố khác.",
            Summary = "Một phần mô tả mới."
        };

        Assert.True(AiStoryDiversityPolicy.IsNearDuplicate(existing, repeated));
        Assert.Equal(64, AiStoryDiversityPolicy.ComputeFingerprint(existing).Length);
    }

    [Fact]
    public void StoryPreviewPrompt_ContainsLockedProfileAndStructuredHistory()
    {
        var request = new GenerateAiCaseRequest
        {
            CaseType = AiCaseTypes.Fraud,
            Language = "vi",
            GenerationPreset = AiGenerationPresets.ShortDemo
        };
        var profile = AiStoryDiversityPolicy.Create(request.CaseType, "draft-seed-current");
        var previousProfile = AiStoryDiversityPolicy.Create(AiCaseTypes.Theft, "draft-seed-previous");
        var history = new List<AiStoryHistoryEntry>
        {
            new()
            {
                Preview = new AiStoryPreview { Title = "The Silent Bell" },
                Diversity = previousProfile,
                StoryFingerprint = "old"
            }
        };

        var prompt = AiCaseService.BuildStoryPreviewPrompt(request, profile, history);

        Assert.Contains("Concrete case type: FRAUD", prompt, StringComparison.Ordinal);
        Assert.Contains("Diversity seed: draft-seed-current", prompt, StringComparison.Ordinal);
        Assert.Contains("The Silent Bell", prompt, StringComparison.Ordinal);
        Assert.Contains(previousProfile.MethodArchetype, prompt, StringComparison.Ordinal);
        Assert.Contains("Do not reuse or lightly reskin", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void DraftListResponse_ExposesDiversityIdentityWithoutSpoilerAxes()
    {
        var draft = new AiCaseDraft
        {
            StoryDiversity = new AiStoryDiversityProfile
            {
                Seed = "draft-seed",
                RequestedCaseType = AiCaseTypes.Random,
                CaseType = AiCaseTypes.Murder,
                CoreFingerprint = new string('a', 64),
                MotiveArchetype = "secret motive",
                MethodArchetype = "secret method",
                TwistArchetype = "secret twist"
            }
        };

        var response = AiDraftResponse.From(draft, includeJson: false);

        Assert.Equal(AiCaseTypes.Murder, response.StoryDiversity.CaseType);
        Assert.Equal("draft-seed", response.StoryDiversity.Seed);
        Assert.Empty(response.StoryDiversity.MotiveArchetype);
        Assert.Empty(response.StoryDiversity.MethodArchetype);
        Assert.Empty(response.StoryDiversity.TwistArchetype);
    }

    [Fact]
    public void GameCase_JsonUsesExactSnakeCasePixelProfile()
    {
        var json = JsonSerializer.Serialize(new GameCase(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        Assert.Equal("en", root.GetProperty("language").GetString());
        Assert.Equal("pixel_art", root.GetProperty("art_style").GetString());
        Assert.Equal("high_detail_pixel", root.GetProperty("sub_style").GetString());
        Assert.Equal("chibi", root.GetProperty("character_style").GetString());
        Assert.False(root.TryGetProperty("artStyle", out _));
        Assert.False(root.TryGetProperty("subStyle", out _));
        Assert.False(root.TryGetProperty("characterStyle", out _));
    }

    [Fact]
    public void CharacterPrompt_UsesUnifiedPixelChibiContract()
    {
        var prompt = AiCaseService.BuildCharacterMasterSpritePrompt(new CaseCharacter
        {
            CharacterId = "char-test",
            Name = "Test",
            Role = "Witness",
            VisualDescription = "A short middle-aged witness with silver hair and a navy coat."
        });

        Assert.Contains("pixel_art", prompt, StringComparison.Ordinal);
        Assert.Contains("high_detail_pixel", prompt, StringComparison.Ordinal);
        Assert.Contains("chibi", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("storybook", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("painterly", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SharedImagePrompt_ContainsExactPixelProfileWithoutLegacyKeywords()
    {
        var prompt = AiCaseService.FixedVisualStylePrompt;

        Assert.Contains("art_style=pixel_art", prompt, StringComparison.Ordinal);
        Assert.Contains("sub_style=high_detail_pixel", prompt, StringComparison.Ordinal);
        Assert.Contains("character_style=chibi", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("storybook", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("painterly", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void StrictCaseSchema_ExcludesServerOwnedRuntimeAndAssetFields()
    {
        var schema = AiStrictSchemaProvider.CaseLogicSchema();
        var json = schema.ToJsonString();

        Assert.False(schema["additionalProperties"]!.GetValue<bool>());
        Assert.DoesNotContain("coverImageUrl", json, StringComparison.Ordinal);
        Assert.DoesNotContain("backgroundUrl", json, StringComparison.Ordinal);
        Assert.DoesNotContain("imageUrl", json, StringComparison.Ordinal);
        Assert.DoesNotContain("placementPlan", json, StringComparison.Ordinal);
        Assert.DoesNotContain("runtime", json, StringComparison.Ordinal);
        Assert.Contains("visualDescription", json, StringComparison.Ordinal);
        Assert.Contains("visualTextPolicy", json, StringComparison.Ordinal);
    }

    [Fact]
    public void TruthAwareCaseSchema_LocksProjectionNamespacesWithoutChangingLegacySchema()
    {
        var draft = new AiCaseDraft
        {
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            Settings = new AiDraftSettings()
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(
            AiCaseMockFactory.BuildMockTruthPackageJson(draft),
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var schema = AiStrictSchemaProvider.CaseLogicSchema(
            CaseMechanicsVersions.InvestigationV2,
            truth);
        var properties = schema["properties"]!;
        var clue = properties["clues"]!["items"]!["properties"]!;
        var dialogue = properties["dialogues"]!["items"]!["properties"]!;
        var scene = properties["stages"]!["items"]!["properties"]!["scenes"]!
            ["items"]!["properties"]!;
        var finalLogic = properties["finalLogic"]!["properties"]!;
        var legacy = AiStrictSchemaProvider.CaseLogicSchema();
        var v3 = AiStrictSchemaProvider.CaseLogicSchema(
            CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            truth).ToJsonString();

        Assert.Equal(truth.CaseSeed.LocationIds.ToHashSet(StringComparer.Ordinal),
            EnumValues(scene["sceneId"]!));
        Assert.Equal(truth.CaseSeed.LocationIds.ToHashSet(StringComparer.Ordinal),
            EnumValues(clue["sceneId"]!));
        Assert.Equal(CaseTruthReferenceContract.TimelineEventIds(truth.TrueTimeline)
                .ToHashSet(StringComparer.Ordinal),
            EnumValues(clue["sourceActionId"]!));
        Assert.Equal(truth.ProofGraph.Conclusions.Select(item => item.ConclusionId)
                .ToHashSet(StringComparer.Ordinal),
            EnumValues(clue["supportsConclusionIds"]!["items"]!));
        Assert.Equal(1, clue["supportsConclusionIds"]!["minItems"]!.GetValue<int>());
        Assert.Equal(1, dialogue["statementIds"]!["minItems"]!.GetValue<int>());
        Assert.Equal(new[] { truth.CoreTruth.CulpritId }.ToHashSet(StringComparer.Ordinal),
            EnumValues(finalLogic["culpritId"]!));
        Assert.Equal(new[] { truth.CoreTruth.Motive }.ToHashSet(StringComparer.Ordinal),
            EnumValues(finalLogic["motive"]!));
        Assert.Equal(new[] { truth.CoreTruth.Method }.ToHashSet(StringComparer.Ordinal),
            EnumValues(finalLogic["method"]!));
        Assert.Null(legacy["properties"]!["clues"]!["items"]!["properties"]!["sceneId"]!["enum"]);
        Assert.Contains("testimonyFragments", v3, StringComparison.Ordinal);
        Assert.Contains("candidateTestimonyFragmentIds", v3, StringComparison.Ordinal);
    }

    [Fact]
    public void TruthStageSchemas_ConstrainCanonicalProofReferences()
    {
        var traceSchema = AiStrictSchemaProvider.TraceLedgerSchema();
        var traceLedger = traceSchema["properties"]!["traceLedger"]!;
        var traceReferences = traceLedger["items"]!["properties"]!["supportsConclusionIds"]!;
        var allowedTraceIds = traceReferences["items"]!["enum"]!.AsArray()
            .Select(item => item!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);

        var proofSchema = AiStrictSchemaProvider.ProofGraphSchema();
        var conclusions = proofSchema["properties"]!["proofGraph"]!["properties"]!["conclusions"]!;
        var conclusionProperties = conclusions["items"]!["properties"]!;
        var allowedConclusionIds = conclusionProperties["conclusionId"]!["enum"]!.AsArray()
            .Select(item => item!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);

        Assert.Equal(1, traceReferences["minItems"]!.GetValue<int>());
        Assert.Equal(2, traceReferences["maxItems"]!.GetValue<int>());
        Assert.Equal(CaseTruthScopeLimits.MaxTraceEntries, traceLedger["maxItems"]!.GetValue<int>());
        Assert.True(ProofConclusionIds.All.SetEquals(allowedTraceIds));
        Assert.Equal(ProofConclusionIds.ByCategory.Count, conclusions["minItems"]!.GetValue<int>());
        Assert.Equal(ProofConclusionIds.ByCategory.Count, conclusions["maxItems"]!.GetValue<int>());
        Assert.True(ProofConclusionIds.All.SetEquals(allowedConclusionIds));
    }

    [Fact]
    public void FeasibilityReviewV2Schema_LocksEnvelopeAndStructuredFindingCodes()
    {
        var schema = AiStrictSchemaProvider.CaseTruthFeasibilityReviewSchema();
        var properties = schema["properties"]!;
        var findingProperties = properties["findings"]!["items"]!["properties"]!;

        Assert.Equal(
            new[] { CaseTruthReviewStatuses.Passed, CaseTruthReviewStatuses.Failed, CaseTruthReviewStatuses.Ambiguous }
                .ToHashSet(StringComparer.Ordinal),
            EnumValues(properties["status"]!));
        Assert.Equal(
            new[] { CaseTruthSchemaVersions.FeasibilityReviewV2 }.ToHashSet(StringComparer.Ordinal),
            EnumValues(properties["schemaVersion"]!));
        Assert.Equal(0, properties["confidence"]!["minimum"]!.GetValue<int>());
        Assert.Equal(1, properties["confidence"]!["maximum"]!.GetValue<int>());
        Assert.Equal(0, properties["issues"]!["maxItems"]!.GetValue<int>());
        Assert.Equal(
            CaseTruthReviewFindingCodes.All,
            EnumValues(findingProperties["code"]!));
    }

    [Fact]
    public void BlindReviewV2Schema_UsesStructuredFindingsAndGameplayProjectionVersion()
    {
        var schema = AiStrictSchemaProvider.BlindSolvabilityReviewSchema();
        var properties = schema["properties"]!;

        Assert.Equal(
            new[] { CaseTruthSchemaVersions.BlindReviewV2 }.ToHashSet(StringComparer.Ordinal),
            EnumValues(properties["schemaVersion"]!));
        Assert.Equal(ProofConclusionCategories.All.Count,
            properties["evidenceChainIds"]!["minItems"]!.GetValue<int>());
        Assert.Equal(CaseTruthReviewFindingCodes.All,
            EnumValues(properties["findings"]!["items"]!["properties"]!["code"]!));
    }

    [Fact]
    public void TruthStageSchemas_LockEveryUpstreamReferenceNamespace()
    {
        var budget = AiTruthGenerationBudget.For(AiGenerationPresets.ShortDemo, 2);
        var suspects = new[] { "suspect-b", "suspect-a" };
        var actors = new[] { "suspect-a", "suspect-b", "target" };
        var locations = new[] { "location-a", "location-b" };
        var events = new[] { "action-core", "event-alibi" };
        var traces = new[] { "trace-a", "trace-b" };
        var statements = new[] { "statement-a", "statement-b" };

        var core = AiStrictSchemaProvider.CoreTruthSchema(budget, suspects);
        var coreProperties = core["properties"]!["coreTruth"]!["properties"]!;
        Assert.Equal(suspects.ToHashSet(StringComparer.Ordinal), EnumValues(coreProperties["culpritId"]!));
        Assert.Equal(1, coreProperties["crimeActionIds"]!["minItems"]!.GetValue<int>());
        Assert.Equal(budget.MaxTimelineEvents,
            coreProperties["crimeActionIds"]!["maxItems"]!.GetValue<int>());

        var timeline = AiStrictSchemaProvider.TrueTimelineSchema(budget, suspects, "target", locations);
        var timelineProperties = timeline["properties"]!["trueTimeline"]!["items"]!["properties"]!;
        Assert.Equal(actors.ToHashSet(StringComparer.Ordinal), EnumValues(timelineProperties["actorId"]!));
        Assert.Equal(actors.ToHashSet(StringComparer.Ordinal), EnumValues(timelineProperties["witnessIds"]!["items"]!));
        Assert.Equal(locations.ToHashSet(StringComparer.Ordinal), EnumValues(timelineProperties["locationId"]!));
        Assert.Equal(2, timelineProperties["traceIds"]!["maxItems"]!.GetValue<int>());
        Assert.Null(timelineProperties["eventId"]!["enum"]);

        var opportunity = AiStrictSchemaProvider.OpportunityMatrixSchema(budget, suspects, events);
        var opportunityProperties = opportunity["properties"]!["opportunityMatrix"]!["items"]!["properties"]!;
        Assert.Equal(suspects.ToHashSet(StringComparer.Ordinal), EnumValues(opportunityProperties["characterId"]!));
        Assert.Equal(events.ToHashSet(StringComparer.Ordinal), EnumValues(opportunityProperties["alibiEventIds"]!["items"]!));

        var trace = AiStrictSchemaProvider.TraceLedgerSchema(budget, events, traces);
        var traceLedger = trace["properties"]!["traceLedger"]!;
        var traceProperties = traceLedger["items"]!["properties"]!;
        Assert.Equal(traces.Length, traceLedger["minItems"]!.GetValue<int>());
        Assert.Equal(traces.Length, traceLedger["maxItems"]!.GetValue<int>());
        Assert.Equal(traces.ToHashSet(StringComparer.Ordinal), EnumValues(traceProperties["traceId"]!));
        Assert.Equal(events.ToHashSet(StringComparer.Ordinal), EnumValues(traceProperties["sourceActionId"]!));

        var statement = AiStrictSchemaProvider.StatementLedgerSchema(budget, actors, events, traces);
        var statementProperties = statement["properties"]!["statementLedger"]!["items"]!["properties"]!;
        Assert.Equal(actors.ToHashSet(StringComparer.Ordinal), EnumValues(statementProperties["speakerId"]!));
        Assert.Equal(events.ToHashSet(StringComparer.Ordinal), EnumValues(statementProperties["eventIds"]!["items"]!));
        Assert.Equal(1, statementProperties["knowledgeSourceIds"]!["minItems"]!.GetValue<int>());
        Assert.Equal(traces.ToHashSet(StringComparer.Ordinal), EnumValues(statementProperties["contradictedByTraceIds"]!["items"]!));

        var proof = AiStrictSchemaProvider.ProofGraphSchema(budget, suspects, traces, statements);
        var conclusionProperties = proof["properties"]!["proofGraph"]!["properties"]!["conclusions"]!
            ["items"]!["properties"]!;
        var redHerringProperties = proof["properties"]!["redHerringLedger"]!["items"]!["properties"]!;
        Assert.Equal(traces.ToHashSet(StringComparer.Ordinal), EnumValues(conclusionProperties["supportingTraceIds"]!["items"]!));
        Assert.Equal(statements.ToHashSet(StringComparer.Ordinal), EnumValues(conclusionProperties["supportingStatementIds"]!["items"]!));
        Assert.Equal(suspects.ToHashSet(StringComparer.Ordinal), EnumValues(conclusionProperties["excludesSuspectIds"]!["items"]!));
        Assert.Equal(suspects.ToHashSet(StringComparer.Ordinal), EnumValues(redHerringProperties["suspectId"]!));
        Assert.Equal(traces.ToHashSet(StringComparer.Ordinal), EnumValues(redHerringProperties["clearingTraceIds"]!["items"]!));
        Assert.Equal(statements.ToHashSet(StringComparer.Ordinal), EnumValues(redHerringProperties["clearingStatementIds"]!["items"]!));
    }

    [Fact]
    public void TruthStageSchemas_RejectEmptyMandatoryUpstreamEnums()
    {
        var budget = AiTruthGenerationBudget.For(AiGenerationPresets.ShortDemo, 2);

        Assert.Throws<ArgumentException>(() =>
            AiStrictSchemaProvider.TraceLedgerSchema(budget, new[] { "event-a" }, Array.Empty<string>()));
        Assert.Throws<ArgumentException>(() =>
            AiStrictSchemaProvider.OpportunityMatrixSchema(budget, new[] { "suspect-a" }, Array.Empty<string>()));
        Assert.Throws<ArgumentException>(() =>
            AiStrictSchemaProvider.ProofGraphSchema(budget, new[] { "suspect-a" }, new[] { "trace-a" }, Array.Empty<string>()));
    }

    [Fact]
    public void TruthEvidenceStage_HasExpandedBudgetAndOneBoundedIncompleteRetry()
    {
        var initial = AiCaseService.TruthStageMaxOutputTokens(AiGenerationSchemaVersions.TraceLedger);
        var retry = AiCaseService.TruthStageRetryMaxOutputTokens(AiGenerationSchemaVersions.TraceLedger);
        var retryPrompt = AiCaseService.BuildIncompleteTruthRetryPrompt("LOCKED INPUT", AiGenerationSchemaVersions.TraceLedger);

        Assert.Equal(18000, initial);
        Assert.True(retry > initial);
        Assert.True(retry <= 32000);
        Assert.Contains("max_output_tokens", retryPrompt, StringComparison.Ordinal);
        Assert.Contains("at most 24 words", retryPrompt, StringComparison.Ordinal);
        Assert.Contains("Return every required array entry exactly once", retryPrompt, StringComparison.Ordinal);
    }

    [Fact]
    public void TruthCheckpoint_ResumesAtTheNextArtifact()
    {
        Assert.Equal(CaseTruthArtifacts.Evidence,
            AiCaseService.NextTruthArtifact(CaseTruthArtifacts.Opportunity));
        Assert.Equal(CaseTruthArtifacts.Statements,
            AiCaseService.NextTruthArtifact(CaseTruthArtifacts.Evidence));
        Assert.Null(AiCaseService.NextTruthArtifact(CaseTruthArtifacts.ProofGraph));
        Assert.Null(AiCaseService.NextTruthArtifact(string.Empty));
    }

    [Fact]
    public void V3StrictSchemaAddsFragmentsAndCandidateListsWithoutChangingV2Schema()
    {
        var v2 = AiStrictSchemaProvider.CaseLogicSchema(CaseMechanicsVersions.InvestigationV2).ToJsonString();
        var v3 = AiStrictSchemaProvider.CaseLogicSchema(CaseMechanicsVersions.InvestigationV3PairedConfrontation).ToJsonString();

        Assert.DoesNotContain("testimonyFragments", v2, StringComparison.Ordinal);
        Assert.DoesNotContain("candidateEvidenceIds", v2, StringComparison.Ordinal);
        Assert.DoesNotContain("candidateTestimonyFragmentIds", v2, StringComparison.Ordinal);
        Assert.Contains("testimonyFragments", v3, StringComparison.Ordinal);
        Assert.Contains("candidateEvidenceIds", v3, StringComparison.Ordinal);
        Assert.Contains("candidateTestimonyFragmentIds", v3, StringComparison.Ordinal);
        Assert.DoesNotContain("mechanicsVersion", v3, StringComparison.Ordinal);
        Assert.DoesNotContain("generationPreset", v3, StringComparison.Ordinal);
        Assert.DoesNotContain("runtime", v3, StringComparison.Ordinal);
    }

    [Fact]
    public void V3GenerationContractIsFixedToOneCrackLoop()
    {
        var contract = AiGenerationContract.For(AiGenerationPresets.CrackTheLieV3, 6);

        Assert.Equal(1, contract.MinStages);
        Assert.Equal(1, contract.MaxStages);
        Assert.Equal(1, contract.MinScenes);
        Assert.Equal(1, contract.MaxScenes);
        Assert.Equal(4, contract.MinClues);
        Assert.Equal(4, contract.MaxClues);
        Assert.Equal(1, contract.EvidenceChallenges);
        Assert.Equal(0, contract.Deductions);
        Assert.Equal(0, contract.TeamworkChains);
        Assert.Equal(0, contract.MaxPuzzles);
        Assert.Equal(0, contract.MaxInteractions);
    }

    [Fact]
    public void V3PromptLocksTopologyAndDoesNotAskModelForServerOwnedFields()
    {
        var draft = new AiCaseDraft
        {
            Prompt = "A compact archive contradiction.",
            Settings = new AiDraftSettings
            {
                StageCount = 1,
                MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
                GenerationMode = CaseGenerationModes.PlacementFirst,
                GenerationPreset = AiGenerationPresets.CrackTheLieV3
            },
            StoryPreview = new AiStoryPreview { Title = "The Resealed Packet", Summary = "A clerk's account conflicts with a physical trace." }
        };

        var prompt = AiCaseService.BuildFullCasePrompt(draft, null, null);

        Assert.Contains("Exactly one stage containing exactly one scene", prompt, StringComparison.Ordinal);
        Assert.Contains("two CUTOUT evidence items", prompt, StringComparison.Ordinal);
        Assert.Contains("exactly one CAMERA_CAPTURE evidence", prompt, StringComparison.Ordinal);
        Assert.Contains("exactly two ITEM_INSPECT evidence", prompt, StringComparison.Ordinal);
        Assert.Contains("successful camera capture", prompt, StringComparison.Ordinal);
        Assert.Contains("Exactly one of the nine", prompt, StringComparison.Ordinal);
        Assert.Contains("subject-neutral", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Movement, ownership", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("silently audit all nine pairs", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Never output mechanicsVersion", prompt, StringComparison.Ordinal);
        Assert.Contains("candidateTestimonyFragmentIds", prompt, StringComparison.Ordinal);
        Assert.Contains("correct evidence may be camera- or item-acquired", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Preserve every visually observable story state", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("empty, missing, removed", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("asset-layer rule", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void V3SemanticReviewerPromptIsBlindToTheAuthoredAnswer()
    {
        var gameCase = AiCaseMockFactory.CreateMockV3GeneratedLogic().ToGameCase(new AiDraftSettings
        {
            StageCount = 1,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            GenerationMode = CaseGenerationModes.PlacementFirst,
            GenerationPreset = AiGenerationPresets.CrackTheLieV3
        });

        var prompt = AiV3SemanticReviewPolicy.BuildPrompt(gameCase);

        Assert.Contains("not told the authored answer", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("every Cartesian-product pair exactly once", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Entity alignment", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("object moved does NOT disprove", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("If either side still allows the testimony to be true", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("correctEvidenceId", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("authored correct", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ShortDemoContract_IsCompactAndInternallyConsistent()
    {
        var contract = AiGenerationContract.For(AiGenerationPresets.ShortDemo, 2);
        var prompt = contract.PromptRequirements();

        Assert.Equal(6, contract.MinClues);
        Assert.Equal(8, contract.MaxClues);
        Assert.Equal(2, contract.EvidenceChallenges);
        Assert.Equal(1, contract.MinPuzzles);
        Assert.Equal(1, contract.MaxPuzzles);
        Assert.Equal(1, contract.MinInteractions);
        Assert.Equal(1, contract.MaxInteractions);
        Assert.Contains("clues 6-8", prompt, StringComparison.Ordinal);
        Assert.Contains("puzzles 1-1", prompt, StringComparison.Ordinal);
        Assert.Contains("interactions 1-1", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("10-12", prompt, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(AiGenerationPresets.ShortDemo, 1, 1)]
    [InlineData(AiGenerationPresets.NormalRandom, 1, 2)]
    [InlineData(AiGenerationPresets.PuzzleHeavy, 1, 2)]
    [InlineData(AiGenerationPresets.DialogueHeavy, 1, 2)]
    [InlineData(AiGenerationPresets.FullFeature, 2, 3)]
    public void IncludeCrackTheLie_PreservesSelectedV2PresetAndAddsItsCrackBudget(
        string preset,
        int minimumCracks,
        int maximumCracks)
    {
        var baseContract = AiGenerationContract.For(preset, preset == AiGenerationPresets.FullFeature ? 6 : 4);
        var settings = new AiDraftSettings
        {
            GenerationPreset = preset,
            StageCount = baseContract.MinStages,
            IncludeCrackTheLie = true,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
        };

        var additive = AiGenerationContract.For(settings);

        Assert.Equal(baseContract.MinStages, additive.MinStages);
        Assert.Equal(baseContract.MaxStages, additive.MaxStages);
        Assert.Equal(baseContract.Deductions, additive.Deductions);
        Assert.Equal(baseContract.TeamworkChains, additive.TeamworkChains);
        Assert.Equal(minimumCracks, additive.EvidenceChallenges);
        Assert.Equal(maximumCracks, additive.MaxEvidenceChallenges);
    }

    [Theory]
    [InlineData(AiGenerationPresets.ShortDemo, 2, 2, 2, 2, 3, 4, 6, 8, 6, 8, 2, 1, 1)]
    [InlineData(AiGenerationPresets.NormalRandom, 4, 4, 4, 4, 6, 4, 8, 10, 8, 12, 2, 1, 1)]
    [InlineData(AiGenerationPresets.PuzzleHeavy, 5, 5, 6, 5, 6, 4, 9, 12, 6, 10, 2, 1, 1)]
    [InlineData(AiGenerationPresets.DialogueHeavy, 5, 5, 6, 5, 6, 5, 10, 12, 12, 16, 3, 2, 1)]
    [InlineData(AiGenerationPresets.FullFeature, 6, 6, 6, 6, 6, 5, 10, 12, 12, 16, 3, 2, 2)]
    public void GenerationContracts_MatchPresetBudgets(
        string preset, int requestedStages, int minStages, int maxStages, int minScenes, int maxScenes,
        int minCharacters, int minClues, int maxClues, int minDialogues, int maxDialogues,
        int challenges, int deductions, int chains)
    {
        var contract = AiGenerationContract.For(preset, requestedStages);

        Assert.Equal(minStages, contract.MinStages);
        Assert.Equal(maxStages, contract.MaxStages);
        Assert.Equal(minScenes, contract.MinScenes);
        Assert.Equal(maxScenes, contract.MaxScenes);
        Assert.Equal(minCharacters, contract.MinCharacters);
        Assert.Equal(minClues, contract.MinClues);
        Assert.Equal(maxClues, contract.MaxClues);
        Assert.Equal(minDialogues, contract.MinDialogues);
        Assert.Equal(maxDialogues, contract.MaxDialogues);
        Assert.Equal(challenges, contract.EvidenceChallenges);
        Assert.Equal(deductions, contract.Deductions);
        Assert.Equal(chains, contract.TeamworkChains);
    }

    [Fact]
    public void RepairPrompt_ContainsTheActualPreviousCheckpoint()
    {
        var draft = new AiCaseDraft
        {
            Prompt = "A station mystery",
            Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.ShortDemo, StageCount = 2 },
            StoryPreview = new AiStoryPreview { Title = "Last Bell", Summary = "A bell rings after closing." }
        };

        var prompt = AiCaseService.BuildFullCasePrompt(draft, "Fix missing references.", "{\"caseId\":\"case-checkpoint\"}");

        Assert.Contains("case-checkpoint", prompt, StringComparison.Ordinal);
        Assert.Contains("Fix missing references", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("10 to 12 clues", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"coverImageUrl\":", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("\"backgroundUrl\":", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("generationMode must", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("mechanicsVersion must", prompt, StringComparison.Ordinal);
        Assert.Contains("Glass Meridian v3 composition", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("naturally embedded camera clues", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Never use composition words", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("every visually observable story state", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("empty, missing, removed", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("zero camera clues", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackgroundPrompt_HasOneUnambiguousNoTextPolicy()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-platform",
            Title = "Main Platform",
            Description = "A rainy station platform.",
            VisualDescription = "Rainy Victorian platform with blank dark fixtures, brass lamps and wet stone."
        };
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.PlacementFirst,
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-leaked-detail",
                    SceneId = scene.SceneId,
                    SourceType = "camera",
                    DiscoverMethod = "camera",
                    VisualDescription = "Macro view of a brass keyway shown inside a framed close-up panel."
                }
            },
            Stages = { new CaseStage { StageId = "stage-1", Order = 1, Scenes = { scene } } }
        };

        var prompt = AiCaseService.BuildBackgroundImagePrompt(new AiCaseDraft(), gameCase, scene);

        Assert.DoesNotContain("Documents may use abstract", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("no readable words", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("colored selection boxes", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("EMPTY ROOM / PLACEMENT-FIRST", prompt, StringComparison.Ordinal);
        Assert.Contains("composited later", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Macro view of a brass keyway", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Embedded camera evidence", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CameraContract_RejectsCloseUpCompositionButKeepsCameraClue()
    {
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-camera",
                    SourceType = "camera",
                    DiscoverMethod = "camera",
                    SceneId = "scene-one",
                    VisualDescription = "Macro close-up photograph of a crescent scratch in a framed detail panel."
                }
            }
        };

        var result = AiGenerationContract.For(AiGenerationPresets.ShortDemo, 2)
            .Validate(gameCase, new AiDraftSettings
            {
                StageCount = 2,
                GenerationPreset = AiGenerationPresets.ShortDemo
            });

        Assert.Contains(result.Errors, error => error.Code == "CameraComposition" && error.RefId == "clue-camera");
        Assert.DoesNotContain(result.Errors, error => error.Code == "PlacementFirstCameraClue");
    }

    [Fact]
    public void CameraBackgroundPrompt_EmbedsEvidenceWithoutInsetPanelsOrNpcs()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-gallery",
            Title = "Meridian Gallery",
            Description = "A brass observatory gallery.",
            VisualDescription = "Wide brass observatory architecture with marble floor and open playable space."
        };
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            Stages = { new CaseStage { StageId = "stage-1", Scenes = { scene } } },
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-bolt",
                    SceneId = scene.SceneId,
                    Source = scene.SceneId,
                    SourceType = "camera",
                    DiscoverMethod = "camera",
                    VisualDescription = "A bright crescent gouge beneath the tarnished edge of the brass floor bolt."
                }
            }
        };

        var prompt = AiCaseService.BuildBackgroundImagePrompt(new AiCaseDraft(), gameCase, scene);

        Assert.Contains("bright crescent gouge", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ordinary scene-scale size", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("one continuous full-room composition", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not render NPCs or CUTOUT items", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Never enlarge a clue", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackgroundAndPlacementQaPrompts_ShareAuthoritativeEmptySceneState()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-empty-gallery",
            Title = "Phòng trưng bày",
            Description = "Tủ kính giữa phòng đã trống không, nhưng ổ khóa vẫn nguyên vẹn.",
            VisualDescription = "A timber exhibition hall with a central glass display enclosure and warm brass lanterns.",
            ItemIds = { "item-maintenance-dial" }
        };
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            Stages = { new CaseStage { StageId = "stage-1", Scenes = { scene } } },
            Items =
            {
                new CaseItem
                {
                    ItemId = "item-maintenance-dial",
                    VisualDescription = "A fixed brass three-ring maintenance dial beneath the display plinth.",
                    RenderMode = CaseItemRenderModes.Embedded,
                    InteractionPurpose = CaseItemInteractionPurposes.OperateMechanism,
                    IsCollectible = false
                }
            },
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-wheel-tracks",
                    SceneId = scene.SceneId,
                    Source = scene.SceneId,
                    SourceType = "camera",
                    DiscoverMethod = "camera",
                    VisualDescription = "Two oily wheel tracks cross the threshold over fresh silver firework ash."
                }
            }
        };

        var backgroundPrompt = AiCaseService.BuildBackgroundImagePrompt(new AiCaseDraft(), gameCase, scene);
        var qaPrompt = AiCaseService.BuildPlacementPlanPrompt(gameCase, scene, null, null);

        foreach (var prompt in new[] { backgroundPrompt, qaPrompt })
        {
            Assert.Contains("CANONICAL SCENE VISUAL CONTRACT", prompt, StringComparison.Ordinal);
            Assert.Contains(scene.Description, prompt, StringComparison.Ordinal);
            Assert.Contains(scene.VisualDescription, prompt, StringComparison.Ordinal);
            Assert.Contains("item-maintenance-dial", prompt, StringComparison.Ordinal);
            Assert.Contains("clue-wheel-tracks", prompt, StringComparison.Ordinal);
        }

        Assert.Contains("Never fill an explicitly empty", backgroundPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("invented object inside an explicitly empty", qaPrompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackgroundAndPlacementPrompts_ExplicitlyExcludeDeferredCutoutMentionedInStory()
    {
        const string redThreadName = "S\u1ee3i ch\u1ec9 \u0111\u1ecf";
        var scene = new CaseScene
        {
            SceneId = "scene-gallery",
            Title = "Silent Bell Gallery",
            Description = $"The locked glass display is visibly empty; {redThreadName} lies beside a rain puddle.",
            VisualDescription = "A dark stone gallery with an empty locked glass display, a rain puddle and a maintenance seam.",
            ItemIds = { "item-red-thread", "item-maintenance-seam" }
        };
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            Stages = { new CaseStage { StageId = "stage-1", Scenes = { scene } } },
            Items =
            {
                new CaseItem
                {
                    ItemId = "item-red-thread",
                    Name = redThreadName,
                    VisualDescription = "A short loop of wet scarlet thread marked with black cable grease.",
                    RenderMode = CaseItemRenderModes.Cutout
                },
                new CaseItem
                {
                    ItemId = "item-maintenance-seam",
                    Name = "Maintenance seam",
                    VisualDescription = "A narrow maintenance seam beneath the display plinth.",
                    RenderMode = CaseItemRenderModes.Embedded,
                    InteractionPurpose = CaseItemInteractionPurposes.OperateMechanism
                }
            },
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-empty-display-lock",
                    SceneId = scene.SceneId,
                    Source = scene.SceneId,
                    SourceType = "camera",
                    DiscoverMethod = "camera",
                    VisualDescription = "An intact brass lock centered on the visibly empty glass display."
                }
            }
        };

        var visualContract = AiCaseService.BuildSceneVisualContract(gameCase, scene);
        var backgroundPrompt = AiCaseService.BuildBackgroundImagePrompt(new AiCaseDraft(), gameCase, scene);
        var qaPrompt = AiCaseService.BuildPlacementPlanPrompt(gameCase, scene, null, null);

        var deferred = Assert.Single(visualContract.DeferredCutouts);
        Assert.Equal("item-red-thread", deferred.ItemId);
        Assert.Contains(scene.Description, backgroundPrompt, StringComparison.Ordinal);
        Assert.Contains("item-red-thread", backgroundPrompt, StringComparison.Ordinal);
        Assert.Contains(redThreadName, backgroundPrompt, StringComparison.Ordinal);
        Assert.Contains("MUST BE ABSENT", backgroundPrompt, StringComparison.Ordinal);
        Assert.Contains("leave its intended placement empty", backgroundPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("item-maintenance-seam", backgroundPrompt, StringComparison.Ordinal);
        Assert.Contains("clue-empty-display-lock", backgroundPrompt, StringComparison.Ordinal);
        Assert.Contains("item-red-thread", qaPrompt, StringComparison.Ordinal);
        Assert.Contains("every listed CUTOUT must still be absent", qaPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("unexpectedCutoutItemIds", qaPrompt, StringComparison.Ordinal);
    }

    [Fact]
    public void BackgroundQaRetry_UsesStructuredCorrectionsWithoutBooleanDump()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-empty-gallery",
            Title = "Phòng trưng bày",
            Description = "Tủ kính giữa phòng đã trống không.",
            VisualDescription = "A timber exhibition hall with a central glass display enclosure."
        };
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            Stages = { new CaseStage { StageId = "stage-1", Scenes = { scene } } }
        };
        const string qaJson = """
        {
          "backgroundQa": {
            "pixelArtMatch": true,
            "prohibitedTextFound": false,
            "prohibitedUiFound": false,
            "duplicateEmbeddedTargetFound": false,
            "unexpectedForegroundContentFound": false,
            "sceneMatch": false,
            "notes": "The central glass case contains a large rocket exhibit, but the case must be empty."
          }
        }
        """;

        var qaResult = AiCaseService.ParseBackgroundQa(qaJson);
        var retryPrompt = AiCaseService.BuildBackgroundRetryPrompt(new AiCaseDraft(), gameCase, scene, qaResult);

        Assert.False(qaResult.Passed);
        Assert.Contains("MANDATORY VISUAL QA CORRECTION", retryPrompt, StringComparison.Ordinal);
        Assert.Contains("large rocket exhibit", retryPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(scene.Description, retryPrompt, StringComparison.Ordinal);
        Assert.Contains("Do not fill any explicitly empty", retryPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("sceneMatch=False", retryPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("pixelArtMatch=True", retryPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("prohibitedTextFound=False", retryPrompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackgroundQaRetry_TargetsDetectedCutoutWithoutQaBooleanDump()
    {
        const string redThreadName = "S\u1ee3i ch\u1ec9 \u0111\u1ecf";
        var scene = new CaseScene
        {
            SceneId = "scene-gallery",
            Title = "Silent Bell Gallery",
            Description = $"The locked glass display is empty; {redThreadName} lies beside the puddle.",
            VisualDescription = "A dark stone gallery with an empty locked glass display and a rain puddle.",
            ItemIds = { "item-red-thread" }
        };
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            Stages = { new CaseStage { StageId = "stage-1", Scenes = { scene } } },
            Items =
            {
                new CaseItem
                {
                    ItemId = "item-red-thread",
                    Name = redThreadName,
                    VisualDescription = "A short loop of wet scarlet thread marked with black cable grease.",
                    RenderMode = CaseItemRenderModes.Cutout
                }
            }
        };
        const string qaJson = """
        {
          "backgroundQa": {
            "pixelArtMatch": true,
            "prohibitedTextFound": false,
            "prohibitedUiFound": false,
            "duplicateEmbeddedTargetFound": false,
            "unexpectedForegroundContentFound": true,
            "unexpectedCutoutItemIds": ["item-red-thread"],
            "sceneMatch": true,
            "notes": "The room geometry is otherwise correct, but the deferred item is baked into the background."
          }
        }
        """;

        var qaResult = AiCaseService.ParseBackgroundQa(qaJson);
        var retryPrompt = AiCaseService.BuildBackgroundRetryPrompt(new AiCaseDraft(), gameCase, scene, qaResult);

        Assert.False(qaResult.Passed);
        Assert.Equal(new[] { "item-red-thread" }, qaResult.UnexpectedCutoutItemIds);
        Assert.Contains("Remove deferred CUTOUT item-red-thread", retryPrompt, StringComparison.Ordinal);
        Assert.Contains(redThreadName, retryPrompt, StringComparison.Ordinal);
        Assert.Contains("leave that placement empty for runtime compositing", retryPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Apply the relevant QA correction", retryPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("pixelArtMatch=True", retryPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("prohibitedTextFound=False", retryPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Remove every readable", retryPrompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackgroundQaRetry_ForegroundWithoutIdsForbidsEveryDeferredCutout()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-gallery",
            Description = "A red thread lies beside the empty display.",
            VisualDescription = "A stone gallery with an empty display.",
            ItemIds = { "item-red-thread" }
        };
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            Stages = { new CaseStage { StageId = "stage-1", Scenes = { scene } } },
            Items =
            {
                new CaseItem
                {
                    ItemId = "item-red-thread",
                    Name = "Red thread",
                    VisualDescription = "A short loop of wet scarlet thread.",
                    RenderMode = CaseItemRenderModes.Cutout
                }
            }
        };
        const string legacyQaJson = """
        {
          "backgroundQa": {
            "pixelArtMatch": true,
            "prohibitedTextFound": false,
            "prohibitedUiFound": false,
            "duplicateEmbeddedTargetFound": false,
            "unexpectedForegroundContentFound": true,
            "sceneMatch": true,
            "notes": "A portable foreground prop is baked into the background."
          }
        }
        """;

        var qaResult = AiCaseService.ParseBackgroundQa(legacyQaJson);
        var retryPrompt = AiCaseService.BuildBackgroundRetryPrompt(new AiCaseDraft(), gameCase, scene, qaResult);

        Assert.Contains("Remove deferred CUTOUT item-red-thread", retryPrompt, StringComparison.Ordinal);
    }

    [Fact]
    public void BackgroundReuse_RequiresMatchingPromptHashAndQaMarker()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"sirlocked-background-reuse-{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        try
        {
            const string prompt = "Canonical safe background prompt";
            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(prompt))).ToLowerInvariant();
            var path = Path.Combine(folder, "scene.png");
            File.WriteAllBytes(path, [1, 2, 3]);
            File.WriteAllText($"{path}.prompt.sha256", hash);
            File.WriteAllText($"{path}.qa-passed", hash);

            Assert.True(AiCaseService.CanReusePassedBackground(path, prompt));

            File.WriteAllText($"{path}.qa-passed", "stale-hash");
            Assert.False(AiCaseService.CanReusePassedBackground(path, prompt));
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    [Fact]
    public void ResponsesEnvelope_ParsesStatusRefusalAndUsageWithoutDuplicatingOutputText()
    {
        const string json = """
        {
          "id":"resp_1","status":"completed","output_text":"{\"ok\":true}",
          "output":[{"content":[{"type":"output_text","text":"{\"ok\":true}"},{"type":"refusal","refusal":""}]}],
          "usage":{"input_tokens":12,"output_tokens":7}
        }
        """;

        var envelope = AiCaseService.ExtractOpenAiTextEnvelope(json);

        Assert.Equal("completed", envelope.Status);
        Assert.Equal("{\"ok\":true}", envelope.Content);
        Assert.Equal(12, envelope.InputTokens);
        Assert.Equal(7, envelope.OutputTokens);
    }

    [Fact]
    public void ResponsesEnvelope_ParsesIncompleteReason()
    {
        const string json = """
        {
          "id":"resp_incomplete","status":"incomplete",
          "incomplete_details":{"reason":"max_output_tokens"},
          "output":[],"usage":{"input_tokens":31,"output_tokens":2048}
        }
        """;

        var envelope = AiCaseService.ExtractOpenAiTextEnvelope(json);

        Assert.Equal("incomplete", envelope.Status);
        Assert.Equal("max_output_tokens", envelope.IncompleteReason);
        Assert.Equal(string.Empty, envelope.Content);
        Assert.Equal(2048, envelope.OutputTokens);
    }

    [Fact]
    public void ResponsesEnvelope_ParsesRefusalContent()
    {
        const string json = """
        {
          "id":"resp_refusal","status":"completed",
          "output":[{"content":[{"type":"refusal","refusal":"Request cannot be completed."}]}]
        }
        """;

        var envelope = AiCaseService.ExtractOpenAiTextEnvelope(json);

        Assert.Equal("Request cannot be completed.", envelope.Refusal);
        Assert.Equal(string.Empty, envelope.Content);
    }

    [Fact]
    public void VisualSafety_RejectsTextBearingCameraEvidenceBeforeAssets()
    {
        var gameCase = MockCaseFactory.Create("test", 4, "medium");
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
            scene.VisualDescription = "Victorian interior using material wear, strong silhouettes and clear physical evidence.";
        var clue = gameCase.Clues[0];
        clue.SourceType = "camera";
        clue.DiscoverMethod = "camera";
        clue.SceneId = gameCase.Stages[0].Scenes[0].SceneId;
        clue.VisualDescription = "A duty board with readable numbers and handwritten labels.";
        clue.VisualTextPolicy = ClueVisualTextPolicies.NoText;

        var result = AiGenerationContract.For(AiGenerationPresets.NormalRandom, 4)
            .Validate(gameCase, new AiDraftSettings { StageCount = 4, GenerationPreset = AiGenerationPresets.NormalRandom });

        Assert.Contains(result.Errors, error => error.Code == "VisualSafety" && error.RefId == clue.ClueId);
    }

    [Fact]
    public void AbstractSymbols_RequiresCameraClueReferencedBySymbolMatchPuzzle()
    {
        var gameCase = MockCaseFactory.Create("test", 4, "medium");
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
            scene.VisualDescription = "Victorian interior with worn brass mechanisms and strong physical silhouettes.";
        var clue = gameCase.Clues[0];
        clue.SourceType = "camera";
        clue.DiscoverMethod = "camera";
        clue.SceneId = gameCase.Stages[0].Scenes[0].SceneId;
        clue.VisualDescription = "Three simple geometric shapes cut into a small brass plate.";
        clue.VisualTextPolicy = ClueVisualTextPolicies.AbstractSymbols;

        var settings = new AiDraftSettings
        {
            StageCount = 4,
            GenerationPreset = AiGenerationPresets.NormalRandom
        };
        var contract = AiGenerationContract.For(settings.GenerationPreset, settings.StageCount);

        var rejected = contract.Validate(gameCase, settings);
        Assert.Contains(rejected.Errors, error => error.Code == "InvalidVisualTextPolicy" && error.RefId == clue.ClueId);

        gameCase.Puzzles.Add(new CasePuzzle
        {
            PuzzleId = "puzzle-symbols",
            Type = CasePuzzleTypes.SymbolMatchPuzzle,
            TargetId = gameCase.Items[0].ItemId,
            RequiredClueIds = { clue.ClueId },
            Options = { "circle", "triangle", "diamond" },
            CorrectSequence = { "circle", "diamond" },
            SuccessMessage = "The mechanism releases.",
            FailureMessage = "The mechanism remains locked."
        });

        var accepted = contract.Validate(gameCase, settings);
        Assert.DoesNotContain(accepted.Errors, error => error.Code == "InvalidVisualTextPolicy" && error.RefId == clue.ClueId);

        clue.SourceType = "item";
        clue.DiscoverMethod = "inspect";
        var nonCamera = contract.Validate(gameCase, settings);
        Assert.Contains(nonCamera.Errors, error => error.Code == "InvalidVisualTextPolicy" && error.RefId == clue.ClueId);
    }

    private static HashSet<string> EnumValues(JsonNode schema) =>
        schema["enum"]!.AsArray().Select(item => item!.GetValue<string>())
            .ToHashSet(StringComparer.Ordinal);
}
