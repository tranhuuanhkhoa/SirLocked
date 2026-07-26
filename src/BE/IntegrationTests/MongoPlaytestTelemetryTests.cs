using Microsoft.Extensions.Logging.Abstractions;
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

public sealed class MongoPlaytestTelemetryTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_MONGO_IT";
    private const string PseudonymKey = "playtest-pseudonym-key-0123456789";

    [Fact]
    public async Task RecordedEvent_RoundTripsWithHashedIdentifiersOnly()
    {
        if (!ShouldRun()) return;

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings), Options.Create(new PlaytestSettings()));
        var client = new MongoClient(settings.ConnectionString);

        try
        {
            await db.PingAsync();
            var pseudonymizer = new PlaytestPseudonymizer(PseudonymKey);
            var sink = new MongoPlaytestEventSink(
                new MongoPlaytestEventStore(db),
                pseudonymizer,
                TimeProvider.System,
                NullLogger<MongoPlaytestEventSink>.Instance);

            await sink.RecordAsync(
                "room-42", "user-7", PlayerRole.Interrogator, PlaytestEventType.WaitingEnded, 5,
                attemptId: "attempt-1", revision: 2, durationMs: 4200, count: 1);

            var stored = Assert.Single(await db.PlaytestEvents.Find(FilterDefinition<PlaytestEventRecord>.Empty).ToListAsync());
            Assert.Equal(pseudonymizer.SessionPseudonym("room-42"), stored.SessionPseudonym);
            Assert.Equal(pseudonymizer.UserHash("room-42", "user-7"), stored.UserHash);
            Assert.Equal(PlaytestEventType.WaitingEnded, stored.EventType);
            Assert.Equal(4200, stored.DurationMs);

            // The persisted document itself must not carry the raw identifiers anywhere.
            var raw = await db.Database
                .GetCollection<BsonDocument>(settings.PlaytestEventsCollectionName)
                .Find(FilterDefinition<BsonDocument>.Empty)
                .FirstAsync();
            var json = raw.ToJson();
            Assert.DoesNotContain("room-42", json, StringComparison.Ordinal);
            Assert.DoesNotContain("user-7", json, StringComparison.Ordinal);
            Assert.Contains("WaitingEnded", json, StringComparison.Ordinal);
            Assert.False(raw.Contains("roomId"));
            Assert.False(raw.Contains("userId"));
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    [Fact]
    public async Task EnsureIndexes_CreatesTheLookupAndRetentionIndexes()
    {
        if (!ShouldRun()) return;

        var settings = NewSettings();
        TestMongoSafetyGuard.EnsureSafe(settings);
        var playtest = new PlaytestSettings { RetentionDays = 12 };
        var db = new MongoDbContext(Options.Create(settings), Options.Create(playtest));
        var client = new MongoClient(settings.ConnectionString);

        try
        {
            await db.PingAsync();
            await db.EnsureIndexesAsync();

            using var cursor = await db.PlaytestEvents.Indexes.ListAsync();
            var indexes = await cursor.ToListAsync();
            var names = indexes.Select(index => index["name"].AsString).ToList();

            Assert.Contains(MongoDbContext.PlaytestSessionTimestampIndexName, names);
            Assert.Contains(MongoDbContext.PlaytestTypeTimestampIndexName, names);
            Assert.Contains(MongoDbContext.PlaytestTtlIndexName, names);

            var ttl = indexes.Single(index => index["name"].AsString == MongoDbContext.PlaytestTtlIndexName);
            Assert.Equal(TimeSpan.FromDays(playtest.RetentionDays).TotalSeconds, ttl["expireAfterSeconds"].ToDouble());
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

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
}
