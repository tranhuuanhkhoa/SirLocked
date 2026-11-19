using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>
/// What an admin can do to a player: coins, items, level, avatar, session. Coins, items and levels run through one journal
/// (<see cref="AdminPlayerOp"/>): written first, every step idempotent through an operation key, audited once at the end.
/// Coins and slots only ever change through <see cref="MarketStore.ApplyWalletAsync"/>, whose guards keep a balance from going negative.
/// </summary>
public sealed class AdminPlayerOperations
{
    private static readonly TimeSpan AuditClaimExpiry = TimeSpan.FromMinutes(1);

    private readonly AdminPlayersStore _store;
    private readonly MarketStore _marketStore;
    private readonly MarketService _market;
    private readonly ProgressService _progress;
    private readonly IAdminAudit _audit;
    private readonly IAvatarFileRemover _avatarFiles;
    private readonly ILogger<AdminPlayerOperations> _logger;
    private readonly ICatalogProvider _catalog;

    public AdminPlayerOperations(
        AdminPlayersStore store, MarketStore marketStore, MarketService market, ProgressService progress, IAdminAudit audit,
        IAvatarFileRemover avatarFiles, ILogger<AdminPlayerOperations> logger, ICatalogProvider catalog)
    {
        _store = store;
        _marketStore = marketStore;
        _market = market;
        _progress = progress;
        _audit = audit;
        _avatarFiles = avatarFiles;
        _logger = logger;
        _catalog = catalog;
    }

    private DateTime Now => _marketStore.Now;

    public static string OpKey(string operationId) => $"admin:{operationId}";
    public static string ItemLock(string operationId) => MarketService.AdminLockPrefix + operationId;

    private static ApiException ErrorFor(string? code) => code switch
    {
        AdminPlayerErrors.CoinsInsufficient => AdminPlayersRules.Error(409, code, "Người chơi không đủ xu (xu đang giữ cho lệnh mua không trừ được). Số dư không đổi."),
        AdminPlayerErrors.InventoryFull => AdminPlayersRules.Error(409, code, "Kho của người chơi đã đầy."),
        AdminPlayerErrors.ItemNotFound => AdminPlayersRules.Error(404, code, "Người chơi này không có vật phẩm đó."),
        AdminPlayerErrors.ItemInTrade => AdminPlayersRules.Error(409, code, "Vật phẩm đang nằm trong một đề nghị trao đổi. Hãy để đề nghị đó kết thúc rồi thu hồi."),
        AdminPlayerErrors.ItemBusy => AdminPlayersRules.Error(409, code, "Vật phẩm đang được xử lý (có người đang mua, mở hòm hoặc đổi KN). Thử lại sau ít phút."),
        AdminPlayerErrors.ItemEarned => AdminPlayersRules.Error(409, code, "Đây là phần thưởng theo cấp hoặc thành tích. Thu hồi xong hệ thống sẽ tự cấp lại, nên không thu hồi được."),
        AdminPlayerErrors.InProgress => AdminPlayersRules.Error(409, code, "Thao tác này đang được xử lý. Thử lại sau ít giây."),
        _ => AdminPlayersRules.Error(409, code ?? MarketErrors.Busy, "Dữ liệu vừa thay đổi. Hãy tải lại rồi thử lại."),
    };

    private async Task<User> RequireUserAsync(string userId, CancellationToken ct)
    {
        var user = ObjectId.TryParse(userId, out _)
            ? await _marketStore.Context.Users.Find(u => u.Id == userId).FirstOrDefaultAsync(ct)
            : null;
        if (user is null || user.Status == UserStatus.Deleted)
            throw AdminPlayersRules.Error(404, AdminPlayerErrors.PlayerNotFound, "Không tìm thấy người chơi này.");
        return user;
    }

    // ------------------------------------------------------------------ the operations

    public async Task<AdminOperationResultDto> AdjustCoinsAsync(CurrentUser admin, string userId, AdminCoinsRequest request, CancellationToken ct = default)
    {
        AdminPlayersRules.ValidateCoinAmount(request.Amount);
        return await RunAsync(admin, userId, AdminPlayerOpKinds.Coins, request.IdempotencyKey, request.Reason,
            async op =>
            {
                op.Amount = request.Amount;
                var account = await _market.EnsureAccountAsync(userId, ct);
                op.Before = WalletSnapshot(account);
            },
            op => op.Amount == request.Amount, ct);
    }

