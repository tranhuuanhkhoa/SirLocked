using System.Text.Json;
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

public sealed class MongoMyRoomsTests
{
    private const string CallerId = "507f1f77bcf86cd799439061";
    private const string PartnerId = "507f1f77bcf86cd799439062";
    private static readonly DateTime Now = new(2026, 9, 27, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public Task Mine_ReturnsOnlyMembershipAndActiveStatuses_WithoutInvestigationState() => WithDatabase(async db =>
    {
        await db.EnsureIndexesAsync();
        await db.Cases.InsertOneAsync(new GameCase { CaseId = "resume-case", Title = "The Saved Investigation" });
        var ownActive = new[] { RoomStatus.Waiting, RoomStatus.Ready, RoomStatus.InProgress }
            .Select(status => Room(status)).ToList();
        var outsider = Room(RoomStatus.InProgress);
        outsider.Players.RemoveAll(player => player.UserId == CallerId);
        // Merely retaining hostUserId after leaving is not membership.
        Assert.Equal(CallerId, outsider.HostUserId);
        await db.Rooms.InsertManyAsync(ownActive.Concat([
            Room(RoomStatus.Completed), Room(RoomStatus.Abandoned), outsider
        ]));

        var result = await Service(db).GetMineAsync(CallerId);

        Assert.Equal(3, result.Count);
        Assert.Equal(ownActive.Select(room => room.Id).Order(), result.Select(room => room.RoomId).Order());
        Assert.All(result, room =>
        {
            Assert.Equal("The Saved Investigation", room.CaseTitle);
            Assert.Contains(room.Players, player => player.UserId == CallerId);
        });
        var json = JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.DoesNotContain("gameplayState", json);
        Assert.DoesNotContain("private-clue-sentinel", json);
        Assert.DoesNotContain("private-scene-sentinel", json);
        using var indexes = await db.Rooms.Indexes.ListAsync();
        Assert.Contains(await indexes.ToListAsync(), index => index["name"] == "ix_rooms_player_status_updatedAt");
    });

    [Fact]
    public Task Mine_IsBoundedAndSortedByRecentActivityWithStableTies() => WithDatabase(async db =>
    {
        var rooms = Enumerable.Range(0, RoomService.MyRoomsLimit + 7).Select(index =>
        {
            var room = Room(RoomStatus.InProgress);
            room.UpdatedAt = Now.AddMinutes(index / 4);
            room.CreatedAt = Now.AddMinutes(index / 2);
            return room;
        }).ToList();
        await db.Rooms.InsertManyAsync(rooms.AsEnumerable().Reverse());
        var expected = rooms.OrderByDescending(room => room.UpdatedAt)
            .ThenByDescending(room => room.CreatedAt).ThenByDescending(room => room.Id, StringComparer.Ordinal)
            .Take(RoomService.MyRoomsLimit).Select(room => room.Id).ToArray();

        var result = await Service(db).GetMineAsync(CallerId);

        Assert.Equal(RoomService.MyRoomsLimit, result.Count);
        Assert.Equal(expected, result.Select(room => room.RoomId));
        // A removed/missing catalogue entry must not hide other resumable rooms or crash the list.
        Assert.All(result, room => Assert.Equal("resume-case", room.CaseTitle));
    });

    [Fact]
    public Task Mine_ReturnsAnEmptyListForANonmember() => WithDatabase(async db =>
    {
        await db.Rooms.InsertOneAsync(Room(RoomStatus.Waiting));

        var result = await Service(db).GetMineAsync("507f1f77bcf86cd799439063");

        Assert.Empty(result);
    });

    private static GameRoom Room(string status) => new()
    {
        Id = ObjectId.GenerateNewId().ToString(),
        RoomCode = Guid.NewGuid().ToString("N"),
        CaseId = "resume-case",
        HostUserId = CallerId,
        Status = status,
        CreatedAt = Now,
        UpdatedAt = Now,
        Players = [new() { UserId = CallerId, Username = "First Detective" }, new() { UserId = PartnerId, Username = "Second Detective" }],
        GameplayState = new GameplayState
        {
            CurrentSceneId = "private-scene-sentinel",
            UnlockedClueIds = ["private-clue-sentinel"]
        }
    };

    // Listing reads Mongo metadata directly and must neither load full cases nor broadcast events.
    private static RoomService Service(MongoDbContext db) => new(db, null!, null!);

    private static async Task WithDatabase(Func<MongoDbContext, Task> test)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase))
            return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        try
        {
            await db.PingAsync();
            await test(db);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await new MongoClient(settings.ConnectionString).DropDatabaseAsync(settings.DatabaseName);
        }
    }
}
