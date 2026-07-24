using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public sealed class PairedConfrontationCoordinatorTests
{
    private const string AttemptId = "c70fb66f-9eb9-456d-bddb-79ce0e6283e2";

    [Fact]
    public async Task FullCorrectFlow_ResolvesAndTerminalRetryDoesNotWriteTwice()
    {
        var playtestEvents = new RecordingPlaytestEventSink();
        var harness = CreateHarness(enabled: true, playtestEvents);
        EnableCandidateMatrix(harness);

        var started = await harness.Coordinator.StartAsync(
            User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-correct"
            });
        var paired = await harness.Coordinator.SubmitEvidenceAsync(
            User("inv"), "room-1", AttemptId, new SubmitPairedEvidenceRequest
            {
                EvidenceId = "evidence-correct",
                ExpectedRevision = started.Revision
            });
        var firstConfirmation = await harness.Coordinator.ConfirmAsync(
            User("inv"), "room-1", AttemptId, new PairedConfrontationRevisionRequest
            {
                ExpectedRevision = paired.Revision
            });
        var resolved = await harness.Coordinator.ConfirmAsync(
            User("int"), "room-1", AttemptId, new PairedConfrontationRevisionRequest
            {
                ExpectedRevision = paired.Revision
            });
        var retry = await harness.Coordinator.ConfirmAsync(
            User("int"), "room-1", AttemptId, new PairedConfrontationRevisionRequest
            {
                ExpectedRevision = paired.Revision
            });

        Assert.Equal(PairedConfrontationStatus.CollectingProposals, started.Status);
        Assert.Equal(PairedConfrontationStatus.ReadyForReview, paired.Status);
        Assert.Equal(PairedConfrontationStatus.AwaitingSecondConfirmation, firstConfirmation.Status);
        Assert.Equal(PairedConfrontationStatus.ResolvedCorrect, resolved.Status);
        Assert.True(resolved.IsTerminal);
        Assert.False(retry.Changed);
        Assert.Equal(PairedConfrontationStatus.ResolvedCorrect, retry.Status);
        Assert.Null(harness.Room.GameplayState!.ActiveConfrontation);
        Assert.Single(harness.Room.GameplayState.PairedConfrontationAttempts);
        Assert.Single(harness.Room.GameplayState.ResolvedConfrontationRecords);
        Assert.Equal(new[] { "reveal-clue" }, harness.Room.GameplayState.UnlockedClueIds);
        Assert.Equal(4, harness.Persistence.SaveCount);
        Assert.Equal(4, harness.Notifier.StateUpdateCount);
        Assert.Equal(new[]
        {
            PlaytestEventType.ConfrontationStarted,
            PlaytestEventType.ProposalSubmitted,
            PlaytestEventType.JointReviewDisclosed,
            PlaytestEventType.ConfirmationFirst,
            PlaytestEventType.ConfirmationSecond,
            PlaytestEventType.ResolvedCorrect
        }, playtestEvents.EventTypes);
        Assert.All(playtestEvents.AttemptIds, id => Assert.Equal(AttemptId, id));
    }

    [Fact]
    public async Task FeatureFlagRoleAndOwnershipFailuresUseStableGenericCodes()
    {
        var disabled = CreateHarness(enabled: false);
        var disabledError = await Assert.ThrowsAsync<ApiException>(() => disabled.Coordinator.StartAsync(
            User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-correct"
            }));
        AssertError(disabledError, 409, PairedConfrontationCoordinator.V3NotEnabledCode);

        var enabled = CreateHarness(enabled: true);
        var wrongRole = await Assert.ThrowsAsync<ApiException>(() => enabled.Coordinator.StartAsync(
            User("inv"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-correct"
            }));
        AssertError(wrongRole, 403, PairedConfrontationRules.WrongRoleCode);

        var unavailable = await Assert.ThrowsAsync<ApiException>(() => enabled.Coordinator.StartAsync(
            User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-secret-or-missing"
            }));
        AssertError(unavailable, 404, PairedConfrontationCoordinator.TestimonyUnavailableCode);
        Assert.DoesNotContain("fragment-secret-or-missing", unavailable.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CandidateAllowlistsRejectOwnedButExcludedChoicesWithGenericUnavailableCodes()
    {
        var harness = CreateHarness(enabled: true);
        var challenge = Assert.Single(harness.Case.EvidenceChallenges);
        EnableCandidateMatrix(harness);
        harness.Case.TestimonyFragments.Add(new TestimonyFragment
        {
            Id = "fragment-excluded",
            DialogueId = "dialogue-1",
            Text = "Owned but not part of this matrix."
        });
        harness.Case.Clues.Add(new CaseClue { ClueId = "evidence-excluded", IsEvidence = true });
        harness.Room.GameplayState!.TestimonyDiscoveries.Add(new TestimonyDiscoveryRecord
        {
            TestimonyFragmentId = "fragment-excluded",
            DialogueId = "dialogue-1",
            DiscoveredByUserId = "int",
            DiscoveredByRole = PlayerRole.Interrogator
        });
        harness.Room.GameplayState.ClueDiscoveries.Add(new ClueDiscoveryRecord
        {
            ClueId = "evidence-excluded",
            DiscoveredByUserId = "inv",
            DiscoveredByRole = PlayerRole.Investigator
        });

        var testimonyError = await Assert.ThrowsAsync<ApiException>(() => harness.Coordinator.StartAsync(
            User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-excluded"
            }));
        AssertError(testimonyError, 404, PairedConfrontationCoordinator.TestimonyUnavailableCode);

        var started = await harness.Coordinator.StartAsync(
            User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-correct"
            });
        var evidenceError = await Assert.ThrowsAsync<ApiException>(() => harness.Coordinator.SubmitEvidenceAsync(
            User("inv"), "room-1", AttemptId, new SubmitPairedEvidenceRequest
            {
                EvidenceId = "evidence-excluded",
                ExpectedRevision = started.Revision
            }));
        AssertError(evidenceError, 404, PairedConfrontationCoordinator.EvidenceUnavailableCode);
    }

    [Fact]
    public async Task AllEightWrongCandidatePairsResolveIncorrectWithoutUnlockingReveal()
    {
        var evidenceIds = new[] { "evidence-correct", "evidence-wrong-a", "evidence-wrong-b" };
        var fragmentIds = new[] { "fragment-correct", "fragment-wrong-a", "fragment-wrong-b" };
        var wrongPairs = evidenceIds.SelectMany(evidenceId => fragmentIds.Select(fragmentId => (evidenceId, fragmentId)))
            .Where(pair => pair.evidenceId != "evidence-correct" || pair.fragmentId != "fragment-correct")
            .ToList();

        Assert.Equal(8, wrongPairs.Count);
        foreach (var (evidenceId, fragmentId) in wrongPairs)
        {
            var harness = CreateHarness(enabled: true);
            EnableCandidateMatrix(harness);
            var attemptId = Guid.NewGuid().ToString();
            var started = await harness.Coordinator.StartAsync(User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = attemptId,
                TestimonyFragmentId = fragmentId
            });
            var paired = await harness.Coordinator.SubmitEvidenceAsync(User("inv"), "room-1", attemptId, new SubmitPairedEvidenceRequest
            {
                EvidenceId = evidenceId,
                ExpectedRevision = started.Revision
            });
            await harness.Coordinator.ConfirmAsync(User("inv"), "room-1", attemptId, new PairedConfrontationRevisionRequest
            {
                ExpectedRevision = paired.Revision
            });
            var resolved = await harness.Coordinator.ConfirmAsync(User("int"), "room-1", attemptId, new PairedConfrontationRevisionRequest
            {
                ExpectedRevision = paired.Revision
            });

            Assert.Equal(PairedConfrontationStatus.ResolvedIncorrect, resolved.Status);
            Assert.Empty(harness.Room.GameplayState!.UnlockedClueIds);
            Assert.Empty(harness.Room.GameplayState.ResolvedConfrontationRecords);
            Assert.Single(harness.Room.GameplayState.PairedConfrontationAttempts);
        }
    }

    [Fact]
    public async Task LegacyV3WithoutCandidateListsStillFindsChallengeByDialogue()
    {
        var harness = CreateHarness(enabled: true);

        var started = await harness.Coordinator.StartAsync(User("int"), "room-1", new StartPairedConfrontationRequest
        {
            AttemptId = AttemptId,
            TestimonyFragmentId = "fragment-correct"
        });

        Assert.Equal(PairedConfrontationStatus.CollectingProposals, started.Status);
        Assert.Empty(Assert.Single(harness.Case.EvidenceChallenges).CandidateTestimonyFragmentIds);
    }

    [Fact]
    public async Task EmptyReadinessListsFallbackToAllCandidateChoices()
    {
        var harness = CreateHarness(enabled: true);
        EnableCandidateMatrix(harness);
        harness.Case.GenerationPreset = AiGenerationPresets.CrackTheLieV3;
        harness.Room.GameplayState!.ClueDiscoveries.RemoveAll(discovery =>
            discovery.ClueId == "evidence-wrong-b");

        var blocked = await Assert.ThrowsAsync<ApiException>(() => harness.Coordinator.StartAsync(
            User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-correct"
            }));

        AssertError(blocked, 409, PairedConfrontationRules.NotAvailableCode);
        Assert.DoesNotContain("evidence-wrong-b", blocked.Message, StringComparison.Ordinal);

        harness.Room.GameplayState.ClueDiscoveries.Add(new ClueDiscoveryRecord
        {
            ClueId = "evidence-wrong-b",
            DiscoveredByUserId = "inv",
            DiscoveredByRole = PlayerRole.Investigator
        });

        var started = await harness.Coordinator.StartAsync(
            User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-correct"
            });

        Assert.Equal(PairedConfrontationStatus.CollectingProposals, started.Status);
    }

    [Fact]
    public async Task RequiredSubsetOpensCrackWhileOptionalCandidatesRemainUndiscovered()
    {
        var harness = CreateHarness(enabled: true);
        EnableCandidateMatrix(harness);
        harness.Case.GenerationPreset = AiGenerationPresets.NormalRandom;
        var challenge = Assert.Single(harness.Case.EvidenceChallenges);
        challenge.StartRequiredEvidenceIds = ["evidence-correct", "evidence-wrong-a"];
        challenge.StartRequiredTestimonyFragmentIds = ["fragment-correct", "fragment-wrong-a"];
        harness.Room.GameplayState!.ClueDiscoveries.RemoveAll(discovery => discovery.ClueId == "evidence-wrong-b");
        harness.Room.GameplayState.TestimonyDiscoveries.RemoveAll(discovery =>
            discovery.TestimonyFragmentId == "fragment-wrong-b");

        var started = await harness.Coordinator.StartAsync(
            User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-correct"
            });

        Assert.Equal(PairedConfrontationStatus.CollectingProposals, started.Status);
        Assert.DoesNotContain(harness.Room.GameplayState.ClueDiscoveries,
            discovery => discovery.ClueId == "evidence-wrong-b");
        Assert.DoesNotContain(harness.Room.GameplayState.TestimonyDiscoveries,
            discovery => discovery.TestimonyFragmentId == "fragment-wrong-b");
    }

    [Fact]
    public async Task OptimisticConflict_ReloadsAuthoritativeStateAndRetriesOnce()
    {
        var firstRoom = BuildRoom();
        var secondRoom = BuildRoom();
        var gameCase = BuildCase();
        var loader = new QueueContextLoader(gameCase, firstRoom, secondRoom);
        var persistence = new ConflictOncePersistence();
        var notifier = new RecordingNotifier();
        var coordinator = new PairedConfrontationCoordinator(
            loader,
            persistence,
            new MinimalStateBuilder(),
            notifier,
            new NoOpPlaytestEventSink(),
            TimeProvider.System,
            Options.Create(new GameplayV3Settings { Enabled = true }));

        var response = await coordinator.StartAsync(
            User("int"), "room-1", new StartPairedConfrontationRequest
            {
                AttemptId = AttemptId,
                TestimonyFragmentId = "fragment-correct"
            });

        Assert.True(response.Changed);
        Assert.Equal(2, loader.LoadCount);
        Assert.Equal(2, persistence.SaveCount);
        Assert.NotNull(secondRoom.GameplayState!.ActiveConfrontation);
        Assert.Equal(1, notifier.StateUpdateCount);
    }

    private static Harness CreateHarness(bool enabled, IPlaytestEventSink? playtestEvents = null)
    {
        var room = BuildRoom();
        var gameCase = BuildCase();
        var persistence = new RecordingPersistence();
        var notifier = new RecordingNotifier();
        var coordinator = new PairedConfrontationCoordinator(
            new SingleContextLoader(room, gameCase),
            persistence,
            new MinimalStateBuilder(),
            notifier,
            playtestEvents ?? new NoOpPlaytestEventSink(),
            TimeProvider.System,
            Options.Create(new GameplayV3Settings { Enabled = enabled }));
        return new Harness(coordinator, room, gameCase, persistence, notifier);
    }

    private static GameRoom BuildRoom() => new()
    {
        Id = "room-1",
        CaseId = "case-v3",
        Status = RoomStatus.InProgress,
        Players = new List<RoomPlayer>
        {
            new() { UserId = "inv", Username = "investigator", Role = PlayerRole.Investigator },
            new() { UserId = "int", Username = "interrogator", Role = PlayerRole.Interrogator }
        },
        GameplayState = new GameplayState
        {
            Version = 1,
            ClueDiscoveries = new List<ClueDiscoveryRecord>
            {
                new()
                {
                    ClueId = "evidence-correct",
                    DiscoveredByUserId = "inv",
                    DiscoveredByRole = PlayerRole.Investigator
                }
            },
            TestimonyDiscoveries = new List<TestimonyDiscoveryRecord>
            {
                new()
                {
                    TestimonyFragmentId = "fragment-correct",
                    DialogueId = "dialogue-1",
                    DiscoveredByUserId = "int",
                    DiscoveredByRole = PlayerRole.Interrogator
                }
            }
        }
    };

    private static GameCase BuildCase() => new()
    {
        CaseId = "case-v3",
        MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
        TestimonyFragments = new List<TestimonyFragment>
        {
            new() { Id = "fragment-correct", DialogueId = "dialogue-1", Text = "Private testimony" }
        },
        Clues = new List<CaseClue>
        {
            new() { ClueId = "evidence-correct", IsEvidence = true },
            new() { ClueId = "reveal-clue", IsEvidence = false }
        },
        EvidenceChallenges = new List<EvidenceChallenge>
        {
            new()
            {
                ChallengeId = "challenge-1",
                DialogueId = "dialogue-1",
                TestimonyFragmentId = "fragment-correct",
                CorrectEvidenceId = "evidence-correct",
                UnlockClueIds = new List<string> { "reveal-clue" }
            }
        }
    };

    private static CurrentUser User(string id) => new(id, id, "PLAYER");

    private static void EnableCandidateMatrix(Harness harness)
    {
        var challenge = Assert.Single(harness.Case.EvidenceChallenges);
        challenge.CandidateEvidenceIds = new List<string>
        {
            "evidence-correct", "evidence-wrong-a", "evidence-wrong-b"
        };
        challenge.CandidateTestimonyFragmentIds = new List<string>
        {
            "fragment-correct", "fragment-wrong-a", "fragment-wrong-b"
        };
        harness.Case.Clues.AddRange(new[]
        {
            new CaseClue { ClueId = "evidence-wrong-a", IsEvidence = true },
            new CaseClue { ClueId = "evidence-wrong-b", IsEvidence = true }
        });
        harness.Case.TestimonyFragments.AddRange(new[]
        {
            new TestimonyFragment { Id = "fragment-wrong-a", DialogueId = "dialogue-1", Text = "Wrong claim A" },
            new TestimonyFragment { Id = "fragment-wrong-b", DialogueId = "dialogue-1", Text = "Wrong claim B" }
        });
        harness.Room.GameplayState!.ClueDiscoveries.AddRange(new[]
        {
            new ClueDiscoveryRecord { ClueId = "evidence-wrong-a", DiscoveredByUserId = "inv", DiscoveredByRole = PlayerRole.Investigator },
            new ClueDiscoveryRecord { ClueId = "evidence-wrong-b", DiscoveredByUserId = "inv", DiscoveredByRole = PlayerRole.Investigator }
        });
        harness.Room.GameplayState.TestimonyDiscoveries.AddRange(new[]
        {
            new TestimonyDiscoveryRecord { TestimonyFragmentId = "fragment-wrong-a", DialogueId = "dialogue-1", DiscoveredByUserId = "int", DiscoveredByRole = PlayerRole.Interrogator },
            new TestimonyDiscoveryRecord { TestimonyFragmentId = "fragment-wrong-b", DialogueId = "dialogue-1", DiscoveredByUserId = "int", DiscoveredByRole = PlayerRole.Interrogator }
        });
    }

    private static void AssertError(ApiException exception, int status, string code)
    {
        Assert.Equal(status, exception.StatusCode);
        var details = Assert.IsType<ApiErrorDetails>(exception.Errors);
        Assert.Equal(code, details.Code);
        Assert.False(string.IsNullOrWhiteSpace(details.MessageKey));
    }

    private sealed record Harness(
        PairedConfrontationCoordinator Coordinator,
        GameRoom Room,
        GameCase Case,
        RecordingPersistence Persistence,
        RecordingNotifier Notifier);

    private sealed class RecordingPlaytestEventSink : IPlaytestEventSink
    {
        public List<PlaytestEventType> EventTypes { get; } = new();
        public List<string?> AttemptIds { get; } = new();

        public Task RecordAsync(
            string roomId,
            string userId,
            string role,
            PlaytestEventType eventType,
            long stateVersion,
            string? attemptId = null,
            int? revision = null,
            long? durationMs = null,
            int? count = null,
            CancellationToken cancellationToken = default)
        {
            EventTypes.Add(eventType);
            AttemptIds.Add(attemptId);
            return Task.CompletedTask;
        }
    }

    private sealed class SingleContextLoader : IGameplayContextLoader
    {
        private readonly GameRoom _room;
        private readonly GameCase _case;

        public SingleContextLoader(GameRoom room, GameCase gameCase)
        {
            _room = room;
            _case = gameCase;
        }

        public Task<GameplayContext> LoadAsync(
            string userId,
            string roomId,
            bool requireInProgress,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new GameplayContext(
                _room,
                _case,
                _room.Players.Single(player => player.UserId == userId)));
    }

    private sealed class QueueContextLoader : IGameplayContextLoader
    {
        private readonly Queue<GameRoom> _rooms;
        private readonly GameCase _case;

        public QueueContextLoader(GameCase gameCase, params GameRoom[] rooms)
        {
            _case = gameCase;
            _rooms = new Queue<GameRoom>(rooms);
        }

        public int LoadCount { get; private set; }

        public Task<GameplayContext> LoadAsync(
            string userId,
            string roomId,
            bool requireInProgress,
            CancellationToken cancellationToken = default)
        {
            LoadCount++;
            var room = _rooms.Dequeue();
            return Task.FromResult(new GameplayContext(
                room,
                _case,
                room.Players.Single(player => player.UserId == userId)));
        }
    }

    private class RecordingPersistence : IGameplayStatePersistence
    {
        public int SaveCount { get; protected set; }

        public virtual Task<bool> TrySaveAsync(
            GameRoom room,
            GameCase? gameCase = null,
            CancellationToken cancellationToken = default)
        {
            SaveCount++;
            room.GameplayState!.Version++;
            return Task.FromResult(true);
        }
    }

    private sealed class ConflictOncePersistence : RecordingPersistence
    {
        public override Task<bool> TrySaveAsync(
            GameRoom room,
            GameCase? gameCase = null,
            CancellationToken cancellationToken = default)
        {
            SaveCount++;
            if (SaveCount == 1) return Task.FromResult(false);
            room.GameplayState!.Version++;
            return Task.FromResult(true);
        }
    }

    private sealed class MinimalStateBuilder : IGameStateBuilder
    {
        public Task<GameStateResponse> BuildStateAsync(GameRoom room, GameCase gameCase, string userId) =>
            Task.FromResult(new GameStateResponse
            {
                RoomId = room.Id,
                CaseId = gameCase.CaseId,
                MechanicsVersion = gameCase.MechanicsVersion,
                Version = room.GameplayState!.Version
            });
    }

    private sealed class RecordingNotifier : IGameNotifier
    {
        public int StateUpdateCount { get; private set; }
        public Task GameStateUpdated(string roomId, long version)
        {
            StateUpdateCount++;
            return Task.CompletedTask;
        }

        public Task PlayerJoined(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task PlayerLeft(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task RolesUpdated(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task ReadyUpdated(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task GameStarted(string roomId, RoomResponse room) => Task.CompletedTask;
        public Task ItemFound(string roomId, string itemId, string userId, long version) => Task.CompletedTask;
        public Task ClueUnlocked(string roomId, string clueId, string? sourceId, string userId, long version) => Task.CompletedTask;
        public Task DialogueAnswered(string roomId, string dialogueId, string userId, long version) => Task.CompletedTask;
        public Task EvidencePresented(string roomId, string dialogueId, string evidenceId, string userId, long version) => Task.CompletedTask;
        public Task InvestigationUpdate(string roomId, InvestigationUpdateDto update) => Task.CompletedTask;
        public Task SceneChanged(string roomId, string previousSceneId, string currentSceneId, string userId, long version) => Task.CompletedTask;
        public Task StageChanged(string roomId, string previousStageId, string currentStageId, string previousSceneId, string currentSceneId, bool isFinalStageCompleted, string userId, long version) => Task.CompletedTask;
        public Task GameCompleted(string roomId, GameResultResponse result) => Task.CompletedTask;
        public Task SystemMessage(string roomId, string message) => Task.CompletedTask;
    }
}
