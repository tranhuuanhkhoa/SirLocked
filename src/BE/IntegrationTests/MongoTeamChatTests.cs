using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.TeamComms;
using SirLocked.Api.WebAPI.Hubs;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>The in-match chat against a real MongoDB: stored, pushed to the room, read back in order, kept 3 days.</summary>
public sealed class MongoTeamChatTests
{
    private static bool Enabled => string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    [Fact]
    public async Task TheTwoDetectivesChat_EveryoneElseIsTurnedAway()
    {
        if (!Enabled) return;
        await WithDatabase(async db =>
        {
            var hub = new RecordingHub();
            var time = new SteppingTime(new DateTimeOffset(2026, 11, 19, 8, 0, 0, TimeSpan.Zero));
            var chat = new TeamChatService(db, hub, new TeamChatLimiter(), time);
            var room = await InsertRoom(db, RoomStatus.InProgress);

            var first = await chat.SendAsync("sherlock", room.Id, "  Watson, xem cái đồng hồ!  ", CancellationToken.None);
            time.Advance(TimeSpan.FromSeconds(2));
            var second = await chat.SendAsync("watson", room.Id, "Đây rồi\n\n\n\nkim chỉ 2:17", CancellationToken.None);

            Assert.Equal(("Watson, xem cái đồng hồ!", "Sherlock", "INTERROGATOR"), (first.Text, first.Username, first.Role));
            Assert.Equal("Đây rồi\n\nkim chỉ 2:17", second.Text);
            // Pushed to the room's group, the sender's tabs included.
            Assert.Equal(2, hub.Sent.Count);
            Assert.All(hub.Sent, sent => Assert.Equal((GameHub.RoomGroup(room.Id), TeamChatService.ChatEvent), (sent.Target, sent.Method)));
            Assert.Same(first, hub.Sent[0].Args[0]);

            var history = await chat.HistoryAsync("watson", room.Id, CancellationToken.None);
            Assert.Equal([first.Id, second.Id], history.Select(message => message.Id));
            Assert.Equal(first.SentAt, history[0].SentAt);

            var outsider = await Assert.ThrowsAsync<ApiException>(() => chat.SendAsync("stranger", room.Id, "chào", CancellationToken.None));
            Assert.Equal(403, outsider.StatusCode);
            Assert.Equal(403, (await Assert.ThrowsAsync<ApiException>(() => chat.HistoryAsync("stranger", room.Id, CancellationToken.None))).StatusCode);
            Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => chat.SendAsync("sherlock", ObjectId.GenerateNewId().ToString(), "chào", CancellationToken.None))).StatusCode);
            Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => chat.SendAsync("sherlock", "not-an-id", "chào", CancellationToken.None))).StatusCode);
            Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => chat.SendAsync("sherlock", room.Id, "   ", CancellationToken.None))).StatusCode);
            Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => chat.SendAsync("sherlock", room.Id, new string('a', 301), CancellationToken.None))).StatusCode);

            var finished = await InsertRoom(db, RoomStatus.Completed);
            Assert.Equal(409, (await Assert.ThrowsAsync<ApiException>(() => chat.SendAsync("sherlock", finished.Id, "chào", CancellationToken.None))).StatusCode);
            var tutorial = await InsertRoom(db, RoomStatus.InProgress, TutorialRules.RoomMode);
            Assert.Equal(409, (await Assert.ThrowsAsync<ApiException>(() => chat.SendAsync("sherlock", tutorial.Id, "chào", CancellationToken.None))).StatusCode);
            // Nothing refused was stored or pushed.
            Assert.Equal(2, await db.TeamChatMessages.CountDocumentsAsync(FilterDefinition<TeamChatMessage>.Empty));
            Assert.Equal(2, hub.Sent.Count);
        });
    }

    [Fact]
    public async Task TooManyLinesAtOnceAreRefused_AndHistoryKeepsTheLatestEighty()
    {
        if (!Enabled) return;
        await WithDatabase(async db =>
        {
            var time = new SteppingTime(new DateTimeOffset(2026, 11, 19, 8, 0, 0, TimeSpan.Zero));
            var chat = new TeamChatService(db, new RecordingHub(), new TeamChatLimiter(), time);
            var room = await InsertRoom(db, RoomStatus.InProgress);
            await chat.SendAsync("sherlock", room.Id, "một", CancellationToken.None);
            var flood = await Assert.ThrowsAsync<ApiException>(() => chat.SendAsync("sherlock", room.Id, "hai", CancellationToken.None));
            Assert.Equal(429, flood.StatusCode);
            // The partner is not slowed down by Sherlock's flood.
            await chat.SendAsync("watson", room.Id, "ba", CancellationToken.None);

            var older = Enumerable.Range(0, 90).Select(index => new TeamChatMessage
            {
                Id = ObjectId.GenerateNewId().ToString(), RoomId = room.Id, UserId = "watson", Username = "Watson",
                Text = $"cũ {index}", SentAt = new DateTime(2026, 11, 19, 7, 0, 0, DateTimeKind.Utc).AddSeconds(index),
            });
            await db.TeamChatMessages.InsertManyAsync(older);
            var history = await chat.HistoryAsync("sherlock", room.Id, CancellationToken.None);
            Assert.Equal(TeamCommsRules.HistoryLimit, history.Count);
            Assert.Equal("ba", history[^1].Text);
            Assert.Equal("một", history[^2].Text);
            Assert.True(history.Zip(history.Skip(1)).All(pair => pair.First.SentAt <= pair.Second.SentAt));
        });
    }

    [Fact]
    public async Task ChatIsKeptThreeDaysByATtlIndex()
    {
        if (!Enabled) return;
        await WithDatabase(async db =>
        {
            await db.EnsureIndexesAsync();
            // Running it twice is safe.
            await db.EnsureIndexesAsync();
            var indexes = await (await db.TeamChatMessages.Indexes.ListAsync()).ToListAsync();
            var ttl = indexes.Single(index => index["name"] == MongoDbContext.TeamChatTtlIndexName);
            Assert.Equal(TimeSpan.FromDays(3).TotalSeconds, ttl["expireAfterSeconds"].ToDouble());
            Assert.Contains(indexes, index => index["name"] == MongoDbContext.TeamChatRoomIndexName);
        });
    }

    private static async Task<GameRoom> InsertRoom(MongoDbContext db, string status, string? mode = null)
    {
        var room = new GameRoom
        {
            Id = ObjectId.GenerateNewId().ToString(),
            Status = status,
            Mode = mode,
            Players = [new RoomPlayer { UserId = "sherlock", Username = "Sherlock", Role = "INTERROGATOR" }, new RoomPlayer { UserId = "watson", Username = "Watson", Role = "INVESTIGATOR" }],
        };
        await db.Rooms.InsertOneAsync(room);
        return room;
    }

    private static async Task WithDatabase(Func<MongoDbContext, Task> test)
    {
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var client = new MongoClient(settings.ConnectionString);
        try
        {
            var db = new MongoDbContext(Options.Create(settings));
            await db.PingAsync();
            await test(db);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    private sealed class SteppingTime(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public void Advance(TimeSpan by) => _now += by;
        public override DateTimeOffset GetUtcNow() => _now;
    }

    /// <summary>A hub context that writes down what would have been pushed, and to whom.</summary>
    private sealed class RecordingHub : IHubContext<GameHub>
    {
        public List<(string Target, string Method, object?[] Args)> Sent { get; } = new();
        public IHubClients Clients => new RecordingClients(this);
        public IGroupManager Groups => throw new NotSupportedException();
    }

    private sealed class RecordingClients(RecordingHub hub) : IHubClients
    {
        private IClientProxy Proxy(string target) => new RecordingProxy(hub, target);
        public IClientProxy All => Proxy("all");
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => Proxy("all-except");
        public IClientProxy Client(string connectionId) => Proxy("client:" + connectionId);
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => Proxy("clients");
        public IClientProxy Group(string groupName) => Proxy(groupName);
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => Proxy(groupName + ":except");
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => Proxy("groups");
        public IClientProxy User(string userId) => Proxy("user:" + userId);
        public IClientProxy Users(IReadOnlyList<string> userIds) => Proxy("users");
    }

    private sealed class RecordingProxy(RecordingHub hub, string target) : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
        {
            lock (hub.Sent) hub.Sent.Add((target, method, args));
            return Task.CompletedTask;
        }
    }
}
