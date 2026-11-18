using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Weekly;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The weekly challenge chest against a real (standalone) MongoDB: a game of the week's case with 80 points and the
/// right culprit drops exactly one chest per verified account per week, whatever runs twice or at once (the hook on a
/// re-saved result, two games finishing together, the recovery sweep); a full bag keeps the chest waiting instead of
/// losing it, and the week is the week the game was played in. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoWeeklyDropTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_MONGO_IT";
    private const string Challenge = "case-challenge";

    /// <summary>Thursday 17:00 in Vietnam, inside the week that starts Wednesday 2026-11-18 00:00 UTC.</summary>
    private static readonly DateTime Now = new(2026, 11, 19, 10, 0, 0, DateTimeKind.Utc);
    private static readonly ChallengeWeek ThisWeek = ChallengeWeek.FromKey("2026-11-18");

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable(RunEnvironmentVariable), "true", StringComparison.OrdinalIgnoreCase);

    // ------------------------------------------------------------------ one chest

    [Fact]
    public async Task Evaluate_QualifyingGame_GivesOneChestInTheBag()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 92, success: true, user);

        // Ticket 95 of 100 falls in the last 10: Két Nhà Băng.
        var status = await env.Drops(new ScriptedRandom(95)).EvaluatePlayerAsync(result, user, CancellationToken.None);

        Assert.Equal(WeeklyDropStatuses.Granted, status);
        var drop = await env.Store.WeeklyDrops.Find(d => d.Id == WeeklyDrop.IdOf(ThisWeek.Key, user)).SingleAsync();
        Assert.Equal(user, drop.UserId);
        Assert.Equal(ThisWeek.Key, drop.WeekKey);
        Assert.Equal(Challenge, drop.CaseId);
        Assert.Equal("room-1", drop.RoomId);
        Assert.Equal("chest_nb", drop.ChestDefId);
        Assert.Equal(WeeklyDropStates.Done, drop.State);
        Assert.NotNull(drop.DeliveredAt);
        var item = await env.Store.Items.Find(i => i.Id == drop.ItemId).SingleAsync();
        Assert.Equal(user, item.OwnerId);
        Assert.Equal("chest_nb", item.DefId);
        Assert.Equal(MarketItemSources.Weekly, item.Source);
        Assert.Null(item.LockedBy);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Weekly));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Evaluate_Repeated_GivesOneChest_AndSlotsMatchItems()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 80, success: true, user);
        var drops = env.Drops(new CryptoChestRandom());
        var hook = new MarketGameRewardHook(env.Market, env.Progress, drops, NullLogger<MarketGameRewardHook>.Instance);

        // The result is saved again (hook twice), something evaluates it once more, and the sweep passes by.
        await hook.OnGameResultPersistedAsync(result);
        await hook.OnGameResultPersistedAsync(result);
        await drops.EvaluateAsync(result, CancellationToken.None);
        Assert.Equal(0, await drops.RecoverAsync(TimeSpan.Zero, CancellationToken.None));

        var drop = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();
        Assert.Equal(WeeklyDropStates.Done, drop.State);
        var item = await env.Store.Items.Find(i => i.Source == MarketItemSources.Weekly).SingleAsync();
        Assert.Equal(drop.ItemId, item.Id);
        Assert.Equal(drop.ChestDefId, item.DefId);
        // The coin reward was paid once as well.
        Assert.Equal(MarketRules.StarterCoins + MarketRules.RewardFor(true), (await env.Market.GetWalletAsync(user)).Balance);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Evaluate_TwoQualifyingGamesInParallel_GiveOneChest()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var first = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 90, success: true, user);
        var second = await env.AddResultAsync("room-2", Challenge, Now.AddMinutes(-4), score: 95, success: true, user);

        // Both games finish at once, and each is evaluated three times over, every call with its own service.
        var calls = new[] { first, second, first, second, first, second }
            .Select(result => Task.Run(async () =>
                (Room: result.RoomId, Status: await env.Drops(new CryptoChestRandom()).EvaluatePlayerAsync(result, user, CancellationToken.None))))
            .ToList();
        var statuses = await Task.WhenAll(calls);

        var drop = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();
        Assert.Equal(WeeklyDrop.IdOf(ThisWeek.Key, user), drop.Id);
        Assert.Equal(WeeklyDropStates.Done, drop.State);
        Assert.All(statuses.Where(s => s.Room == drop.RoomId), s => Assert.Equal(WeeklyDropStatuses.Granted, s.Status));
        var other = statuses.Where(s => s.Room != drop.RoomId).ToList();
        Assert.Equal(3, other.Count);
        Assert.All(other, s => Assert.Equal(WeeklyDropStatuses.AlreadyThisWeek, s.Status));
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Weekly));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Evaluate_UsesTheWeekOfTheResult_NotTheClock()
    {
        if (!Enabled) return;
        // Five minutes into the new week: the game below ended one second before it began.
        await using var env = await DropEnv.CreateAsync(now: ThisWeek.StartUtc.AddMinutes(5));
        var lastWeek = ThisWeek.Previous();
        await env.AddWeekAsync(lastWeek, "case-p");
        await env.AddWeekAsync(ThisWeek, "case-q");
        var user = await env.AddUserAsync();
        var late = await env.AddResultAsync("room-p", "case-p", new DateTime(2026, 11, 17, 23, 59, 59, DateTimeKind.Utc), 85, true, user);
        var drops = env.Drops(new CryptoChestRandom());

        Assert.Equal(WeeklyDropStatuses.Granted, await drops.EvaluatePlayerAsync(late, user, CancellationToken.None));

        var drop = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();
        Assert.Equal($"2026-11-11:{user}", drop.Id);
        Assert.Equal("2026-11-11", drop.WeekKey);
        Assert.Equal("case-p", drop.CaseId);

        // The new week's case drops the new week's chest.
        var fresh = await env.AddResultAsync("room-q", "case-q", ThisWeek.StartUtc.AddMinutes(2), 85, true, user);
        Assert.Equal(WeeklyDropStatuses.Granted, await drops.EvaluatePlayerAsync(fresh, user, CancellationToken.None));
        Assert.True(await env.Store.WeeklyDrops.Find(d => d.Id == $"2026-11-18:{user}").AnyAsync());
        Assert.Equal(2, await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Weekly));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Evaluate_EachTeammateRollsOwnChest()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var a = await env.AddUserAsync();
        var b = await env.AddUserAsync();
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 88, success: true, a, b, a, "");

        // One roll each, in the order the players are listed: 0 is Hòm Niêm Phong, 95 is Két Nhà Băng.
        await env.Drops(new ScriptedRandom(0, 95)).EvaluateAsync(result, CancellationToken.None);

        var byUser = (await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).ToListAsync()).ToDictionary(d => d.UserId);
        Assert.Equal(2, byUser.Count);
        Assert.Equal("chest_np", byUser[a].ChestDefId);
        Assert.Equal("chest_nb", byUser[b].ChestDefId);
        Assert.NotEqual(byUser[a].ItemId, byUser[b].ItemId);
        Assert.Equal(a, (await env.Store.Items.Find(i => i.Id == byUser[a].ItemId).SingleAsync()).OwnerId);
        Assert.Equal(b, (await env.Store.Items.Find(i => i.Id == byUser[b].ItemId).SingleAsync()).OwnerId);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Evaluate_AfterAdminSwapsTheCase_TheDroppedRoomStillReportsGranted()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-10), score: 90, success: true, user);
        var drops = env.Drops(new CryptoChestRandom());
        Assert.Equal(WeeklyDropStatuses.Granted, await drops.EvaluatePlayerAsync(result, user, CancellationToken.None));

        // Mid-week an admin puts another case on the challenge.
        await env.Db.WeeklyFeatures.UpdateOneAsync(w => w.WeekKey == ThisWeek.Key,
            Builders<WeeklyFeature>.Update.Set(w => w.CaseId, "case-swapped"));

        // The game that dropped the chest still says so; any other game of the week is too late, whatever its case.
        Assert.Equal(WeeklyDropStatuses.Granted, await drops.EvaluatePlayerAsync(result, user, CancellationToken.None));
        var swapped = await env.AddResultAsync("room-2", "case-swapped", Now.AddMinutes(-5), score: 95, success: true, user);
        Assert.Equal(WeeklyDropStatuses.AlreadyThisWeek, await drops.EvaluatePlayerAsync(swapped, user, CancellationToken.None));

        var drop = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();
        Assert.Equal("room-1", drop.RoomId);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Weekly));
        await env.AssertSlotsMatchItemsAsync();
    }

    // ------------------------------------------------------------------ no chest

    [Fact]
    public async Task Evaluate_OtherCaseAfterADrop_IsNotChallenge()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var won = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-10), score: 90, success: true, user);
        var drops = env.Drops(new CryptoChestRandom());
        Assert.Equal(WeeklyDropStatuses.Granted, await drops.EvaluatePlayerAsync(won, user, CancellationToken.None));

        // An unrelated case later that week is not the challenge, not "already got this week's chest".
        var other = await env.AddResultAsync("room-2", "case-other", Now.AddMinutes(-5), score: 100, success: true, user);
        Assert.Equal(WeeklyDropStatuses.NotChallenge, await drops.EvaluatePlayerAsync(other, user, CancellationToken.None));
        // Another challenge game is the one that is too late.
        var again = await env.AddResultAsync("room-3", Challenge, Now.AddMinutes(-4), score: 100, success: true, user);
        Assert.Equal(WeeklyDropStatuses.AlreadyThisWeek, await drops.EvaluatePlayerAsync(again, user, CancellationToken.None));

        Assert.Equal("room-1", (await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync()).RoomId);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Weekly));
    }

    [Fact]
    public async Task Evaluate_OtherCase_IsNotChallenge()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var result = await env.AddResultAsync("room-1", "case-other", Now.AddMinutes(-5), score: 100, success: true, user);

        Assert.Equal(WeeklyDropStatuses.NotChallenge,
            await env.Drops(new CryptoChestRandom()).EvaluatePlayerAsync(result, user, CancellationToken.None));

        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(FilterDefinition<WeeklyDrop>.Empty));
    }

    [Fact]
    public async Task Evaluate_GuestPlayer_IsUnverified()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 100, success: true, "guest-abc");
        var drops = env.Drops(new CryptoChestRandom());

        Assert.Equal(WeeklyDropStatuses.Unverified, await drops.EvaluatePlayerAsync(result, "guest-abc", CancellationToken.None));
        await drops.EvaluateAsync(result, CancellationToken.None);
        Assert.Equal(0, await drops.RecoverAsync(TimeSpan.Zero, CancellationToken.None));

        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(FilterDefinition<WeeklyDrop>.Empty));
        Assert.Equal(0, await env.Store.Accounts.CountDocumentsAsync(FilterDefinition<MarketAccount>.Empty));
    }

    [Fact]
    public async Task Evaluate_AuthorOrUnverifiedAccount_GetsNoChest_UntilVerifiedAndPlayedAgain()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var author = await env.AddUserAsync();
        var unverified = await env.AddUserAsync(verified: false);
        await env.AddCaseAsync(Challenge, author);
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-10), score: 100, success: true, author, unverified);
        var drops = env.Drops(new CryptoChestRandom());

        Assert.Equal(WeeklyDropStatuses.Author, await drops.EvaluatePlayerAsync(result, author, CancellationToken.None));
        Assert.Equal(WeeklyDropStatuses.Unverified, await drops.EvaluatePlayerAsync(result, unverified, CancellationToken.None));
        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(FilterDefinition<WeeklyDrop>.Empty));

        // Nothing was written, so after verifying the e-mail the next good game of the week drops the chest.
        await env.Db.Users.UpdateOneAsync(u => u.Id == unverified, Builders<User>.Update.Set(u => u.IsEmailVerified, true));
        var again = await env.AddResultAsync("room-2", Challenge, Now.AddMinutes(-5), score: 81, success: true, unverified);
        Assert.Equal(WeeklyDropStatuses.Granted, await drops.EvaluatePlayerAsync(again, unverified, CancellationToken.None));
        Assert.Equal("room-2", (await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync()).RoomId);
    }

    [Fact]
    public async Task Evaluate_FullBag_Waits_ThenGrantsWhenRoom()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        await env.FillBagAsync(user);
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 90, success: true, user);
        var drops = env.Drops(new CryptoChestRandom());

        Assert.Equal(WeeklyDropStatuses.Waiting, await drops.EvaluatePlayerAsync(result, user, CancellationToken.None));

        var drop = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();
        Assert.Equal(WeeklyDropStates.Waiting, drop.State);
        Assert.Null(drop.DeliveredAt);
        Assert.False(await env.Store.Items.Find(i => i.Id == drop.ItemId).AnyAsync());
        Assert.Equal(MarketRules.InventorySlots, (await env.Store.FindAccountAsync(user))!.Slots);
        await env.AssertSlotsMatchItemsAsync();
        // The sweep leaves a waiting chest alone: the player claims it.
        Assert.Equal(0, await drops.RecoverAsync(TimeSpan.Zero, CancellationToken.None));
        Assert.Equal(WeeklyDropStates.Waiting, (await env.Store.WeeklyDrops.Find(d => d.Id == drop.Id).SingleAsync()).State);

        // Once there is room, the same game delivers the same chest.
        await env.FreeOneSlotAsync(user);
        Assert.Equal(WeeklyDropStatuses.Granted, await drops.EvaluatePlayerAsync(result, user, CancellationToken.None));
        var done = await env.Store.WeeklyDrops.Find(d => d.Id == drop.Id).SingleAsync();
        Assert.Equal(WeeklyDropStates.Done, done.State);
        Assert.Equal(drop.ChestDefId, (await env.Store.Items.Find(i => i.Id == drop.ItemId).SingleAsync()).DefId);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Evaluate_NoChestToRoll_ReturnsNoChest()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 90, success: true, user);
        var logger = new ListLogger<WeeklyDropService>();

        var status = await env.Drops(new CryptoChestRandom(), new NothingDropsCatalog(), logger)
            .EvaluatePlayerAsync(result, user, CancellationToken.None);

        Assert.Equal(WeeklyDropStatuses.NoChest, status);
        Assert.Contains(LogLevel.Warning, logger.Levels);
        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(FilterDefinition<WeeklyDrop>.Empty));
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Weekly));
    }

    // ------------------------------------------------------------------ recovery

    [Fact]
    public async Task Recover_FindsAResultWhoseHookNeverRan()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var low = await env.AddUserAsync();
        // Saved, then the server stopped before the hook ran. Another game was too weak, a third was not the challenge.
        await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-3), score: 90, success: true, user);
        await env.AddResultAsync("room-2", Challenge, Now.AddMinutes(-3), score: 79, success: true, low);
        await env.AddResultAsync("room-3", "case-other", Now.AddMinutes(-3), score: 99, success: true, low);
        var drops = env.Drops(new CryptoChestRandom());

        // Too fresh for a sweep that waits ten minutes: the hook may still be running.
        Assert.Equal(0, await drops.RecoverAsync(TimeSpan.FromMinutes(10), CancellationToken.None));
        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(FilterDefinition<WeeklyDrop>.Empty));

        Assert.Equal(1, await drops.RecoverAsync(TimeSpan.Zero, CancellationToken.None));
        var drop = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();
        Assert.Equal(WeeklyDrop.IdOf(ThisWeek.Key, user), drop.Id);
        Assert.Equal(WeeklyDropStates.Done, drop.State);
        Assert.True(await env.Store.Items.Find(i => i.Id == drop.ItemId && i.OwnerId == user).AnyAsync());

        // The next sweep has nothing left to do.
        Assert.Equal(0, await drops.RecoverAsync(TimeSpan.Zero, CancellationToken.None));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Recover_NothingToDrop_DoesNothing()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 90, success: true, user);
        var logger = new ListLogger<WeeklyDropService>();
        var drops = env.Drops(new CryptoChestRandom(), new NothingDropsCatalog(), logger);

        Assert.Equal(0, await drops.RecoverAsync(TimeSpan.Zero, CancellationToken.None));
        Assert.Equal(0, await drops.RecoverAsync(TimeSpan.Zero, CancellationToken.None));

        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(FilterDefinition<WeeklyDrop>.Empty));
        // No warning per game on every sweep: at most one quiet line per sweep.
        Assert.DoesNotContain(logger.Levels, level => level >= LogLevel.Warning);
        Assert.True(logger.Levels.Count <= 2, $"{logger.Levels.Count} log lines for two sweeps");
    }

    [Fact]
    public async Task Recover_IgnoresResultsOlderThanTheWindow()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var old = await env.AddUserAsync();
        var recent = await env.AddUserAsync();
        // Both games qualify and neither was evaluated; only the one inside the window is the sweep's business.
        await env.AddResultAsync("room-old", Challenge, Now.AddHours(-3), score: 90, success: true, old);
        await env.AddResultAsync("room-recent", Challenge, Now.AddHours(-1), score: 90, success: true, recent);

        Assert.Equal(1, await env.Drops(new CryptoChestRandom()).RecoverAsync(TimeSpan.Zero, CancellationToken.None));

        var drop = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();
        Assert.Equal(recent, drop.UserId);
        Assert.False(await env.Store.WeeklyDrops.Find(d => d.UserId == old).AnyAsync());
    }

    [Fact]
    public async Task Recover_FinishesAPendingDrop_WhoseSlotWasAlreadyTaken()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var at = env.Clock.GetUtcNow().UtcDateTime.AddMinutes(-2);
        // The server stopped after rolling and taking the slot, before the chest went in.
        var pending = new WeeklyDrop
        {
            Id = WeeklyDrop.IdOf(ThisWeek.Key, user), UserId = user, WeekKey = ThisWeek.Key, CaseId = Challenge, RoomId = "room-1",
            ChestDefId = "chest_sm", ItemId = MarketStore.NewId(), State = WeeklyDropStates.Pending, CreatedAt = at, UpdatedAt = at,
        };
        await env.Store.WeeklyDrops.InsertOneAsync(pending);
        Assert.Equal(WalletWrite.Applied,
            await env.Store.ApplyWalletAsync(user, $"weekly:{pending.Id}", 0, slotDelta: 1));

        Assert.Equal(1, await env.Drops(new CryptoChestRandom()).RecoverAsync(TimeSpan.FromSeconds(30), CancellationToken.None));

        var done = await env.Store.WeeklyDrops.Find(d => d.Id == pending.Id).SingleAsync();
        Assert.Equal(WeeklyDropStates.Done, done.State);
        var item = await env.Store.Items.Find(i => i.Id == pending.ItemId).SingleAsync();
        Assert.Equal("chest_sm", item.DefId);
        Assert.Equal(MarketItemSources.Weekly, item.Source);
        await env.AssertSlotsMatchItemsAsync();
    }

    // ------------------------------------------------------------------ the reward API: claiming

    [Fact]
    public async Task Claim_AfterMakingRoom_GivesTheSameChest()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        await env.FillBagAsync(user);
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 90, success: true, user);
        // Ticket 95 of 100: Két Nhà Băng.
        var drops = env.Drops(new ScriptedRandom(95));
        Assert.Equal(WeeklyDropStatuses.Waiting, await drops.EvaluatePlayerAsync(result, user, CancellationToken.None));
        var waiting = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();

        await env.FreeOneSlotAsync(user);
        var claimed = await drops.ClaimAsync(Caller(user), waiting.Id, CancellationToken.None);

        Assert.Equal(waiting.Id, claimed.Id);
        Assert.Equal(ThisWeek.Key, claimed.WeekKey);
        Assert.Equal("chest_nb", claimed.ChestId);
        Assert.Equal("Két Nhà Băng", claimed.ChestName);
        Assert.Equal("Bank Safe", claimed.ChestNameEn);
        Assert.Equal("chest_bank", claimed.IconKey);
        Assert.Equal(WeeklyDropStates.Done, claimed.State);
        Assert.Equal(waiting.CreatedAt, claimed.CreatedAt);
        // The chest rolled when the game ended, under the item id chosen then.
        var item = await env.Store.Items.Find(i => i.Source == MarketItemSources.Weekly).SingleAsync();
        Assert.Equal(waiting.ItemId, item.Id);
        Assert.Equal("chest_nb", item.DefId);
        Assert.Equal(user, item.OwnerId);

        // Claiming again answers the same chest and gives nothing more.
        var again = await drops.ClaimAsync(Caller(user), waiting.Id, CancellationToken.None);
        Assert.Equal(WeeklyDropStates.Done, again.State);
        Assert.Equal(waiting.Id, again.Id);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Weekly));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Claim_StillFull_Returns409SlotsFull()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        await env.FillBagAsync(user);
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 90, success: true, user);
        var drops = env.Drops(new CryptoChestRandom());
        Assert.Equal(WeeklyDropStatuses.Waiting, await drops.EvaluatePlayerAsync(result, user, CancellationToken.None));
        var waiting = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => drops.ClaimAsync(Caller(user), waiting.Id, CancellationToken.None));

        Assert.Equal(409, error.StatusCode);
        Assert.Equal("SLOTS_FULL", ((ApiErrorDetails)error.Errors!).Code);
        var stored = await env.Store.WeeklyDrops.Find(d => d.Id == waiting.Id).SingleAsync();
        Assert.Equal(WeeklyDropStates.Waiting, stored.State);
        Assert.Null(stored.DeliveredAt);
        Assert.False(await env.Store.Items.Find(i => i.Id == waiting.ItemId).AnyAsync());
        Assert.Equal(MarketRules.InventorySlots, (await env.Store.FindAccountAsync(user))!.Slots);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Claim_SomeoneElsesDrop_Returns404()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var owner = await env.AddUserAsync();
        var other = await env.AddUserAsync();
        await env.FillBagAsync(owner);
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 90, success: true, owner);
        var drops = env.Drops(new CryptoChestRandom());
        Assert.Equal(WeeklyDropStatuses.Waiting, await drops.EvaluatePlayerAsync(result, owner, CancellationToken.None));
        var waiting = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();
        // The owner made room: a claim of theirs would deliver it, so only the ownership check stands in the way.
        await env.FreeOneSlotAsync(owner);
        var othersSlots = (await env.Store.FindAccountAsync(other))!.Slots;

        var stolen = await Assert.ThrowsAsync<ApiException>(() => drops.ClaimAsync(Caller(other), waiting.Id, CancellationToken.None));
        var missing = await Assert.ThrowsAsync<ApiException>(() =>
            drops.ClaimAsync(Caller(owner), WeeklyDrop.IdOf(ThisWeek.Key, other), CancellationToken.None));

        foreach (var error in new[] { stolen, missing })
        {
            Assert.Equal(404, error.StatusCode);
            Assert.Equal("WEEKLY_DROP_NOT_FOUND", ((ApiErrorDetails)error.Errors!).Code);
        }
        var stored = await env.Store.WeeklyDrops.Find(d => d.Id == waiting.Id).SingleAsync();
        Assert.Equal(WeeklyDropStates.Waiting, stored.State);
        Assert.Equal(waiting.UpdatedAt, stored.UpdatedAt);
        Assert.False(await env.Store.Items.Find(i => i.Source == MarketItemSources.Weekly).AnyAsync());
        Assert.Equal(othersSlots, (await env.Store.FindAccountAsync(other))!.Slots);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Claim_LeavesNoDropPending_AfterTheConflictOrTheChest()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        await env.FillBagAsync(user);
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 90, success: true, user);
        var drops = env.Drops(new CryptoChestRandom());
        Assert.Equal(WeeklyDropStatuses.Waiting, await drops.EvaluatePlayerAsync(result, user, CancellationToken.None));
        var dropId = WeeklyDrop.IdOf(ThisWeek.Key, user);

        // A claim goes through pending (so a crash mid-claim is the sweep's to finish), but never stays there.
        await Assert.ThrowsAsync<ApiException>(() => drops.ClaimAsync(Caller(user), dropId, CancellationToken.None));
        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(d => d.State == WeeklyDropStates.Pending));
        Assert.Equal(WeeklyDropStates.Waiting, (await env.Store.WeeklyDrops.Find(d => d.Id == dropId).SingleAsync()).State);
        // The result page asks about the game again: still waiting, still not pending.
        Assert.Equal(WeeklyDropStatuses.Waiting, (await drops.GetForRoomAsync(user, "room-1", CancellationToken.None)).Status);
        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(d => d.State == WeeklyDropStates.Pending));

        await env.FreeOneSlotAsync(user);
        Assert.Equal(WeeklyDropStates.Done, (await drops.ClaimAsync(Caller(user), dropId, CancellationToken.None)).State);
        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(d => d.State == WeeklyDropStates.Pending));
        Assert.Equal(WeeklyDropStates.Done, (await env.Store.WeeklyDrops.Find(d => d.Id == dropId).SingleAsync()).State);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Theory]
    [InlineData("claim")]
    [InlineData("result page")]
    public async Task RetryOfAWaitingChest_CutShortAfterTakingTheSlot_IsLeftPendingForTheSweep(string retriedBy)
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        await env.FillBagAsync(user);
        var result = await env.AddResultAsync("room-1", Challenge, Now.AddMinutes(-5), score: 90, success: true, user);
        var drops = env.Drops(new CryptoChestRandom());
        Assert.Equal(WeeklyDropStatuses.Waiting, await drops.EvaluatePlayerAsync(result, user, CancellationToken.None));
        var dropId = WeeklyDrop.IdOf(ThisWeek.Key, user);
        await env.FreeOneSlotAsync(user);

        // The chest cannot be made, so the retry stops after taking the slot, as if the server stopped right there.
        // The result page retries too: asking about the game evaluates it, and a waiting chest of that game is tried again.
        await env.RefuseWeeklyItemsAsync(true);
        await Assert.ThrowsAnyAsync<MongoException>(() => retriedBy == "claim"
            ? (Task)drops.ClaimAsync(Caller(user), dropId, CancellationToken.None)
            : drops.GetForRoomAsync(user, "room-1", CancellationToken.None));

        // Pending, not waiting: the sweep finishes it soon, while the wallet still knows that slot was taken.
        var stopped = await env.Store.WeeklyDrops.Find(d => d.Id == dropId).SingleAsync();
        Assert.Equal(WeeklyDropStates.Pending, stopped.State);
        Assert.False(await env.Store.Items.Find(i => i.Id == stopped.ItemId).AnyAsync());
        await env.RefuseWeeklyItemsAsync(false);
        Assert.Equal(1, await drops.RecoverAsync(TimeSpan.Zero, CancellationToken.None));

        Assert.Equal(WeeklyDropStates.Done, (await env.Store.WeeklyDrops.Find(d => d.Id == dropId).SingleAsync()).State);
        Assert.True(await env.Store.Items.Find(i => i.Id == stopped.ItemId && i.OwnerId == user).AnyAsync());
        Assert.Equal(MarketRules.InventorySlots, (await env.Store.FindAccountAsync(user))!.Slots);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task Claim_PendingDrop_IsFinishedWithoutASecondSlot()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var at = env.Clock.GetUtcNow().UtcDateTime;
        // A claim cut short: back to pending, the slot taken under the drop's operation key, the chest not made yet.
        var pending = new WeeklyDrop
        {
            Id = WeeklyDrop.IdOf(ThisWeek.Key, user), UserId = user, WeekKey = ThisWeek.Key, CaseId = Challenge, RoomId = "room-1",
            ChestDefId = "chest_sm", ItemId = MarketStore.NewId(), State = WeeklyDropStates.Pending, CreatedAt = at.AddHours(-1), UpdatedAt = at,
        };
        await env.Store.WeeklyDrops.InsertOneAsync(pending);
        var slotsBefore = (await env.Store.FindAccountAsync(user))!.Slots;
        Assert.Equal(WalletWrite.Applied, await env.Store.ApplyWalletAsync(user, $"weekly:{pending.Id}", 0, slotDelta: 1));

        var claimed = await env.Drops(new CryptoChestRandom()).ClaimAsync(Caller(user), pending.Id, CancellationToken.None);

        Assert.Equal(WeeklyDropStates.Done, claimed.State);
        Assert.Equal("chest_sm", (await env.Store.Items.Find(i => i.Id == pending.ItemId).SingleAsync()).DefId);
        Assert.Equal(slotsBefore + 1, (await env.Store.FindAccountAsync(user))!.Slots);
        await env.AssertSlotsMatchItemsAsync();
    }

    // ------------------------------------------------------------------ the reward API: reading

    [Fact]
    public async Task GetForRoom_ReportsEachStatus()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        var stranger = await env.AddUserAsync();
        await env.AddResultAsync("room-low", Challenge, Now.AddMinutes(-20), score: 79, success: true, user);
        await env.AddResultAsync("room-unsolved", Challenge, Now.AddMinutes(-15), score: 95, success: false, user);
        await env.AddResultAsync("room-won", Challenge, Now.AddMinutes(-10), score: 90, success: true, user);
        await env.AddResultAsync("room-late", Challenge, Now.AddMinutes(-5), score: 100, success: true, user);
        // Ticket 95 of 100: Két Nhà Băng.
        var drops = env.Drops(new ScriptedRandom(95));

        var low = await drops.GetForRoomAsync(user, "room-low", CancellationToken.None);
        Assert.Equal(WeeklyDropStatuses.LowScore, low.Status);
        Assert.Null(low.Drop);
        Assert.Equal(80, low.MinScore);
        var unsolved = await drops.GetForRoomAsync(user, "room-unsolved", CancellationToken.None);
        Assert.Equal(WeeklyDropStatuses.NotSolved, unsolved.Status);
        Assert.Null(unsolved.Drop);

        // The page can ask before the hook ran: the game is evaluated then, once.
        var granted = await drops.GetForRoomAsync(user, "room-won", CancellationToken.None);
        Assert.Equal(WeeklyDropStatuses.Granted, granted.Status);
        Assert.NotNull(granted.Drop);
        Assert.Equal(WeeklyDrop.IdOf(ThisWeek.Key, user), granted.Drop!.Id);
        Assert.Equal("chest_nb", granted.Drop.ChestId);
        Assert.Equal("Két Nhà Băng", granted.Drop.ChestName);
        Assert.Equal(WeeklyDropStates.Done, granted.Drop.State);
        Assert.Equal(80, granted.MinScore);
        Assert.Equal(WeeklyDropStatuses.Granted, (await drops.GetForRoomAsync(user, "room-won", CancellationToken.None)).Status);

        // A later good game of the week is too late, and points at the chest the week already gave.
        var late = await drops.GetForRoomAsync(user, "room-late", CancellationToken.None);
        Assert.Equal(WeeklyDropStatuses.AlreadyThisWeek, late.Status);
        Assert.Equal(granted.Drop.Id, late.Drop?.Id);

        // A game the player was not in, or no game at all, is not their challenge.
        var notTheirs = await drops.GetForRoomAsync(stranger, "room-won", CancellationToken.None);
        Assert.Equal(WeeklyDropStatuses.NotChallenge, notTheirs.Status);
        Assert.Null(notTheirs.Drop);
        Assert.Equal(WeeklyDropStatuses.NotChallenge, (await drops.GetForRoomAsync(user, "room-missing", CancellationToken.None)).Status);

        var drop = await env.Store.WeeklyDrops.Find(FilterDefinition<WeeklyDrop>.Empty).SingleAsync();
        Assert.Equal(user, drop.UserId);
        Assert.Equal("room-won", drop.RoomId);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Weekly));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task GetForRoom_OlderThanTheRecoveryWindow_NeverRollsAChest()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        var lastWeek = ThisWeek.Previous();
        await env.AddWeekAsync(lastWeek, "case-p");
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync(verified: false);
        // Two good games played before the e-mail was verified: one last week, one three hours ago.
        await env.AddResultAsync("room-p", "case-p", lastWeek.StartUtc.AddDays(2), score: 95, success: true, user);
        await env.AddResultAsync("room-q", Challenge, Now.AddHours(-3), score: 95, success: true, user);
        var drops = env.Drops(new CryptoChestRandom());
        Assert.Equal(WeeklyDropStatuses.Unverified, (await drops.GetForRoomAsync(user, "room-q", CancellationToken.None)).Status);

        // Verifying later does not drop the chests of those games when their result pages are opened again (spec 7.3):
        // only a new good game of the week does.
        await env.Db.Users.UpdateOneAsync(u => u.Id == user, Builders<User>.Update.Set(u => u.IsEmailVerified, true));
        foreach (var room in new[] { "room-p", "room-q" })
        {
            var status = await drops.GetForRoomAsync(user, room, CancellationToken.None);
            Assert.Equal(WeeklyDropStatuses.NoChest, status.Status);
            Assert.Null(status.Drop);
        }
        Assert.Equal(0, await env.Store.WeeklyDrops.CountDocumentsAsync(FilterDefinition<WeeklyDrop>.Empty));

        await env.AddResultAsync("room-r", Challenge, Now.AddMinutes(-5), score: 81, success: true, user);
        Assert.Equal(WeeklyDropStatuses.Granted, (await drops.GetForRoomAsync(user, "room-r", CancellationToken.None)).Status);
        // The older game of the same week is now simply too late.
        Assert.Equal(WeeklyDropStatuses.AlreadyThisWeek, (await drops.GetForRoomAsync(user, "room-q", CancellationToken.None)).Status);
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Source == MarketItemSources.Weekly));
    }

    [Fact]
    public async Task GetMine_ListsWaitingFromLastWeek()
    {
        if (!Enabled) return;
        await using var env = await DropEnv.CreateAsync();
        var lastWeek = ThisWeek.Previous();
        var twoWeeksAgo = ThisWeek.Previous(2);
        await env.AddWeekAsync(lastWeek, "case-p");
        await env.AddWeekAsync(ThisWeek, Challenge);
        var user = await env.AddUserAsync();
        await env.FillBagAsync(user);
        var drops = env.Drops(new CryptoChestRandom());
        var old = await env.AddResultAsync("room-p", "case-p", lastWeek.StartUtc.AddDays(3), score: 85, success: true, user);
        Assert.Equal(WeeklyDropStatuses.Waiting, await drops.EvaluatePlayerAsync(old, user, CancellationToken.None));
        var lastWeeksDrop = WeeklyDrop.IdOf(lastWeek.Key, user);

        var mine = await drops.GetMineAsync(user, CancellationToken.None);

        Assert.Equal(ThisWeek.Key, mine.WeekKey);
        Assert.Equal(80, mine.MinScore);
        Assert.Null(mine.ThisWeek);
        var listed = Assert.Single(mine.Waiting);
        Assert.Equal(lastWeeksDrop, listed.Id);
        Assert.Equal(lastWeek.Key, listed.WeekKey);
        Assert.Equal(WeeklyDropStates.Waiting, listed.State);

        // This week's game waits too (the bag is still full): it is this week's chest and the newest waiting one.
        var fresh = await env.AddResultAsync("room-q", Challenge, Now.AddMinutes(-5), score: 90, success: true, user);
        Assert.Equal(WeeklyDropStatuses.Waiting, await drops.EvaluatePlayerAsync(fresh, user, CancellationToken.None));
        // A chest of two weeks ago whose kind has left the catalog since is still listed, under its id.
        var gone = new WeeklyDrop
        {
            Id = WeeklyDrop.IdOf(twoWeeksAgo.Key, user), UserId = user, WeekKey = twoWeeksAgo.Key, CaseId = "case-o", RoomId = "room-o",
            ChestDefId = "chest_gone", ItemId = MarketStore.NewId(), State = WeeklyDropStates.Waiting,
            CreatedAt = twoWeeksAgo.StartUtc.AddDays(1), UpdatedAt = twoWeeksAgo.StartUtc.AddDays(1),
        };
        await env.Store.WeeklyDrops.InsertOneAsync(gone);
        var thisWeeksDrop = WeeklyDrop.IdOf(ThisWeek.Key, user);

        mine = await drops.GetMineAsync(user, CancellationToken.None);

        Assert.Equal(thisWeeksDrop, mine.ThisWeek?.Id);
        Assert.Equal(WeeklyDropStates.Waiting, mine.ThisWeek!.State);
        Assert.Equal(new[] { thisWeeksDrop, lastWeeksDrop, gone.Id }, mine.Waiting.Select(d => d.Id));
        var unknown = mine.Waiting[2];
        Assert.Equal("chest_gone", unknown.ChestId);
        Assert.Equal("chest_gone", unknown.ChestName);
        Assert.Equal("chest_gone", unknown.ChestNameEn);
        Assert.Null(unknown.Look);

        // Last week's chest, claimed once there is room, leaves the list; another player sees none of it.
        await env.FreeOneSlotAsync(user);
        Assert.Equal(WeeklyDropStates.Done, (await drops.ClaimAsync(Caller(user), lastWeeksDrop, CancellationToken.None)).State);
        mine = await drops.GetMineAsync(user, CancellationToken.None);
        Assert.Equal(new[] { thisWeeksDrop, gone.Id }, mine.Waiting.Select(d => d.Id));
        var someoneElse = await drops.GetMineAsync(await env.AddUserAsync(), CancellationToken.None);
        Assert.Null(someoneElse.ThisWeek);
        Assert.Empty(someoneElse.Waiting);
    }

    // ------------------------------------------------------------------ helpers

    private static CurrentUser Caller(string userId) => new(userId, "Thám tử", UserRole.Player);

    /// <summary>Hands out the scripted values in order (then 0).</summary>
    private sealed class ScriptedRandom(params int[] values) : IChestRandom
    {
        private readonly Queue<int> _values = new(values);
        public int NextInt(int exclusiveMax) => _values.Count > 0 ? _values.Dequeue() : 0;
    }

    /// <summary>Starts at a chosen moment and then runs with the real clock, so writes that touch a time still change it.</summary>
    private sealed class RunningClock(DateTime start) : TimeProvider
    {
        private readonly Stopwatch _elapsed = Stopwatch.StartNew();
        public override DateTimeOffset GetUtcNow() => new DateTimeOffset(start, TimeSpan.Zero) + _elapsed.Elapsed;
    }

    /// <summary>The seed catalog with every challenge weight at 0, as when an admin turns all drops off.</summary>
    private sealed class NothingDropsCatalog : ICatalogProvider
    {
        public NothingDropsCatalog()
        {
            var batch = CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow);
            foreach (var chest in batch.Chests) chest.ChallengeWeight = 0;
            Current = CatalogSnapshot.Build(batch.Items, batch.Chests, batch.LevelRewards, batch.Achievements, batch.Progress);
        }

        public CatalogSnapshot Current { get; }
        public void Invalidate() { }
        public Task RefreshAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<LogLevel> Levels { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            lock (Levels) Levels.Add(logLevel);
        }
    }

    private sealed class DropEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private DropEnv(MongoDbSettings settings, DateTime now)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Clock = new RunningClock(now);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db, Clock);
            Market = new MarketService(Store, NullLogger<MarketService>.Instance);
            Progress = new ProgressService(Store, Market, NullLogger<ProgressService>.Instance);
        }

        public TimeProvider Clock { get; }
        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public MarketService Market { get; }
        public ProgressService Progress { get; }

        public static async Task<DropEnv> CreateAsync(DateTime? now = null)
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_weeklydrop_{Guid.NewGuid():N}"
            };
            if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
                || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                    server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
                throw new InvalidOperationException("Weekly drop integration tests need a loopback MongoDB and a temporary database.");
            var env = new DropEnv(settings, now ?? Now);
            await env.Db.PingAsync();
            await env.Store.EnsureIndexesAsync();
            return env;
        }

        /// <summary>A drop service as the app builds it, with the real weekly service on the same clock.</summary>
        public WeeklyDropService Drops(IChestRandom random, ICatalogProvider? catalog = null, ILogger<WeeklyDropService>? logger = null)
        {
            var weekly = new WeeklyService(Db, new LeaderboardService(Db), CaseCatalogPolicy.Open,
                Options.Create(new WeeklyChallengeSettings()), FixedCatalogProvider.Default, new ScriptedRandom(), Clock,
                NullLogger<WeeklyService>.Instance);
            return new WeeklyDropService(Store, Market, weekly, random, Options.Create(new WeeklyChallengeSettings()),
                logger ?? NullLogger<WeeklyDropService>.Instance, catalog);
        }

        public async Task<string> AddUserAsync(bool verified = true)
        {
            var user = new User
            {
                Id = ObjectId.GenerateNewId().ToString(),
                FullName = "Thám tử",
                Email = $"{Guid.NewGuid():N}@tests.invalid",
                Status = UserStatus.Active,
                IsEmailVerified = verified
            };
            await Db.Users.InsertOneAsync(user);
            await Market.EnsureAccountAsync(user.Id);
            return user.Id;
        }

        public Task AddCaseAsync(string caseId, string author = "") =>
            Db.Cases.InsertOneAsync(new GameCase { CaseId = caseId, Title = $"Case {caseId}", Status = CaseStatus.Published, AuthorUserId = author });

        /// <summary>The week's challenge, as the picker or an admin stores it.</summary>
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

        /// <summary>A finished game as the result store saves it (without running the hook).</summary>
        public async Task<GameResult> AddResultAsync(
            string roomId, string caseId, DateTime createdAt, int score, bool success, params string[] players)
        {
            var result = new GameResult
            {
                Id = ObjectId.GenerateNewId().ToString(),
                RoomId = roomId,
                CaseId = caseId,
                Players = players.ToList(),
                ScoreSummary = new ScoreSummary { TotalScore = score },
                Success = success,
                CreatedAt = createdAt,
            };
            await Db.GameResults.InsertOneAsync(result);
            return result;
        }

        /// <summary>Grants chests until no slot is left.</summary>
        public async Task FillBagAsync(string userId)
        {
            while (MarketRules.HasRoom((await Store.FindAccountAsync(userId))!.Slots, 1))
                await Market.AdminGrantAsync(userId, "chest_np", 0);
        }

        /// <summary>Takes one item out of the bag and gives its slot back, as selling it would.</summary>
        public async Task FreeOneSlotAsync(string userId)
        {
            var item = await Store.Items.Find(i => i.OwnerId == userId && i.Source != MarketItemSources.Weekly).FirstAsync();
            await Store.Items.DeleteOneAsync(i => i.Id == item.Id);
            await Store.ApplyWalletAsync(userId, $"test-free:{item.Id}", 0, slotDelta: -1);
        }

        /// <summary>While on, the items collection refuses any new weekly chest (a server-side validator), so a grant stops after taking its slot.</summary>
        public Task RefuseWeeklyItemsAsync(bool refuse) =>
            Db.Database.RunCommandAsync<BsonDocument>(new BsonDocument
            {
                { "collMod", Store.Items.CollectionNamespace.CollectionName },
                { "validator", refuse ? new BsonDocument("source", new BsonDocument("$ne", MarketItemSources.Weekly)) : new BsonDocument() },
                { "validationAction", "error" },
            });

        public async Task AssertSlotsMatchItemsAsync()
        {
            var items = await Store.Items.Find(FilterDefinition<MarketItem>.Empty).ToListAsync();
            Assert.Equal(items.Count, items.Select(i => i.Id).Distinct().Count());
            foreach (var account in await Store.Accounts.Find(FilterDefinition<MarketAccount>.Empty).ToListAsync())
            {
                // Level and achievement items take no slot.
                Assert.Equal(items.Count(i => i.OwnerId == account.Id && !MarketItemSources.IsEarned(i.Source)), account.Slots);
                Assert.True(account.Slots <= MarketRules.InventorySlots, $"slot cap exceeded for {account.Id}");
                Assert.True(account.Balance >= 0, $"negative balance for {account.Id}");
            }
        }

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
