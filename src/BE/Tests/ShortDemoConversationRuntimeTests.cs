using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public class ShortDemoConversationRuntimeTests
{
    private const string FirstSecret = "BRANCH_FIRST_TESTIMONY_SENTINEL";
    private const string SecondSecret = "BRANCH_SECOND_TESTIMONY_SENTINEL";

    [Fact]
    public void ClassicBranch_DeliversCanonicalDialogueRewardAndChallengeExactlyOnce()
    {
        var gameCase = Case(CaseMechanicsVersions.InvestigationV2);
        var state = Room().GameplayState!;
        var scene = gameCase.Stages.Single().Scenes.Single();
        Assert.Equal(new[] { "legacy" }, GameStateBuilder.BuildSceneDialogues(gameCase, state, scene).Select(item => item.DialogueId));
        Assert.False(GameplayConversationRules.IsChallengeAvailable(gameCase, state, scene, gameCase.EvidenceChallenges.Single()));
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "witness" });

        var first = Apply(gameCase, state, scene, Branch("choice-a"));
        var replay = Apply(gameCase, state, scene, Branch("choice-a"));

        Assert.True(first.Changed);
        Assert.False(replay.Changed);
        Assert.Equal(new[] { "dialogue-a" }, state.AskedDialogueIds);
        Assert.Equal(new[] { "reward-a" }, state.UnlockedClueIds);
        Assert.Single(state.ClueDiscoveries);
        Assert.True(GameplayConversationRules.IsChallengeAvailable(gameCase, state, scene, gameCase.EvidenceChallenges.Single()));
        Assert.True(CompleteConditionProgress.Evaluate(scene.CompleteCondition, new HashSet<string>(),
            state.UnlockedClueIds.ToHashSet(), state.AskedDialogueIds.ToHashSet()).IsSatisfied);
        Assert.Equal(new[] { "dialogue-a", "legacy" }, GameStateBuilder.BuildSceneDialogues(gameCase, state, scene).Select(item => item.DialogueId));
        Assert.DoesNotContain(GameplayConversationRules.BuildTranscript(gameCase, state, scene.CharacterIds), item => item.NodeId == "leaf-b");
    }

    [Fact]
    public async Task PairedBranch_RejectsApiBypassAndSavesPrivateDiscoveryBeforePersistence()
    {
        var gameCase = Case();
        var room = Room();
        var persistence = new RecordingPersistence();
        var builder = new ProjectionStateBuilder();
        var service = Service(gameCase, room, persistence, builder);

        var bypass = await Assert.ThrowsAsync<ApiException>(() => service.AskDialogueAsync(User("int"), room.Id, "dialogue-a"));
        Assert.Equal(400, bypass.StatusCode);
        await Assert.ThrowsAsync<ApiException>(() => service.ConverseAsync(User("int"), room.Id,
            new ConverseRequest { CharacterId = "witness", NodeId = "leaf-a" }));
        Assert.Equal(0, persistence.SaveCount);
        Assert.Empty(room.GameplayState!.AskedDialogueIds);
        Assert.Empty(room.GameplayState.TestimonyDiscoveries);

        var root = await service.ConverseAsync(User("int"), room.Id, new ConverseRequest { CharacterId = "witness" });
        Assert.DoesNotContain(FirstSecret, JsonSerializer.Serialize(root));
        Assert.DoesNotContain(SecondSecret, JsonSerializer.Serialize(root));
        var first = await service.ConverseAsync(User("int"), room.Id, Branch("choice-a"));

        Assert.Equal(new[] { 0, 1 }, persistence.TestimonyCountsAtSave);
        Assert.Equal("fragment-a", Assert.Single(first.State.PrivateTestimonies).TestimonyFragmentId);
        Assert.Contains(FirstSecret, JsonSerializer.Serialize(first));
        Assert.DoesNotContain(SecondSecret, JsonSerializer.Serialize(first));
        Assert.Equal("int", Assert.Single(room.GameplayState.TestimonyDiscoveries).DiscoveredByUserId);
        Assert.Equal(new[] { "dialogue-a" }, room.GameplayState.AskedDialogueIds);
        Assert.Null(first.Challenge);
        Assert.Null(first.Node.ChallengeId);
        Assert.Contains(first.Node.Lines, line => line.Text.Contains(FirstSecret, StringComparison.Ordinal));
        Assert.DoesNotContain(typeof(ConversationNodeDto).GetProperties(), property => property.Name == "SourceDialogueId");

        var investigator = await builder.BuildStateAsync(room, gameCase, "inv");
        Assert.Empty(investigator.PrivateTestimonies);
        Assert.Empty(investigator.VisibleScene.ConversationTranscript);
        Assert.Empty(investigator.VisibleScene.AvailableDialogues);
        Assert.DoesNotContain(FirstSecret, JsonSerializer.Serialize(investigator));
        Assert.DoesNotContain(SecondSecret, JsonSerializer.Serialize(investigator));

        var replay = await service.ConverseAsync(User("int"), room.Id, Branch("choice-a"));
        var flatReplay = await service.AskDialogueAsync(User("int"), room.Id, "dialogue-a");
        Assert.False(replay.Changed);
        Assert.False(flatReplay.Changed);
        Assert.Equal(2, persistence.SaveCount);
        Assert.Single(room.GameplayState.TestimonyDiscoveries);
        Assert.Single(room.GameplayState.ClueDiscoveries);
        await Assert.ThrowsAsync<ApiException>(() => service.AskDialogueAsync(User("int"), room.Id, "dialogue-b"));
    }

    [Fact]
    public async Task Investigator_CannotVisitOrAskLinkedSource()
    {
        var gameCase = Case();
        var room = Room();
        var persistence = new RecordingPersistence();
        var service = Service(gameCase, room, persistence, new ProjectionStateBuilder());
        var converse = await Assert.ThrowsAsync<ApiException>(() => service.ConverseAsync(User("inv"), room.Id,
            new ConverseRequest { CharacterId = "witness" }));
        var ask = await Assert.ThrowsAsync<ApiException>(() => service.AskDialogueAsync(User("inv"), room.Id, "dialogue-a"));
        Assert.Equal(403, converse.StatusCode);
        Assert.Equal(403, ask.StatusCode);
        Assert.Equal(0, persistence.SaveCount);
        Assert.Empty(room.GameplayState!.VisitedConversationNodeIds);
    }

    [Fact]
    public void CausalProof_CannotBypassLockedBranchThroughFlatQuestion()
    {
        var gameCase = Case(CaseMechanicsVersions.InvestigationV2);
        gameCase.EvidenceChallenges.Clear();
        Assert.True(CausalStateGraphValidator.Validate(gameCase).IsValid);
        gameCase.ConversationNodes.Single(node => node.IsRoot).Choices.Single(choice => choice.ChoiceId == "choice-a")
            .RequiredClueIds.Add("never-unlocked");

        var blocked = CausalStateGraphValidator.Validate(gameCase);
        Assert.Contains(blocked.Errors, error => error.Code == "NoCanonicalWinPath");
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("character")]
    [InlineData("root")]
    [InlineData("statements")]
    [InlineData("requirements")]
    [InlineData("rewards")]
    [InlineData("scenes")]
    [InlineData("challenge")]
    public void CentralValidator_RejectsInvalidSourceLink(string mutation)
    {
        var gameCase = Case();
        var leaf = gameCase.ConversationNodes.Single(node => node.NodeId == "leaf-a");
        var baseline = new CaseValidationService().ValidateFullLogic(gameCase);
        Assert.DoesNotContain(baseline.Errors, error => error.Code == "InvalidConversationSource"
            || error.Path.EndsWith(".sourceDialogueId", StringComparison.Ordinal));
        switch (mutation)
        {
            case "missing": leaf.SourceDialogueId = "missing"; break;
            case "character": leaf.CharacterId = "other-witness"; break;
            case "root": leaf.IsRoot = true; break;
            case "statements": leaf.StatementIds.Clear(); break;
            case "requirements": leaf.RequiredClueIds.Add("reward-b"); break;
            case "rewards": leaf.UnlockClueIds.Clear(); break;
            case "scenes": leaf.AvailableSceneIds.Clear(); break;
            case "challenge": gameCase.EvidenceChallenges.Single().DialogueId = "dialogue-b"; break;
        }

        var result = new CaseValidationService().ValidateFullLogic(gameCase);
        Assert.Contains(result.Errors, error => mutation == "missing"
            ? error.Code == "MissingReference" && error.Path.EndsWith(".sourceDialogueId", StringComparison.Ordinal)
            : error.Code == "InvalidConversationSource");
    }

    [Fact]
    public void LegacyUnlinkedTree_KeepsIndependentFlatQuestions()
    {
        var gameCase = Case(CaseMechanicsVersions.InvestigationV2);
        foreach (var node in gameCase.ConversationNodes) node.SourceDialogueId = null;
        var state = Room().GameplayState!;
        var scene = gameCase.Stages.Single().Scenes.Single();
        Assert.Equal(3, GameStateBuilder.BuildSceneDialogues(gameCase, state, scene).Count);
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "witness" });
        Apply(gameCase, state, scene, Branch("choice-a"));
        Assert.Empty(state.AskedDialogueIds);
    }

    [Fact]
    public void ClassicChallengeMinimum_UsesNewShortProfileAndPreservesLegacyMinimum()
    {
        var gameCase = Case(CaseMechanicsVersions.InvestigationV2);
        gameCase.GenerationPreset = AiGenerationPresets.ShortDemo;
        gameCase.ShortDemoProfileVersion = 1;
        var sampler = new CaseValidationService().ValidateFullLogic(gameCase);
        Assert.DoesNotContain(sampler.Errors, error => error.Code == "MissingField" && error.Path == "evidenceChallenges");

        gameCase.ShortDemoProfileVersion = 0;
        var legacy = new CaseValidationService().ValidateFullLogic(gameCase);
        Assert.Contains(legacy.Errors, error => error.Code == "MissingField" && error.Path == "evidenceChallenges"
            && error.Message.Contains("at least 2", StringComparison.Ordinal));

        gameCase.ShortDemoProfileVersion = 1;
        gameCase.GenerationPreset = AiGenerationPresets.NormalRandom;
        var normal = new CaseValidationService().ValidateFullLogic(gameCase);
        Assert.Contains(normal.Errors, error => error.Code == "MissingField" && error.Path == "evidenceChallenges");
    }

    private static ConverseRequest Branch(string choiceId) => new() { CharacterId = "witness", NodeId = "root", ChoiceId = choiceId };
    private static CurrentUser User(string id) => new(id, id, "PLAYER");
    private static ConversationRuleResult Apply(GameCase gameCase, GameplayState state, CaseScene scene, ConverseRequest request) =>
        GameplayConversationRules.Apply(gameCase, state, scene, request, "int", PlayerRole.Interrogator, DateTime.UtcNow);

    private static GameCase Case(int mechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation) => new()
    {
        CaseId = "short-branch", Title = "Branch test", MechanicsVersion = mechanicsVersion,
        LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
        Characters = [new() { CharacterId = "witness", Name = "Witness" }],
        Stages = [new() { StageId = "stage", Order = 1, Scenes = [new() { SceneId = "scene", CharacterIds = ["witness"],
            CompleteCondition = new() { RequiredDialogueIds = ["dialogue-a"] } }] }],
        Clues = [new() { ClueId = "reward-a", Title = "First clue" }, new() { ClueId = "reward-b", Title = "Second clue" }],
        Dialogues = [new() { DialogueId = "dialogue-a", CharacterId = "witness", Question = "First topic", Answer = FirstSecret,
            StatementIds = ["statement-a"], AvailableSceneIds = ["scene"], UnlockClueIds = ["reward-a"] },
            new() { DialogueId = "dialogue-b", CharacterId = "witness", Question = "Second topic", Answer = SecondSecret,
                StatementIds = ["statement-b"], AvailableSceneIds = ["scene"], UnlockClueIds = ["reward-b"] },
            new() { DialogueId = "legacy", CharacterId = "witness", Question = "Independent topic", Answer = "Legacy answer", AvailableSceneIds = ["scene"] }],
        ConversationNodes = [new() { NodeId = "root", CharacterId = "witness", IsRoot = true, AvailableSceneIds = ["scene"],
            Lines = [new() { Speaker = "DETECTIVE", Text = "Which topic should we discuss?" }],
            Choices = [new() { ChoiceId = "choice-a", Label = "First topic", NextNodeId = "leaf-a" },
                new() { ChoiceId = "choice-b", Label = "Second topic", NextNodeId = "leaf-b" }] },
            new() { NodeId = "leaf-a", CharacterId = "witness", SourceDialogueId = "dialogue-a", AvailableSceneIds = ["scene"],
                StatementIds = ["statement-a"], UnlockClueIds = ["reward-a"], ChallengeId = "challenge",
                Lines = [new() { Speaker = ConversationSpeakers.Npc, Text = FirstSecret }], Choices = [new() { ChoiceId = "return-a", Label = "Back" }] },
            new() { NodeId = "leaf-b", CharacterId = "witness", SourceDialogueId = "dialogue-b", AvailableSceneIds = ["scene"],
                StatementIds = ["statement-b"], UnlockClueIds = ["reward-b"], Lines = [new() { Speaker = ConversationSpeakers.Npc, Text = SecondSecret }],
                Choices = [new() { ChoiceId = "return-b", Label = "Back" }] }],
        TestimonyFragments = [new() { Id = "fragment-a", DialogueId = "dialogue-a", Text = FirstSecret },
            new() { Id = "fragment-b", DialogueId = "dialogue-b", Text = SecondSecret }],
        EvidenceChallenges = [new() { ChallengeId = "challenge", DialogueId = "dialogue-a", CorrectEvidenceId = "reward-a",
            TestimonyFragmentId = "fragment-a", Prompt = "Present evidence" }]
    };

    private static GameRoom Room() => new()
    {
        Id = "room", CaseId = "short-branch", Status = RoomStatus.InProgress,
        Players = [new() { UserId = "int", Role = PlayerRole.Interrogator }, new() { UserId = "inv", Role = PlayerRole.Investigator }],
        GameplayState = new() { Version = 1, CurrentStageId = "stage", CurrentSceneId = "scene", UnlockedSceneIds = ["scene"] }
    };

    private static GameplayService Service(GameCase gameCase, GameRoom room, RecordingPersistence persistence, IGameStateBuilder builder) =>
        new(null!, new SingleContextLoader(room, gameCase), persistence, DispatchProxy.Create<IGameNotifier, NoOpNotifier>(), builder,
            null!, null!, new NoOpPlaytestEventSink(), Options.Create(new AccusationSettings()), NullLogger<GameplayService>.Instance);

    private sealed class SingleContextLoader(GameRoom room, GameCase gameCase) : IGameplayContextLoader
    {
        public Task<GameplayContext> LoadAsync(string userId, string roomId, bool requireInProgress, CancellationToken cancellationToken = default) =>
            Task.FromResult(new GameplayContext(room, gameCase, room.Players.Single(player => player.UserId == userId)));
    }

    private sealed class RecordingPersistence : IGameplayStatePersistence
    {
        public int SaveCount { get; private set; }
        public List<int> TestimonyCountsAtSave { get; } = [];
        public Task<bool> TrySaveAsync(GameRoom room, GameCase? gameCase = null, CancellationToken cancellationToken = default)
        {
            SaveCount++;
            TestimonyCountsAtSave.Add(room.GameplayState!.TestimonyDiscoveries.Count);
            room.GameplayState.Version++;
            return Task.FromResult(true);
        }
    }

    private sealed class ProjectionStateBuilder : IGameStateBuilder
    {
        public Task<GameStateResponse> BuildStateAsync(GameRoom room, GameCase gameCase, string userId)
        {
            var state = room.GameplayState!;
            var scene = gameCase.Stages.Single().Scenes.Single();
            var response = new GameStateResponse
            {
                RoomId = room.Id, CaseId = gameCase.CaseId, MechanicsVersion = gameCase.MechanicsVersion, Version = state.Version,
                AskedDialogueIds = state.AskedDialogueIds.ToList(), VisitedConversationNodeIds = state.VisitedConversationNodeIds.ToList(),
                VisibleScene = new() { SceneId = scene.SceneId, AvailableDialogues = GameStateBuilder.BuildSceneDialogues(gameCase, state, scene),
                    ConversationTranscript = GameplayConversationRules.BuildTranscript(gameCase, state, scene.CharacterIds),
                    ConversationTreeCharacterIds = ["witness"] }
            };
            V3KnowledgeProjector.Apply(response, room, gameCase, userId);
            return Task.FromResult(response);
        }
    }

    public class NoOpNotifier : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => Task.CompletedTask;
    }
}
