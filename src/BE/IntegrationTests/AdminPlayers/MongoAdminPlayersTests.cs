using System.Text.Json;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.IntegrationTests.AdminPlayers;

/// <summary>
/// The player admin against a real (standalone) MongoDB: coins, items, levels, avatars and sessions, each of them
/// journaled and audited. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoAdminPlayersTests
{
    private static readonly CurrentUser Admin = AdminPlayersEnv.Admin;
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private const string Rare = "VC-0391";

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static string Key() => AdminPlayersEnv.Key();

    private static string Code(ApiException error) => ((ApiErrorDetails)error.Errors!).Code;

    private static AdminCoinsRequest Coins(long amount, string? key = null, string reason = "Bù lỗi sự kiện") =>
        new() { Amount = amount, Reason = reason, IdempotencyKey = key ?? Key() };

    private static AdminGrantItemRequest GrantOf(string defId, string? key = null) =>
        new() { DefId = defId, Reason = "Quà sự kiện", IdempotencyKey = key ?? Key() };

    private static AdminRevokeItemRequest Revoke(string? key = null) =>
        new() { Reason = "Vật phẩm cấp nhầm", IdempotencyKey = key ?? Key() };

    private static AdminSetProgressRequest SetTo(int level, int xp = 0, string? key = null) =>
        new() { Level = level, Xp = xp, Reason = "Hỗ trợ người chơi", IdempotencyKey = key ?? Key() };

    private static async Task<MarketItem> GrantedItemAsync(AdminPlayersEnv env, CurrentUser user, string defId)
    {
        var result = await env.Operations.GrantItemAsync(Admin, user.Id, GrantOf(defId));
        return await env.Store.Items.Find(i => i.Id == result.ItemId).FirstAsync();
    }

    // ------------------------------------------------------------------ coins

    [Fact]
    public async Task AddingCoins_ChangesTheBalanceAndLeavesAnAudit()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var start = (await env.AccountAsync(user.Id)).Balance;

        var result = await env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(250));

        Assert.Equal(start + 250, result.Balance);
        Assert.Equal(start + 250, (await env.AccountAsync(user.Id)).Balance);
        var entry = Assert.Single(await env.AuditEntriesAsync("player.coins"));
        Assert.Equal(Admin.Id, entry.AdminId);
        Assert.Equal("user", entry.TargetType);
        Assert.Equal(user.Id, entry.TargetId);
        Assert.Equal("Bù lỗi sự kiện", entry.Reason);
        Assert.Contains($"{start}", entry.Before!);
        Assert.Contains($"{start + 250}", entry.After!);
    }

    [Fact]
    public async Task ResendingTheSameKey_DoesNotCreditTwice_NorAuditTwice()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var start = (await env.AccountAsync(user.Id)).Balance;
        var key = Key();

        var first = await env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(100, key));
        var again = await env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(100, key));

        Assert.Equal(first.OperationId, again.OperationId);
        Assert.Equal(start + 100, (await env.AccountAsync(user.Id)).Balance);
        Assert.Single(await env.AuditEntriesAsync("player.coins"));
    }

    [Fact]
    public async Task ParallelRequestsWithOneKey_CreditOnce()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var start = (await env.AccountAsync(user.Id)).Balance;
        var key = Key();

        await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
        {
            // A loser may be told the winner is still working; the money is what must add up.
            try { await env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(70, key)); }
            catch (ApiException error) when (Code(error) == AdminPlayerErrors.InProgress) { }
        }));

        Assert.Equal(start + 70, (await env.AccountAsync(user.Id)).Balance);
    }

    [Fact]
    public async Task TheSameKeyForADifferentAmount_IsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var key = Key();
        await env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(100, key));

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(200, key)));

        Assert.Equal(MarketErrors.InvalidRequestId, Code(error));
    }

    [Fact]
    public async Task RemovingMoreThanTheBalance_IsRefused_AndChangesNothing()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var start = (await env.AccountAsync(user.Id)).Balance;

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(-(start + 1))));

        Assert.Equal(409, error.StatusCode);
        Assert.Equal(AdminPlayerErrors.CoinsInsufficient, Code(error));
        Assert.Equal(start, (await env.AccountAsync(user.Id)).Balance);
        Assert.Empty(await env.AuditEntriesAsync("player.coins"));
    }

    [Fact]
    public async Task RemovingTheWholeBalance_LeavesExactlyZero()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var start = (await env.AccountAsync(user.Id)).Balance;

        var result = await env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(-start));

        Assert.Equal(0, result.Balance);
    }

    [Fact]
    public async Task CoinsHeldByABuyOrder_CannotBeRemoved()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var start = (await env.AccountAsync(user.Id)).Balance;
        await env.Market.PlaceOrderAsync(user, Rare, 200);

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(-(start - 100))));

        Assert.Equal(AdminPlayerErrors.CoinsInsufficient, Code(error));
        var account = await env.AccountAsync(user.Id);
        Assert.Equal(start - 200, account.Balance);
        Assert.Equal(200, account.Held);
    }

    [Theory]
    [InlineData("")]
    [InlineData("ab")]
    public async Task AnOperationWithoutAReason_IsRefused(string reason)
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(5, reason: reason)));

        Assert.Equal(AdminPlayerErrors.ReasonRequired, Code(error));
    }

    [Fact]
    public async Task AnUnknownPlayer_IsNotFound_AndGetsNoAccount()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var ghost = MongoDB.Bson.ObjectId.GenerateNewId().ToString();

        var missing = await Assert.ThrowsAsync<ApiException>(() => env.Operations.AdjustCoinsAsync(Admin, ghost, Coins(5)));
        var malformed = await Assert.ThrowsAsync<ApiException>(() => env.Operations.AdjustCoinsAsync(Admin, "not-an-id", Coins(5)));

        Assert.Equal(404, missing.StatusCode);
        Assert.Equal(404, malformed.StatusCode);
        Assert.Equal(0, await env.Store.Accounts.CountDocumentsAsync(a => a.Id == ghost));
    }

    [Fact]
    public async Task ALockedPlayer_CanStillBeFined()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync(status: UserStatus.Locked);

        var result = await env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(-100));

        Assert.Equal(MarketRules.StarterCoins - 100, result.Balance);
    }

    [Fact]
    public async Task AnInterruptedAdjustment_IsFinishedByRecovery_Once()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var start = (await env.AccountAsync(user.Id)).Balance;
        var old = DateTime.UtcNow.AddMinutes(-10);
        // The process died right after the journal was written, before the wallet moved.
        await env.AdminStore.Ops.InsertOneAsync(new AdminPlayerOp
        {
            Id = $"{Admin.Id}:{Key()}",
            Kind = AdminPlayerOpKinds.Coins,
            TargetUserId = user.Id,
            AdminId = Admin.Id,
            AdminName = Admin.FullName,
            Reason = "Bù lỗi",
            Amount = 40,
            CreatedAt = old,
            UpdatedAt = old,
        });

        Assert.Equal(1, await env.Operations.RecoverAsync(TimeSpan.FromSeconds(30)));
        Assert.Equal(0, await env.Operations.RecoverAsync(TimeSpan.FromSeconds(30)));

        Assert.Equal(start + 40, (await env.AccountAsync(user.Id)).Balance);
        Assert.Single(await env.AuditEntriesAsync("player.coins"));
    }

    [Fact]
    public async Task AnAdjustmentInterruptedAfterTheWallet_DoesNotPayAgain_AndStillGetsItsAudit()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var start = (await env.AccountAsync(user.Id)).Balance;
        var old = DateTime.UtcNow.AddMinutes(-10);
        var id = $"{Admin.Id}:{Key()}";
        await env.Store.ApplyWalletAsync(user.Id, AdminPlayerOperations.OpKey(id), 40);
        await env.AdminStore.Ops.InsertOneAsync(new AdminPlayerOp
        {
            Id = id,
            Kind = AdminPlayerOpKinds.Coins,
            TargetUserId = user.Id,
            AdminId = Admin.Id,
            AdminName = Admin.FullName,
            Reason = "Bù lỗi",
            Amount = 40,
            CreatedAt = old,
            UpdatedAt = old,
        });

        await env.Operations.RecoverAsync(TimeSpan.FromSeconds(30));

        Assert.Equal(start + 40, (await env.AccountAsync(user.Id)).Balance);
        Assert.Single(await env.AuditEntriesAsync("player.coins"));
    }

    // ------------------------------------------------------------------ granting

    [Fact]
    public async Task GrantingAnItem_AddsItOnce_EvenWhenResent()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var key = Key();

        var first = await env.Operations.GrantItemAsync(Admin, user.Id, GrantOf(Rare, key));
        var again = await env.Operations.GrantItemAsync(Admin, user.Id, GrantOf(Rare, key));

        Assert.Equal(first.ItemId, again.ItemId);
        var granted = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.DefId == Rare).ToListAsync();
        var item = Assert.Single(granted);
        Assert.Equal(MarketItemSources.Grant, item.Source);
        Assert.Single(await env.AuditEntriesAsync("player.grant"));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task GrantingAnUnknownDef_IsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.GrantItemAsync(Admin, user.Id, GrantOf("no-such-def")));

        Assert.Equal(AdminPlayerErrors.UnknownDef, Code(error));
    }

    [Fact]
    public async Task GrantingIntoAFullBag_IsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        await env.Store.Accounts.UpdateOneAsync(a => a.Id == user.Id, Builders<MarketAccount>.Update.Set(a => a.Slots, MarketRules.InventorySlots));

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.GrantItemAsync(Admin, user.Id, GrantOf(Rare)));

        Assert.Equal(AdminPlayerErrors.InventoryFull, Code(error));
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.OwnerId == user.Id && i.DefId == Rare));
    }

    [Fact]
    public async Task AGrantInterruptedAfterTheSlot_CreatesItsItemOnce()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var old = DateTime.UtcNow.AddMinutes(-10);
        var itemId = MarketStore.NewId();
        await env.Store.ApplyWalletAsync(user.Id, MarketService.AdminGrantOpKey(itemId), 0, slotDelta: 1);
        await env.AdminStore.Ops.InsertOneAsync(new AdminPlayerOp
        {
            Id = $"{Admin.Id}:{Key()}",
            Kind = AdminPlayerOpKinds.GrantItem,
            TargetUserId = user.Id,
            AdminId = Admin.Id,
            AdminName = Admin.FullName,
            Reason = "Quà",
            DefId = Rare,
            ItemId = itemId,
            CreatedAt = old,
            UpdatedAt = old,
        });

        await env.Operations.RecoverAsync(TimeSpan.FromSeconds(30));

        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Id == itemId));
        await env.AssertSlotsMatchItemsAsync();
    }

    // ------------------------------------------------------------------ revoking

    [Fact]
    public async Task RevokingAFreeItem_RemovesItAndFreesItsSlot()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await GrantedItemAsync(env, user, Rare);
        var slots = (await env.AccountAsync(user.Id)).Slots;

        await env.Operations.RevokeItemAsync(Admin, user.Id, item.Id, Revoke());

        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == item.Id));
        Assert.Equal(slots - 1, (await env.AccountAsync(user.Id)).Slots);
        var entry = Assert.Single(await env.AuditEntriesAsync("player.revoke"));
        Assert.Contains(item.Id, entry.Before!);
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task RevokingAListedItem_CancelsTheListingFirst()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await GrantedItemAsync(env, user, Rare);
        var listing = (await env.Market.CreateListingAsync(user, item.Id, 500)).Listing;

        var result = await env.Operations.RevokeItemAsync(Admin, user.Id, item.Id, Revoke());

        Assert.Equal(listing.ListingId, result.CancelledListingId);
        var saved = await env.Store.Listings.Find(l => l.Id == listing.ListingId).FirstAsync();
        Assert.Equal(MarketListingStatus.Cancelled, saved.Status);
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == item.Id));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task RevokingAnItemInAPendingOffer_IsRefused_AndKeepsTheItem()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var owner = await env.AddUserAsync("Chủ");
        var other = await env.AddUserAsync("Bạn");
        var item = await GrantedItemAsync(env, owner, Rare);
        await env.Market.CreateTradeAsync(owner, new CreateTradeRequestFixture(other.Id, item.Id).Build());

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.RevokeItemAsync(Admin, owner.Id, item.Id, Revoke()));

        Assert.Equal(409, error.StatusCode);
        Assert.Equal(AdminPlayerErrors.ItemInTrade, Code(error));
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Id == item.Id));
        Assert.Empty(await env.AuditEntriesAsync("player.revoke"));
    }

    [Fact]
    public async Task RevokingAnItemRequestedByAnOffer_IsRefused_Too()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var owner = await env.AddUserAsync("Chủ");
        var other = await env.AddUserAsync("Bạn");
        var item = await GrantedItemAsync(env, owner, Rare);
        await env.Market.CreateTradeAsync(other, new CreateTradeRequestFixture(owner.Id, requested: item.Id).Build());

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.RevokeItemAsync(Admin, owner.Id, item.Id, Revoke()));

        Assert.Equal(AdminPlayerErrors.ItemInTrade, Code(error));
    }

    [Fact]
    public async Task RevokingAnItemLockedByARunningTrade_IsRefused_AndKeepsTheLock()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var owner = await env.AddUserAsync();
        var item = await GrantedItemAsync(env, owner, Rare);
        var lockKey = MarketService.TxLock(MarketStore.NewId());
        await env.Store.LockItemAsync(item.Id, owner.Id, lockKey);

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.RevokeItemAsync(Admin, owner.Id, item.Id, Revoke()));

        Assert.Equal(AdminPlayerErrors.ItemInTrade, Code(error));
        Assert.Equal(lockKey, (await env.Store.Items.Find(i => i.Id == item.Id).FirstAsync()).LockedBy);
    }

    [Fact]
    public async Task AnItemBeingSpentByAChest_CannotBeRevoked()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var owner = await env.AddUserAsync();
        var item = await GrantedItemAsync(env, owner, Rare);
        await env.Store.LockItemAsync(item.Id, owner.Id, MarketService.ChestLockPrefix + "x");

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.RevokeItemAsync(Admin, owner.Id, item.Id, Revoke()));

        Assert.Equal(AdminPlayerErrors.ItemBusy, Code(error));
    }

    [Fact]
    public async Task RevokingAnEquippedItem_TakesItOffFirst()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await GrantedItemAsync(env, user, "frame_dong");
        await env.Market.EquipAsync(user.Id, item.Id);
        Assert.True((await env.AccountAsync(user.Id)).Equipped.ContainsValue(item.Id));

        await env.Operations.RevokeItemAsync(Admin, user.Id, item.Id, Revoke());

        Assert.False((await env.AccountAsync(user.Id)).Equipped.ContainsValue(item.Id));
        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == item.Id));
    }

    [Fact]
    public async Task AnEarnedReward_CannotBeRevoked_BecauseItWouldComeBack()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        await env.Operations.SetProgressAsync(Admin, user.Id, SetTo(10));
        var earned = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.Source == MarketItemSources.Level).FirstAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.RevokeItemAsync(Admin, user.Id, earned.Id, Revoke()));

        Assert.Equal(AdminPlayerErrors.ItemEarned, Code(error));
        Assert.Equal(1, await env.Store.Items.CountDocumentsAsync(i => i.Id == earned.Id));
    }

    [Fact]
    public async Task RevokingSomeoneElsesItem_IsNotFound()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var owner = await env.AddUserAsync();
        var other = await env.AddUserAsync();
        var item = await GrantedItemAsync(env, owner, Rare);

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.RevokeItemAsync(Admin, other.Id, item.Id, Revoke()));

        Assert.Equal(404, error.StatusCode);
        Assert.Equal(AdminPlayerErrors.ItemNotFound, Code(error));
    }

    [Fact]
    public async Task ResendingARevoke_ReturnsTheSameResult()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await GrantedItemAsync(env, user, Rare);
        var key = Key();

        var first = await env.Operations.RevokeItemAsync(Admin, user.Id, item.Id, Revoke(key));
        var again = await env.Operations.RevokeItemAsync(Admin, user.Id, item.Id, Revoke(key));

        Assert.Equal(first.OperationId, again.OperationId);
        Assert.Single(await env.AuditEntriesAsync("player.revoke"));
        await env.AssertSlotsMatchItemsAsync();
    }

    [Fact]
    public async Task ARevokeInterruptedAfterCommit_RollsForwardOnce()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var item = await GrantedItemAsync(env, user, Rare);
        var old = DateTime.UtcNow.AddMinutes(-10);
        var id = $"{Admin.Id}:{Key()}";
        await env.Store.LockItemAsync(item.Id, user.Id, AdminPlayerOperations.ItemLock(id));
        await env.AdminStore.Ops.InsertOneAsync(new AdminPlayerOp
        {
            Id = id,
            Kind = AdminPlayerOpKinds.RevokeItem,
            TargetUserId = user.Id,
            AdminId = Admin.Id,
            AdminName = Admin.FullName,
            Reason = "Cấp nhầm",
            DefId = Rare,
            ItemId = item.Id,
            Committed = true,
            CreatedAt = old,
            UpdatedAt = old,
        });

        await env.Operations.RecoverAsync(TimeSpan.FromSeconds(30));

        Assert.Equal(0, await env.Store.Items.CountDocumentsAsync(i => i.Id == item.Id));
        await env.AssertSlotsMatchItemsAsync();
    }

    // ------------------------------------------------------------------ level and experience

    [Fact]
    public async Task RaisingALevel_GrantsWhatIsMissing_ExactlyOnce()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var expected = CosmeticCatalog.LevelRewards.Where(r => r.Level <= 20).Select(r => r.DefId).ToHashSet();
        Assert.NotEmpty(expected);
        var key = Key();

        var result = await env.Operations.SetProgressAsync(Admin, user.Id, SetTo(20, 5, key));
        var resent = await env.Operations.SetProgressAsync(Admin, user.Id, SetTo(20, 5, key));
        await env.Operations.SetProgressAsync(Admin, user.Id, SetTo(20, 7));
        // Opening the profile grants what the level is owed: nothing is left to give.
        await env.Progress.GetMeAsync(user.Id);

        Assert.Equal(20, result.Level);
        Assert.Equal(5, result.Xp);
        Assert.Equal(expected, result.GrantedRewardDefIds.ToHashSet());
        Assert.Equal(expected, resent.GrantedRewardDefIds.ToHashSet());
        var owned = await env.Store.Items.Find(i => i.OwnerId == user.Id && i.Source == MarketItemSources.Level).ToListAsync();
        Assert.Equal(expected.Count, owned.Count);
        Assert.Equal(expected, owned.Select(i => i.DefId).ToHashSet());
        Assert.Equal(2, (await env.AuditEntriesAsync("player.progress")).Count);
    }

    [Fact]
    public async Task LoweringALevel_TakesNothingBack_AndSaysWhatStays()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        await env.Operations.SetProgressAsync(Admin, user.Id, SetTo(30));
        var before = await env.Store.Items.CountDocumentsAsync(i => i.OwnerId == user.Id && i.Source == MarketItemSources.Level);
        var above = CosmeticCatalog.LevelRewards.Where(r => r.Level > 1).Where(r => r.Level <= 30).Select(r => r.DefId).ToHashSet();

        var result = await env.Operations.SetProgressAsync(Admin, user.Id, SetTo(1));

        Assert.Equal(1, result.Level);
        Assert.Equal(before, await env.Store.Items.CountDocumentsAsync(i => i.OwnerId == user.Id && i.Source == MarketItemSources.Level));
        Assert.Equal(above, result.KeptRewardDefIds.ToHashSet());
        Assert.Empty(result.GrantedRewardDefIds);
    }

    [Fact]
    public async Task ProgressOffTheCurve_IsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.SetProgressAsync(Admin, user.Id, SetTo(51)));

        Assert.Equal(AdminPlayerErrors.ProgressInvalid, Code(error));
        Assert.Empty(await env.AuditEntriesAsync("player.progress"));
    }

    // ------------------------------------------------------------------ avatar

    private static async Task SeedAvatarAsync(AdminPlayersEnv env, CurrentUser user, string url = "https://res.cloudinary.com/x/image/upload/v1/sirlocked/avatars/u.webp")
    {
        await env.Progress.GetMeAsync(user.Id);
        await env.Store.PlayerProgress.UpdateOneAsync(p => p.Id == user.Id,
            Builders<PlayerProgress>.Update
                .Set(p => p.Avatar, AvatarImageProcessor.UploadedAvatar)
                .Set(p => p.AvatarUrl, url)
                .Set(p => p.AvatarUploadedAt, DateTime.UtcNow));
    }

    [Fact]
    public async Task RemovingAnAvatar_GoesBackToTheDefault_DeletesTheFile_AndIsAudited()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        await SeedAvatarAsync(env, user);

        var result = await env.Operations.RemoveAvatarAsync(Admin, user.Id, "Ảnh phản cảm");

        Assert.True(result.FileRemoved);
        Assert.Equal(new[] { user.Id }, env.Remover.Removed);
        var look = await env.Progress.GetPublicAsync(user.Id);
        Assert.Equal(CosmeticCatalog.DefaultAvatar, look.Avatar);
        Assert.Null(look.AvatarUrl);
        var entry = Assert.Single(await env.AuditEntriesAsync("player.avatar.remove"));
        Assert.Contains("cloudinary", entry.Before!);
        Assert.Equal("Ảnh phản cảm", entry.Reason);
    }

    [Fact]
    public async Task AFileTheHostWouldNotDelete_StillClearsTheAvatar_AndSaysSo()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        await SeedAvatarAsync(env, user);
        env.Remover.Succeeds = false;

        var result = await env.Operations.RemoveAvatarAsync(Admin, user.Id, "Ảnh phản cảm");

        Assert.False(result.FileRemoved);
        Assert.Null((await env.Progress.GetPublicAsync(user.Id)).AvatarUrl);
    }

    [Fact]
    public async Task RemovingAnAvatarThatIsNotThere_IsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.RemoveAvatarAsync(Admin, user.Id, "Ảnh phản cảm"));

        Assert.Equal(AdminPlayerErrors.NoAvatar, Code(error));
        Assert.Empty(env.Remover.Removed);
    }

    [Fact]
    public async Task ThePictureGrid_ListsNewestFirst_AndForgetsWhatWasApproved()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var first = await env.AddUserAsync("Một");
        var second = await env.AddUserAsync("Hai");
        await env.AddUserAsync("Không ảnh");
        await SeedAvatarAsync(env, first, "https://img.test/1.webp");
        await Task.Delay(5);
        await SeedAvatarAsync(env, second, "https://img.test/2.webp");

        var page = await env.Moderation.ListAsync(pendingOnly: true, 1, 10);
        Assert.Equal(2, page.Total);
        Assert.Equal(new[] { second.Id, first.Id }, page.Items.Select(i => i.UserId));
        Assert.Equal("Hai", page.Items[0].FullName);
        Assert.Equal(2, await env.Moderation.PendingCountAsync());

        await env.Moderation.ApproveAsync(Admin, second.Id);

        Assert.Equal(1, await env.Moderation.PendingCountAsync());
        Assert.Equal(new[] { first.Id }, (await env.Moderation.ListAsync(pendingOnly: true, 1, 10)).Items.Select(i => i.UserId));
        Assert.Equal(2, (await env.Moderation.ListAsync(pendingOnly: false, 1, 10)).Total);
        Assert.Single(await env.AuditEntriesAsync("player.avatar.approve"));

        // A new picture has a new address and needs looking at again.
        await SeedAvatarAsync(env, second, "https://img.test/2b.webp");
        Assert.Equal(2, await env.Moderation.PendingCountAsync());
    }

    [Fact]
    public async Task ThePictureGrid_PagesFromTheServer()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        for (var i = 0; i < 3; i++) await SeedAvatarAsync(env, await env.AddUserAsync($"U{i}"), $"https://img.test/{i}.webp");

        var page = await env.Moderation.ListAsync(pendingOnly: false, 2, 2);

        Assert.Equal(3, page.Total);
        Assert.Single(page.Items);
    }

    // ------------------------------------------------------------------ sessions

    [Fact]
    public async Task ForcingALogout_RevokesTheAccessAndRefreshTokens()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var before = await env.Db.Users.Find(u => u.Id == user.Id).FirstAsync();

        await env.Operations.ForceLogoutAsync(Admin, user.Id, "Tài khoản bị lộ");

        var after = await env.Db.Users.Find(u => u.Id == user.Id).FirstAsync();
        Assert.Equal(before.AuthorizationVersion + 1, after.AuthorizationVersion);
        Assert.Null(after.RefreshToken);
        Assert.Null(after.RefreshTokenHash);
        Assert.Null(after.RefreshTokenExpiry);
        var entry = Assert.Single(await env.AuditEntriesAsync("player.logout"));
        Assert.DoesNotContain("SECRET", entry.Before + entry.After);
    }

    [Fact]
    public async Task AnAdminCannotForceTheirOwnLogout()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var admin = await env.AddUserAsync("Yến", role: UserRole.Admin);

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Operations.ForceLogoutAsync(admin, admin.Id, "Thử nghiệm"));

        Assert.Equal(AdminPlayerErrors.SelfAction, Code(error));
    }

    // ------------------------------------------------------------------ the list

    [Fact]
    public async Task TheListPagesOnTheServer_AndReportsTheTotal()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var now = DateTime.UtcNow;
        for (var i = 0; i < 5; i++) await env.AddUserAsync($"Người {i}", createdAt: now.AddMinutes(-i));

        var first = await env.Players.ListAsync(new AdminPlayerQuery(Page: 1, PageSize: 2));
        var last = await env.Players.ListAsync(new AdminPlayerQuery(Page: 3, PageSize: 2));

        Assert.Equal(5, first.Total);
        Assert.Equal(new[] { "Người 0", "Người 1" }, first.Items.Select(p => p.FullName));
        Assert.Equal(new[] { "Người 4" }, last.Items.Select(p => p.FullName));
    }

    [Fact]
    public async Task TheListSearchesNameAndEmail_WithoutRunningAPattern()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        await env.AddUserAsync("Nguyễn Văn An", email: "an@tests.invalid");
        await env.AddUserAsync("Trần Bình", email: "binh.tran@tests.invalid");
        await env.AddUserAsync("a.b", email: "dot@tests.invalid");

        Assert.Equal(new[] { "Trần Bình" }, (await env.Players.ListAsync(new AdminPlayerQuery(Search: "BINH.TRAN"))).Items.Select(p => p.FullName));
        Assert.Equal(new[] { "Nguyễn Văn An" }, (await env.Players.ListAsync(new AdminPlayerQuery(Search: "văn an"))).Items.Select(p => p.FullName));
        // "." is a dot, not "any character".
        Assert.Equal(new[] { "a.b" }, (await env.Players.ListAsync(new AdminPlayerQuery(Search: "a.b"))).Items.Select(p => p.FullName));
        Assert.Empty((await env.Players.ListAsync(new AdminPlayerQuery(Search: ".*"))).Items);
    }

    [Fact]
    public async Task TheListFiltersRoleAndStatus()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        await env.AddUserAsync("Thường");
        await env.AddUserAsync("VIP", role: UserRole.Vip);
        await env.AddUserAsync("Bị khóa", status: UserStatus.Locked);
        await env.AddUserAsync("Chưa xác minh", verified: false);

        Assert.Equal(new[] { "VIP" }, (await env.Players.ListAsync(new AdminPlayerQuery(Role: UserRole.Vip))).Items.Select(p => p.FullName));
        Assert.Equal(new[] { "Bị khóa" }, (await env.Players.ListAsync(new AdminPlayerQuery(Status: AdminPlayerStatusFilter.Locked))).Items.Select(p => p.FullName));
        Assert.Equal(new[] { "Chưa xác minh" }, (await env.Players.ListAsync(new AdminPlayerQuery(Status: AdminPlayerStatusFilter.Unverified))).Items.Select(p => p.FullName));
        Assert.Equal(3, (await env.Players.ListAsync(new AdminPlayerQuery(Status: AdminPlayerStatusFilter.Active))).Total);
    }

    [Fact]
    public async Task TheListSortsByCoinsAndLevel_AcrossPages()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var poor = await env.AddUserAsync("Nghèo");
        var rich = await env.AddUserAsync("Giàu");
        var noAccount = await env.AddUserAsync("Chưa có ví", withAccount: false);
        await env.Operations.AdjustCoinsAsync(Admin, rich.Id, Coins(9000));
        await env.Operations.AdjustCoinsAsync(Admin, poor.Id, Coins(-400));
        await env.Operations.SetProgressAsync(Admin, poor.Id, SetTo(12));

        var byCoins = await env.Players.ListAsync(new AdminPlayerQuery(Sort: AdminPlayerSorts.Coins, Page: 1, PageSize: 2));
        Assert.Equal(new[] { "Giàu", "Nghèo" }, byCoins.Items.Select(p => p.FullName));
        Assert.Equal(MarketRules.StarterCoins + 9000, byCoins.Items[0].Balance);
        var nextPage = await env.Players.ListAsync(new AdminPlayerQuery(Sort: AdminPlayerSorts.Coins, Page: 2, PageSize: 2));
        Assert.Equal(new[] { "Chưa có ví" }, nextPage.Items.Select(p => p.FullName));
        Assert.Equal(0, nextPage.Items[0].Balance);

        var byLevel = await env.Players.ListAsync(new AdminPlayerQuery(Sort: AdminPlayerSorts.Level, PageSize: 1));
        Assert.Equal("Nghèo", byLevel.Items.Single().FullName);
        Assert.Equal(12, byLevel.Items.Single().Level);
        // Reading must not hand out the one-time starter grant.
        Assert.Equal(0, await env.Store.Accounts.CountDocumentsAsync(a => a.Id == noAccount.Id));
    }

    [Fact]
    public async Task TheListRefusesABadSort_AndAnEndlessSearch()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();

        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => env.Players.ListAsync(new AdminPlayerQuery(Sort: "password")))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => env.Players.ListAsync(new AdminPlayerQuery(Search: new string('a', 200))))).StatusCode);
    }

    // ------------------------------------------------------------------ the detail

    [Fact]
    public async Task TheDetail_ShowsTheWholePlayer_AndNoSecret()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync("Thám tử An", email: "an.detail@tests.invalid");
        var frame = await GrantedItemAsync(env, user, "frame_dong");
        await env.Market.EquipAsync(user.Id, frame.Id);
        var listed = await GrantedItemAsync(env, user, Rare);
        var listing = (await env.Market.CreateListingAsync(user, listed.Id, 700)).Listing;
        await env.Operations.SetProgressAsync(Admin, user.Id, SetTo(10, 3));
        await env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(25));

        var detail = await env.Players.GetDetailAsync(user.Id);

        Assert.Equal("an.detail@tests.invalid", detail.Account.Email);
        Assert.True(detail.Account.HasPassword);
        Assert.Equal(10, detail.Progress.Level);
        Assert.Equal(3, detail.Progress.Xp);
        Assert.Equal(ProgressRules.XpToNext(10), detail.Progress.XpToNext);
        Assert.Equal(MarketRules.StarterCoins + 25, detail.Wallet.Balance);
        Assert.Equal("frame_dong", detail.Look.FrameDefId);
        var worn = detail.Inventory.Single(i => i.ItemId == frame.Id);
        Assert.True(worn.Equipped);
        var forSale = detail.Inventory.Single(i => i.ItemId == listed.Id);
        Assert.Equal("LISTED", forSale.LockReason);
        Assert.Equal(listing.ListingId, forSale.ListingId);
        Assert.Equal(700, forSale.ListingPrice);
        Assert.Contains(detail.Inventory, i => i.Source == MarketItemSources.Level);

        var json = JsonSerializer.Serialize(detail, Web);
        Assert.DoesNotContain("SECRET", json);
        Assert.DoesNotContain("passwordHash", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("refreshToken", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TheDetail_OfSomeoneWhoNeverPlayed_CreatesNothing()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync(withAccount: false);

        var detail = await env.Players.GetDetailAsync(user.Id);

        Assert.False(detail.Wallet.HasAccount);
        Assert.Equal(0, detail.Wallet.Balance);
        Assert.Equal(1, detail.Progress.Level);
        Assert.Equal(0, await env.Store.Accounts.CountDocumentsAsync(a => a.Id == user.Id));
        Assert.Equal(0, await env.Store.PlayerProgress.CountDocumentsAsync(p => p.Id == user.Id));
    }

    [Fact]
    public async Task HistoriesArePagedAndBelongToThePlayer()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync("An");
        var other = await env.AddUserAsync("Bình");
        for (var i = 0; i < 3; i++)
        {
            await env.Db.GameResults.InsertOneAsync(new GameResult
            {
                Id = MongoDB.Bson.ObjectId.GenerateNewId().ToString(),
                RoomId = MongoDB.Bson.ObjectId.GenerateNewId().ToString(),
                CaseId = "case-a",
                Players = new List<string> { user.Id, other.Id },
                Success = i == 0,
                CreatedAt = DateTime.UtcNow.AddMinutes(-i),
                CaseDefinitionSnapshot = new GameResultCaseSnapshot { Title = "Vụ án A" },
                ScoreSummary = new ScoreSummary { TotalScore = 80, Rank = "A" },
            });
        }
        await env.Chests.AdminGrantAsync(user.Id, "chest_np", 1, 1);
        await env.Chests.OpenAsync(user, "chest_np", Key());
        var item = await GrantedItemAsync(env, user, Rare);
        await env.Market.CreateListingAsync(user, item.Id, 100);
        await env.Market.BuyListingAsync(other, (await env.Store.Listings.Find(l => l.SellerId == user.Id).FirstAsync()).Id);
        var offered = await GrantedItemAsync(env, other, Rare);
        await env.Market.CreateTradeAsync(other, new CreateTradeRequestFixture(user.Id, offered.Id).Build());

        var games = await env.Players.GamesAsync(user.Id, 2, 2);
        Assert.Equal(3, games.Total);
        Assert.Equal("Vụ án A", games.Items.Single().CaseTitle);
        Assert.Equal(80, games.Items.Single().Score);
        var openings = await env.Players.ChestOpeningsAsync(user.Id, 1, 10);
        Assert.Equal("chest_np", openings.Items.Single().ChestDefId);
        Assert.False(string.IsNullOrEmpty(openings.Items.Single().Reward.Name));
        var sales = await env.Players.SalesAsync(user.Id, 1, 10);
        Assert.Equal("SOLD", sales.Items.Single().Side);
        Assert.Equal("Bình", sales.Items.Single().OtherName);
        var trades = await env.Players.TradesAsync(user.Id, 1, 10);
        Assert.Equal("Bình", trades.Items.Single().FromName);
        Assert.Empty((await env.Players.GamesAsync((await env.AddUserAsync()).Id, 1, 10)).Items);
    }

    [Fact]
    public async Task ThePlayersAuditLog_FindsEverythingDoneToThem()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var user = await env.AddUserAsync();
        var other = await env.AddUserAsync();
        await env.Operations.AdjustCoinsAsync(Admin, user.Id, Coins(10));
        await env.Operations.AdjustCoinsAsync(Admin, other.Id, Coins(10));
        var item = await GrantedItemAsync(env, user, Rare);
        var listing = (await env.Market.CreateListingAsync(user, item.Id, 100)).Listing;
        await env.Economy.RemoveListingAsync(Admin, listing.ListingId, "Giá bất thường");

        var log = await env.Players.AuditAsync(user.Id, 1, 50);

        Assert.Equal(new[] { "listing.remove", "player.grant", "player.coins" }, log.Items.Select(entry => entry.Action));
        Assert.Equal(3, log.Total);
    }
}

internal sealed class CreateTradeRequestFixture(string toUserId, string? offered = null, string? requested = null)
{
    public CreateTradeRequest Build() => new()
    {
        ToUserId = toUserId,
        OfferItemIds = offered is null ? new List<string>() : new List<string> { offered },
        RequestItemIds = requested is null ? new List<string>() : new List<string> { requested },
    };
}
