using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using System.Net;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
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
