using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.DTOs.Matchmaking;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Weekly;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The pixel catalogue against a real loopback MongoDB (SIRLOCKED_RUN_MONGO_IT=true): with PixelOnly on,
/// players only see and play pixel cases; older cases stay in the database and old rooms keep working.
/// </summary>
public sealed partial class MongoCaseCatalogTests
{
    private const string Classic = "case-v3-broken-seal-vi";
    private const string ClassicEn = "case-v3-broken-seal-en";
    private static readonly string[] PixelIds = ["case-pixel-lo-thuoc-thu-nam-vi", "case-pixel-tram-hong-ngoc-vi"];

    [Fact]
    public Task PixelOnly_ListsAndOpensOnlyPixelCases_WhileAdminStillSeesEverything() => WithCatalog(async c =>
    {
        await c.SeedEverythingAsync();
        Assert.Equal(6, (await c.Open.Cases.GetPublishedAsync()).Count);

        var visible = await c.PixelOnly.Cases.GetPublishedAsync();
        Assert.Equal(PixelIds.OrderBy(id => id), visible.Select(summary => summary.CaseId).OrderBy(id => id));
        Assert.All(visible, summary => Assert.True(summary.IsPixel));

        var detail = await c.PixelOnly.Cases.GetPublicDetailAsync(PixelIds[1]);
        Assert.True(detail.IsPixel);
        var hidden = await Assert.ThrowsAsync<ApiException>(() => c.PixelOnly.Cases.GetPublicDetailAsync(Classic));
        Assert.Equal(404, hidden.StatusCode);
        // Not deleted: the admin list and the case itself are intact, and with the switch off it opens again.
        var admin = await c.PixelOnly.Cases.GetAllForAdminAsync();
        Assert.Equal(6, admin.Count);
        Assert.Contains(admin, summary => summary.CaseId == Classic && !summary.IsPixel && !summary.PlayerVisible);
        Assert.All(admin.Where(summary => summary.IsPixel), summary => Assert.True(summary.PlayerVisible));
        Assert.All((await c.Open.Cases.GetAllForAdminAsync()), summary => Assert.True(summary.PlayerVisible));
        Assert.NotNull(await c.PixelOnly.Cases.FindCaseAsync(Classic));
        Assert.Equal(Classic, (await c.Open.Cases.GetPublicDetailAsync(Classic)).CaseId);
    });

    [Fact]
    public Task PixelOnly_RefusesRoomsForOlderCases_ButKeepsRoomsCreatedBefore() => WithCatalog(async c =>
    {
        await c.SeedEverythingAsync();
        var host = await c.UserAsync("Chủ phòng");

        var before = await c.Open.Rooms.CreateAsync(host, Classic, "PRIVATE"); // created while the catalogue was open
        var refused = await Assert.ThrowsAsync<ApiException>(() => c.PixelOnly.Rooms.CreateAsync(host, Classic, "PRIVATE"));
        Assert.Equal(422, refused.StatusCode);
        Assert.Equal(RoomService.CaseNotPlayableCode, Assert.IsType<ApiErrorDetails>(refused.Errors).Code);
        var refusedEn = await Assert.ThrowsAsync<ApiException>(() => c.PixelOnly.Rooms.CreateAsync(host, ClassicEn));
        Assert.Equal(RoomService.CaseNotPlayableCode, Assert.IsType<ApiErrorDetails>(refusedEn.Errors).Code);

        var created = await c.PixelOnly.Rooms.CreateAsync(host, PixelIds[1], "PRIVATE");
        Assert.Equal(PixelIds[1], created.CaseId);
        Assert.Equal(RoomStatus.Waiting, created.Status);

        // the room from before still opens, for its members, with its case title
        var reopened = await c.PixelOnly.Rooms.GetAsync(host.Id, before.RoomId);
        Assert.Equal(Classic, reopened.CaseId);
        Assert.Equal((await c.PixelOnly.Cases.FindCaseAsync(Classic))!.Title, reopened.CaseTitle);
        // ...but it no longer appears in "my rooms" (legacy cases are hidden), while the pixel room does
        var mine = await c.PixelOnly.Rooms.GetMineAsync(host.Id);
        Assert.DoesNotContain(mine, room => room.RoomId == before.RoomId);
        Assert.Contains(mine, room => room.RoomId == created.RoomId);
        Assert.Contains(await c.Open.Rooms.GetMineAsync(host.Id), room => room.RoomId == before.RoomId);
    });