    public async Task<AdminOperationResultDto> GrantItemAsync(CurrentUser admin, string userId, AdminGrantItemRequest request, CancellationToken ct = default)
    {
        var def = _catalog.Current.Find(request.DefId)
            ?? throw AdminPlayersRules.Error(400, AdminPlayerErrors.UnknownDef, "Không có loại vật phẩm này.");
        return await RunAsync(admin, userId, AdminPlayerOpKinds.GrantItem, request.IdempotencyKey, request.Reason,
            async op =>
            {
                op.DefId = def.Id;
                op.ItemId = MarketStore.NewId();
                var account = await _market.EnsureAccountAsync(userId, ct);
                op.Before = new BsonDocument { { "slots", account.Slots } };
            },
            op => op.DefId == def.Id, ct);
    }

    public async Task<AdminOperationResultDto> RevokeItemAsync(CurrentUser admin, string userId, string itemId, AdminRevokeItemRequest request, CancellationToken ct = default)
    {
        return await RunAsync(admin, userId, AdminPlayerOpKinds.RevokeItem, request.IdempotencyKey, request.Reason,
            async op =>
            {
                op.ItemId = itemId;
                var item = await _marketStore.Items.Find(i => i.Id == itemId && i.OwnerId == userId).FirstOrDefaultAsync(ct);
                if (item is null) return;
                op.DefId = item.DefId;
                op.Before = new BsonDocument
                {
                    { "itemId", item.Id }, { "defId", item.DefId }, { "ownerId", item.OwnerId }, { "source", item.Source },
                    { "lockedBy", item.LockedBy is null ? BsonNull.Value : item.LockedBy },
                };
            },
            op => op.ItemId == itemId, ct);
    }

    public async Task<AdminOperationResultDto> SetProgressAsync(CurrentUser admin, string userId, AdminSetProgressRequest request, CancellationToken ct = default)
    {
        AdminPlayersRules.ValidateProgress(request.Level, request.Xp);
        return await RunAsync(admin, userId, AdminPlayerOpKinds.SetProgress, request.IdempotencyKey, request.Reason,
            async op =>
            {
                op.Level = request.Level;
                op.Xp = request.Xp;
                var progress = await _marketStore.PlayerProgress.Find(p => p.Id == userId).FirstOrDefaultAsync(ct);
                op.Before = new BsonDocument { { "level", progress?.Level ?? 1 }, { "xp", progress?.Xp ?? 0 } };
            },
            op => op.Level == request.Level && op.Xp == request.Xp, ct);
    }

    private async Task<AdminOperationResultDto> RunAsync(
        CurrentUser admin, string userId, string kind, string? idempotencyKey, string? reason,
        Func<AdminPlayerOp, Task> describe, Func<AdminPlayerOp, bool> sameRequest, CancellationToken ct)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        var id = AdminPlayersRules.OperationId(admin.Id, idempotencyKey);
        await RequireUserAsync(userId, ct);

        var op = await _store.Ops.Find(o => o.Id == id).FirstOrDefaultAsync(ct);
        if (op is null)
        {
            var now = Now;
            var fresh = new AdminPlayerOp
            {
                Id = id,
                Kind = kind,
                TargetUserId = userId,
                AdminId = admin.Id,
                AdminName = admin.FullName,
                Reason = note,
                CreatedAt = now,
                UpdatedAt = now,
            };
            await describe(fresh);
            try
            {
                await _store.Ops.InsertOneAsync(fresh, cancellationToken: ct);
                op = fresh;
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                op = await _store.Ops.Find(o => o.Id == id).FirstAsync(ct);
            }
        }
        if (op.Kind != kind || op.TargetUserId != userId || !sameRequest(op))
            throw MarketService.Error(400, MarketErrors.InvalidRequestId, "This idempotencyKey was already used for another operation.");

