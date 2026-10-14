using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
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

public sealed class MongoRoomDisconnectTimeoutTests
{
    private static readonly DateTime Now = new(2026, 9, 28, 0, 0, 0, DateTimeKind.Utc);
    private const string FirstUser = "507f1f77bcf86cd799439071";
    private const string SecondUser = "507f1f77bcf86cd799439072";

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task AnyOfflineMember_ExpiresAt300SecondsAndCancelsBothProposals(bool bothOffline) => WithDatabase(async (db, notifier, clock) =>
    {
        var room = Room(Now.AddSeconds(-299));
        room.Players[0].IsConnected = !bothOffline;
        room.Players[0].DisconnectedAt = bothOffline ? Now.AddSeconds(-299) : null;
        await db.Rooms.InsertOneAsync(room);
        var service = new RoomDisconnectTimeoutService(db, notifier, clock);

        Assert.Equal(0, await service.ExpireDueRoomsAsync());
        clock.Now = Now.AddSeconds(1);
        Assert.Equal(1, await service.ExpireDueRoomsAsync());
        Assert.Equal(0, await service.ExpireDueRoomsAsync());

        var saved = await Load(db, room.Id);
        Assert.Equal(RoomStatus.Abandoned, saved.Status);
        Assert.Equal(GameStatus.Failed, saved.GameplayState!.GameStatus);
        Assert.Equal(2, saved.GameplayState.Version);
        Assert.Equal(clock.Now, saved.GameplayState.CompletedAt);
        Assert.Null(saved.GameplayState.ActiveConfrontation);
        Assert.Null(saved.GameplayState.ActiveAccusation);
        Assert.Equal(PairedConfrontationStatus.Cancelled, Assert.Single(saved.GameplayState.PairedConfrontationAttempts).Status);
        Assert.Equal(AccusationProposalStatus.Cancelled, Assert.Single(saved.GameplayState.AccusationAttempts).Status);
        Assert.Equal((room.Id, 2L), Assert.Single(notifier.Updates));
    });

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task LobbyOfflineOrMissingDisconnectTimestamp_GetsFiveMinutesFromMatchStart(bool missingTimestamp) => WithDatabase(async (db, notifier, clock) =>
    {
        var room = Room(missingTimestamp ? null : Now.AddHours(-2));
        room.GameplayState!.StartedAt = Now;
        await db.Rooms.InsertOneAsync(room);
        var service = new RoomDisconnectTimeoutService(db, notifier, clock);
        clock.Now = Now.AddSeconds(299);
        Assert.Equal(0, await service.ExpireDueRoomsAsync());
        clock.Now = Now.AddSeconds(300);
        Assert.Equal(1, await service.ExpireDueRoomsAsync());
    });

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task ReconnectOrNewDisconnect_InvalidatesAnOldTimeoutSnapshot(bool disconnectedAgain) => WithDatabase(async (db, notifier, clock) =>
    {
        var room = Room(Now.AddMinutes(-5));
        await db.Rooms.InsertOneAsync(room);
        var stale = await Load(db, room.Id);
        var update = Builders<GameRoom>.Update
            .Set("players.1.isConnected", !disconnectedAgain)
            .Set("players.1.lastConnectedAt", Now)
            .Set("players.1.disconnectedAt", disconnectedAgain ? Now : (DateTime?)null);
        await db.Rooms.UpdateOneAsync(candidate => candidate.Id == room.Id, update);

        var service = new RoomDisconnectTimeoutService(db, notifier, clock);
        Assert.False(await service.TryExpireAsync(stale, stale.Players[1], Now));
        Assert.Equal(0, await service.ExpireDueRoomsAsync());
        Assert.Equal(RoomStatus.InProgress, (await Load(db, room.Id)).Status);
        Assert.Empty(notifier.Updates);
    });

