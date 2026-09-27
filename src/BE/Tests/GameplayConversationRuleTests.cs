using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.WebAPI.Controllers;
using Xunit;

namespace SirLocked.Tests;

public class GameplayConversationRuleTests
{
    private static readonly DateTime VisitedAt = new(2026, 6, 19, 9, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void OpenRoot_FirstVisitUnlocksClueAndRecordsConversationDiscovery()
    {
        var (gameCase, state, scene) = Fixture();

        var result = Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });

        Assert.True(result.Changed);
        Assert.Equal("root", result.Node.NodeId);
        Assert.Contains("root", state.VisitedConversationNodeIds);
        Assert.Equal(new[] { "clue-root" }, result.UnlockedClueIds);
        Assert.Contains("clue-root", state.UnlockedClueIds);
        var discovery = Assert.Single(state.ClueDiscoveries);
        Assert.Equal(ClueDiscoverySources.Conversation, discovery.SourceAction);
        Assert.Equal("user-int", discovery.DiscoveredByUserId);
        Assert.Equal(VisitedAt, discovery.DiscoveredAt);
    }

    [Fact]
    public void RejectsCharacterWithoutTree()
    {
        var (gameCase, state, scene) = Fixture();

        var error = Assert.Throws<ApiException>(() =>
            Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-2" }));

        Assert.Equal(400, error.StatusCode);
        Assert.Equal("This case has no conversation tree.", error.Message);
    }

    [Fact]
    public void RejectsCharacterOutsideCurrentScene()
    {
        var (gameCase, state, scene) = Fixture();
        scene.CharacterIds.Clear();

        var error = Assert.Throws<ApiException>(() =>
            Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" }));

        Assert.Equal(400, error.StatusCode);
        Assert.Equal("This character is not in the current scene.", error.Message);
    }

    [Fact]
    public void LockedRootChoiceAndTargetUseGenericErrors()
    {
        var (gameCase, state, scene) = Fixture();
        var root = gameCase.ConversationNodes.Single(node => node.NodeId == "root");
        root.RequiredClueIds.Add("clue-root-secret");

        AssertSecretSafe(() => Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" }),
            "clue-root-secret");

        root.RequiredClueIds.Clear();
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });

        AssertSecretSafe(() => Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "root",
            ChoiceId = "choice-locked"
        }), "clue-choice-secret");

        AssertSecretSafe(() => Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "root",
            ChoiceId = "choice-locked-target"
        }), "clue-target-secret");
    }

    [Fact]
    public void ResolvesTopicFollowUpAndNullTargetBackToRoot()
    {
        var (gameCase, state, scene) = Fixture();
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });

        var topic = Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "root",
            ChoiceId = "choice-topic"
        });
        var followUp = Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "topic",
            ChoiceId = "choice-follow"
        });
        var backToRoot = Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "follow",
            ChoiceId = "choice-return"
        });

        Assert.Equal("topic", topic.Node.NodeId);
        Assert.True(topic.Changed);
        Assert.Equal("follow", followUp.Node.NodeId);
        Assert.True(followUp.Changed);
        Assert.Equal("root", backToRoot.Node.NodeId);
        Assert.False(backToRoot.Changed);
        Assert.Equal("choice-topic", backToRoot.Node.Choices[0].ChoiceId);
    }

    [Fact]
    public void OpenWithoutNode_ResumesVisitedNodeWithPendingBranch()
    {
        var (gameCase, state, scene) = Fixture();
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });
        Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "root",
            ChoiceId = "choice-topic"
        });

        var resumed = Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });

        Assert.Equal("topic", resumed.Node.NodeId);
        Assert.False(resumed.Changed);
        Assert.Contains(resumed.Node.Choices, choice => choice.ChoiceId == "choice-follow");
    }

    [Fact]
    public void VisibleChoices_KeepsVisitedBranchesNavigable()
    {
        var (gameCase, state, scene) = Fixture();
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });
        Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "root",
            ChoiceId = "choice-topic"
        });

        var root = gameCase.ConversationNodes.Single(node => node.NodeId == "root");
        var visibleChoices = GameplayConversationRules.VisibleChoices(root, state);

        // Visited branches must stay selectable so gated follow-ups deeper in the tree
        // remain reachable without reopening the conversation.
        Assert.Contains(visibleChoices, choice => choice.ChoiceId == "choice-topic");
        Assert.Contains(visibleChoices, choice => choice.ChoiceId == "choice-locked-target");
    }

    [Fact]
    public void GatedChoiceBecomesAvailableAfterRequiredClueIsUnlocked()
    {
        var (gameCase, state, scene) = Fixture();
        state.UnlockedClueIds.Add("clue-choice-secret");
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });

        var result = Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "root",
            ChoiceId = "choice-locked"
        });

        Assert.Equal("topic", result.Node.NodeId);
        Assert.True(result.Changed);
    }

    [Fact]
    public void RejectsChoiceWithoutCurrentNode()
    {
        var (gameCase, state, scene) = Fixture();

        var error = Assert.Throws<ApiException>(() => Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            ChoiceId = "choice-topic"
        }));

        Assert.Equal(400, error.StatusCode);
        Assert.Equal("nodeId is required when selecting a conversation choice.", error.Message);
    }

    [Fact]
    public void RevisitIsIdempotent()
    {
        var (gameCase, state, scene) = Fixture();
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });

        var revisit = Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "root"
        });

        Assert.False(revisit.Changed);
        Assert.Empty(revisit.UnlockedClueIds);
        Assert.Single(state.VisitedConversationNodeIds);
        Assert.Single(state.ClueDiscoveries);
    }

    [Fact]
    public void RejectsDirectOpenOfUnvisitedNonRootNode()
    {
        var (gameCase, state, scene) = Fixture();

        var error = Assert.Throws<ApiException>(() => Apply(gameCase, state, scene, new ConverseRequest
        {
            CharacterId = "char-1",
            NodeId = "topic"
        }));

        Assert.Equal(400, error.StatusCode);
        Assert.Equal("This conversation node is not available.", error.Message);
    }

    [Fact]
    public void ChallengeAvailabilityAcceptsAskedDialogueOrVisitedConversationNode()
    {
        var (gameCase, state, scene) = Fixture();
        var challenge = gameCase.EvidenceChallenges.Single();

        Assert.False(GameplayConversationRules.IsChallengeAvailable(gameCase, state, scene, challenge));

        state.AskedDialogueIds.Add("dialogue-1");
        Assert.True(GameplayConversationRules.IsChallengeAvailable(gameCase, state, scene, challenge));

        state.AskedDialogueIds.Clear();
        state.VisitedConversationNodeIds.Add("topic");
        Assert.True(GameplayConversationRules.IsChallengeAvailable(gameCase, state, scene, challenge));
    }

    [Fact]
    public void ConverseEndpointAndServiceContractAreExposed()
    {
        var controllerMethod = typeof(GameController).GetMethod(nameof(GameController.Converse));
        var serviceMethod = typeof(IGameplayService).GetMethod(nameof(IGameplayService.ConverseAsync));

        Assert.NotNull(controllerMethod);
        Assert.NotNull(serviceMethod);
        Assert.Contains(controllerMethod!.GetCustomAttributes(typeof(HttpPostAttribute), false)
            .Cast<HttpPostAttribute>(), attribute => attribute.Template == "converse");
    }

    [Fact]
    public void BuildTranscript_ProjectsOnlyVisitedNodesInVisitOrder()
    {
        var (gameCase, state, scene) = Fixture();
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1", NodeId = "root", ChoiceId = "choice-topic" });

        var transcript = GameplayConversationRules.BuildTranscript(gameCase, state, scene.CharacterIds);

        Assert.Equal(new[] { "root", "topic" }, transcript.Select(entry => entry.NodeId).ToArray());
        Assert.DoesNotContain(transcript, entry => entry.NodeId == "follow");
        var topic = transcript.Single(entry => entry.NodeId == "topic");
        Assert.NotNull(topic.Challenge);
        Assert.False(topic.Challenge!.IsResolved);
        Assert.Null(topic.Challenge.Resolution);
    }

    [Fact]
    public void BuildTranscript_ExcludesNodesWhoseCharacterIsNotInScene()
    {
        var (gameCase, state, scene) = Fixture();
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });
        scene.CharacterIds.Remove("char-1");

        Assert.Empty(GameplayConversationRules.BuildTranscript(gameCase, state, scene.CharacterIds));
    }

    [Fact]
    public void BuildTranscript_ResolvedChallengeExposesResolution()
    {
        var (gameCase, state, scene) = Fixture();
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1", NodeId = "root", ChoiceId = "choice-topic" });
        var challenge = gameCase.EvidenceChallenges.Single();
        challenge.SuccessResponse = "The mask slips.";
        state.ResolvedConfrontationRecords.Add(new ResolvedConfrontationRecord { ChallengeId = challenge.ChallengeId });

        var topic = GameplayConversationRules.BuildTranscript(gameCase, state, scene.CharacterIds)
            .Single(entry => entry.NodeId == "topic");

        Assert.True(topic.Challenge!.IsResolved);
        Assert.Equal("The mask slips.", topic.Challenge.Resolution);
    }

    [Fact]
    public void NewlyUnlockedChoices_OnlyVisitedNodeChoicesGatedByNewClues()
    {
        var (gameCase, state, scene) = Fixture();
        Apply(gameCase, state, scene, new ConverseRequest { CharacterId = "char-1" });
        state.UnlockedClueIds.Add("clue-choice-secret");

        var unlocked = GameplayConversationRules.NewlyUnlockedChoices(gameCase, state, new[] { "clue-choice-secret" });

        Assert.Contains(unlocked, pair => pair.Choice.ChoiceId == "choice-locked");
        Assert.DoesNotContain(unlocked, pair => pair.Choice.ChoiceId == "choice-topic");
    }

    [Fact]
    public void NewlyUnlockedChoices_IgnoresChoicesOnUnvisitedNodes()
    {
        var (gameCase, state, scene) = Fixture();
        state.UnlockedClueIds.Add("clue-choice-secret");

        Assert.Empty(GameplayConversationRules.NewlyUnlockedChoices(gameCase, state, new[] { "clue-choice-secret" }));
    }

    [Fact]
    public void ConversationChoiceDto_HidesLabelWhenLocked()
    {
        var choice = new ConversationChoice { ChoiceId = "c", Label = "secret topic", RequiredClueIds = { "clue-x" } };

        var locked = ConversationChoiceDto.From(choice, new HashSet<string>());
        Assert.True(locked.IsLocked);
        Assert.Null(locked.Label);

        var open = ConversationChoiceDto.From(choice, new HashSet<string> { "clue-x" });
        Assert.False(open.IsLocked);
        Assert.Equal("secret topic", open.Label);
    }

    [Fact]
    public void ConversationProjectionDtos_DoNotLeakHiddenFields()
    {
        var choiceProps = typeof(ConversationChoiceDto).GetProperties().Select(p => p.Name).ToHashSet();
        Assert.DoesNotContain("RequiredClueIds", choiceProps);
        Assert.DoesNotContain("NextNodeId", choiceProps);

        var nodeProps = typeof(ConversationNodeDto).GetProperties().Select(p => p.Name).ToHashSet();
        Assert.DoesNotContain("RequiredClueIds", nodeProps);
        Assert.DoesNotContain("UnlockClueIds", nodeProps);
        Assert.DoesNotContain("Choices", nodeProps);

        var entryProps = typeof(ConversationTranscriptEntryDto).GetProperties().Select(p => p.Name).ToHashSet();
        Assert.DoesNotContain("RequiredClueIds", entryProps);
        Assert.DoesNotContain("UnlockClueIds", entryProps);
        Assert.DoesNotContain("Choices", entryProps);
    }

    private static ConversationRuleResult Apply(
        GameCase gameCase,
        GameplayState state,
        CaseScene scene,
        ConverseRequest request) =>
        GameplayConversationRules.Apply(
            gameCase,
            state,
            scene,
            request,
            "user-int",
            "INTERROGATOR",
            VisitedAt);

    private static void AssertSecretSafe(Action action, string secretClueId)
    {
        var error = Assert.Throws<ApiException>(action);
        Assert.Equal(400, error.StatusCode);
        Assert.DoesNotContain(secretClueId, error.Message);
        Assert.Null(error.Errors);
    }

    private static (GameCase GameCase, GameplayState State, CaseScene Scene) Fixture()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-1",
            CharacterIds = { "char-1", "char-2" }
        };
        var gameCase = new GameCase
        {
            MechanicsVersion = CaseMechanicsVersions.InvestigationV2,
            Characters =
            {
                new CaseCharacter { CharacterId = "char-1", Name = "Ada" },
                new CaseCharacter { CharacterId = "char-2", Name = "Blaise" }
            },
            Stages = { new CaseStage { StageId = "stage-1", Scenes = { scene } } },
            Clues =
            {
                new CaseClue { ClueId = "clue-root" },
                new CaseClue { ClueId = "clue-root-secret" },
                new CaseClue { ClueId = "clue-choice-secret" },
                new CaseClue { ClueId = "clue-target-secret" }
            },
            Dialogues = { new CaseDialogue { DialogueId = "dialogue-1", CharacterId = "char-1" } },
            EvidenceChallenges =
            {
                new EvidenceChallenge { ChallengeId = "challenge-1", DialogueId = "dialogue-1" }
            },
            ConversationNodes =
            {
                new ConversationNode
                {
                    NodeId = "root",
                    CharacterId = "char-1",
                    IsRoot = true,
                    UnlockClueIds = { "clue-root" },
                    Choices =
                    {
                        new ConversationChoice { ChoiceId = "choice-topic", Label = "Topic", NextNodeId = "topic" },
                        new ConversationChoice
                        {
                            ChoiceId = "choice-locked",
                            Label = "Locked",
                            RequiredClueIds = { "clue-choice-secret" },
                            NextNodeId = "topic"
                        },
                        new ConversationChoice
                        {
                            ChoiceId = "choice-locked-target",
                            Label = "Locked target",
                            NextNodeId = "locked-target"
                        }
                    }
                },
                new ConversationNode
                {
                    NodeId = "topic",
                    CharacterId = "char-1",
                    ChallengeId = "challenge-1",
                    Choices =
                    {
                        new ConversationChoice { ChoiceId = "choice-follow", Label = "Follow up", NextNodeId = "follow" },
                        new ConversationChoice { ChoiceId = "choice-back", Label = "Back" }
                    }
                },
                new ConversationNode
                {
                    NodeId = "follow",
                    CharacterId = "char-1",
                    Choices = { new ConversationChoice { ChoiceId = "choice-return", Label = "Return" } }
                },
                new ConversationNode
                {
                    NodeId = "locked-target",
                    CharacterId = "char-1",
                    RequiredClueIds = { "clue-target-secret" },
                    Choices = { new ConversationChoice { ChoiceId = "choice-locked-back", Label = "Back" } }
                }
            }
        };

        return (gameCase, new GameplayState(), scene);
    }
}
