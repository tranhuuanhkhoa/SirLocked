using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.DTOs.Weekly;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Weekly;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The weekly challenge picks its own case against a real (standalone) MongoDB: one document per week even when
/// many requests ask at once, only counted reviews make a case good, recent weeks are not repeated, an admin's
/// choice or clear wins for its week, and the answer carries the chest odds. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoWeeklyChallengeTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_MONGO_IT";

    /// <summary>Thursday 17:00 in Vietnam, inside the week that starts Wednesday 2026-11-18 00:00 UTC.</summary>
    private static readonly DateTime Now = new(2026, 11, 19, 10, 0, 0, DateTimeKind.Utc);
    private static readonly ChallengeWeek ThisWeek = ChallengeWeek.FromKey("2026-11-18");

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable(RunEnvironmentVariable), "true", StringComparison.OrdinalIgnoreCase);

    private static CurrentUser Admin() => new(ObjectId.GenerateNewId().ToString(), "Admin", UserRole.Admin);

    // ------------------------------------------------------------------ picking

    [Fact]
    public async Task Ensure_PicksAGoodCase_OncePerWeek()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        string[] good = ["case-a", "case-b", "case-c"];
        foreach (var id in good) await env.AddRatedCaseAsync(id, stars: 5, reviews: 5);
        await env.AddRatedCaseAsync("case-weak", stars: 2, reviews: 5);

        // Many first requests of the week at once, each with its own service and its own random draw.
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() =>
            env.Service(random: new CryptoChestRandom()).EnsureChallengeAsync(ThisWeek, CancellationToken.None))));

        var feature = Assert.Single(await env.Db.WeeklyFeatures.Find(FilterDefinition<WeeklyFeature>.Empty).ToListAsync());
        Assert.Contains(feature.CaseId, good);
        Assert.Equal(WeeklyFeatureTypes.WeeklyChallenge, feature.Type);
        Assert.Equal(ThisWeek.Key, feature.WeekKey);
        Assert.Equal(WeeklyFeatureSources.Auto, feature.Source);
        Assert.True(feature.IsActive);
        Assert.Equal(ThisWeek.StartUtc, feature.WeekStart);
        Assert.Equal(ThisWeek.EndUtc, feature.WeekEnd);
        Assert.All(results, result =>
        {
            Assert.NotNull(result);
            Assert.Equal(feature.Id, result!.Id);
            Assert.Equal(feature.CaseId, result.CaseId);
        });

        // Asking again later in the week returns the same document and creates nothing.
        var again = await env.Service(random: new CryptoChestRandom()).EnsureChallengeAsync(ThisWeek, CancellationToken.None);
        Assert.Equal(feature.Id, again!.Id);
        Assert.Equal(1, await env.Db.WeeklyFeatures.CountDocumentsAsync(FilterDefinition<WeeklyFeature>.Empty));
    }

    [Fact]
    public async Task Ensure_CountsOnlyVerifiedNonAuthorReviews()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();

        // Every case below sorts before case-y, so a wrongly counted one would be drawn first by index 0.
        // Unverified: five 5-star reviews, but three come from unverified accounts (and one more from a guest id).
        await env.AddCaseAsync("case-unverified");
        for (var i = 0; i < 2; i++) await env.AddReviewAsync("case-unverified", await env.AddUserAsync(), 5);
        for (var i = 0; i < 3; i++) await env.AddReviewAsync("case-unverified", await env.AddUserAsync(verified: false), 5);
        await env.AddReviewAsync("case-unverified", "guest-abc", 5);
        // Author: four 5-star reviews plus the author's own.
        var author = await env.AddUserAsync();
        await env.AddCaseAsync("case-author", author: author);
        for (var i = 0; i < 4; i++) await env.AddReviewAsync("case-author", await env.AddUserAsync(), 5);
        await env.AddReviewAsync("case-author", author, 5);
        // Hidden: four 5-star reviews plus one an admin hid.
        await env.AddCaseAsync("case-hidden");
        for (var i = 0; i < 4; i++) await env.AddReviewAsync("case-hidden", await env.AddUserAsync(), 5);
        await env.AddReviewAsync("case-hidden", await env.AddUserAsync(), 5, hidden: true);
        // Locked: four 5-star reviews plus one from a locked account.
        await env.AddCaseAsync("case-locked");
        for (var i = 0; i < 4; i++) await env.AddReviewAsync("case-locked", await env.AddUserAsync(), 5);
        await env.AddReviewAsync("case-locked", await env.AddUserAsync(status: UserStatus.Locked), 5);
        // Y: five 4-star reviews from verified active accounts, average exactly 4.0.
        await env.AddRatedCaseAsync("case-y", stars: 4, reviews: 5);

        var random = new ScriptedRandom(0);
        var picked = await env.Service(random: random).EnsureChallengeAsync(ThisWeek, CancellationToken.None);

        Assert.Equal("case-y", picked!.CaseId);
        Assert.Equal([1], random.Bounds);
    }

    [Fact]
    public async Task Ensure_AvoidsTheLastFourWeeks()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        string[] ids = ["case-a", "case-b", "case-c", "case-d", "case-e"];
        foreach (var id in ids) await env.AddRatedCaseAsync(id, stars: 5, reviews: 5);
        for (var weeks = 1; weeks <= 4; weeks++) await env.AddWeekAsync(ThisWeek.Previous(weeks), ids[weeks - 1]);
        await env.AddWeekAsync(ThisWeek.Previous(5), "case-e"); // five weeks ago is old enough to run again

        var random = new ScriptedRandom(0);
        var picked = await env.Service(random: random).EnsureChallengeAsync(ThisWeek, CancellationToken.None);

        Assert.Equal("case-e", picked!.CaseId);
        Assert.Equal([1], random.Bounds);
    }

    [Fact]
    public async Task Ensure_WhenEveryGoodCaseIsRecent_StillSkipsLastWeek()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddRatedCaseAsync("case-a", stars: 5, reviews: 5);
        await env.AddRatedCaseAsync("case-b", stars: 5, reviews: 5);
        await env.AddWeekAsync(ThisWeek.Previous(1), "case-a");
        await env.AddWeekAsync(ThisWeek.Previous(2), "case-b");

        var random = new ScriptedRandom(0);
        var picked = await env.Service(random: random).EnsureChallengeAsync(ThisWeek, CancellationToken.None);

        Assert.Equal("case-b", picked!.CaseId);
        Assert.Equal([1], random.Bounds);
    }

    [Fact]
    public async Task Ensure_NoPlayableCase_CreatesNothing()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddRatedCaseAsync("case-draft", stars: 5, reviews: 5, status: CaseStatus.Draft);
        await env.AddRatedCaseAsync(TutorialRules.CaseId, stars: 5, reviews: 5);
        var service = env.Service();

        Assert.Null(await service.EnsureChallengeAsync(ThisWeek, CancellationToken.None));
        Assert.Null(await service.GetActiveChallengeAsync());
        Assert.Equal(0, (await service.GetChallengeLeaderboardAsync()).TotalRanked);
        Assert.Equal(0, await env.Db.WeeklyFeatures.CountDocumentsAsync(FilterDefinition<WeeklyFeature>.Empty));
    }

    [Fact]
    public async Task Ensure_AdoptsTheLegacyActiveChallenge()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddCaseAsync("case-legacy"); // no reviews: only the admin's choice can bring it in
        await env.AddCaseAsync("case-old");
        await env.AddRatedCaseAsync("case-good", stars: 5, reviews: 5);
        // What the admin set before weeks had keys: a Monday-to-Sunday window around now.
        var legacy = await env.AddLegacyAsync("case-legacy", Now.AddDays(-3), Now.AddDays(3), active: true, createdAt: Now.AddDays(-3));
        // Neither of these speaks for this week: one was switched off, the other ran out an hour ago.
        await env.AddLegacyAsync("case-old", Now.AddDays(-3), Now.AddDays(3), active: false, createdAt: Now.AddDays(-1));
        await env.AddLegacyAsync("case-old", ThisWeek.StartUtc, Now.AddHours(-1), active: true, createdAt: Now.AddDays(-1));
        var service = env.Service();

        var adopted = await service.EnsureChallengeAsync(ThisWeek, CancellationToken.None);

        Assert.Equal("case-legacy", adopted!.CaseId);
        Assert.Equal(ThisWeek.Key, adopted.WeekKey);
        Assert.Equal(WeeklyFeatureSources.Admin, adopted.Source);
        Assert.Equal(ThisWeek.StartUtc, adopted.WeekStart);
        Assert.Equal(ThisWeek.EndUtc, adopted.WeekEnd);
        Assert.NotEqual(legacy.Id, adopted.Id);
        var dto = await service.GetActiveChallengeAsync();
        Assert.Equal("case-legacy", dto!.CaseId);
        Assert.Equal(WeeklyFeatureSources.Admin, dto.Source);
        // The old document stays as the admin left it.
        var old = await env.Db.WeeklyFeatures.Find(w => w.Id == legacy.Id).SingleAsync();
        Assert.True(old.IsActive);
        Assert.Null(old.WeekKey);

        // A legacy window only speaks for the week that holds now: a past week still picks on its own.
        var past = await service.EnsureChallengeAsync(ThisWeek.Previous(1), CancellationToken.None);
        Assert.Equal("case-good", past!.CaseId);
        Assert.Equal(WeeklyFeatureSources.Auto, past.Source);
    }

    // ------------------------------------------------------------------ admin

    [Fact]
    public async Task Clear_StopsThisWeek_NextWeekPicksAgain()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddRatedCaseAsync("case-a", stars: 5, reviews: 5);
        await env.AddRatedCaseAsync("case-b", stars: 5, reviews: 5);
        // An old document the admin set for a later window: clearing switches it off too, as before.
        var legacy = await env.AddLegacyAsync("case-b", Now.AddDays(30), Now.AddDays(37), active: true, createdAt: Now.AddDays(-1));
        var admin = Admin();
        var service = env.Service(random: new ScriptedRandom(0));

        Assert.Equal("case-a", (await service.GetActiveChallengeAsync())!.CaseId);
        Assert.True(await service.ClearWeeklyFeatureAsync(admin, WeeklyFeatureTypes.WeeklyChallenge));

        Assert.Null(await service.GetActiveChallengeAsync());
        Assert.Null(await service.EnsureChallengeAsync(ThisWeek, CancellationToken.None));
        Assert.Null(await service.FindChallengeAsync(ThisWeek, CancellationToken.None));
        var cleared = await env.Db.WeeklyFeatures.Find(w => w.WeekKey == ThisWeek.Key).SingleAsync();
        Assert.False(cleared.IsActive);
        Assert.Equal("case-a", cleared.CaseId);
        Assert.False((await env.Db.WeeklyFeatures.Find(w => w.Id == legacy.Id).SingleAsync()).IsActive);
        Assert.False(await service.ClearWeeklyFeatureAsync(admin, WeeklyFeatureTypes.WeeklyChallenge)); // nothing left to stop

        // Next week picks again on its own, and does not bring back the case that was stopped.
        var nextWeek = env.Service(now: Now.AddDays(7), random: new ScriptedRandom(0));
        var next = await nextWeek.GetActiveChallengeAsync();
        Assert.Equal(ThisWeek.Previous(-1).Key, next!.WeekKey);
        Assert.Equal(WeeklyFeatureSources.Auto, next.Source);
        Assert.Equal("case-b", next.CaseId);

        // Clearing a week nobody has asked about yet keeps that week empty instead of picking.
        var later = env.Service(now: Now.AddDays(14));
        Assert.True(await later.ClearWeeklyFeatureAsync(admin, WeeklyFeatureTypes.WeeklyChallenge));
        Assert.Null(await later.GetActiveChallengeAsync());
        var empty = await env.Db.WeeklyFeatures.Find(w => w.WeekKey == ThisWeek.Previous(-2).Key).SingleAsync();
        Assert.False(empty.IsActive);
        Assert.Equal(string.Empty, empty.CaseId);
        Assert.Equal(ThisWeek.Previous(-2).StartUtc, empty.WeekStart);
    }

    [Fact]
    public async Task Set_SnapsAdminWindowToTheWeek()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddRatedCaseAsync("case-a", stars: 5, reviews: 5);
        await env.AddCaseAsync("case-b");
        await env.AddCaseAsync("case-c");
        var admin = Admin();
        var service = env.Service(random: new ScriptedRandom(0));
        Assert.Equal("case-a", (await service.EnsureChallengeAsync(ThisWeek, CancellationToken.None))!.CaseId);

        // The admin page sends whole days: Friday 00:00 UTC to Sunday 23:59:59.
        var dto = await service.SetWeeklyFeatureAsync(admin, new SetWeeklyFeatureRequest
        {
            Type = WeeklyFeatureTypes.WeeklyChallenge,
            CaseId = "case-b",
            WeekStart = new DateTime(2026, 11, 20, 0, 0, 0, DateTimeKind.Utc),
            WeekEnd = new DateTime(2026, 11, 22, 23, 59, 59, DateTimeKind.Utc),
        });

        Assert.Equal(new DateTime(2026, 11, 18, 0, 0, 0, DateTimeKind.Utc), dto.WeekStart);
        Assert.Equal(new DateTime(2026, 11, 25, 0, 0, 0, DateTimeKind.Utc), dto.WeekEnd);
        Assert.Equal("2026-11-18", dto.WeekKey);
        Assert.Equal(WeeklyFeatureSources.Admin, dto.Source);
        Assert.Equal("case-b", dto.CaseId);
        var stored = await env.Db.WeeklyFeatures.Find(w => w.WeekKey == ThisWeek.Key).SingleAsync();
        Assert.Equal("case-b", stored.CaseId);
        Assert.Equal(WeeklyFeatureSources.Admin, stored.Source);
        Assert.True(stored.IsActive);
        Assert.Equal(ThisWeek.StartUtc, stored.WeekStart);
        Assert.Equal(ThisWeek.EndUtc, stored.WeekEnd);
        Assert.Equal(admin.Id, stored.CreatedBy);
        Assert.Equal("case-b", (await service.EnsureChallengeAsync(ThisWeek, CancellationToken.None))!.CaseId);

        // Choosing next week's case (no document yet) leaves this week alone; weekEnd is not read.
        var next = await service.SetWeeklyFeatureAsync(admin, new SetWeeklyFeatureRequest
        {
            Type = WeeklyFeatureTypes.WeeklyChallenge,
            CaseId = "case-c",
            WeekStart = new DateTime(2026, 11, 27, 0, 0, 0, DateTimeKind.Utc),
            WeekEnd = new DateTime(2026, 11, 26, 0, 0, 0, DateTimeKind.Utc),
        });
        Assert.Equal("2026-11-25", next.WeekKey);
        Assert.Equal("case-c", (await service.FindChallengeAsync(ChallengeWeek.FromKey("2026-11-25"), CancellationToken.None))!.CaseId);
        Assert.Equal("case-b", (await service.GetActiveChallengeAsync())!.CaseId);
        Assert.Equal(2, await env.Db.WeeklyFeatures.CountDocumentsAsync(FilterDefinition<WeeklyFeature>.Empty));

        // Choosing again after a clear brings the week back with the admin's case.
        await service.ClearWeeklyFeatureAsync(admin, WeeklyFeatureTypes.WeeklyChallenge);
        await service.SetWeeklyFeatureAsync(admin, new SetWeeklyFeatureRequest
        {
            Type = WeeklyFeatureTypes.WeeklyChallenge, CaseId = "case-c", WeekStart = Now, WeekEnd = Now.AddDays(1),
        });
        Assert.Equal("case-c", (await service.GetActiveChallengeAsync())!.CaseId);
        Assert.Equal(2, await env.Db.WeeklyFeatures.CountDocumentsAsync(FilterDefinition<WeeklyFeature>.Empty));
    }

    [Fact]
    public async Task Set_PastWeek_IsRefused()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddCaseAsync("case-a");
        var service = env.Service();

        // Last week (2026-11-11 to 2026-11-18 00:00 UTC) ended before now; so did the week a year ago.
        foreach (var weekStart in new[] { new DateTime(2026, 11, 12, 0, 0, 0, DateTimeKind.Utc), ThisWeek.StartUtc.AddTicks(-1), Now.AddYears(-1) })
        {
            var error = await Assert.ThrowsAsync<ApiException>(() => service.SetWeeklyFeatureAsync(Admin(), new SetWeeklyFeatureRequest
            {
                Type = WeeklyFeatureTypes.WeeklyChallenge, CaseId = "case-a", WeekStart = weekStart, WeekEnd = weekStart.AddDays(7),
            }));
            Assert.Equal(400, error.StatusCode);
            Assert.Equal("Tuần này đã kết thúc; chỉ chọn được tuần đang chạy hoặc tuần sau.", error.Message);
        }

        Assert.Equal(0, await env.Db.WeeklyFeatures.CountDocumentsAsync(FilterDefinition<WeeklyFeature>.Empty));
    }

    [Fact]
    public async Task Set_TwoWeeksAhead_IsRefused()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddCaseAsync("case-a");
        var service = env.Service();

        // The week after next starts 2026-12-02 00:00 UTC; next week's last moment is still allowed (see Set_NextWeek_IsAccepted).
        // The last day a DateTime can hold has no whole week after it: still a plain refusal, not a crash.
        var lastDay = new DateTime(9999, 12, 31, 0, 0, 0, DateTimeKind.Utc);
        foreach (var weekStart in new[] { ThisWeek.Previous(-2).StartUtc, new DateTime(2026, 12, 5, 0, 0, 0, DateTimeKind.Utc), Now.AddYears(1), lastDay })
        {
            var error = await Assert.ThrowsAsync<ApiException>(() => service.SetWeeklyFeatureAsync(Admin(), new SetWeeklyFeatureRequest
            {
                Type = WeeklyFeatureTypes.WeeklyChallenge, CaseId = "case-a", WeekStart = weekStart, WeekEnd = weekStart,
            }));
            Assert.Equal(400, error.StatusCode);
            Assert.Equal("Chỉ chọn được tuần đang chạy hoặc tuần sau.", error.Message);
        }

        Assert.Equal(0, await env.Db.WeeklyFeatures.CountDocumentsAsync(FilterDefinition<WeeklyFeature>.Empty));
    }

    [Fact]
    public async Task Set_NextWeek_IsAccepted()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddCaseAsync("case-a");
        await env.AddCaseAsync("case-b");
        var admin = Admin();
        var service = env.Service();
        var nextWeek = ThisWeek.Previous(-1);

        // Any moment of next week names it, up to its very last tick.
        var dto = await service.SetWeeklyFeatureAsync(admin, new SetWeeklyFeatureRequest
        {
            Type = WeeklyFeatureTypes.WeeklyChallenge, CaseId = "case-a", WeekStart = nextWeek.EndUtc.AddTicks(-1), WeekEnd = nextWeek.EndUtc,
        });

        Assert.Equal(nextWeek.Key, dto.WeekKey);
        Assert.Equal(nextWeek.StartUtc, dto.WeekStart);
        Assert.Equal(nextWeek.EndUtc, dto.WeekEnd);
        var stored = await env.Db.WeeklyFeatures.Find(w => w.WeekKey == nextWeek.Key).SingleAsync();
        Assert.Equal("case-a", stored.CaseId);
        Assert.Equal(WeeklyFeatureSources.Admin, stored.Source);
        Assert.True(stored.IsActive);

        // The running week is still open to the admin, down to its first moment.
        var current = await service.SetWeeklyFeatureAsync(admin, new SetWeeklyFeatureRequest
        {
            Type = WeeklyFeatureTypes.WeeklyChallenge, CaseId = "case-b", WeekStart = ThisWeek.StartUtc, WeekEnd = ThisWeek.EndUtc,
        });
        Assert.Equal(ThisWeek.Key, current.WeekKey);
        Assert.Equal("case-b", (await service.GetActiveChallengeAsync())!.CaseId);
        Assert.Equal(2, await env.Db.WeeklyFeatures.CountDocumentsAsync(FilterDefinition<WeeklyFeature>.Empty));
    }

    // ------------------------------------------------------------------ what players read

    [Fact]
    public async Task GetActive_ReturnsOddsAndMinScore()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddRatedCaseAsync("case-a", stars: 5, reviews: 5);
        var leaderboard = new RecordingLeaderboard();
        var service = env.Service(leaderboard: leaderboard, settings: new WeeklyChallengeSettings { MinScore = 80 });

        var dto = await service.GetActiveChallengeAsync();

        Assert.NotNull(dto);
        Assert.Equal("case-a", dto!.CaseId);
        Assert.Equal("Case case-a", dto.CaseTitle);
        Assert.Equal(80, dto.MinScore);
        Assert.Equal(ThisWeek.Key, dto.WeekKey);
        Assert.Equal(WeeklyFeatureSources.Auto, dto.Source);
        Assert.Equal(ThisWeek.StartUtc, dto.WeekStart);
        Assert.Equal(ThisWeek.EndUtc, dto.WeekEnd);
        Assert.Equal(["chest_np", "chest_sm", "chest_nb"], dto.Drops.Select(drop => drop.ChestId));
        Assert.Equal([60m, 30m, 10m], dto.Drops.Select(drop => drop.Percent));
        Assert.All(dto.Drops, drop =>
        {
            Assert.False(string.IsNullOrEmpty(drop.Name));
            Assert.False(string.IsNullOrEmpty(drop.NameEn));
            Assert.False(string.IsNullOrEmpty(drop.IconKey));
        });

        // The leaderboard counts plays inside the same week.
        await service.GetChallengeLeaderboardAsync(10);
        Assert.Equal(("case-a", (DateTime?)ThisWeek.StartUtc, (DateTime?)ThisWeek.EndUtc), leaderboard.Last);

        // The case of the week has no chest and no week key.
        await service.SetWeeklyFeatureAsync(Admin(), new SetWeeklyFeatureRequest
        {
            Type = WeeklyFeatureTypes.CaseOfWeek, CaseId = "case-a", WeekStart = Now.AddDays(-1), WeekEnd = Now.AddDays(1),
        });
        var caseOfWeek = await service.GetActiveCaseOfWeekAsync();
        Assert.Equal("case-a", caseOfWeek!.CaseId);
        Assert.Empty(caseOfWeek.Drops);
        Assert.Null(caseOfWeek.WeekKey);
    }

    [Fact]
    public async Task GetActive_CaseNoLongerPlayable_ReturnsNull()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync();
        await env.AddRatedCaseAsync("case-a", stars: 5, reviews: 5);
        var service = env.Service();
        Assert.Equal("case-a", (await service.GetActiveChallengeAsync())!.CaseId);

        await env.Db.Cases.UpdateOneAsync(c => c.CaseId == "case-a", Builders<GameCase>.Update.Set(c => c.Status, CaseStatus.Archived));

        Assert.Null(await service.GetActiveChallengeAsync());
    }

    // ------------------------------------------------------------------ index

    [Fact]
    public async Task EnsureIndexes_WithLegacyDocumentsWithoutWeekKey_Succeeds()
    {
        if (!Enabled) return;
        await using var env = await WeeklyEnv.CreateAsync(ensureIndexes: false);
        var raw = env.Db.Database.GetCollection<BsonDocument>(env.Db.Settings.WeeklyFeaturesCollectionName);
        BsonDocument Legacy() => new()
        {
            { "type", WeeklyFeatureTypes.WeeklyChallenge }, { "caseId", "case-a" },
            { "weekStart", Now.AddDays(-3) }, { "weekEnd", Now.AddDays(3) }, { "isActive", true },
            { "createdBy", "admin" }, { "createdAt", Now },
        };
        await raw.InsertManyAsync([Legacy(), Legacy(), Legacy().Add("weekKey", BsonNull.Value)]);

        await env.Db.EnsureIndexesAsync();
        await env.Db.EnsureIndexesAsync(); // safe to run again

        var index = (await env.Db.WeeklyFeatures.Indexes.List().ToListAsync())
            .Single(i => i["name"] == "ux_weeklyFeatures_type_weekKey");
        Assert.True(index["unique"].ToBoolean());
        Assert.Equal(new BsonDocument { { "type", 1 }, { "weekKey", 1 } }, index["key"].AsBsonDocument);
        Assert.True(index["partialFilterExpression"].AsBsonDocument.Contains("weekKey"));

        // Old documents still go in; a second document for the same week and type does not.
        await raw.InsertOneAsync(Legacy());
        await raw.InsertOneAsync(Legacy().Add("weekKey", ThisWeek.Key));
        var duplicate = await Assert.ThrowsAsync<MongoWriteException>(() => raw.InsertOneAsync(Legacy().Add("weekKey", ThisWeek.Key)));
        Assert.Equal(ServerErrorCategory.DuplicateKey, duplicate.WriteError.Category);
        await raw.InsertOneAsync(Legacy().Set("type", WeeklyFeatureTypes.CaseOfWeek).Add("weekKey", ThisWeek.Key));
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>Hands out the scripted values in order (then 0) and remembers every bound it was asked for.</summary>
    private sealed class ScriptedRandom(params int[] values) : IChestRandom
    {
        private readonly Queue<int> _values = new(values);
        public List<int> Bounds { get; } = [];

        public int NextInt(int exclusiveMax)
        {
            Bounds.Add(exclusiveMax);
            return _values.Count > 0 ? _values.Dequeue() : 0;
        }
    }

    private sealed class FixedClock(DateTime utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(utcNow, TimeSpan.Zero);
    }

    private sealed class RecordingLeaderboard : ILeaderboardService
    {
        public (string CaseId, DateTime? After, DateTime? Before)? Last { get; private set; }

        public Task<LeaderboardDto> GetCaseLeaderboardAsync(
            string caseId, string? metric, int limit = 100, DateTime? after = null, DateTime? before = null, CancellationToken ct = default)
        {
            Last = (caseId, after, before);
            return Task.FromResult(new LeaderboardDto { Metric = LeaderboardMetrics.Fastest, TotalRanked = 0 });
        }
    }

    private sealed class WeeklyEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private WeeklyEnv(MongoDbSettings settings)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
        }

        public MongoDbContext Db { get; }

        public static async Task<WeeklyEnv> CreateAsync(bool ensureIndexes = true)
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_weekly_{Guid.NewGuid():N}"
            };
            if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
                || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                    server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
                throw new InvalidOperationException("Weekly challenge integration tests need a loopback MongoDB and a temporary database.");
            var env = new WeeklyEnv(settings);
            await env.Db.PingAsync();
            if (ensureIndexes) await env.Db.EnsureIndexesAsync();
            return env;
        }

        public WeeklyService Service(
            DateTime? now = null, IChestRandom? random = null, WeeklyChallengeSettings? settings = null, ILeaderboardService? leaderboard = null) =>
            new(Db, leaderboard ?? new RecordingLeaderboard(), CaseCatalogPolicy.Open,
                Options.Create(settings ?? new WeeklyChallengeSettings()), FixedCatalogProvider.Default,
                random ?? new ScriptedRandom(), new FixedClock(now ?? Now), NullLogger<WeeklyService>.Instance);

        public async Task<string> AddUserAsync(bool verified = true, string status = UserStatus.Active)
        {
            var user = new User
            {
                Id = ObjectId.GenerateNewId().ToString(),
                FullName = "Thám tử",
                Email = $"{Guid.NewGuid():N}@tests.invalid",
                Status = status,
                IsEmailVerified = verified
            };
            await Db.Users.InsertOneAsync(user);
            return user.Id;
        }

        public Task AddCaseAsync(string caseId, string author = "", string status = CaseStatus.Published) =>
            Db.Cases.InsertOneAsync(new GameCase
            {
                CaseId = caseId,
                Title = $"Case {caseId}",
                Status = status,
                AuthorUserId = author,
            });

        /// <summary>A case with this many reviews of this many stars, each from its own verified active account.</summary>
        public async Task AddRatedCaseAsync(string caseId, int stars, int reviews, string status = CaseStatus.Published)
        {
            await AddCaseAsync(caseId, status: status);
            for (var i = 0; i < reviews; i++) await AddReviewAsync(caseId, await AddUserAsync(), stars);
        }

        public Task AddReviewAsync(string caseId, string userId, int rating, bool hidden = false) =>
            Db.Reviews.InsertOneAsync(new CaseReview { CaseId = caseId, UserId = userId, Rating = rating, Hidden = hidden });

        /// <summary>A past week's challenge, as the picker would have stored it.</summary>
        public Task AddWeekAsync(ChallengeWeek week, string caseId) =>
            Db.WeeklyFeatures.InsertOneAsync(new WeeklyFeature
            {
                Type = WeeklyFeatureTypes.WeeklyChallenge,
                WeekKey = week.Key,
                Source = WeeklyFeatureSources.Auto,
                CaseId = caseId,
                WeekStart = week.StartUtc,
                WeekEnd = week.EndUtc,
                IsActive = true,
                CreatedAt = week.StartUtc,
            });

        /// <summary>A challenge the admin set before weeks had keys: any window, no week key.</summary>
        public async Task<WeeklyFeature> AddLegacyAsync(string caseId, DateTime start, DateTime end, bool active, DateTime createdAt)
        {
            var feature = new WeeklyFeature
            {
                Type = WeeklyFeatureTypes.WeeklyChallenge,
                CaseId = caseId,
                WeekStart = start,
                WeekEnd = end,
                IsActive = active,
                CreatedBy = "admin",
                CreatedAt = createdAt,
            };
            await Db.WeeklyFeatures.InsertOneAsync(feature);
            return feature;
        }

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
