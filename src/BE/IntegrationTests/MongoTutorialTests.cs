using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Matchmaking;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// Màn tân thủ against a real loopback MongoDB (SIRLOCKED_RUN_MONGO_IT=true): the Kỳ cựu / Nhập môn choice, the gate
/// on rooms and matchmaking, the solo tutorial room with its role switch, and a solo accusation that finishes the
/// tutorial without leaving a game result.
/// </summary>
public sealed class MongoTutorialTests
{
    [Fact]
    public Task Beginner_IsGatedUntilTheTutorial_AndTheSoloRoomResumesAndSwitchesRoles() => WithStack(async s =>
    {
        await s.Cases.SeedPixelDemoAsync();
        var player = await s.UserAsync("Người mới");

        var before = await s.Tutorial.GetStatusAsync(player.Id);
        Assert.True(before.NeedsChoice);
        Assert.False(before.Required);

        var chosen = await s.Tutorial.ChooseAsync(player.Id, "beginner");
        Assert.Equal(TutorialRules.PathBeginner, chosen.Path);
        Assert.True(chosen.Required);
        // A beginner cannot switch to veteran to skip the tutorial; choosing the same path again is a retry.
        var change = await Assert.ThrowsAsync<ApiException>(() => s.Tutorial.ChooseAsync(player.Id, TutorialRules.PathVeteran));
        Assert.Equal(409, change.StatusCode);
        Assert.True((await s.Tutorial.ChooseAsync(player.Id, TutorialRules.PathBeginner)).Required);

        // Rooms and matchmaking are closed until the tutorial is finished.
        var create = await Assert.ThrowsAsync<ApiException>(() => s.Rooms.CreateAsync(player, "case-pixel-tram-hong-ngoc-vi"));
        AssertTutorialRequired(create);
        var enqueue = await Assert.ThrowsAsync<ApiException>(() => s.Matchmaking.EnqueueAsync(player, new EnqueueMatchRequest()));
        AssertTutorialRequired(enqueue);

        var host = await s.UserAsync("Chủ phòng");
        var room = await s.Rooms.CreateAsync(host, "case-pixel-tram-hong-ngoc-vi");
        AssertTutorialRequired(await Assert.ThrowsAsync<ApiException>(() => s.Rooms.JoinAsync(player, room.RoomCode)));

        // The solo room: one player, Sherlock first, every place open, the tutorial case kept out of the catalogue.
        var started = await s.Tutorial.StartAsync(player);
        Assert.False(started.Resumed);
        var tutorialRoom = await s.Db.Rooms.Find(candidate => candidate.Id == started.RoomId).FirstAsync();
        Assert.Equal(TutorialRules.RoomMode, tutorialRoom.Mode);
        Assert.Equal(RoomStatus.InProgress, tutorialRoom.Status);
        Assert.Equal(PlayerRole.Interrogator, Assert.Single(tutorialRoom.Players).Role);
        Assert.Equal(2, tutorialRoom.GameplayState!.UnlockedSceneIds.Count);
        var stored = await s.Cases.FindCaseAsync(TutorialRules.CaseId);
        Assert.Equal(CaseStatus.Draft, stored!.Status);
        Assert.DoesNotContain(await s.Cases.GetPublishedAsync(), summary => summary.CaseId == TutorialRules.CaseId);
        Assert.Equal(409, (await Assert.ThrowsAsync<ApiException>(() => s.Cases.PublishAsync(TutorialRules.CaseId))).StatusCode);

        var resumed = await s.Tutorial.StartAsync(player);
        Assert.True(resumed.Resumed);
        Assert.Equal(started.RoomId, resumed.RoomId);
        Assert.Equal(started.RoomId, (await s.Tutorial.GetStatusAsync(player.Id)).ActiveRoomId);

        // Role switch: only in the tutorial room, only for its member; it bumps the version so pages refetch.
        await s.Tutorial.SwitchRoleAsync(player, started.RoomId, PlayerRole.Investigator);
        var switched = await s.Db.Rooms.Find(candidate => candidate.Id == started.RoomId).FirstAsync();
        Assert.Equal(PlayerRole.Investigator, switched.Players[0].Role);
        Assert.Equal(tutorialRoom.GameplayState.Version + 1, switched.GameplayState!.Version);
        var notTutorial = await Assert.ThrowsAsync<ApiException>(() => s.Tutorial.SwitchRoleAsync(host, room.RoomId, PlayerRole.Investigator));
        Assert.Equal(403, notTutorial.StatusCode);
        var stranger = await Assert.ThrowsAsync<ApiException>(() => s.Tutorial.SwitchRoleAsync(host, started.RoomId, PlayerRole.Investigator));
        Assert.Equal(403, stranger.StatusCode);

        // Older accounts are veterans and never gated.
        var veteran = await s.UserAsync("Kỳ cựu", createdAt: TutorialRules.LaunchUtc.AddDays(-10));
        var veteranStatus = await s.Tutorial.GetStatusAsync(veteran.Id);
        Assert.False(veteranStatus.NeedsChoice);
        Assert.Equal(TutorialRules.PathVeteran, veteranStatus.Path);
        Assert.NotNull(await s.Rooms.CreateAsync(veteran, "case-pixel-tram-hong-ngoc-vi"));
    });