    [Fact]
    public Task Matchmaking_EnglishSearchStillGetsAVietnamesePixelCase() => WithCatalog(async c =>
    {
        await c.SeedPixelOnlyAsync();
        var a = await c.UserAsync("Alice");
        var b = await c.UserAsync("Bob");
        // nothing English exists and nothing is "long": the search widens instead of failing
        await c.PixelOnly.Matchmaking.EnqueueAsync(a, Prefs("en", "LONG"));
        var found = await c.PixelOnly.Matchmaking.EnqueueAsync(b, Prefs("en", "LONG"));
        Assert.Equal(MatchmakingPhases.Found, found.Phase);
        Assert.Contains(found.Match!.CaseId, PixelIds);
        Assert.Equal("vi", found.Match.Language);
    });

    [Fact]
    public Task Matchmaking_PrefersTheRequestedLengthWhenThatLengthExists() => WithCatalog(async c =>
    {
        await c.SeedPixelOnlyAsync();
        var a = await c.UserAsync("Alice");
        var b = await c.UserAsync("Bob");
        // Trâm hồng ngọc is ~20 minutes (short); Lọ thuốc thứ Năm is ~30 (medium)
        await c.PixelOnly.Matchmaking.EnqueueAsync(a, Prefs("en", "SHORT"));
        var found = await c.PixelOnly.Matchmaking.EnqueueAsync(b, Prefs("en", "SHORT"));
        Assert.Equal("case-pixel-tram-hong-ngoc-vi", found.Match!.CaseId);
    });