    [Fact]
    public Task CompletedGameWinsAgainstAStaleTimeoutSnapshot() => WithDatabase(async (db, notifier, clock) =>
    {
        var room = Room(Now.AddMinutes(-5));
        await db.Rooms.InsertOneAsync(room);
        var stale = await Load(db, room.Id);
        await db.Rooms.UpdateOneAsync(candidate => candidate.Id == room.Id, Builders<GameRoom>.Update
            .Set(candidate => candidate.Status, RoomStatus.Completed)
            .Set(candidate => candidate.GameplayState!.GameStatus, GameStatus.Won)
            .Inc(candidate => candidate.GameplayState!.Version, 1));

        Assert.False(await new RoomDisconnectTimeoutService(db, notifier, clock).TryExpireAsync(stale, stale.Players[1], Now));
        var saved = await Load(db, room.Id);
        Assert.Equal(RoomStatus.Completed, saved.Status);
        Assert.Equal(GameStatus.Won, saved.GameplayState!.GameStatus);
        Assert.Empty(notifier.Updates);
    });

    [Fact]
    public Task ConcurrentSweepSnapshots_CommitOnceWithoutDuplicatingHistory() => WithDatabase(async (db, notifier, clock) =>
    {
        var room = Room(Now.AddMinutes(-5));
        await db.Rooms.InsertOneAsync(room);
        var first = await Load(db, room.Id);
        var second = await Load(db, room.Id);
        var service = new RoomDisconnectTimeoutService(db, notifier, clock);

        var results = await Task.WhenAll(service.TryExpireAsync(first, first.Players[1], Now),
            service.TryExpireAsync(second, second.Players[1], Now));

        Assert.Single(results, expired => expired);
        var saved = await Load(db, room.Id);
        Assert.Single(saved.GameplayState!.PairedConfrontationAttempts);
        Assert.Single(saved.GameplayState.AccusationAttempts);
        Assert.Equal(2, saved.GameplayState.Version);
        Assert.Single(notifier.Updates);
    });

    [Fact]
    public Task LateReconnectCheck_ExpiresWithoutWaitingForTheNextSweep() => WithDatabase(async (db, notifier, clock) =>
    {
        var room = Room(Now.AddSeconds(-299));
        await db.Rooms.InsertOneAsync(room);
        var service = new RoomDisconnectTimeoutService(db, notifier, clock);
        Assert.False(await service.ExpireRoomIfNeededAsync(room.Id, Now));
        Assert.True(await service.ExpireRoomIfNeededAsync(room.Id, Now.AddSeconds(2)));
        Assert.True(await service.ExpireRoomIfNeededAsync(room.Id, Now.AddSeconds(3)));
        Assert.Single(notifier.Updates);
    });

    [Fact]
    public Task GameplayVersionChangeIsPreservedByTheRetryingReconnectCheck() => WithDatabase(async (db, notifier, clock) =>
    {
        var room = Room(Now.AddMinutes(-5));
        await db.Rooms.InsertOneAsync(room);
        var stale = await Load(db, room.Id);
        await db.Rooms.UpdateOneAsync(candidate => candidate.Id == room.Id, Builders<GameRoom>.Update
            .Inc(candidate => candidate.GameplayState!.Version, 1)
            .Set(candidate => candidate.GameplayState!.UnlockedClueIds, ["concurrent-clue"]));
        var service = new RoomDisconnectTimeoutService(db, notifier, clock);
        Assert.False(await service.TryExpireAsync(stale, stale.Players[1], Now));

        Assert.True(await service.ExpireRoomIfNeededAsync(room.Id, Now));

        var saved = await Load(db, room.Id);
        Assert.Equal(3, saved.GameplayState!.Version);
        Assert.Equal(["concurrent-clue"], saved.GameplayState.UnlockedClueIds);
    });

    [Fact]
    public Task SweepLeavesLobbyTerminalAndConnectedRoomsUntouched() => WithDatabase(async (db, notifier, clock) =>
    {
        var rooms = new[] { RoomStatus.Waiting, RoomStatus.Ready, RoomStatus.Completed, RoomStatus.Abandoned }
            .Select(status => { var room = Room(Now.AddHours(-1)); room.Status = status; return room; }).ToList();
        var connected = Room(Now.AddHours(-1));
        connected.Players.ForEach(player => player.IsConnected = true);
        rooms.Add(connected);
        await db.Rooms.InsertManyAsync(rooms);

        Assert.Equal(0, await new RoomDisconnectTimeoutService(db, notifier, clock).ExpireDueRoomsAsync());
        foreach (var room in rooms) Assert.Equal(room.Status, (await Load(db, room.Id)).Status);
        Assert.Empty(notifier.Updates);
    });