    [Fact]
    public Task SoloAccusation_FinishesTheTutorial_WithoutAGameResult() => WithStack(async s =>
    {
        await s.Cases.SeedPixelDemoAsync();
        var player = await s.UserAsync("Người mới");
        await s.Tutorial.ChooseAsync(player.Id, TutorialRules.PathBeginner);
        var started = await s.Tutorial.StartAsync(player);

        // The evidence a real run would have found by now.
        var evidence = new[] { "evidence-tt-so-khach", "evidence-tt-thu-tra-gia", "evidence-tt-am-men-lam" };
        await s.Db.Rooms.UpdateOneAsync(room => room.Id == started.RoomId,
            Builders<GameRoom>.Update.Set(room => room.GameplayState!.UnlockedClueIds, evidence.ToList()));

        var response = await s.Accusations.ProposeAsync(player, started.RoomId, new AccuseRequest
        {
            CulpritId = "char-tt-hamilton",
            MotiveId = "motive-tt-muon-am",
            MethodId = "method-tt-luc-vao-kho",
            EvidenceIds = evidence.ToList(),
            EvidenceLinks = new List<EvidenceLinkRequest>
            {
                new() { ClaimType = EvidenceClaimTypes.Motive, EvidenceId = "evidence-tt-thu-tra-gia" },
                new() { ClaimType = EvidenceClaimTypes.Method, EvidenceId = "evidence-tt-am-men-lam" },
                new() { ClaimType = EvidenceClaimTypes.Opportunity, EvidenceId = "evidence-tt-so-khach" }
            }
        });
        Assert.NotNull(response);

        var finished = await s.Db.Rooms.Find(room => room.Id == started.RoomId).FirstAsync();
        Assert.Equal(RoomStatus.Completed, finished.Status);
        Assert.Equal(GameStatus.Won, finished.GameplayState!.GameStatus);
        var account = await s.Db.Users.Find(user => user.Id == player.Id).FirstAsync();
        Assert.NotNull(account.TutorialCompletedAt);
        Assert.False((await s.Tutorial.GetStatusAsync(player.Id)).Required);
        // No stored result: no XP, coins, leaderboard rows, badges or reviews from the tutorial.
        Assert.Equal(0, await s.Db.GameResults.CountDocumentsAsync(result => result.RoomId == started.RoomId));
        // The verdict page still works from the room's own snapshot.
        var verdict = await s.Gameplay.GetResultAsync(player.Id, started.RoomId);
        Assert.True(verdict.Success);
        Assert.Equal(0, await s.Db.GameResults.CountDocumentsAsync(result => result.RoomId == started.RoomId));

        // Rooms are open now.
        Assert.NotNull(await s.Rooms.CreateAsync(player, "case-pixel-tram-hong-ngoc-vi"));
    });

