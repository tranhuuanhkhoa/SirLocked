using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System.Net;
using System.Text.Json;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class MongoGameplayConcurrencyTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_MONGO_IT";

    [Fact]
    public async Task ConcurrentSecondConfirmation_CommitsExactlyOneTerminalOutcome()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable(RunEnvironmentVariable),
                "true",
                StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);

        try
        {
            await db.PingAsync();
            var room = BuildReadyRoom();
            await db.Rooms.InsertOneAsync(room);

            var firstSnapshot = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            var secondSnapshot = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            ResolveWithSecondConfirmation(firstSnapshot);
            ResolveWithSecondConfirmation(secondSnapshot);

            var persistence = new GameplayStatePersistence(db, TimeProvider.System);
            var writes = await Task.WhenAll(
                persistence.TrySaveAsync(firstSnapshot),
                persistence.TrySaveAsync(secondSnapshot));

            Assert.Single(writes, saved => saved);
            Assert.Single(writes, saved => !saved);

            var authoritative = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            Assert.Equal(2, authoritative.GameplayState!.Version);
            Assert.Null(authoritative.GameplayState.ActiveConfrontation);
            Assert.Single(authoritative.GameplayState.PairedConfrontationAttempts);
            Assert.Single(authoritative.GameplayState.ResolvedConfrontationRecords);
            Assert.Equal(new[] { "reveal-clue" }, authoritative.GameplayState.UnlockedClueIds);

            var retry = PairedConfrontationRules.Confirm(
                authoritative.GameplayState,
                "attempt-1",
                "int",
                PlayerRole.Interrogator,
                2,
                isCorrect: true,
                new[] { "reveal-clue" },
                DateTime.UtcNow);
            Assert.False(retry.Changed);
            Assert.Single(authoritative.GameplayState.PairedConfrontationAttempts);
            Assert.Single(authoritative.GameplayState.UnlockedClueIds);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task ConcurrentStarts_CommitExactlyOneGameplayState()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable(RunEnvironmentVariable),
                "true",
                StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);

        try
        {
            await db.PingAsync();
            var room = BuildStartableRoom();
            await db.Rooms.InsertOneAsync(room);

            var host = new CurrentUser(room.HostUserId, "Host", UserRole.Player);
            var service = new RoomService(db, new StubCaseService(), new SilentNotifier());
            var outcomes = await Task.WhenAll(
                TryStartAsync(service, host, room.Id),
                TryStartAsync(service, host, room.Id));

            Assert.Single(outcomes, outcome => outcome.Started);
            var rejected = Assert.Single(outcomes, outcome => !outcome.Started);
            Assert.Equal(409, rejected.Failure!.StatusCode);

            var authoritative = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            Assert.Equal(RoomStatus.InProgress, authoritative.Status);
            Assert.NotNull(authoritative.GameplayState);
            Assert.Equal(1, authoritative.GameplayState!.Version);
            Assert.Equal("scene-1", authoritative.GameplayState.CurrentSceneId);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task StartOnAbandonedRoom_IsRefusedAndKeepsTheFinishedGameplayState()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable(RunEnvironmentVariable),
                "true",
                StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);
        var endedAt = new DateTime(2026, 7, 20, 10, 0, 0, DateTimeKind.Utc);

        try
        {
            await db.PingAsync();
            var room = BuildStartableRoom();
            room.Status = RoomStatus.Abandoned;
            room.GameplayState = new GameplayState
            {
                CurrentStageId = "stage-1",
                CurrentSceneId = "scene-9",
                Version = 11,
                GameStatus = GameStatus.Failed,
                CompletedAt = endedAt
            };
            await db.Rooms.InsertOneAsync(room);

            var host = new CurrentUser(room.HostUserId, "Host", UserRole.Player);
            var service = new RoomService(db, new StubCaseService(), new SilentNotifier());

            var failure = await Assert.ThrowsAsync<ApiException>(() => service.StartAsync(host, room.Id));

            Assert.Equal(409, failure.StatusCode);
            Assert.Equal(RoomService.RoomEndedMessage, failure.Message);
            var authoritative = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            Assert.Equal(RoomStatus.Abandoned, authoritative.Status);
            Assert.Equal(11, authoritative.GameplayState!.Version);
            Assert.Equal(endedAt, authoritative.GameplayState.CompletedAt);
            Assert.Equal("scene-9", authoritative.GameplayState.CurrentSceneId);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task JoinOnAbandonedRoom_StaysRefused()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable(RunEnvironmentVariable),
                "true",
                StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);

        try
        {
            await db.PingAsync();
            var room = BuildStartableRoom();
            room.Status = RoomStatus.Abandoned;
            room.Players.RemoveAt(1); // a free slot is what would make an unguarded join succeed
            await db.Rooms.InsertOneAsync(room);
            var newcomer = new User
            {
                Id = ObjectId.GenerateNewId().ToString(),
                FullName = "Newcomer",
                Email = "newcomer@example.com",
                IsEmailVerified = true
            };
            await db.Users.InsertOneAsync(newcomer);

            var service = new RoomService(db, new StubCaseService(), new SilentNotifier());
            var failure = await Assert.ThrowsAsync<ApiException>(() => service.JoinAsync(
                new CurrentUser(newcomer.Id, newcomer.FullName, UserRole.Player),
                room.RoomCode));

            Assert.Equal(409, failure.StatusCode);
            var authoritative = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
            Assert.Equal(RoomStatus.Abandoned, authoritative.Status);
            Assert.Single(authoritative.Players);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task ConcurrentAiPhaseClaims_AllowExactlyOneGenerator()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable(RunEnvironmentVariable),
                "true",
                StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);

        try
        {
            await db.PingAsync();
            var draft = new AiCaseDraft
            {
                Id = ObjectId.GenerateNewId().ToString(),
                Status = AiDraftStatus.FullLogicAwaitingApproval,
                GenerationPhase = "FULL_LOGIC_AWAITING_APPROVAL"
            };
            await db.AiCaseDrafts.InsertOneAsync(draft);

            var firstSnapshot = await db.AiCaseDrafts.Find(candidate => candidate.Id == draft.Id).FirstAsync();
            var secondSnapshot = await db.AiCaseDrafts.Find(candidate => candidate.Id == draft.Id).FirstAsync();
            var coordinator = new AiDraftWorkflowCoordinator(db, TimeProvider.System);

            var claims = await Task.WhenAll(
                coordinator.ClaimAsync(
                    firstSnapshot,
                    new[] { AiDraftStatus.FullLogicAwaitingApproval },
                    AiDraftStatus.GeneratingSceneLayout,
                    "SCENE_LAYOUT"),
                coordinator.ClaimAsync(
                    secondSnapshot,
                    new[] { AiDraftStatus.FullLogicAwaitingApproval },
                    AiDraftStatus.GeneratingSceneLayout,
                    "SCENE_LAYOUT"));

            Assert.Single(claims, claim => claim.Acquired);
            Assert.Single(claims, claim => !claim.Acquired);
            Assert.NotEmpty(claims[0].Draft.GenerationRunId);
            Assert.Equal(claims[0].Draft.GenerationRunId, claims[1].Draft.GenerationRunId);

            var authoritative = await db.AiCaseDrafts.Find(candidate => candidate.Id == draft.Id).FirstAsync();
            Assert.Equal(AiDraftStatus.GeneratingSceneLayout, authoritative.Status);
            Assert.Equal("SCENE_LAYOUT", authoritative.GenerationPhase);
            Assert.NotEmpty(authoritative.GenerationRunId);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task ExpiredAiLeaseCanBeReclaimedAndOldRunCannotHeartbeat()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable(RunEnvironmentVariable), "true", StringComparison.OrdinalIgnoreCase))
            return;

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);
        var now = new DateTimeOffset(2026, 7, 19, 12, 0, 0, TimeSpan.Zero);

        try
        {
            await db.PingAsync();
            var stale = new AiCaseDraft
            {
                Id = ObjectId.GenerateNewId().ToString(),
                Status = AiDraftStatus.GeneratingFullCase,
                GenerationPhase = "FULL_LOGIC",
                GenerationRunId = "stale-run",
                GenerationClaimedAt = now.UtcDateTime.AddMinutes(-21)
            };
            await db.AiCaseDrafts.InsertOneAsync(stale);
            var coordinator = new AiDraftWorkflowCoordinator(db, new FixedTimeProvider(now));

            var reclaimed = await coordinator.ClaimAsync(
                stale,
                [AiDraftStatus.GeneratingFullCase],
                AiDraftStatus.GeneratingFullCase,
                "FULL_LOGIC");

            Assert.True(reclaimed.Acquired);
            Assert.NotEqual("stale-run", reclaimed.Draft.GenerationRunId);
            Assert.False(await coordinator.HeartbeatAsync(stale));
            Assert.True(await coordinator.HeartbeatAsync(reclaimed.Draft));
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task MongoQueue_DeduplicatesOperationAndRejectsStaleCompletion()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable(RunEnvironmentVariable), "true", StringComparison.OrdinalIgnoreCase))
            return;

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);
        try
        {
            await db.PingAsync();
            var draft = new AiCaseDraft
            {
                Id = ObjectId.GenerateNewId().ToString(),
                Status = AiDraftStatus.StoryAwaitingApproval,
                WorkflowVersion = 3
            };
            await db.AiCaseDrafts.InsertOneAsync(draft);
            var first = await db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync();
            var second = await db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync();
            var coordinator = new AiDraftWorkflowCoordinator(db, TimeProvider.System);

            var queued = await Task.WhenAll(
                coordinator.EnqueueAsync(
                    first,
                    [AiDraftStatus.StoryAwaitingApproval],
                    AiDraftStatus.GeneratingCaseTruth,
                    AiQueuedOperations.CaseTruth,
                    "CASE_TRUTH"),
                coordinator.EnqueueAsync(
                    second,
                    [AiDraftStatus.StoryAwaitingApproval],
                    AiDraftStatus.GeneratingCaseTruth,
                    AiQueuedOperations.CaseTruth,
                    "CASE_TRUTH"));

            Assert.Single(queued, result => result.Acquired);
            Assert.Single(queued, result => !result.Acquired);
            var running = await coordinator.ClaimNextQueuedAsync();
            Assert.NotNull(running);
            Assert.Equal(AiQueueStates.Running, running!.QueueState);
            Assert.NotEmpty(running.GenerationRunId);
            Assert.NotEmpty(running.GenerationInputHash);

            await db.AiCaseDrafts.UpdateOneAsync(
                item => item.Id == draft.Id && item.WorkflowVersion == running.WorkflowVersion,
                Builders<AiCaseDraft>.Update
                    .Inc(item => item.WorkflowVersion, 1)
                    .Set(item => item.GenerationRunId, "new-authoritative-run"));

            Assert.False(await coordinator.CompleteQueuedAsync(running));
            var authoritative = await db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync();
            Assert.Equal("new-authoritative-run", authoritative.GenerationRunId);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task MongoQueue_RetriesOneBenignVersionDriftWhenGenerationInputsAreUnchanged()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable(RunEnvironmentVariable), "true", StringComparison.OrdinalIgnoreCase))
            return;

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);
        try
        {
            await db.PingAsync();
            var draft = new AiCaseDraft
            {
                Id = ObjectId.GenerateNewId().ToString(),
                Status = AiDraftStatus.GeneratedInvalid,
                FailurePhase = AiFailurePhases.ProjectionContentJson,
                WorkflowVersion = 13,
                ProjectionPlanHash = new string('a', 64),
                TruthHash = new string('b', 64)
            };
            await db.AiCaseDrafts.InsertOneAsync(draft);
            var observed = await db.AiCaseDrafts.Find(item => item.Id == draft.Id).FirstAsync();
            await db.AiCaseDrafts.UpdateOneAsync(
                item => item.Id == draft.Id,
                Builders<AiCaseDraft>.Update
                    .Inc(item => item.WorkflowVersion, 1)
                    .Set(item => item.UpdatedAt, DateTime.UtcNow));

            var queued = await new AiDraftWorkflowCoordinator(db, TimeProvider.System).EnqueueAsync(
                observed,
                [AiDraftStatus.GeneratedInvalid],
                AiDraftStatus.GeneratingFullCase,
                AiQueuedOperations.RetryJson,
                "FULL_LOGIC_RETRY");

            Assert.True(queued.Acquired);
            Assert.Equal(15, queued.Draft.WorkflowVersion);
            Assert.Equal(AiQueueStates.Pending, queued.Draft.QueueState);
            Assert.Equal(AiQueuedOperations.RetryJson, queued.Draft.QueuedOperation);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    private static MongoDbSettings NewSettings() => new()
    {
        ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
            ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
        DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
    };

    private sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;
    }

    private static GameRoom BuildReadyRoom()
    {
        var state = new GameplayState { Version = 1 };
        PairedConfrontationRules.Start(
            state,
            "attempt-1",
            "challenge-1",
            "fragment-1",
            "int",
            PlayerRole.Interrogator,
            DateTime.UtcNow);
        PairedConfrontationRules.ProposeEvidence(
            state,
            "attempt-1",
            "evidence-correct",
            "inv",
            PlayerRole.Investigator,
            1,
            DateTime.UtcNow);
        PairedConfrontationRules.Confirm(
            state,
            "attempt-1",
            "inv",
            PlayerRole.Investigator,
            2,
            isCorrect: true,
            new[] { "reveal-clue" },
            DateTime.UtcNow);

        return new GameRoom
        {
            Id = ObjectId.GenerateNewId().ToString(),
            CaseId = "case-v3-concurrency",
            Status = RoomStatus.InProgress,
            GameplayState = state,
            Players = new List<RoomPlayer>
            {
                new() { UserId = "inv", Role = PlayerRole.Investigator },
                new() { UserId = "int", Role = PlayerRole.Interrogator }
            }
        };
    }

    private static GameRoom BuildStartableRoom() => new()
    {
        Id = ObjectId.GenerateNewId().ToString(),
        RoomCode = "STARTR",
        CaseId = "case-start-race",
        HostUserId = "host-1",
        Status = RoomStatus.Ready,
        Players = new List<RoomPlayer>
        {
            new() { UserId = "host-1", Username = "Host", Role = PlayerRole.Investigator, IsReady = true },
            new() { UserId = "guest-1", Username = "Guest", Role = PlayerRole.Interrogator, IsReady = true }
        }
    };

    private static async Task<StartOutcome> TryStartAsync(RoomService service, CurrentUser user, string roomId)
    {
        try
        {
            await service.StartAsync(user, roomId);
            return new StartOutcome(true, null);
        }
        catch (ApiException failure)
        {
            return new StartOutcome(false, failure);
        }
    }

    private sealed record StartOutcome(bool Started, ApiException? Failure);

    private sealed class StubCaseService : ICaseService
    {
        public Task<GameCase> GetCaseAsync(string caseId) => Task.FromResult(new GameCase
        {
            CaseId = caseId,
            Title = "Start Race",
            Status = CaseStatus.Published,
            Stages = new List<CaseStage>
            {
                new()
                {
                    StageId = "stage-1",
                    Order = 1,
                    Scenes = new List<CaseScene> { new() { SceneId = "scene-1" } }
                }
            }
        });

        public Task<GameCase?> FindCaseAsync(string caseId) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> GetPublishedAsync() => throw new NotSupportedException();
        public Task<CasePublicDetailResponse> GetPublicDetailAsync(string caseId) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> GetAllForAdminAsync() => throw new NotSupportedException();
        public CaseValidationResponse ValidateJson(JsonElement caseJson) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> ImportJsonAsync(JsonElement caseJson, bool overwrite, bool preserveServerMetadata = false) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> PublishAsync(string caseId) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> UnpublishAsync(string caseId) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> SeedSampleAsync(bool publish) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedDemoAsync() => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedCrackDemoAsync() => throw new NotSupportedException();
        public GameCase ParseCase(JsonElement caseJson) => throw new NotSupportedException();
        public GameCase ParseCase(string caseJson) => throw new NotSupportedException();
    }

    private sealed class SilentNotifier : IGameNotifier
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

    private static void ResolveWithSecondConfirmation(GameRoom room) =>
        PairedConfrontationRules.Confirm(
            room.GameplayState!,
            "attempt-1",
            "int",
            PlayerRole.Interrogator,
            2,
            isCorrect: true,
            new[] { "reveal-clue" },
            DateTime.UtcNow);
}

internal static class TestMongoSafetyGuard
{
    private const string RequiredDatabasePrefix = "sirlocked_it_";

    public static void EnsureSafe(MongoDbSettings settings)
    {
        if (!settings.DatabaseName.StartsWith(RequiredDatabasePrefix, StringComparison.Ordinal))
            throw new InvalidOperationException($"Test database must start with '{RequiredDatabasePrefix}'.");
        if (settings.ConnectionString.StartsWith("mongodb+srv", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("MongoDB SRV connections are forbidden for integration tests.");

        var mongoUrl = new MongoUrl(settings.ConnectionString);
        var servers = mongoUrl.Servers.ToList();
        if (servers.Count == 0 || servers.Any(server => !IsLoopback(server.Host)))
            throw new InvalidOperationException("Integration tests require a loopback-only MongoDB connection.");
    }

    private static bool IsLoopback(string host)
    {
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)) return true;
        return IPAddress.TryParse(host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address);
    }
}