    [Fact]
    public Task ManualAbandonStillRefusesAfterOnlyThirtySeconds() => WithDatabase(async (db, notifier, _) =>
    {
        var room = Room(DateTime.UtcNow.AddSeconds(-60));
        await db.Rooms.InsertOneAsync(room);
        var service = new RoomService(db, null!, notifier);

        var error = await Assert.ThrowsAsync<ApiException>(() => service.AbandonAsync(new CurrentUser(FirstUser, "First", UserRole.Player), room.Id));

        Assert.Equal(409, error.StatusCode);
        Assert.Contains("5 minutes", error.Message);
        Assert.Equal(RoomStatus.InProgress, (await Load(db, room.Id)).Status);
    });

    [Fact]
    public Task HostedWorkerExpiresADisconnectedRoomWithoutAnyClientRequest() => WithDatabase(async (db, notifier, clock) =>
    {
        await db.EnsureIndexesAsync();
        var room = Room(Now.AddMinutes(-5));
        room.Players[0].IsConnected = false;
        room.Players[0].DisconnectedAt = Now.AddMinutes(-5);
        await db.Rooms.InsertOneAsync(room);
        await using var services = new ServiceCollection().AddLogging()
            .AddSingleton(db).AddSingleton<TimeProvider>(clock).AddSingleton<IGameNotifier>(notifier)
            .AddScoped<RoomDisconnectTimeoutService>().AddHostedService<RoomDisconnectTimeoutWorker>()
            .BuildServiceProvider();
        var worker = Assert.Single(services.GetServices<IHostedService>());
        await worker.StartAsync(CancellationToken.None);
        try
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            while ((await Load(db, room.Id)).Status != RoomStatus.Abandoned)
                await Task.Delay(25, deadline.Token);
            Assert.Single(notifier.Updates);
            using var indexes = await db.Rooms.Indexes.ListAsync();
            Assert.Contains(await indexes.ToListAsync(), index => index["name"] == "ix_rooms_disconnect_timeout");
        }
        finally { await worker.StopAsync(CancellationToken.None); }
    });

    private static GameRoom Room(DateTime? disconnectedAt) => new()
    {
        Id = ObjectId.GenerateNewId().ToString(), RoomCode = Guid.NewGuid().ToString("N"),
        Status = RoomStatus.InProgress, HostUserId = FirstUser, CaseId = "any-mechanics-case",
        Players = [new() { UserId = FirstUser, IsConnected = true }, new() { UserId = SecondUser, DisconnectedAt = disconnectedAt }],
        GameplayState = new GameplayState
        {
            Version = 1, StartedAt = Now.AddHours(-1),
            ActiveConfrontation = new PairedConfrontationState { AttemptId = "paired-attempt", ChallengeId = "challenge" },
            ActiveAccusation = new AccusationProposalState { AttemptId = "accusation-attempt" }
        }
    };

    private static Task<GameRoom> Load(MongoDbContext db, string id) => db.Rooms.Find(room => room.Id == id).FirstAsync();

    private static async Task WithDatabase(Func<MongoDbContext, RecordingNotifier, MutableClock, Task> test)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase)) return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27019/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        try { await db.PingAsync(); await test(db, new RecordingNotifier(), new MutableClock()); }
        finally { TestMongoSafetyGuard.EnsureSafe(settings); await new MongoClient(settings.ConnectionString).DropDatabaseAsync(settings.DatabaseName); }
    }

    private sealed class MutableClock : TimeProvider
    {
        public DateTime Now { get; set; } = MongoRoomDisconnectTimeoutTests.Now;
        public override DateTimeOffset GetUtcNow() => new(Now, TimeSpan.Zero);
    }

    private sealed class RecordingNotifier : IGameNotifier
    {
        public ConcurrentQueue<(string RoomId, long Version)> Updates { get; } = new();
        public Task GameStateUpdated(string roomId, long version) { Updates.Enqueue((roomId, version)); return Task.CompletedTask; }
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
