using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The point of accusation consensus is that agreement ends the case exactly once. These tests run
/// the real coordinator and the real resolver against a real MongoDB, because the guarantee lives in
/// the optimistic version check on the room document rather than in any pure rule.
/// </summary>
public sealed class MongoAccusationConsensusTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_MONGO_IT";
    private const string CaseId = "case-v3-accusation-consensus";
    private const string Investigator = "inv";
    private const string Interrogator = "int";

    [Fact]
    public async Task ConcurrentConfirmations_CommitExactlyOneGameResult()
    {
        if (!ShouldRun()) return;

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);

        try
        {
            await db.PingAsync();
            await db.EnsureIndexesAsync();
            var room = await InsertProposedRoomAsync(db);

            // Two snapshots of the same revision is precisely the race a double submit produces.
            var first = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            var second = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            var partner = new CurrentUser(Interrogator, "Partner", UserRole.Player);
            var request = new AccusationRevisionRequest { ExpectedRevision = 1 };

            var outcomes = await Task.WhenAll(
                TryConfirmAsync(db, first, partner, request),
                TryConfirmAsync(db, second, partner, request));

            var winner = Assert.Single(outcomes, outcome => outcome.Response is not null);
            var loser = Assert.Single(outcomes, outcome => outcome.Response is null);
            Assert.True(winner.Response!.Changed);
            Assert.NotNull(winner.Response.Result);
            Assert.Equal(AccusationProposalStatus.Resolved, winner.Response.Accusation!.Status);

            // A stable coded conflict, never an unhandled failure.
            Assert.Equal(409, loser.Failure!.StatusCode);

            var results = await db.GameResults.Find(FilterDefinition<GameResult>.Empty).ToListAsync();
            var stored = Assert.Single(results);
            Assert.Equal(room.Id, stored.RoomId);
            Assert.True(stored.Success);

            var authoritative = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            Assert.Equal(RoomStatus.Completed, authoritative.Status);
            Assert.Equal(GameStatus.Won, authoritative.GameplayState!.GameStatus);
            Assert.Equal(2, authoritative.GameplayState.Version);
            Assert.Null(authoritative.GameplayState.ActiveAccusation);
            var terminal = Assert.Single(authoritative.GameplayState.AccusationAttempts);
            Assert.Equal(AccusationProposalStatus.Resolved, terminal.Status);
            Assert.Equal(2, terminal.Confirmations.Count);
            Assert.NotNull(authoritative.GameplayState.FinalAccusationSnapshot);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task ProposerAlone_CannotEndTheCase()
    {
        if (!ShouldRun()) return;

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);

        try
        {
            await db.PingAsync();
            await db.EnsureIndexesAsync();
            var room = await InsertProposedRoomAsync(db);
            var proposer = new CurrentUser(Investigator, "Proposer", UserRole.Player);

            // Confirming your own proposal again is a retry, not a second vote.
            var retry = await TryConfirmAsync(
                db,
                await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync(),
                proposer,
                new AccusationRevisionRequest { ExpectedRevision = 1 });

            Assert.NotNull(retry.Response);
            Assert.False(retry.Response!.Changed);
            Assert.Null(retry.Response.Result);
            Assert.Empty(await db.GameResults.Find(FilterDefinition<GameResult>.Empty).ToListAsync());

            var authoritative = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            Assert.Equal(RoomStatus.InProgress, authoritative.Status);
            Assert.Equal(1, authoritative.GameplayState!.Version);
            Assert.Single(authoritative.GameplayState.ActiveAccusation!.Confirmations);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task LegacyRoomWithoutAccusationFields_StillLoads()
    {
        if (!ShouldRun()) return;

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);

        try
        {
            await db.PingAsync();
            var id = ObjectId.GenerateNewId();
            // Written the way a pre-consensus build would have written it.
            await db.Database.GetCollection<BsonDocument>(settings.RoomsCollectionName).InsertOneAsync(new BsonDocument
            {
                { "_id", id },
                { "roomCode", "LEGACY" },
                { "caseId", CaseId },
                { "hostUserId", Investigator },
                { "status", RoomStatus.InProgress },
                { "lobbyVersion", 1 },
                {
                    "players", new BsonArray
                    {
                        new BsonDocument { { "userId", Investigator }, { "role", PlayerRole.Investigator } },
                        new BsonDocument { { "userId", Interrogator }, { "role", PlayerRole.Interrogator } }
                    }
                },
                {
                    "gameplayState", new BsonDocument
                    {
                        { "currentStageId", "stage-1" },
                        { "currentSceneId", "scene-1" },
                        { "version", 4L },
                        { "gameStatus", GameStatus.InProgress }
                    }
                }
            });

            var loaded = await db.Rooms.Find(candidate => candidate.Id == id.ToString()).FirstAsync();

            Assert.Null(loaded.GameplayState!.ActiveAccusation);
            Assert.Empty(loaded.GameplayState.AccusationAttempts);
            Assert.Equal(4, loaded.GameplayState.Version);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    private static async Task<GameRoom> InsertProposedRoomAsync(MongoDbContext db)
    {
        var gameCase = BuildCase();
        var state = new GameplayState
        {
            CurrentStageId = "stage-1",
            CurrentSceneId = "scene-1",
            Version = 1,
            CompletedSceneIds = { "scene-1" },
            CompletedStageIds = { "stage-1" },
            VisitedSceneIds = { "scene-1" },
            UnlockedSceneIds = { "scene-1" },
            UnlockedClueIds = { "clue-motive", "clue-method", "clue-opportunity" }
        };
        AccusationConsensusRules.Propose(
            gameCase,
            state,
            "attempt-1",
            Investigator,
            PlayerRole.Investigator,
            "scene-1",
            new AccusationProposalContent(
                "char-1",
                "motive-1",
                "method-1",
                new List<string>(),
                CorrectLinks()),
            new[] { Investigator, Interrogator },
            DateTime.UtcNow);

        var room = new GameRoom
        {
            Id = ObjectId.GenerateNewId().ToString(),
            RoomCode = "CONSNS",
            CaseId = CaseId,
            HostUserId = Investigator,
            Status = RoomStatus.InProgress,
            GameplayState = state,
            Players = new List<RoomPlayer>
            {
                new() { UserId = Investigator, Username = "Proposer", Role = PlayerRole.Investigator },
                new() { UserId = Interrogator, Username = "Partner", Role = PlayerRole.Interrogator }
            }
        };
        await db.Rooms.InsertOneAsync(room);
        return room;
    }

    private static async Task<ConfirmOutcome> TryConfirmAsync(
        MongoDbContext db,
        GameRoom snapshot,
        CurrentUser user,
        AccusationRevisionRequest request)
    {
        var coordinator = BuildCoordinator(db, snapshot);
        try
        {
            return new ConfirmOutcome(
                await coordinator.ConfirmAsync(user, snapshot.Id, "attempt-1", request),
                null);
        }
        catch (ApiException failure)
        {
            return new ConfirmOutcome(null, failure);
        }
    }

    /// <summary>
    /// The production wiring, except that the context loader hands back an already-loaded snapshot so
    /// the two callers deterministically collide on the same revision.
    /// </summary>
    private static AccusationConsensusCoordinator BuildCoordinator(MongoDbContext db, GameRoom snapshot)
    {
        var gameCase = BuildCase();
        var persistence = new GameplayStatePersistence(db, TimeProvider.System);
        var stateBuilder = new GameStateBuilder(db);
        var notifier = new SilentGameNotifier();
        var playtestEvents = new NoOpPlaytestEventSink();
        var resolver = new GameplayService(
            db,
            new SnapshotContextLoader(snapshot, gameCase),
            persistence,
            notifier,
            stateBuilder,
            new UnusedEvidencePhotoService(),
            new MongoGameResultStore(db),
            playtestEvents,
            Options.Create(new AccusationSettings()),
            NullLogger<GameplayService>.Instance);

        return new AccusationConsensusCoordinator(
            new SnapshotContextLoader(snapshot, gameCase),
            persistence,
            stateBuilder,
            notifier,
            playtestEvents,
            resolver,
            TimeProvider.System,
            Options.Create(new AccusationSettings()));
    }

    private static List<SelectedEvidenceLink> CorrectLinks() => new()
    {
        new SelectedEvidenceLink { ClaimType = EvidenceClaimTypes.Motive, EvidenceId = "clue-motive" },
        new SelectedEvidenceLink { ClaimType = EvidenceClaimTypes.Method, EvidenceId = "clue-method" },
        new SelectedEvidenceLink { ClaimType = EvidenceClaimTypes.Opportunity, EvidenceId = "clue-opportunity" }
    };

    private static GameCase BuildCase() => new()
    {
        CaseId = CaseId,
        Title = "Consensus Race",
        Status = CaseStatus.Published,
        MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
        Stages = new List<CaseStage>
        {
            new()
            {
                StageId = "stage-1",
                Order = 1,
                Scenes = new List<CaseScene> { new() { SceneId = "scene-1", Title = "Study" } }
            }
        },
        Characters = new List<CaseCharacter> { new() { CharacterId = "char-1", Name = "Vera Lund" } },
        Clues = new List<CaseClue>
        {
            new() { ClueId = "clue-motive", Title = "Ledger", IsEvidence = true },
            new() { ClueId = "clue-method", Title = "Letter opener", IsEvidence = true },
            new() { ClueId = "clue-opportunity", Title = "Service key", IsEvidence = true }
        },
        FinalLogic = new FinalLogic
        {
            CulpritId = "char-1",
            MotiveOptions = new List<AccusationOption> { new() { Id = "motive-1", Label = "Silencing a creditor" } },
            MethodOptions = new List<AccusationOption> { new() { Id = "method-1", Label = "A letter opener" } },
            CorrectMotiveId = "motive-1",
            CorrectMethodId = "method-1",
            RequiredEvidenceLinks = new List<RequiredEvidenceLink>
            {
                new() { ClaimType = EvidenceClaimTypes.Motive, EvidenceId = "clue-motive" },
                new() { ClaimType = EvidenceClaimTypes.Method, EvidenceId = "clue-method" },
                new() { ClaimType = EvidenceClaimTypes.Opportunity, EvidenceId = "clue-opportunity" }
            },
            WinEnding = "The seal is broken.",
            FailEnding = "The culprit walks away."
        }
    };

    private static bool ShouldRun() => string.Equals(
        Environment.GetEnvironmentVariable(RunEnvironmentVariable),
        "true",
        StringComparison.OrdinalIgnoreCase);

    private static MongoDbSettings NewSettings() => new()
    {
        ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
            ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
        DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
    };

    private sealed record ConfirmOutcome(AccusationCommandResponse? Response, ApiException? Failure);

    private sealed class SnapshotContextLoader : IGameplayContextLoader
    {
        private readonly GameRoom _room;
        private readonly GameCase _case;

        public SnapshotContextLoader(GameRoom room, GameCase gameCase)
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
                _room.Players.First(player => player.UserId == userId)));
    }

    private sealed class UnusedEvidencePhotoService : IEvidencePhotoService
    {
        public Task<NormalizedEvidencePhoto> NormalizeAsync(IFormFile photo, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task UpsertAsync(
            string roomId,
            string clueId,
            string sceneId,
            string userId,
            NormalizedEvidencePhoto photo,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<EvidencePhoto?> GetAsync(string roomId, string clueId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class SilentGameNotifier : IGameNotifier
    {
        public Task PlayerJoined(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task PlayerLeft(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task RolesUpdated(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task ReadyUpdated(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task GameStarted(string roomId, RoomResponse room) => Task.CompletedTask;
        public Task GameStateUpdated(string roomId, long version) => Task.CompletedTask;
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