        // The journal exists now: a disconnecting client must not abandon it halfway.
        op = await AdvanceAsync(op, CancellationToken.None);
        return op.State switch
        {
            ChestOpeningStates.Done => await ResultAsync(op, ct),
            ChestOpeningStates.Failed => throw ErrorFor(op.Error),
            _ => throw ErrorFor(AdminPlayerErrors.InProgress),
        };
    }

    private static BsonDocument WalletSnapshot(MarketAccount? account) => new()
    {
        { "balance", account?.Balance ?? 0 },
        { "held", account?.Held ?? 0 },
        { "slots", account?.Slots ?? 0 },
    };

    // ------------------------------------------------------------------ the journal

    /// <summary>Runs (or resumes) an operation. Safe to run concurrently with itself.</summary>
    internal async Task<AdminPlayerOp> AdvanceAsync(AdminPlayerOp op, CancellationToken ct)
    {
        if (op.State == ChestOpeningStates.Pending)
        {
            op = op.Kind switch
            {
                AdminPlayerOpKinds.Coins => await AdvanceCoinsAsync(op, ct),
                AdminPlayerOpKinds.GrantItem => await AdvanceGrantAsync(op, ct),
                AdminPlayerOpKinds.RevokeItem => await AdvanceRevokeAsync(op, ct),
                AdminPlayerOpKinds.SetProgress => await AdvanceProgressAsync(op, ct),
                _ => await FailAsync(op, MarketErrors.Busy, ct),
            };
        }
        if (op.State == ChestOpeningStates.Done && !op.Audited) await WriteAuditAsync(op, ct);
        return op;
    }

    private async Task<AdminPlayerOp> AdvanceCoinsAsync(AdminPlayerOp op, CancellationToken ct)
    {
        await _market.EnsureAccountAsync(op.TargetUserId, ct);
        var write = await _marketStore.ApplyWalletAsync(op.TargetUserId, OpKey(op.Id), op.Amount, ct: ct);
        if (write == WalletWrite.Rejected) return await FailAsync(op, AdminPlayerErrors.CoinsInsufficient, ct);
        return await FinishAsync(op, WalletSnapshot(await _marketStore.FindAccountAsync(op.TargetUserId, ct)), ct);
    }

    private async Task<AdminPlayerOp> AdvanceGrantAsync(AdminPlayerOp op, CancellationToken ct)
    {
        await _market.EnsureAccountAsync(op.TargetUserId, ct);
        if (!await _market.AdminGrantItemAsync(op.TargetUserId, op.DefId!, op.ItemId!, ct))
            return await FailAsync(op, AdminPlayerErrors.InventoryFull, ct);
        var account = await _marketStore.FindAccountAsync(op.TargetUserId, ct);
        return await FinishAsync(op, new BsonDocument { { "itemId", op.ItemId }, { "defId", op.DefId }, { "slots", account?.Slots ?? 0 } }, ct);
    }

    private async Task<AdminPlayerOp> AdvanceProgressAsync(AdminPlayerOp op, CancellationToken ct)
    {
        var (level, xp, kept) = await _progress.AdminSetProgressAsync(op.TargetUserId, op.Level!.Value, op.Xp!.Value, OpKey(op.Id), op.Id, ct);
        op.KeptRewardDefIds = kept.ToList();
        return await FinishAsync(op, new BsonDocument { { "level", level }, { "xp", xp } }, ct);
    }

    /// <summary>
    /// Before the commit a revoke can still stop, and leaves the item as it found it apart from a cancelled listing. An offer
    /// locks nothing while it waits, so it is looked for here. After the commit it only rolls forward.
    /// </summary>
    private async Task<AdminPlayerOp> AdvanceRevokeAsync(AdminPlayerOp op, CancellationToken ct)
    {
        var owner = op.TargetUserId;
        var itemId = op.ItemId!;
        var lockKey = ItemLock(op.Id);

        if (!op.Committed)
        {
            var item = await _marketStore.Items.Find(i => i.Id == itemId && i.OwnerId == owner).FirstOrDefaultAsync(ct);
            if (item is null) return await FailAsync(op, AdminPlayerErrors.ItemNotFound, ct);
            // A level or achievement grants itself again the next time the profile opens.
            if (MarketItemSources.IsEarned(item.Source)) return await FailAsync(op, AdminPlayerErrors.ItemEarned, ct);
            if (item.LockedBy?.StartsWith(MarketService.TxLockPrefix, StringComparison.Ordinal) == true
                || await IsInOpenOfferAsync(itemId, ct))
                return await FailAsync(op, AdminPlayerErrors.ItemInTrade, ct);

            if (item.LockedBy?.StartsWith(MarketService.ListingLockPrefix, StringComparison.Ordinal) == true)
            {
                var problem = await WithdrawListingAsync(op, owner, itemId, item.LockedBy[MarketService.ListingLockPrefix.Length..], ct);
                if (problem is not null) return await FailAsync(op, problem, ct);
            }
            else if (item.LockedBy is not null && item.LockedBy != lockKey)
            {
                return await FailAsync(op, AdminPlayerErrors.ItemBusy, ct);
            }

            if (!await _marketStore.LockItemAsync(itemId, owner, lockKey, ct))
                return await FailAsync(op, AdminPlayerErrors.ItemBusy, ct);
            // An offer made between the first look and the lock would otherwise be left naming a missing item.
            if (await IsInOpenOfferAsync(itemId, ct))
            {
                await _marketStore.UnlockItemAsync(itemId, lockKey, ct);
                return await FailAsync(op, AdminPlayerErrors.ItemInTrade, ct);
            }

            var committed = await _store.Ops.UpdateOneAsync(
                o => o.Id == op.Id && o.State == ChestOpeningStates.Pending && !o.Committed,
                Builders<AdminPlayerOp>.Update
                    .Set(o => o.Committed, true)
                    .Set(o => o.CancelledListingId, op.CancelledListingId)
                    .Set(o => o.UpdatedAt, Now),
                cancellationToken: ct);
            if (committed.ModifiedCount == 0)
            {
                // A parallel run got past this point first, or ended the operation.
                var current = await _store.Ops.Find(o => o.Id == op.Id).FirstAsync(ct);
                if (current.State != ChestOpeningStates.Pending) return current;
                op = current;
            }
            op.Committed = true;
        }

        var account = await _marketStore.FindAccountAsync(owner, ct);
        foreach (var slot in account?.Equipped.Where(pair => pair.Value == itemId).ToList() ?? new List<KeyValuePair<string, string>>())
            await _marketStore.UnequipItemAsync(owner, slot.Key, itemId, ct);
        await _marketStore.Items.DeleteOneAsync(i => i.Id == itemId && i.OwnerId == owner && i.LockedBy == lockKey, ct);
        await _marketStore.ApplyWalletAsync(owner, OpKey(op.Id), 0, slotDelta: -1, ct: ct);

        return await FinishAsync(op, new BsonDocument
        {
            { "itemId", itemId },
            { "defId", op.DefId is null ? BsonNull.Value : op.DefId },
            { "removed", true },
            { "cancelledListingId", op.CancelledListingId is null ? BsonNull.Value : op.CancelledListingId },
        }, ct);
    }

    private Task<bool> IsInOpenOfferAsync(string itemId, CancellationToken ct) =>
        _marketStore.Trades.Find(
            Builders<TradeOffer>.Filter.In(t => t.Status, new[] { TradeOfferStatus.Pending, TradeOfferStatus.Accepting })
            & (Builders<TradeOffer>.Filter.ElemMatch(t => t.FromItems, reference => reference.ItemId == itemId)
               | Builders<TradeOffer>.Filter.ElemMatch(t => t.ToItems, reference => reference.ItemId == itemId)))
            .AnyAsync(ct);

    /// <summary>Takes the item off the market through the market's own cancel. Returns an error code when it cannot.</summary>
    private async Task<string?> WithdrawListingAsync(AdminPlayerOp op, string owner, string itemId, string listingId, CancellationToken ct)
    {
        try
        {
            await _market.CancelListingAsync(owner, listingId, ct);
            op.CancelledListingId = listingId;
            return null;
        }
        catch (ApiException exception) when (exception.Errors is ApiErrorDetails { Code: MarketErrors.Busy })
        {
            return AdminPlayerErrors.ItemBusy;
        }
        catch (ApiException exception) when (exception.Errors is ApiErrorDetails { Code: MarketErrors.ListingUnavailable or MarketErrors.ListingNotFound })
        {
            var listing = await _marketStore.Listings.Find(l => l.Id == listingId).FirstOrDefaultAsync(ct);
            // Still being created: its seller's request is running right now.
            if (listing?.Status == MarketListingStatus.Opening) return AdminPlayerErrors.ItemBusy;
            // Closed, and the sweep has not freed the item yet.
            await _marketStore.UnlockItemAsync(itemId, MarketService.ListingLock(listingId), ct);
            return null;
        }
    }

    private async Task<AdminPlayerOp> FinishAsync(AdminPlayerOp op, BsonDocument after, CancellationToken ct)
    {
        await _store.Ops.UpdateOneAsync(o => o.Id == op.Id && o.State == ChestOpeningStates.Pending,
            Builders<AdminPlayerOp>.Update
                .Set(o => o.State, ChestOpeningStates.Done)
                .Set(o => o.After, after)
                .Set(o => o.KeptRewardDefIds, op.KeptRewardDefIds)
                .Set(o => o.CancelledListingId, op.CancelledListingId)
                .Set(o => o.UpdatedAt, Now),
            cancellationToken: ct);
        op.State = ChestOpeningStates.Done;
        op.After = after;
        return op;
    }

    private async Task<AdminPlayerOp> FailAsync(AdminPlayerOp op, string code, CancellationToken ct)
    {
        var failed = await _store.Ops.UpdateOneAsync(o => o.Id == op.Id && o.State == ChestOpeningStates.Pending,
            Builders<AdminPlayerOp>.Update
                .Set(o => o.State, ChestOpeningStates.Failed)
                .Set(o => o.Error, code)
                .Set(o => o.UpdatedAt, Now),
            cancellationToken: ct);
        if (failed.ModifiedCount == 0) return await _store.Ops.Find(o => o.Id == op.Id).FirstAsync(ct);
        op.State = ChestOpeningStates.Failed;
        op.Error = code;
        return op;
    }

    private static string AuditAction(string kind) => kind switch
    {
        AdminPlayerOpKinds.Coins => "player.coins",
        AdminPlayerOpKinds.GrantItem => "player.grant",
        AdminPlayerOpKinds.RevokeItem => "player.revoke",
        _ => "player.progress",
    };

    /// <summary>Exactly one runner writes the entry. If it dies first, its claim expires and the sweep writes it instead.</summary>
    private async Task WriteAuditAsync(AdminPlayerOp op, CancellationToken ct)
    {
        var now = Now;
        var staleClaim = now - AuditClaimExpiry;
        var claimed = await _store.Ops.UpdateOneAsync(
            Builders<AdminPlayerOp>.Filter.Eq(o => o.Id, op.Id)
            & Builders<AdminPlayerOp>.Filter.Eq(o => o.Audited, false)
            & (Builders<AdminPlayerOp>.Filter.Eq(o => o.AuditClaimedAt, null) | Builders<AdminPlayerOp>.Filter.Lt(o => o.AuditClaimedAt, staleClaim)),
            Builders<AdminPlayerOp>.Update.Set(o => o.AuditClaimedAt, now),
            cancellationToken: ct);
        if (claimed.ModifiedCount == 0) return;
        try
        {
            await _audit.LogAsync(new CurrentUser(op.AdminId, op.AdminName, UserRole.Admin), AuditAction(op.Kind), "user", op.TargetUserId,
                op.Before, op.After, op.Reason, ct);
        }
        catch
        {
            // Unclaim so a resend or the sweep tries again; the caller learns the action went unrecorded.
            await _store.Ops.UpdateOneAsync(o => o.Id == op.Id, Builders<AdminPlayerOp>.Update.Set(o => o.AuditClaimedAt, null), cancellationToken: CancellationToken.None);
            throw;
        }
        await _store.Ops.UpdateOneAsync(o => o.Id == op.Id, Builders<AdminPlayerOp>.Update.Set(o => o.Audited, true), cancellationToken: ct);
        op.Audited = true;
    }

    private async Task<AdminOperationResultDto> ResultAsync(AdminPlayerOp op, CancellationToken ct)
    {
        var account = await _marketStore.FindAccountAsync(op.TargetUserId, ct);
        var progress = await _marketStore.PlayerProgress.Find(p => p.Id == op.TargetUserId).FirstOrDefaultAsync(ct);
        var granted = op.Kind == AdminPlayerOpKinds.SetProgress
            ? await _marketStore.Items
                .Find(i => i.OwnerId == op.TargetUserId && i.LastTxId == op.Id && i.Source == MarketItemSources.Level)
                .Project(i => i.DefId)
                .ToListAsync(ct)
            : new List<string>();
        return new AdminOperationResultDto(
            op.Id, op.Kind, op.TargetUserId,
            account?.Balance ?? 0, account?.Held ?? 0, account?.Slots ?? 0,
            progress?.Level ?? 1, progress?.Xp ?? 0,
            op.ItemId, op.DefId, op.CancelledListingId,
            granted, op.KeptRewardDefIds);
    }

    // ------------------------------------------------------------------ one-step operations

    /// <summary>Clears the picture first: a file the host will not delete must not leave an offensive avatar on show.</summary>
    public async Task<AdminAvatarRemovalDto> RemoveAvatarAsync(CurrentUser admin, string userId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        await RequireUserAsync(userId, ct);
        var cleared = await _progress.AdminClearAvatarAsync(userId, ct)
            ?? throw AdminPlayersRules.Error(409, AdminPlayerErrors.NoAvatar, "Người chơi này không có ảnh tải lên.");
        var fileRemoved = await _avatarFiles.TryRemoveAsync(userId, CancellationToken.None);
        await _store.AvatarReviews.DeleteOneAsync(r => r.Id == userId, CancellationToken.None);
        await _audit.LogAsync(admin, "player.avatar.remove", "user", userId,
            new { avatar = cleared.PreviousAvatar, avatarUrl = cleared.PreviousUrl },
            new { avatar = cleared.Avatar, avatarUrl = (string?)null, fileRemoved },
            note, CancellationToken.None);
        return new AdminAvatarRemovalDto(userId, cleared.Avatar, fileRemoved);
    }

    /// <summary>
    /// The version in every issued JWT stops matching, and the refresh token is cleared so the session cannot quietly renew itself.
    /// </summary>
    public async Task ForceLogoutAsync(CurrentUser admin, string userId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        if (userId == admin.Id)
            throw AdminPlayersRules.Error(400, AdminPlayerErrors.SelfAction, "Không thể tự ép đăng xuất chính mình. Hãy đăng xuất như bình thường.");
        var user = await RequireUserAsync(userId, ct);
        await _marketStore.Context.Users.UpdateOneAsync(u => u.Id == userId,
            Builders<User>.Update
                .Set(u => u.RefreshToken, null)
                .Set(u => u.RefreshTokenHash, null)
                .Set(u => u.RefreshTokenExpiry, null)
                .Inc(u => u.AuthorizationVersion, 1)
                .Set(u => u.UpdatedAt, Now),
            cancellationToken: ct);
        await _audit.LogAsync(admin, "player.logout", "user", userId,
            new { authorizationVersion = user.AuthorizationVersion },
            new { authorizationVersion = user.AuthorizationVersion + 1 },
            note, CancellationToken.None);
    }

    // ------------------------------------------------------------------ recovery

    /// <summary>Finishes journals older than <paramref name="staleAfter"/>: operations a crash interrupted, and audits it left unwritten.</summary>
    public async Task<int> RecoverAsync(TimeSpan staleAfter, CancellationToken ct = default)
    {
        var cutoff = Now - staleAfter;
        var stale = await _store.Ops
            .Find(o => (o.State == ChestOpeningStates.Pending || (o.State == ChestOpeningStates.Done && !o.Audited)) && o.UpdatedAt < cutoff)
            .SortBy(o => o.UpdatedAt).Limit(50).ToListAsync(ct);
        var done = 0;
        foreach (var op in stale)
        {
            // Lease: only one sweeper resumes an operation.
            var leased = await _store.Ops.UpdateOneAsync(o => o.Id == op.Id && o.UpdatedAt == op.UpdatedAt,
                Builders<AdminPlayerOp>.Update.Set(o => o.UpdatedAt, Now), cancellationToken: ct);
            if (leased.ModifiedCount == 0) continue;
            try
            {
                await AdvanceAsync(op, ct);
                done++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogError(exception, "Admin player operation {OperationId} could not be resumed.", op.Id);
            }
        }
        return done;
    }
}