    private static void AssertTutorialRequired(ApiException error)
    {
        Assert.Equal(403, error.StatusCode);
        Assert.Equal(TutorialRules.RequiredCode, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
    }

    // ---------------------------------------------------------------- stack

    private sealed class Stack
    {
        public required MongoDbContext Db { get; init; }
        public required CaseService Cases { get; init; }
        public required RoomService Rooms { get; init; }
        public required MatchmakingService Matchmaking { get; init; }
        public required TutorialService Tutorial { get; init; }
        public required GameplayService Gameplay { get; init; }
        public required AccusationConsensusCoordinator Accusations { get; init; }

        public async Task<CurrentUser> UserAsync(string name, DateTime? createdAt = null)
        {
            var user = new User
            {
                Id = ObjectId.GenerateNewId().ToString(), FullName = name, Email = $"{Guid.NewGuid():N}@tests.invalid",
                IsEmailVerified = true, Role = UserRole.Player, CreatedAt = createdAt ?? DateTime.UtcNow
            };
            await Db.Users.InsertOneAsync(user);
            return new CurrentUser(user.Id, name, UserRole.Player);
        }
    }

    private static async Task WithStack(Func<Stack, Task> test)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase))
            return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        EnsureLoopbackTestDatabase(settings);
        var db = new MongoDbContext(Options.Create(settings));
        try
        {
            await db.PingAsync();
            await db.EnsureIndexesAsync();
            var cache = new CaseCache(new MemoryCache(new MemoryCacheOptions()), Options.Create(new CaseCacheSettings()));
            var policy = new CaseCatalogPolicy(new CaseCatalogSettings { PixelOnly = true });
            var cases = new CaseService(db, cache, new CaseValidationService(), Options.Create(new GameplayV3Settings { Enabled = true }),
                new TestEnvironment(), NullLogger<CaseService>.Instance, policy);
            var notifier = new SilentGameNotifier();
            var loader = new GameplayContextLoader(db, cases);
            var persistence = new GameplayStatePersistence(db, TimeProvider.System);
            var stateBuilder = new GameStateBuilder(db);
            var playtest = new NoOpPlaytestEventSink();
            var gameplay = new GameplayService(db, loader, persistence, notifier, stateBuilder, new UnusedEvidencePhotoService(),
                new MongoGameResultStore(db), playtest, Options.Create(new AccusationSettings()), NullLogger<GameplayService>.Instance);
            await test(new Stack
            {
                Db = db,
                Cases = cases,
                Rooms = new RoomService(db, cases, notifier, policy),
                Matchmaking = new MatchmakingService(db, cases, new SilentMatchmakingNotifier(), TimeProvider.System,
                    NullLogger<MatchmakingService>.Instance, policy),
                Tutorial = new TutorialService(db, cases, notifier),
                Gameplay = gameplay,
                Accusations = new AccusationConsensusCoordinator(loader, persistence, stateBuilder, notifier, playtest, gameplay,
                    TimeProvider.System, Options.Create(new AccusationSettings()))
            });
        }
        finally
        {
            EnsureLoopbackTestDatabase(settings);
            await new MongoClient(settings.ConnectionString).DropDatabaseAsync(settings.DatabaseName);
        }
    }

    private static void EnsureLoopbackTestDatabase(MongoDbSettings settings)
    {
        if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal))
            throw new InvalidOperationException("Test database must start with 'sirlocked_it_'.");
        var servers = new MongoUrl(settings.ConnectionString).Servers.ToList();
        if (servers.Count == 0 || servers.Any(server => !(string.Equals(server.Host, "localhost", StringComparison.OrdinalIgnoreCase)
                || (IPAddress.TryParse(server.Host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address)))))
            throw new InvalidOperationException("Integration tests require a loopback-only MongoDB connection.");
    }

    private sealed class TestEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "SirLocked.Api";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = AppContext.BaseDirectory;
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class UnusedEvidencePhotoService : IEvidencePhotoService
    {
        public Task<NormalizedEvidencePhoto> NormalizeAsync(IFormFile photo, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("The tutorial test does not upload photos.");

        public Task UpsertAsync(string roomId, string clueId, string sceneId, string userId, NormalizedEvidencePhoto photo,
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("The tutorial test does not upload photos.");

        public Task<EvidencePhoto?> GetAsync(string roomId, string clueId, CancellationToken cancellationToken = default) =>
            Task.FromResult<EvidencePhoto?>(null);
    }

    private sealed class SilentMatchmakingNotifier : IMatchmakingNotifier
    {
        public Task StatusChanged(string userId, MatchmakingStatusResponse status) => Task.CompletedTask;
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
        public Task PlayerEntrance(string roomId, SirLocked.Api.DTOs.Market.PlayerEntranceDto entrance) => Task.CompletedTask;
    }
}
