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

public sealed class MongoRoomPresenceTests
{
    [Fact]
    public async Task AtomicReconnectFilter_RespectsServerDeadlineOtherPlayersAndTerminalRooms()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase)) return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var client = new MongoClient(settings.ConnectionString);
        var db = new MongoDbContext(Options.Create(settings));
        try
        {
            await db.PingAsync();
            var now = DateTime.UtcNow;
            foreach (var scenario in new (string Name, string Status, DateTime? Started, DateTime? Offline, bool PartnerExpired, bool Allowed)[]
            {
                (Name: "lobby", Status: RoomStatus.Waiting, Started: (DateTime?)null, Offline: (DateTime?)now.AddHours(-1), PartnerExpired: false, Allowed: true),
                ("before deadline", RoomStatus.InProgress, (DateTime?)now.AddMinutes(-10), (DateTime?)now.AddMinutes(-1), false, true),
                ("at deadline", RoomStatus.InProgress, (DateTime?)now.AddMinutes(-10), (DateTime?)now.AddMinutes(-5), false, false),
                ("expired partner", RoomStatus.InProgress, (DateTime?)now.AddMinutes(-10), (DateTime?)now.AddMinutes(-1), true, false),
                ("old lobby disconnect", RoomStatus.InProgress, (DateTime?)now.AddMinutes(-1), (DateTime?)now.AddHours(-1), false, true),
                ("missing timestamp fresh match", RoomStatus.InProgress, (DateTime?)now.AddMinutes(-1), (DateTime?)null, false, true),
                ("missing timestamp old match", RoomStatus.InProgress, (DateTime?)now.AddMinutes(-10), (DateTime?)null, false, false),
                ("abandoned", RoomStatus.Abandoned, (DateTime?)now.AddMinutes(-10), (DateTime?)now.AddMinutes(-1), false, false),
                ("completed", RoomStatus.Completed, (DateTime?)now.AddMinutes(-10), (DateTime?)now.AddMinutes(-1), false, false)
            })
            {
                var room = new GameRoom
                {
                    Id = ObjectId.GenerateNewId().ToString(),
                    Status = scenario.Status,
                    GameplayState = scenario.Started is DateTime started ? new GameplayState { StartedAt = started, GameStatus = GameStatus.InProgress } : null,
                    Players = new()
                    {
                        new RoomPlayer { UserId = "returning", IsConnected = false, DisconnectedAt = scenario.Offline },
                        new RoomPlayer { UserId = "partner", IsConnected = !scenario.PartnerExpired, DisconnectedAt = scenario.PartnerExpired ? now.AddMinutes(-6) : null }
                    }
                };
                await db.Rooms.InsertOneAsync(room);
                var result = await db.Rooms.UpdateOneAsync(RoomPresenceWriteRules.ReconnectFilter(room.Id, "returning"),
                    Builders<GameRoom>.Update.Set("Players.$.IsConnected", true).Unset("Players.$.DisconnectedAt"));
                Assert.True(result.MatchedCount == (scenario.Allowed ? 1 : 0), scenario.Name);
                var saved = await db.Rooms.Find(candidate => candidate.Id == room.Id).FirstAsync();
                Assert.Equal(scenario.Allowed, saved.Players[0].IsConnected);
                Assert.Equal(scenario.Status, saved.Status);
            }
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }
}