    [Fact]
    public Task Matchmaking_WithThePixelCatalogueOff_StillRefusesAMismatch() => WithCatalog(async c =>
    {
        await c.SeedPixelOnlyAsync();
        var a = await c.UserAsync("Alice");
        var error = await Assert.ThrowsAsync<ApiException>(() => c.Open.Matchmaking.EnqueueAsync(a, Prefs("en", "SHORT")));
        Assert.Equal(MatchmakingService.NoCasesCode, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
    });

    [Fact]
    public Task Workshop_ListsAndStatsOnlyPixelCases() => WithCatalog(async c =>
    {
        await c.SeedEverythingAsync();
        var all = await c.Open.Workshop.GetWorkshopCasesAsync(null, "hot", 1, 48);
        Assert.Equal(6, all.Total);
        var pixel = await c.PixelOnly.Workshop.GetWorkshopCasesAsync(null, "hot", 1, 48);
        Assert.Equal(2, pixel.Total);
        Assert.All(pixel.Items, item => Assert.Contains(item.CaseId, PixelIds));
        Assert.Equal(PixelIds[1], (await c.PixelOnly.Workshop.GetCaseStatsAsync(PixelIds[1])).CaseId);
        var hidden = await Assert.ThrowsAsync<ApiException>(() => c.PixelOnly.Workshop.GetCaseStatsAsync(Classic));
        Assert.Equal(404, hidden.StatusCode);
        Assert.Equal(Classic, (await c.Open.Workshop.GetCaseStatsAsync(Classic)).CaseId);
    });

    [Fact]
    public Task CaseOfTheWeek_IsPixelOnlyAndAnOlderFeatureReadsAsNotSet() => WithCatalog(async c =>
    {
        await c.SeedEverythingAsync();
        var admin = new CurrentUser(ObjectId.GenerateNewId().ToString(), "Admin", UserRole.Admin);
        WeeklyService Weekly(CaseCatalogPolicy policy) => new(c.Db, null!, policy);
        SetWeeklyFeatureRequest Request(string caseId) => new()
        {
            Type = WeeklyFeatureTypes.CaseOfWeek, CaseId = caseId,
            WeekStart = DateTime.UtcNow.AddDays(-1), WeekEnd = DateTime.UtcNow.AddDays(6)
        };

        // featured while the catalogue was open
        await Weekly(CaseCatalogPolicy.Open).SetWeeklyFeatureAsync(admin, Request(Classic));
        Assert.Equal(Classic, (await Weekly(CaseCatalogPolicy.Open).GetActiveCaseOfWeekAsync())!.CaseId);
        Assert.Null(await Weekly(c.PixelOnly.Policy).GetActiveCaseOfWeekAsync());

        // with PixelOnly on, only a pixel case can be featured
        var refused = await Assert.ThrowsAsync<ApiException>(() => Weekly(c.PixelOnly.Policy).SetWeeklyFeatureAsync(admin, Request(Classic)));
        Assert.Equal(400, refused.StatusCode);
        await Weekly(c.PixelOnly.Policy).SetWeeklyFeatureAsync(admin, Request(PixelIds[1]));
        Assert.Equal(PixelIds[1], (await Weekly(c.PixelOnly.Policy).GetActiveCaseOfWeekAsync())!.CaseId);
    });

    [Fact]
    public Task StartupSeeding_InsertsMissingPixelCases_AndNeverOverwritesOrRevives() => WithCatalog(async c =>
    {
        var first = await c.Open.Seeder.SeedMissingPixelCasesAsync();
        Assert.Equal(PixelIds.OrderBy(id => id), first.OrderBy(id => id));
        var stored = await c.Db.Cases.Find(x => PixelIds.Contains(x.CaseId)).ToListAsync();
        Assert.All(stored, gameCase => Assert.Equal(CaseStatus.Published, gameCase.Status));
        Assert.All(stored, gameCase => Assert.True(CaseCatalogRules.IsPixel(gameCase)));

        // second start: nothing is missing, nothing is touched
        Assert.Empty(await c.Open.Seeder.SeedMissingPixelCasesAsync());

        // an admin edit and an admin unpublish both survive another start
        await c.Db.Cases.UpdateOneAsync(x => x.CaseId == PixelIds[0], Builders<GameCase>.Update.Set(x => x.Title, "Tên do admin sửa"));
        await c.Db.Cases.UpdateOneAsync(x => x.CaseId == PixelIds[1], Builders<GameCase>.Update.Set(x => x.Status, CaseStatus.Draft));
        Assert.Empty(await c.Open.Seeder.SeedMissingPixelCasesAsync());
        Assert.Equal("Tên do admin sửa", (await c.Db.Cases.Find(x => x.CaseId == PixelIds[0]).FirstAsync()).Title);
        Assert.Equal(CaseStatus.Draft, (await c.Db.Cases.Find(x => x.CaseId == PixelIds[1]).FirstAsync()).Status);

        // a deleted one comes back, the others stay as they are
        await c.Db.Cases.DeleteOneAsync(x => x.CaseId == PixelIds[0]);
        Assert.Equal(new[] { PixelIds[0] }, await c.Open.Seeder.SeedMissingPixelCasesAsync());
        Assert.Equal(CaseStatus.Draft, (await c.Db.Cases.Find(x => x.CaseId == PixelIds[1]).FirstAsync()).Status);
    });

    [Fact]
    public Task StartupSeeding_WorkerFillsAnEmptyDatabase_AndToleratesARunningRoom() => WithCatalog(async c =>
    {
        var services = new ServiceCollection();
        services.AddSingleton<IPixelCaseSeeder>(c.Open.Cases);
        var scopes = services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
        var worker = new PixelCaseSeedWorker(scopes, Options.Create(new CaseCatalogSettings { SeedPixelOnStartup = true }), NullLogger<PixelCaseSeedWorker>.Instance);

        Assert.True(await worker.RunPassAsync(CancellationToken.None));
        Assert.Equal(2, await c.Db.Cases.CountDocumentsAsync(x => PixelIds.Contains(x.CaseId) && x.Status == CaseStatus.Published));
        // a room is playing one of them: another pass changes nothing and does not fail
        var host = await c.UserAsync("Đang chơi");
        await c.Open.Rooms.CreateAsync(host, PixelIds[1], "PRIVATE");
        Assert.True(await worker.RunPassAsync(CancellationToken.None));
        Assert.Equal(2, await c.Db.Cases.CountDocumentsAsync(x => PixelIds.Contains(x.CaseId)));
    });

    [Fact]
    public Task Legacy_AdminListHidesOlderCasesUnlessAsked_AndKeepsThemStored() => WithCatalog(async c =>
    {
        await c.SeedEverythingAsync();
        var all = await c.PixelOnly.Cases.GetAllForAdminAsync();
        Assert.Equal(6, all.Count);

        var defaultList = c.PixelOnly.Legacy.FilterAdminList(all, includeLegacy: false);
        Assert.Equal(PixelIds.OrderBy(id => id), defaultList.Select(summary => summary.CaseId).OrderBy(id => id));
        Assert.Equal(6, c.PixelOnly.Legacy.FilterAdminList(all, includeLegacy: true).Count);
        // with the switch off nothing is hidden, whatever the flag says
        Assert.Equal(6, c.Open.Legacy.FilterAdminList(await c.Open.Cases.GetAllForAdminAsync(), includeLegacy: false).Count);

        Assert.Equal(4, (await c.PixelOnly.Legacy.GetHiddenCaseIdsAsync()).Count);
        Assert.Empty(await c.Open.Legacy.GetHiddenCaseIdsAsync());
        Assert.True(await c.PixelOnly.Legacy.IsHiddenAsync(Classic));
        Assert.False(await c.PixelOnly.Legacy.IsHiddenAsync(PixelIds[0]));
        Assert.False(await c.PixelOnly.Legacy.IsHiddenAsync("case-that-does-not-exist"));
        Assert.Equal(4, await c.Db.Cases.CountDocumentsAsync(x => !PixelIds.Contains(x.CaseId)));
    });

    [Fact]
    public Task Legacy_RoomsOfOlderCasesLeaveEveryList_ButStayStoredAndOpenable() => WithCatalog(async c =>
    {
        await c.SeedEverythingAsync();
        var host = await c.UserAsync("Chủ phòng");
        var other = await c.UserAsync("Người xem");
        var oldPublic = await c.Open.Rooms.CreateAsync(host, Classic, "PUBLIC");
        var newPublic = await c.Open.Rooms.CreateAsync(host, PixelIds[1], "PUBLIC");

        var openMine = await c.Open.Rooms.GetMineAsync(host.Id);
        Assert.Equal(2, openMine.Count);
        var pixelMine = await c.PixelOnly.Rooms.GetMineAsync(host.Id);
        Assert.Equal(new[] { newPublic.RoomId }, pixelMine.Select(room => room.RoomId));

        var openPublic = await c.Open.Rooms.ListPublicAsync(other.Id, new PublicRoomQuery { Language = "ALL" });
        Assert.Equal(2, openPublic.Count);
        var pixelPublic = await c.PixelOnly.Rooms.ListPublicAsync(other.Id, new PublicRoomQuery { Language = "ALL" });
        Assert.Equal(new[] { newPublic.RoomId }, pixelPublic.Select(room => room.RoomId));

        // hidden, not removed: the document is there and its own members can still open it
        Assert.Equal(1, await c.Db.Rooms.CountDocumentsAsync(room => room.Id == oldPublic.RoomId));
        Assert.Equal(Classic, (await c.PixelOnly.Rooms.GetAsync(host.Id, oldPublic.RoomId)).CaseId);
    });

    [Fact]
    public Task Legacy_ResultsLeaveTheProfile_AndTheDashboardCounters() => WithCatalog(async c =>
    {
        await c.SeedEverythingAsync();
        var user = await c.UserAsync("Thám tử");
        await c.Db.GameResults.InsertManyAsync([
            new GameResult { RoomId = NewId(), CaseId = Classic, Players = [user.Id], Success = true },
            new GameResult { RoomId = NewId(), CaseId = ClassicEn, Players = [user.Id], Success = true },
            new GameResult { RoomId = NewId(), CaseId = PixelIds[1], Players = [user.Id], Success = false }
        ]);
        await c.Open.Rooms.CreateAsync(user, Classic, "PRIVATE");
        await c.Open.Rooms.CreateAsync(user, PixelIds[1], "PRIVATE");

        var all = await c.Open.Profile.GetProfileAsync(user.Id);
        Assert.Equal(3, all.CasesPlayed);
        Assert.Equal(2, all.CasesSolved);
        var pixel = await c.PixelOnly.Profile.GetProfileAsync(user.Id);
        Assert.Equal(1, pixel.CasesPlayed);
        Assert.Equal(0, pixel.CasesSolved);

        var openBoard = System.Text.Json.JsonSerializer.SerializeToElement(await c.Open.Admin.GetDashboardAsync());
        var pixelBoard = System.Text.Json.JsonSerializer.SerializeToElement(await c.PixelOnly.Admin.GetDashboardAsync());
        Assert.Equal(6, openBoard.GetProperty("totalCases").GetInt32());
        Assert.Equal(2, pixelBoard.GetProperty("totalCases").GetInt32());
        Assert.Equal(2, pixelBoard.GetProperty("publishedCases").GetInt32());
        Assert.Equal(2, openBoard.GetProperty("totalRooms").GetInt32());
        Assert.Equal(1, pixelBoard.GetProperty("totalRooms").GetInt32());
        Assert.Equal(3, openBoard.GetProperty("totalResults").GetInt32());
        Assert.Equal(1, pixelBoard.GetProperty("totalResults").GetInt32());
        Assert.Equal(2, openBoard.GetProperty("wins").GetInt32());
        Assert.Equal(0, pixelBoard.GetProperty("wins").GetInt32());
        // nothing was deleted
        Assert.Equal(3, await c.Db.GameResults.CountDocumentsAsync(_ => true));
    });

    [Fact]
    public Task Legacy_ReviewsAndLeaderboardOfOlderCasesAreHidden_ButStored() => WithCatalog(async c =>
    {
        await c.SeedEverythingAsync();
        var player = await c.UserAsync("Thám tử");
        foreach (var caseId in new[] { Classic, PixelIds[1] })
        {
            await c.Db.GameResults.InsertOneAsync(new GameResult
            {
                RoomId = NewId(), CaseId = caseId, Players = [player.Id], Success = true, ScoreSummary = new ScoreSummary { TotalScore = 80 }
            });
            await c.Db.Reviews.InsertOneAsync(new CaseReview { CaseId = caseId, UserId = player.Id, AuthorDisplay = "Thám tử", Rating = 5 });
        }

        // the older case: visible with the catalogue open, hidden with PixelOnly
        Assert.Equal(1, (await c.Open.Leaderboard.GetCaseLeaderboardAsync(Classic, LeaderboardMetrics.TopScore)).TotalRanked);
        Assert.Equal(0, (await c.PixelOnly.Leaderboard.GetCaseLeaderboardAsync(Classic, LeaderboardMetrics.TopScore)).TotalRanked);
        Assert.Equal(1, (await c.Open.Reviews.GetReviewsAsync(Classic, 1, 10)).Total);
        var page = await c.PixelOnly.Reviews.GetReviewsAsync(Classic, 1, 10);
        Assert.Equal(0, page.Total);
        Assert.Empty(page.Items);
        Assert.Equal(1, (await c.Open.Reviews.GetSummaryAsync(Classic)).TotalReviews);
        Assert.Equal(0, (await c.PixelOnly.Reviews.GetSummaryAsync(Classic)).TotalReviews);
        var eligibility = await Assert.ThrowsAsync<ApiException>(() => c.PixelOnly.Reviews.CheckEligibilityAsync(player, Classic));
        Assert.Equal(404, eligibility.StatusCode);
        var submit = await Assert.ThrowsAsync<ApiException>(() =>
            c.PixelOnly.Reviews.SubmitReviewAsync(player, Classic, new SirLocked.Api.DTOs.Review.SubmitReviewDto { Rating = 4 }));
        Assert.Equal(404, submit.StatusCode);

        // a pixel case is untouched by the hiding
        Assert.Equal(1, (await c.PixelOnly.Leaderboard.GetCaseLeaderboardAsync(PixelIds[1], LeaderboardMetrics.TopScore)).TotalRanked);
        Assert.Equal(1, (await c.PixelOnly.Reviews.GetReviewsAsync(PixelIds[1], 1, 10)).Total);
        Assert.True((await c.PixelOnly.Reviews.CheckEligibilityAsync(player, PixelIds[1])).AlreadyReviewed);

        // and nothing was deleted
        Assert.Equal(2, await c.Db.Reviews.CountDocumentsAsync(_ => true));
        Assert.Equal(2, await c.Db.GameResults.CountDocumentsAsync(_ => true));
    });

    // ------------------------------------------------------------------ harness

    private static string NewId() => ObjectId.GenerateNewId().ToString();

    private static EnqueueMatchRequest Prefs(string language, string length) =>
        new() { Mode = "QUICK", PreferredRole = "ANY", CaseLength = length, Language = language };

    private sealed class Side
    {
        public required CaseCatalogPolicy Policy { get; init; }
        public required CaseService Cases { get; init; }
        public required IPixelCaseSeeder Seeder { get; init; }
        public required RoomService Rooms { get; init; }
        public required MatchmakingService Matchmaking { get; init; }
        public required WorkshopService Workshop { get; init; }
        public required LegacyCaseCatalog Legacy { get; init; }
        public required ProfileService Profile { get; init; }
        public required LeaderboardService Leaderboard { get; init; }
        public required ReviewService Reviews { get; init; }
        public required AdminService Admin { get; init; }
    }

    private sealed class Catalog
    {
        public required MongoDbContext Db { get; init; }
        public required Side Open { get; init; }
        public required Side PixelOnly { get; init; }

        public async Task<CurrentUser> UserAsync(string name)
        {
            var user = new User
            {
                Id = ObjectId.GenerateNewId().ToString(), FullName = name, Email = $"{Guid.NewGuid():N}@tests.invalid",
                IsEmailVerified = true, Role = UserRole.Player
            };
            await Db.Users.InsertOneAsync(user);
            return new CurrentUser(user.Id, name, UserRole.Player);
        }

        public async Task SeedEverythingAsync()
        {
            await Open.Cases.SeedCrackDemoAsync();
            await Open.Cases.SeedPointClickDemoAsync();
            await Open.Cases.SeedPixelDemoAsync();
        }

        public Task SeedPixelOnlyAsync() => Open.Cases.SeedPixelDemoAsync();
    }

    private static Side MakeSide(MongoDbContext db, CaseCache cache, bool pixelOnly)
    {
        var policy = new CaseCatalogPolicy(new CaseCatalogSettings { PixelOnly = pixelOnly });
        var cases = new CaseService(db, cache, new CaseValidationService(), Options.Create(new GameplayV3Settings { Enabled = true }),
            new TestEnvironment(), NullLogger<CaseService>.Instance, policy);
        var legacy = new LegacyCaseCatalog(db, cache, policy);
        return new Side
        {
            Policy = policy,
            Cases = cases,
            Seeder = cases,
            Legacy = legacy,
            Profile = new ProfileService(db, legacy),
            Leaderboard = new LeaderboardService(db, legacy),
            Reviews = new ReviewService(db, legacy),
            Admin = new AdminService(db, legacy),
            Rooms = new RoomService(db, cases, new SilentGameNotifier(), policy, legacy),
            Matchmaking = new MatchmakingService(db, cases, new SilentMatchmakingNotifier(), TimeProvider.System,
                NullLogger<MatchmakingService>.Instance, policy),
            Workshop = new WorkshopService(db, policy)
        };
    }

    private static async Task WithCatalog(Func<Catalog, Task> test)
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
            // One shared cache for both sides: the filter must not depend on what the cache holds.
            var cache = new CaseCache(new MemoryCache(new MemoryCacheOptions()), Options.Create(new CaseCacheSettings()));
            await test(new Catalog { Db = db, Open = MakeSide(db, cache, false), PixelOnly = MakeSide(db, cache, true) });
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
        public Task InvestigationUpdate(string roomId, SirLocked.Api.DTOs.Investigation.InvestigationUpdateDto update) => Task.CompletedTask;
        public Task SceneChanged(string roomId, string previousSceneId, string currentSceneId, string userId, long version) => Task.CompletedTask;
        public Task StageChanged(string roomId, string previousStageId, string currentStageId, string previousSceneId, string currentSceneId, bool isFinalStageCompleted, string userId, long version) => Task.CompletedTask;
        public Task GameCompleted(string roomId, SirLocked.Api.DTOs.Submission.GameResultResponse result) => Task.CompletedTask;
        public Task SystemMessage(string roomId, string message) => Task.CompletedTask;
        public Task PlayerEntrance(string roomId, SirLocked.Api.DTOs.Market.PlayerEntranceDto entrance) => Task.CompletedTask;
    }
}
