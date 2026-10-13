using System.Text.Json;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

public sealed class ShortDemoSamplerContractTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Theory]
    [InlineData(false, CaseMechanicsVersions.InvestigationV2)]
    [InlineData(true, CaseMechanicsVersions.InvestigationV3PairedConfrontation)]
    public void NewShortCreation_NormalizesScopeAndAssignsServerProfile(bool includeCrack, int mechanicsVersion)
    {
        // Client JSON cannot select the persisted profile or force V3 through it.
        var request = JsonSerializer.Deserialize<GenerateAiCaseRequest>(
            """{"generationPreset":"short_demo","stageCount":6,"difficulty":"hard","language":"VI","shortDemoProfileVersion":0}""",
            JsonOptions)!;
        request.IncludeCrackTheLie = includeCrack;

        var settings = AiCaseService.CreateNewDraftSettings(request);

        Assert.Equal(AiGenerationPresets.ShortDemo, request.GenerationPreset);
        Assert.Equal(2, settings.StageCount);
        Assert.Equal("easy", settings.Difficulty);
        Assert.Equal(CaseLanguages.Vietnamese, settings.Language);
        Assert.Equal(AiGenerationContract.CurrentShortDemoProfileVersion, settings.ShortDemoProfileVersion);
        Assert.Equal(mechanicsVersion, settings.MechanicsVersion);
        Assert.Equal(includeCrack, settings.IncludeCrackTheLie);
        Assert.Equal(1, AiGenerationContract.For(settings).EvidenceChallenges);
    }

    [Fact]
    public void RetiredV3Request_BecomesNewShortSamplerWithoutChangingPersistedLegacyDrafts()
    {
        var settings = AiCaseService.CreateNewDraftSettings(new GenerateAiCaseRequest
        {
            GenerationPreset = AiGenerationPresets.CrackTheLieV3
        });

        Assert.Equal(AiGenerationPresets.ShortDemo, settings.GenerationPreset);
        Assert.Equal(1, settings.ShortDemoProfileVersion);
        Assert.True(settings.IncludeCrackTheLie);
        Assert.Equal(CaseMechanicsVersions.InvestigationV3PairedConfrontation, settings.MechanicsVersion);
        Assert.Equal(0, new AiDraftSettings { GenerationPreset = AiGenerationPresets.CrackTheLieV3 }.ShortDemoProfileVersion);
    }

    [Fact]
    public void OtherPresetCreation_DoesNotReceiveShortSamplerProfile()
    {
        var settings = AiCaseService.CreateNewDraftSettings(new GenerateAiCaseRequest
        {
            GenerationPreset = AiGenerationPresets.NormalRandom, StageCount = 4
        });

        Assert.Equal(0, settings.ShortDemoProfileVersion);
        Assert.Equal(4, settings.StageCount);
    }

    [Fact]
    public void MissingProfile_InLegacyJsonAndBsonPreservesContractAndCanonicalHash()
    {
        var legacy = new AiDraftSettings { GenerationPreset = AiGenerationPresets.ShortDemo, StageCount = 2 };
        var legacyJson = JsonSerializer.SerializeToNode(legacy, JsonOptions)!;
        var loadedJson = JsonSerializer.Deserialize<AiDraftSettings>(legacyJson.ToJsonString(), JsonOptions)!;
        var legacyBson = legacy.ToBsonDocument();
        var loadedBson = BsonSerializer.Deserialize<AiDraftSettings>(legacyBson);

        Assert.Null(legacyJson["shortDemoProfileVersion"]);
        Assert.False(legacyBson.Contains(nameof(AiDraftSettings.ShortDemoProfileVersion)));
        Assert.Equal(0, loadedJson.ShortDemoProfileVersion);
        Assert.Equal(0, loadedBson.ShortDemoProfileVersion);
        Assert.Equal(ProjectionCanonicalizer.HashObject(legacyJson), ProjectionCanonicalizer.HashObject(loadedJson));
        Assert.Equal(ProjectionCanonicalizer.HashObject(legacyJson), ProjectionCanonicalizer.HashObject(loadedBson));
        var contract = AiGenerationContract.For(loadedBson);
        Assert.Equal(2, contract.EvidenceChallenges);
        Assert.Equal((0, 1), (contract.MinPuzzles, contract.MaxPuzzles));
        Assert.Equal((0, 1), (contract.MinInteractions, contract.MaxInteractions));
        Assert.Equal(0, contract.MinConversationCharacters);
    }

    [Fact]
    public void NewProfile_RoundTripsAndIsInjectedOnlyFromServerSettings()
    {
        var settings = AiCaseService.CreateNewDraftSettings(new GenerateAiCaseRequest
        {
            GenerationPreset = AiGenerationPresets.ShortDemo
        });
        var loaded = BsonSerializer.Deserialize<AiDraftSettings>(settings.ToBson());
        var generated = new GeneratedCaseLogic();
        var gameCase = generated.ToGameCase(loaded);
        var draft = new AiCaseDraft { Id = "64b64c0f0f0f0f0f0f0f0f0f", Settings = loaded };
        gameCase.Id = draft.Id;

        Assert.Equal(1, loaded.ShortDemoProfileVersion);
        Assert.Equal(1, gameCase.ShortDemoProfileVersion);
        gameCase.ShortDemoProfileVersion = 99;
        AiV3GenerationProfile.ApplyServerOwnedFields(draft, gameCase);
        Assert.Equal(1, gameCase.ShortDemoProfileVersion);
        loaded.ShortDemoProfileVersion = 0;
        AiV3GenerationProfile.ApplyServerOwnedFields(draft, gameCase);
        Assert.Equal(0, gameCase.ShortDemoProfileVersion);
        Assert.DoesNotContain("shortDemoProfileVersion", JsonSerializer.Serialize(gameCase, JsonOptions), StringComparison.Ordinal);
        Assert.False(gameCase.ToBsonDocument().Contains(nameof(GameCase.ShortDemoProfileVersion)));
    }

    [Theory]
    [InlineData(CaseLanguages.English, false)]
    [InlineData(CaseLanguages.Vietnamese, false)]
    [InlineData(CaseLanguages.English, true)]
    [InlineData(CaseLanguages.Vietnamese, true)]
    public void NewShort_CompiledCaseMeetsSamplerContractAndPrompt(string language, bool isV3)
    {
        var (draft, gameCase) = CompileSampler(language, isV3);
        var validation = AiGenerationContract.For(draft.Settings).Validate(gameCase, draft.Settings);
        var prompt = AiCaseService.BuildFullLogicRequestPrompt(draft);

        Assert.True(validation.IsValid, Format(validation));
        var fullLogic = new CaseValidationService().ValidateFullLogic(gameCase);
        Assert.True(fullLogic.IsValid, Format(fullLogic));
        var truthProjection = new CaseTruthService().ValidateProjection(draft.CaseTruth!, gameCase);
        Assert.True(truthProjection.IsValid, Format(truthProjection));
        Assert.Single(gameCase.Puzzles);
        Assert.Single(gameCase.Interactions.Where(item => item.Type == CaseInteractionTypes.CombineItems));
        Assert.Single(gameCase.Interactions.Where(item => item.Type == CaseInteractionTypes.UseItemOnTarget));
        Assert.Single(gameCase.EvidenceChallenges);
        Assert.Single(gameCase.Deductions);
        Assert.Single(gameCase.RequiredTeamworkChains);
        Assert.Contains("SHORT_DEMO sampler requirements (mandatory, never optional)", prompt, StringComparison.Ordinal);
        Assert.Contains("exactly one COMBINE_ITEMS", prompt, StringComparison.Ordinal);
        Assert.Contains("exactly one USE_ITEM_ON_TARGET", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("conversationNodes are OPTIONAL", AiCaseService.BuildFullCasePrompt(draft), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("puzzles")]
    [InlineData("combine")]
    [InlineData("use")]
    [InlineData("conversationNodes")]
    [InlineData("evidenceChallenges")]
    [InlineData("deductions")]
    [InlineData("requiredTeamworkChains")]
    public void NewShort_RejectsMissingSamplerMechanic(string omitted)
    {
        var (draft, gameCase) = CompileSampler();
        switch (omitted)
        {
            case "puzzles": gameCase.Puzzles.Clear(); break;
            case "combine": gameCase.Interactions.RemoveAll(item => item.Type == CaseInteractionTypes.CombineItems); break;
            case "use": gameCase.Interactions.RemoveAll(item => item.Type == CaseInteractionTypes.UseItemOnTarget); break;
            case "conversationNodes": gameCase.ConversationNodes.Clear(); break;
            case "evidenceChallenges": gameCase.EvidenceChallenges.Clear(); break;
            case "deductions": gameCase.Deductions.Clear(); break;
            case "requiredTeamworkChains": gameCase.RequiredTeamworkChains.Clear(); break;
        }
        var path = omitted is "combine" or "use" ? "interactions" : omitted;
        var result = AiGenerationContract.For(draft.Settings).Validate(gameCase, draft.Settings);

        Assert.Contains(result.Errors, error => error.Code == "PresetContract" && error.Path == path);
    }

    [Theory]
    [InlineData(CaseInteractionTypes.CombineItems, CaseInteractionTypes.UseItemOnTarget)]
    [InlineData(CaseInteractionTypes.UseItemOnTarget, CaseInteractionTypes.CombineItems)]
    public void NewShort_TotalInteractionCountCannotReplaceRequiredTypes(string repeated, string omitted)
    {
        var (draft, gameCase) = CompileSampler();
        gameCase.Interactions.Single(item => item.Type == omitted).Type = repeated;

        var result = AiGenerationContract.For(draft.Settings).Validate(gameCase, draft.Settings);

        Assert.Equal(2, gameCase.Interactions.Count);
        Assert.Contains(result.Errors, error => error.Code == "PresetContract" && error.Path == "interactions"
            && error.Message.Contains(omitted, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void NewShort_FlatOrRepeatedTopicsCannotReplaceBranchingDialogue(bool repeatTopic)
    {
        var (draft, gameCase) = CompileSampler();
        var root = gameCase.ConversationNodes.Single(node => node.IsRoot);
        var topics = root.Choices.Where(choice => choice.NextNodeId is not null).ToList();
        Assert.True(topics.Count >= 2);
        foreach (var choice in topics)
            choice.NextNodeId = repeatTopic ? topics[0].NextNodeId : null;

        var result = AiGenerationContract.For(draft.Settings).Validate(gameCase, draft.Settings);

        Assert.Contains(result.Errors, error => error.Code == "PresetContract" && error.Path == "conversationNodes"
            && error.Message.Contains("branching", StringComparison.Ordinal));
    }

    [Fact]
    public void LegacyShort_StillCompilesWithoutSamplerMechanicsOrUpgradingTheProfile()
    {
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f0f", PlannedTargetKind = CaseTargetKinds.Asset,
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.ShortDemo, StageCount = 2 }
        };
        draft.CaseTruth = JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!;
        var plan = new GameplayProjectionPlanner(new CaseTruthService()).Build(draft, draft.CaseTruth);
        var gameCase = new GameCaseProjectionCompiler().Compile(plan, ProjectionContentMockFactory.Build(plan), draft.Settings);
        AiV3GenerationProfile.ApplyServerOwnedFields(draft, gameCase);
        var validation = AiGenerationContract.For(draft.Settings).Validate(gameCase, draft.Settings);

        Assert.True(validation.IsValid, Format(validation));
        Assert.Equal(0, gameCase.ShortDemoProfileVersion);
        Assert.Empty(gameCase.Puzzles);
        Assert.Empty(gameCase.Interactions);
        Assert.Empty(gameCase.ConversationNodes);
        Assert.Equal(2, gameCase.EvidenceChallenges.Count);
        Assert.DoesNotContain("SHORT_DEMO sampler requirements", AiCaseService.BuildFullCasePrompt(draft), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthArtifacts.Evidence)]
    [InlineData(CaseTruthArtifacts.Statements)]
    public void SamplerTruthPrompt_PlansSharedSceneFactsBeforeProjectionAndPreservesLegacy(string artifact)
    {
        var draft = AiPromptBenchmark.Fixture(AiGenerationPresets.ShortDemo);
        var newPrompt = AiCaseService.BuildTruthStagePrompt(draft, artifact, draft.CaseTruth!, string.Empty);
        draft.Settings.ShortDemoProfileVersion = 0;
        var legacyPrompt = AiCaseService.BuildTruthStagePrompt(draft, artifact, draft.CaseTruth!, string.Empty);

        Assert.Contains("SHORT_DEMO BRANCH SOURCE CONTRACT", newPrompt, StringComparison.Ordinal);
        Assert.DoesNotContain("SHORT_DEMO BRANCH SOURCE CONTRACT", legacyPrompt, StringComparison.Ordinal);
        Assert.Contains("existing", newPrompt, StringComparison.Ordinal);
        if (artifact == CaseTruthArtifacts.Statements)
        {
            Assert.Contains("exactly one statement with a contradictedByTraceIds entry", newPrompt, StringComparison.Ordinal);
            Assert.Contains("other distinct, non-contradicted statement by that same speaker", newPrompt, StringComparison.Ordinal);
        }
    }

    private static (AiCaseDraft Draft, GameCase Case) CompileSampler(string language = CaseLanguages.English, bool isV3 = false)
    {
        var draft = AiPromptBenchmark.Fixture(AiGenerationPresets.ShortDemo, language, isV3);
        var gameCase = new GameCaseProjectionCompiler().Compile(draft.ProjectionPlan!,
            ProjectionContentMockFactory.Build(draft.ProjectionPlan!), draft.Settings);
        return (draft, gameCase);
    }

    private static string Format(SirLocked.Api.DTOs.Case.CaseValidationResult result) =>
        string.Join(Environment.NewLine, result.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}"));
}
