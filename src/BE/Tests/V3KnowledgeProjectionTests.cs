using System.Text.Json;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class V3KnowledgeProjectionTests
{
    private const string InvSecret = "INV_SECRET_SENTINEL_7F91";
    private const string IntSecret = "INT_SECRET_SENTINEL_42AC";
    private static readonly DateTime Now = new(2026, 7, 19, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void SameCanonicalState_ProjectsDifferentCallerKnowledgeWithoutCrossRoleSentinels()
    {
        var gameCase = Case();
        var room = Room();
        room.GameplayState!.UnlockedClueIds.Add("evidence-inv");
        room.GameplayState.ClueDiscoveries.Add(new ClueDiscoveryRecord
        {
            ClueId = "evidence-inv",
            DiscoveredByUserId = "inv",
            DiscoveredByRole = PlayerRole.Investigator
        });
        room.GameplayState.TestimonyDiscoveries.Add(new TestimonyDiscoveryRecord
        {
            TestimonyFragmentId = "fragment-int",
            DialogueId = "dialogue-int",
            DiscoveredByUserId = "int",
            DiscoveredByRole = PlayerRole.Interrogator
        });

        var investigator = FullResponse(gameCase);
        var interrogator = FullResponse(gameCase);
        V3KnowledgeProjector.Apply(investigator, room, gameCase, "inv");
        V3KnowledgeProjector.Apply(interrogator, room, gameCase, "int");

        var investigatorJson = JsonSerializer.Serialize(investigator);
        var interrogatorJson = JsonSerializer.Serialize(interrogator);
        Assert.Contains(InvSecret, investigatorJson);
        Assert.DoesNotContain(IntSecret, investigatorJson);
        Assert.Contains(IntSecret, interrogatorJson);
        Assert.DoesNotContain(InvSecret, interrogatorJson);
        Assert.Empty(investigator.ActionLog);
        Assert.Empty(interrogator.ActionLog);
        Assert.Empty(investigator.VisibleScene.ConversationTranscript);
        Assert.NotNull(investigator.VisibleScene.Runtime);
        Assert.Single(investigator.VisibleScene.Runtime!.ClueZones);
        Assert.NotNull(interrogator.VisibleScene.Runtime);
        Assert.Empty(interrogator.VisibleScene.Runtime!.ClueZones);
    }

    [Fact]
    public void ReadyForReview_RevealsOnlyThePairAndKeepsUnrelatedKnowledgePrivate()
    {
        var gameCase = CaseWithUnrelatedSecrets();
        var room = Room();
        var state = room.GameplayState!;
        Discover(state, "evidence-inv", "inv", PlayerRole.Investigator);
        Discover(state, "evidence-unrelated", "inv", PlayerRole.Investigator);
        DiscoverTestimony(state, "fragment-int", "dialogue-int", "int");
        DiscoverTestimony(state, "fragment-unrelated", "dialogue-unrelated", "int");
        PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-int", "int", PlayerRole.Interrogator, Now);
        PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-inv", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(1));

        var investigator = FullResponse(gameCase);
        var interrogator = FullResponse(gameCase);
        V3KnowledgeProjector.Apply(investigator, room, gameCase, "inv");
        V3KnowledgeProjector.Apply(interrogator, room, gameCase, "int");

        var investigatorJson = JsonSerializer.Serialize(investigator);
        var interrogatorJson = JsonSerializer.Serialize(interrogator);
        Assert.Contains(InvSecret, investigatorJson);
        Assert.Contains(IntSecret, investigatorJson);
        Assert.Contains(InvSecret, interrogatorJson);
        Assert.Contains(IntSecret, interrogatorJson);
        Assert.Contains("INV_UNRELATED_SENTINEL", investigatorJson);
        Assert.DoesNotContain("INT_UNRELATED_SENTINEL", investigatorJson);
        Assert.Contains("INT_UNRELATED_SENTINEL", interrogatorJson);
        Assert.DoesNotContain("INV_UNRELATED_SENTINEL", interrogatorJson);
        Assert.Equal(2, investigator.PrivateEvidence.Count);
        Assert.Empty(investigator.PrivateTestimonies);
        Assert.Equal(2, interrogator.PrivateTestimonies.Count);
        Assert.Empty(interrogator.PrivateEvidence);
        Assert.Equal(2, investigator.ActiveConfrontation!.Revision);
        Assert.NotNull(investigator.ActiveConfrontation.Evidence);
        Assert.NotNull(investigator.ActiveConfrontation.Testimony);
        Assert.Single(investigator.SharedKnowledge.AttemptHistory);
    }

    [Fact]
    public void CollectingProposals_ShowsOwnProposalAndPartnerReadinessOnly()
    {
        var gameCase = Case();
        var room = Room();
        var state = room.GameplayState!;
        DiscoverTestimony(state, "fragment-int", "dialogue-int", "int");
        PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-int", "int", PlayerRole.Interrogator, Now);

        var investigator = FullResponse(gameCase);
        var interrogator = FullResponse(gameCase);
        V3KnowledgeProjector.Apply(investigator, room, gameCase, "inv");
        V3KnowledgeProjector.Apply(interrogator, room, gameCase, "int");

        Assert.Equal(PairedConfrontationStatus.CollectingProposals, investigator.ActiveConfrontation!.Status);
        Assert.True(investigator.ActiveConfrontation.PartnerHasProposed);
        Assert.Null(investigator.ActiveConfrontation.Testimony);
        Assert.DoesNotContain(IntSecret, JsonSerializer.Serialize(investigator));
        Assert.NotNull(interrogator.ActiveConfrontation!.Testimony);
        Assert.Contains(IntSecret, JsonSerializer.Serialize(interrogator));
        Assert.Empty(investigator.SharedKnowledge.AttemptHistory);
    }

    [Fact]
    public void IncorrectAttempt_SharesSafeFailureButNeverCorrectEvidenceId()
    {
        var gameCase = Case();
        var room = Room();
        var state = room.GameplayState!;
        Discover(state, "evidence-inv", "inv", PlayerRole.Investigator);
        DiscoverTestimony(state, "fragment-int", "dialogue-int", "int");
        PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-int", "int", PlayerRole.Interrogator, Now);
        PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-inv", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(1));
        PairedConfrontationRules.Confirm(
            state, "attempt-1", "inv", PlayerRole.Investigator, 2, false, Array.Empty<string>(), Now.AddMinutes(2));
        PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, false, Array.Empty<string>(), Now.AddMinutes(3));

        var response = FullResponse(gameCase);
        V3KnowledgeProjector.Apply(response, room, gameCase, "int");
        var json = JsonSerializer.Serialize(response);

        var attempt = Assert.Single(response.SharedKnowledge.AttemptHistory);
        Assert.Equal("The relation does not establish the claimed time.", attempt.Feedback);
        Assert.Contains(InvSecret, json);
        Assert.Contains(IntSecret, json);
        Assert.DoesNotContain("CORRECT_EVIDENCE_SECRET_ID", json);
        Assert.Empty(response.SharedKnowledge.ResolvedTruths);
    }

    [Fact]
    public void CorrectAttempt_EntersResolvedTruthAndUnlocksOnlyOnce()
    {
        var gameCase = Case();
        gameCase.EvidenceChallenges[0].CorrectEvidenceId = "evidence-inv";
        gameCase.EvidenceChallenges[0].UnlockClueIds.Add("reveal-1");
        gameCase.EvidenceChallenges[0].RevealTitle = "The broken seal";
        gameCase.Clues.Add(new CaseClue
        {
            ClueId = "reveal-1",
            Title = "The archive was reopened",
            Content = "Fresh wax proves the seal was remade.",
            NarrativeMeaning = "The alibi no longer holds."
        });
        var room = Room();
        var state = room.GameplayState!;
        Discover(state, "evidence-inv", "inv", PlayerRole.Investigator);
        DiscoverTestimony(state, "fragment-int", "dialogue-int", "int");
        PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-int", "int", PlayerRole.Interrogator, Now);
        PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-inv", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(1));
        PairedConfrontationRules.Confirm(
            state, "attempt-1", "inv", PlayerRole.Investigator, 2, true, new[] { "reveal-1" }, Now.AddMinutes(2));
        PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, true, new[] { "reveal-1" }, Now.AddMinutes(3));
        PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, true, new[] { "reveal-1" }, Now.AddMinutes(4));

        var response = FullResponse(gameCase);
        V3KnowledgeProjector.Apply(response, room, gameCase, "int");

        var truth = Assert.Single(response.SharedKnowledge.ResolvedTruths);
        Assert.Single(response.PrivateTestimonies);
        Assert.Equal("fragment-int", response.PrivateTestimonies[0].TestimonyFragmentId);
        Assert.Empty(response.PrivateEvidence);
        Assert.False(response.IsCaseComplete);
        Assert.Equal("Continue the investigation.", response.CurrentObjective);
        Assert.Equal(V3KnowledgeProjector.ResolvedSharedTruth, truth.Status);
        Assert.Equal("The timeline is broken.", truth.Feedback);
        Assert.Equal("The broken seal", truth.RevealTitle);
        Assert.Equal("reveal-1", Assert.Single(truth.Reveals).ClueId);
        Assert.Empty(response.SharedKnowledge.AttemptHistory);
        Assert.Equal(new[] { "reveal-1" }, state.UnlockedClueIds);
        Assert.Single(state.ResolvedConfrontationRecords);
    }

    [Fact]
    public void CorrectAttempt_DoesNotCompleteCaseWhileAnotherChallengeRemains()
    {
        var gameCase = Case();
        gameCase.EvidenceChallenges[0].CorrectEvidenceId = "evidence-inv";
        gameCase.EvidenceChallenges.Add(new EvidenceChallenge
        {
            ChallengeId = "challenge-2",
            DialogueId = "dialogue-int",
            TestimonyFragmentId = "fragment-int",
            CorrectEvidenceId = "evidence-inv"
        });
        var room = Room();
        var state = room.GameplayState!;
        Discover(state, "evidence-inv", "inv", PlayerRole.Investigator);
        DiscoverTestimony(state, "fragment-int", "dialogue-int", "int");
        PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-int", "int", PlayerRole.Interrogator, Now);
        PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-inv", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(1));
        PairedConfrontationRules.Confirm(
            state, "attempt-1", "inv", PlayerRole.Investigator, 2, true, Array.Empty<string>(), Now.AddMinutes(2));
        PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, true, Array.Empty<string>(), Now.AddMinutes(3));

        var response = FullResponse(gameCase);
        V3KnowledgeProjector.Apply(response, room, gameCase, "int");

        Assert.False(response.IsCaseComplete);
        Assert.Equal("Continue the investigation.", response.CurrentObjective);
    }

    [Fact]
    public void AdditiveV3Projection_PreservesV2PuzzlesDeductionsAndFinalAccusation()
    {
        var gameCase = Case();
        gameCase.Puzzles.Add(new CasePuzzle { PuzzleId = "puzzle-public" });
        var room = Room();
        var investigator = FullResponse(gameCase);
        investigator.VisibleScene.Puzzles.Add(new ScenePuzzleDto
        {
            PuzzleId = "puzzle-public",
            Prompt = "Align the mechanism."
        });
        investigator.Deductions.Add(new DeductionDto
        {
            DeductionId = "deduction-public",
            Prompt = "Which chain explains the evidence?",
            RequiredClueIds = { "private-dependency" },
            MissingClueIds = { "private-dependency" },
            IsAvailable = true
        });
        investigator.AvailableForAccusation = true;
        investigator.AccusationConfig = new AccusationConfigDto
        {
            MotiveOptions = { new AccusationOptionDto { Id = "motive-a", Label = "Protect the archive" } }
        };

        V3KnowledgeProjector.Apply(investigator, room, gameCase, "inv");

        Assert.Single(investigator.VisibleScene.Puzzles);
        var deduction = Assert.Single(investigator.Deductions);
        Assert.True(deduction.IsAvailable);
        Assert.Empty(deduction.RequiredClueIds);
        Assert.Empty(deduction.MissingClueIds);
        Assert.True(investigator.AvailableForAccusation);
        Assert.NotNull(investigator.AccusationConfig);

        var interrogator = FullResponse(gameCase);
        interrogator.VisibleScene.Puzzles.Add(new ScenePuzzleDto { PuzzleId = "puzzle-public" });
        interrogator.Deductions.Add(new DeductionDto { DeductionId = "deduction-public", IsAvailable = true });
        interrogator.AvailableForAccusation = true;
        interrogator.AccusationConfig = investigator.AccusationConfig;

        V3KnowledgeProjector.Apply(interrogator, room, gameCase, "int");

        Assert.Empty(interrogator.VisibleScene.Puzzles);
        Assert.Single(interrogator.Deductions);
        Assert.True(interrogator.AvailableForAccusation);
        Assert.NotNull(interrogator.AccusationConfig);
    }

    [Fact]
    public void EditingAfterReview_DoesNotErasePreviouslyDisclosedPair()
    {
        var gameCase = CaseWithUnrelatedSecrets();
        var room = Room();
        var state = room.GameplayState!;
        Discover(state, "evidence-inv", "inv", PlayerRole.Investigator);
        Discover(state, "evidence-unrelated", "inv", PlayerRole.Investigator);
        DiscoverTestimony(state, "fragment-int", "dialogue-int", "int");
        PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-int", "int", PlayerRole.Interrogator, Now);
        PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-inv", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(1));
        PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, false, Array.Empty<string>(), Now.AddMinutes(2));
        PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-unrelated", "inv", PlayerRole.Investigator, 2, Now.AddMinutes(3));

        var response = FullResponse(gameCase);
        V3KnowledgeProjector.Apply(response, room, gameCase, "int");

        Assert.Equal(2, response.SharedKnowledge.AttemptHistory.Count);
        Assert.Contains(response.SharedKnowledge.AttemptHistory, pair => pair.Revision == 2 && pair.Evidence.ClueId == "evidence-inv");
        Assert.Contains(response.SharedKnowledge.AttemptHistory, pair => pair.Revision == 3 && pair.Evidence.ClueId == "evidence-unrelated");
        Assert.False(response.ActiveConfrontation!.ConfirmedByMe);
        Assert.False(response.ActiveConfrontation.PartnerConfirmed);
    }

    [Fact]
    public void V1AndV2_AreUnchangedByV3Projector()
    {
        foreach (var version in new[] { CaseMechanicsVersions.Legacy, CaseMechanicsVersions.InvestigationV2 })
        {
            var gameCase = Case();
            gameCase.MechanicsVersion = version;
            var response = FullResponse(gameCase);
            var before = JsonSerializer.Serialize(response);

            V3KnowledgeProjector.Apply(response, Room(), gameCase, "inv");

            Assert.Equal(before, JsonSerializer.Serialize(response));
        }
    }

    [Fact]
    public void PlayableSceneProjection_ExposesOnlyTheCurrentRolesActionSurface()
    {
        var gameCase = Case();
        var room = Room();
        var investigator = FullResponse(gameCase);
        var interrogator = FullResponse(gameCase);
        investigator.VisibleScene.Hotspots = new List<HotspotDto>
        {
            new() { HotspotId = "item-hotspot", Type = "ITEM", TargetId = "item-1", Label = "Wax" },
            new() { HotspotId = "npc-hotspot", Type = "CHARACTER", TargetId = "npc-1", Label = "Witness" }
        };
        interrogator.VisibleScene.Hotspots = investigator.VisibleScene.Hotspots;

        V3KnowledgeProjector.Apply(investigator, room, gameCase, "inv");
        V3KnowledgeProjector.Apply(interrogator, room, gameCase, "int");

        Assert.Equal("ITEM", Assert.Single(investigator.VisibleScene.Hotspots).Type);
        Assert.Empty(investigator.VisibleScene.AvailableDialogues);
        Assert.NotEmpty(investigator.VisibleScene.Items);
        Assert.Equal("CHARACTER", Assert.Single(interrogator.VisibleScene.Hotspots).Type);
        Assert.Single(interrogator.VisibleScene.AvailableDialogues);
        Assert.Empty(interrogator.VisibleScene.Items);
        Assert.All(interrogator.VisibleScene.AvailableDialogues, dialogue =>
        {
            Assert.Null(dialogue.Answer);
            Assert.Empty(dialogue.MissingClueIds);
            Assert.Empty(dialogue.EvidenceChallenges);
        });
    }

    /// <summary>
    /// A standing proposal is reviewed by both detectives, but it must not become a side channel for
    /// clue ids the partner never earned. Evidence the pair disclosed through a confrontation stays
    /// readable; a private discovery cited in the same proposal arrives as an undisclosed claim.
    /// </summary>
    [Fact]
    public void ActiveAccusation_KeepsSharedEvidenceIdsAndWithholdsThePrivateOnes()
    {
        var gameCase = CaseWithUnrelatedSecrets();
        var room = Room();
        var state = room.GameplayState!;
        Discover(state, "evidence-inv", "inv", PlayerRole.Investigator);
        Discover(state, "evidence-unrelated", "inv", PlayerRole.Investigator);
        DiscoverTestimony(state, "fragment-int", "dialogue-int", "int");
        PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-int", "int", PlayerRole.Interrogator, Now);
        PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-inv", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(1));
        state.ActiveAccusation = new AccusationProposalState
        {
            AttemptId = "accusation-1",
            Status = AccusationProposalStatus.AwaitingConfirmation,
            Revision = 1,
            ProposedByUserId = "inv",
            ProposedByRole = PlayerRole.Investigator,
            CulpritId = "npc-1",
            EvidenceIds = { "evidence-unrelated" },
            EvidenceLinks =
            {
                new SelectedEvidenceLink { ClaimType = "METHOD", EvidenceId = "evidence-inv" },
                new SelectedEvidenceLink { ClaimType = "MOTIVE", EvidenceId = "evidence-unrelated" }
            }
        };

        var investigator = WithActiveAccusation(FullResponse(gameCase), state);
        var interrogator = WithActiveAccusation(FullResponse(gameCase), state);
        V3KnowledgeProjector.Apply(investigator, room, gameCase, "inv");
        V3KnowledgeProjector.Apply(interrogator, room, gameCase, "int");

        Assert.DoesNotContain("evidence-unrelated", JsonSerializer.Serialize(interrogator));
        Assert.Equal(2, interrogator.ActiveAccusation!.EvidenceLinks.Count);
        Assert.Empty(interrogator.ActiveAccusation.EvidenceIds);
        var shared = interrogator.ActiveAccusation.EvidenceLinks.Single(link => link.ClaimType == "METHOD");
        var withheld = interrogator.ActiveAccusation.EvidenceLinks.Single(link => link.ClaimType == "MOTIVE");
        Assert.Equal("evidence-inv", shared.EvidenceId);
        Assert.False(shared.IsUndisclosed);
        Assert.Null(withheld.EvidenceId);
        Assert.True(withheld.IsUndisclosed);
        // The proposer keeps the full proposal; nothing they earned is hidden back from them.
        Assert.All(investigator.ActiveAccusation!.EvidenceLinks, link => Assert.False(link.IsUndisclosed));
        Assert.Equal("evidence-unrelated", Assert.Single(investigator.ActiveAccusation.EvidenceIds));
    }

    private static GameStateResponse WithActiveAccusation(GameStateResponse response, GameplayState state)
    {
        response.ActiveAccusation = AccusationProposalDto.From(state.ActiveAccusation!);
        return response;
    }

    private static GameCase Case() => new()
    {
        CaseId = "v3-case",
        MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
        Characters =
        {
            new CaseCharacter { CharacterId = "npc-1", Name = "Witness" }
        },
        Dialogues =
        {
            new CaseDialogue
            {
                DialogueId = "dialogue-int",
                CharacterId = "npc-1",
                Question = "Where were you?",
                Answer = $"Legacy answer {IntSecret}"
            }
        },
        TestimonyFragments =
        {
            new TestimonyFragment
            {
                Id = "fragment-int",
                DialogueId = "dialogue-int",
                Text = $"The witness claims nine o'clock. {IntSecret}"
            }
        },
        Clues =
        {
            new CaseClue
            {
                ClueId = "evidence-inv",
                Title = $"Pocket watch {InvSecret}",
                Content = $"Stopped at eight forty. {InvSecret}",
                InventoryDescription = InvSecret,
                NarrativeMeaning = InvSecret,
                IsEvidence = true
            },
            new CaseClue
            {
                ClueId = "CORRECT_EVIDENCE_SECRET_ID",
                Title = "Correct answer must remain private",
                Content = "Correct answer content",
                IsEvidence = true
            }
        },
        EvidenceChallenges =
        {
            new EvidenceChallenge
            {
                ChallengeId = "challenge-1",
                DialogueId = "dialogue-int",
                TestimonyFragmentId = "fragment-int",
                Prompt = $"Private challenge prompt {IntSecret}",
                CorrectEvidenceId = "CORRECT_EVIDENCE_SECRET_ID",
                FailureResponse = "The relation does not establish the claimed time.",
                SuccessResponse = "The timeline is broken."
            }
        }
    };

    private static GameCase CaseWithUnrelatedSecrets()
    {
        var gameCase = Case();
        gameCase.Clues.Add(new CaseClue
        {
            ClueId = "evidence-unrelated",
            Title = "INV_UNRELATED_SENTINEL",
            Content = "INV_UNRELATED_SENTINEL",
            IsEvidence = true
        });
        gameCase.Dialogues.Add(new CaseDialogue
        {
            DialogueId = "dialogue-unrelated",
            CharacterId = "npc-1",
            Question = "Unrelated question",
            Answer = "INT_UNRELATED_SENTINEL"
        });
        gameCase.TestimonyFragments.Add(new TestimonyFragment
        {
            Id = "fragment-unrelated",
            DialogueId = "dialogue-unrelated",
            Text = "INT_UNRELATED_SENTINEL"
        });
        return gameCase;
    }

    private static GameRoom Room() => new()
    {
        Id = "507f1f77bcf86cd799439011",
        Players =
        {
            new RoomPlayer { UserId = "inv", Role = PlayerRole.Investigator, IsConnected = true },
            new RoomPlayer { UserId = "int", Role = PlayerRole.Interrogator, IsConnected = true }
        },
        GameplayState = new GameplayState()
    };

    private static GameStateResponse FullResponse(GameCase gameCase) => new()
    {
        MechanicsVersion = gameCase.MechanicsVersion,
        CurrentObjective = "Continue the investigation.",
        UnlockedClueIds = gameCase.Clues.Select(clue => clue.ClueId).ToList(),
        UsedInteractionIds = { InvSecret },
        SolvedPuzzleIds = { IntSecret },
        UnlockedClues = gameCase.Clues.Select(ClueDto.From).ToList(),
        EvidenceClues = gameCase.Clues.Select(ClueDto.From).ToList(),
        CollectedItems =
        {
            new SceneItemDto { ItemId = "secret-item", Name = InvSecret, Description = InvSecret, InspectText = InvSecret }
        },
        CurrentSceneMissingRequirements = new MissingRequirementsDto
        {
            RequiredClueIds = { InvSecret, IntSecret }
        },
        VisibleScene = new VisibleSceneDto
        {
            Runtime = new SceneRuntime
            {
                ClueZones = { new ClueZone { ClueId = InvSecret, Label = InvSecret } }
            },
            Items =
            {
                new SceneItemDto { ItemId = "secret-item", Name = InvSecret, Description = InvSecret, InspectText = InvSecret }
            },
            AvailableDialogues = gameCase.Dialogues.Select(dialogue => new SceneDialogueDto
            {
                DialogueId = dialogue.DialogueId,
                CharacterId = dialogue.CharacterId,
                Question = dialogue.Question,
                Answer = dialogue.Answer,
                RequiredClueIds = { InvSecret },
                MissingClueIds = { IntSecret },
                EvidenceChallenges = { new EvidenceChallengeDto { ChallengeId = IntSecret, Prompt = IntSecret } }
            }).ToList(),
            ConversationTranscript =
            {
                new ConversationTranscriptEntryDto
                {
                    NodeId = IntSecret,
                    Lines = { new ConversationLineDto { Speaker = "NPC", Text = IntSecret } }
                }
            },
            ConversationTreeCharacterIds = { IntSecret }
        },
        Testimonies =
        {
            new TestimonyDto { DialogueId = "dialogue-int", Question = IntSecret, Answer = IntSecret }
        },
        ActionLog =
        {
            new ActionLogEntryDto { ActionType = InvSecret, Message = IntSecret }
        }
    };

    private static void Discover(GameplayState state, string clueId, string userId, string role) =>
        state.ClueDiscoveries.Add(new ClueDiscoveryRecord
        {
            ClueId = clueId,
            DiscoveredByUserId = userId,
            DiscoveredByRole = role
        });

    private static void DiscoverTestimony(GameplayState state, string fragmentId, string dialogueId, string userId) =>
        state.TestimonyDiscoveries.Add(new TestimonyDiscoveryRecord
        {
            TestimonyFragmentId = fragmentId,
            DialogueId = dialogueId,
            DiscoveredByUserId = userId,
            DiscoveredByRole = PlayerRole.Interrogator
        });
}
