using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class V3MongoConcurrencyTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_V3_MONGO_IT";

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
        V3LocalMongoSafetyGuard.EnsureSafe(settings);
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
            V3LocalMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    private static MongoDbSettings NewSettings() => new()
    {
        AuditSafetyMode = true,
        ConnectionString = "mongodb://127.0.0.1:27018/?serverSelectionTimeoutMS=3000",
        DatabaseName = $"sirlocked_v3_it_{Guid.NewGuid():N}"
    };

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
