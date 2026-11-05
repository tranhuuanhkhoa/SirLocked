using System.Security.Cryptography;
using System.Text;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.Services.Market;

/// <summary>Reads what a lobby shows of its players. Implementations must answer for every id asked about.</summary>
public interface IPlayerCosmeticsReader
{
    Task<IReadOnlyDictionary<string, PlayerCosmeticsDto>> GetCosmeticsAsync(IReadOnlyCollection<string> userIds, CancellationToken ct = default);
}

/// <summary>What an admin's removal of an uploaded picture changed.</summary>
public sealed record AdminClearedAvatar(string PreviousAvatar, string PreviousUrl, string Avatar);

/// <summary>
/// Hồ sơ thám tử: level, experience, avatar, earned cosmetics. Like the market it runs on a standalone MongoDB,
/// so exchanging items is a journaled sequence of conditional writes on one <see cref="XpExchange"/>: lock the
/// items, commit, burn them, free their slots, pay the XP, grant what the new level unlocks. Every step is
/// idempotent, so a retry or the recovery sweep can resume it at any point.
/// </summary>
public sealed class ProgressService : IPlayerCosmeticsReader
{
    private const int OpsWindow = 64;
    private const int XpWriteAttempts = 20;

    private readonly MarketStore _store;
    private readonly MarketService _market;
    private readonly ILogger<ProgressService> _logger;
    private readonly IAvatarStorage? _avatars;
    private readonly ICatalogProvider _catalog;
    private readonly ICosmeticDefaults? _defaults;

    public ProgressService(
        MarketStore store, MarketService market, ILogger<ProgressService> logger, IAvatarStorage? avatars = null, ICatalogProvider? catalog = null,
        ICosmeticDefaults? defaults = null)
    {
        _store = store;
        _market = market;
        _logger = logger;
        _avatars = avatars;
        _catalog = catalog ?? FixedCatalogProvider.Default;
        _defaults = defaults;
    }

    private Task<CosmeticDefaults> DefaultsAsync(CancellationToken ct) =>
        _defaults?.GetAsync(ct) ?? Task.FromResult(CosmeticDefaults.InCode);

    private DateTime Now => _store.Now;

    internal static string ExchangeLock(string exchangeId) => MarketService.XpLockPrefix + exchangeId;
    private static string ExchangeOpKey(string exchangeId) => $"xp:{exchangeId}";

    /// <summary>Deterministic ids make granting idempotent: a second grant of the same reward is a duplicate key.</summary>
    public static string EarnedItemId(string userId, string defId)
    {
        var hash = MD5.HashData(Encoding.UTF8.GetBytes($"earned:{userId}:{defId}"));
        return Convert.ToHexString(hash, 0, 12).ToLowerInvariant();
    }

    private static ApiException ErrorFor(string? code) => code switch
    {
        ProgressErrors.MaxLevel => MarketService.Error(409, code, "You are already at the highest level."),
        ProgressErrors.ItemNotFound => MarketService.Error(404, code, "This item is not in your inventory."),
        ProgressErrors.ItemLocked => MarketService.Error(409, code, "Items for sale or in a trade cannot be exchanged."),
        ProgressErrors.ItemEquipped => MarketService.Error(409, code, "Take the item off before exchanging it."),
        ProgressErrors.ItemNotExchangeable => MarketService.Error(409, code, "Only rare and epic items can be exchanged."),
        ChestErrors.InProgress => MarketService.Error(409, code, "This request is still being processed."),
        _ => MarketService.Error(409, code ?? MarketErrors.Busy, "The market changed; please try again."),
    };

    // ------------------------------------------------------------------ progress

    private async Task<PlayerProgress> EnsureProgressAsync(string userId, CancellationToken ct)
    {
        var progress = await _store.PlayerProgress.Find(p => p.Id == userId).FirstOrDefaultAsync(ct);
        if (progress is not null) return progress;
        var now = Now;
        var fresh = new PlayerProgress { Id = userId, Avatar = CosmeticCatalog.DefaultAvatar, CreatedAt = now, UpdatedAt = now };
        try
        {
            await _store.PlayerProgress.InsertOneAsync(fresh, cancellationToken: ct);
            return fresh;
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            return await _store.PlayerProgress.Find(p => p.Id == userId).FirstAsync(ct);
        }
    }

    public async Task<ProgressDto> GetMeAsync(string userId, CancellationToken ct = default)
    {
        await _market.EnsureAccountAsync(userId, ct);
        var progress = await EnsureProgressAsync(userId, ct);
        await GrantLevelRewardsAsync(userId, progress.Level, null, ct);
        var achievements = await SyncAchievementsAsync(userId, ct);
        return await BuildAsync(progress, achievements, ct);
    }

    private async Task<ProgressDto> BuildAsync(PlayerProgress progress, IReadOnlyList<AchievementProgress> achievements, CancellationToken ct)
    {
        var userId = progress.Id;
        var account = await _market.EnsureAccountAsync(userId, ct);
        var items = await _store.Items.Find(i => i.OwnerId == userId).SortByDescending(i => i.AcquiredAt).ThenBy(i => i.Id).ToListAsync(ct);
        var equippedIds = account.Equipped.Values.ToHashSet(StringComparer.Ordinal);

        var catalog = _catalog.Current;
        var exchangeable = new List<ExchangeableItemDto>();
        var owned = new List<OwnedCosmeticDto>();
        foreach (var item in items)
        {
            if (catalog.Find(item.DefId) is not { } def) continue;
            var equipped = item.LockedBy is null && equippedIds.Contains(item.Id);
            if (item.LockedBy is null && !equipped && ProgressRules.IsExchangeable(def))
                exchangeable.Add(new ExchangeableItemDto(item.Id, MarketService.ToDefDto(def), catalog.XpValue(def)));
            if (CosmeticCatalog.IsCosmetic(def.Category))
                owned.Add(new OwnedCosmeticDto(item.Id, def.Id, def.Category, item.Source, item.LockedBy is not null, equipped));
        }

        var worn = Wear(account, items, await DefaultsAsync(ct));
        var isMax = progress.Level >= ProgressRules.MaxLevel;
        return new ProgressDto(
            progress.Level, progress.Xp, isMax ? 0 : ProgressRules.XpToNext(progress.Level), ProgressRules.MaxLevel, isMax,
            progress.Avatar, progress.AvatarUrl, _avatars?.IsAvailable == true,
            worn.Frame, worn.Title, worn.Entrance,
            exchangeable.OrderByDescending(x => x.Xp).ThenBy(x => x.Def.Name, StringComparer.Ordinal).ToList(),
            owned,
            achievements.Select(a => new AchievementProgressDto(a.Def.TitleDefId, a.Def.Countable, a.Count, a.Def.Target, a.Earned)).ToList());
    }

    // ------------------------------------------------------------------ what a detective wears

    /// <summary>An equipped entry only counts while it still points at a free item of the right category, owned by this account.</summary>
    private (string? Frame, string Title, string Entrance) Wear(MarketAccount? account, IReadOnlyCollection<MarketItem> items, CosmeticDefaults defaults)
    {
        string? Slot(string category)
        {
            if (account is null || !account.Equipped.TryGetValue(category, out var itemId)) return null;
            var item = items.FirstOrDefault(i => i.Id == itemId && i.OwnerId == account.Id && i.LockedBy is null);
            return item is not null && _catalog.Current.Find(item.DefId)?.Category == category ? item.DefId : null;
        }
        return (
            Slot(MarketCategories.Frame) ?? defaults.Frame,
            Slot(MarketCategories.Title) ?? defaults.Title,
            Slot(MarketCategories.Entrance) ?? defaults.Entrance);
    }

    public async Task<IReadOnlyDictionary<string, PlayerCosmeticsDto>> GetCosmeticsAsync(IReadOnlyCollection<string> userIds, CancellationToken ct = default)
    {
        var ids = userIds.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToList();
        var progress = (await _store.PlayerProgress.Find(p => ids.Contains(p.Id)).ToListAsync(ct)).ToDictionary(p => p.Id);
        var accounts = (await _store.Accounts.Find(a => ids.Contains(a.Id)).ToListAsync(ct)).ToDictionary(a => a.Id);
        var equippedIds = accounts.Values.SelectMany(a => a.Equipped.Values).Distinct(StringComparer.Ordinal).ToList();
        var items = equippedIds.Count == 0
            ? new List<MarketItem>()
            : await _store.Items.Find(i => equippedIds.Contains(i.Id)).ToListAsync(ct);
        var defaults = await DefaultsAsync(ct);

        var result = new Dictionary<string, PlayerCosmeticsDto>(StringComparer.Ordinal);
        foreach (var id in ids)
        {
            var worn = Wear(accounts.GetValueOrDefault(id), items, defaults);
            var mine = progress.GetValueOrDefault(id);
            result[id] = new PlayerCosmeticsDto(
                mine?.Level ?? 1, mine?.Avatar ?? CosmeticCatalog.DefaultAvatar, mine?.AvatarUrl,
                worn.Frame, worn.Title, worn.Entrance);
        }
        return result;
    }

    /// <summary>Another detective's public look, for visiting their profile.</summary>
    public async Task<PlayerCosmeticsDto> GetPublicAsync(string userId, CancellationToken ct = default) =>
        (await GetCosmeticsAsync(new[] { userId }, ct))[userId];

    // ------------------------------------------------------------------ exchange

    public async Task<ExchangeResultDto> ExchangeAsync(CurrentUser user, IReadOnlyCollection<string>? itemIds, string? idempotencyKey, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(idempotencyKey) || !MarketService.RequestIdPattern.IsMatch(idempotencyKey))
            throw MarketService.Error(400, MarketErrors.InvalidRequestId, "idempotencyKey must be 8-64 letters, digits, '-' or '_'.");
        var ids = (itemIds ?? Array.Empty<string>()).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).OrderBy(id => id, StringComparer.Ordinal).ToList();
        if (ids.Count == 0 || ids.Count > ProgressRequestLimits.MaxItems)
            throw MarketService.Error(400, ProgressErrors.NoItems, "Choose the items to exchange.");
        await _market.RequireVerifiedAsync(user.Id, ct);
        await _market.EnsureAccountAsync(user.Id, ct);

        var id = $"{user.Id}:{idempotencyKey}";
        var exchange = await _store.XpExchanges.Find(e => e.Id == id).FirstOrDefaultAsync(ct);
        if (exchange is null)
        {
            long xp;
            try
            {
                // Checked up front so a refused click leaves no document behind. The locks below decide races.
                xp = await PriceAsync(user.Id, ids, ct);
            }
            catch (ApiException)
            {
                // A parallel retry of this very request may have locked or burned the items by now: its journal holds the answer.
                exchange = await _store.XpExchanges.Find(e => e.Id == id).FirstOrDefaultAsync(ct);
                if (exchange is null) throw;
                xp = exchange.Xp;
            }
            if (exchange is null)
            {
                var now = Now;
                var fresh = new XpExchange { Id = id, UserId = user.Id, ItemIds = ids, Xp = xp, CreatedAt = now, UpdatedAt = now };
                try
                {
                    await _store.XpExchanges.InsertOneAsync(fresh, cancellationToken: ct);
                    // The exchange now exists: a disconnecting client must not abandon it halfway.
                    exchange = await AdvanceAsync(fresh, CancellationToken.None);
                }
                catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
                {
                    exchange = await _store.XpExchanges.Find(e => e.Id == id).FirstAsync(ct);
                }
            }
        }

        if (!exchange.ItemIds.SequenceEqual(ids))
            throw MarketService.Error(400, MarketErrors.InvalidRequestId, "This idempotencyKey was already used for another operation.");
        return exchange.State switch
        {
            ChestOpeningStates.Done => await ResultAsync(exchange, ct),
            ChestOpeningStates.Failed => throw ErrorFor(exchange.Error),
            _ => throw ErrorFor(ChestErrors.InProgress),
        };
    }

    private async Task<long> PriceAsync(string userId, IReadOnlyList<string> ids, CancellationToken ct)
    {
        var progress = await EnsureProgressAsync(userId, ct);
        if (progress.Level >= ProgressRules.MaxLevel) throw ErrorFor(ProgressErrors.MaxLevel);

        var items = await _store.Items.Find(i => ids.Contains(i.Id) && i.OwnerId == userId).ToListAsync(ct);
        if (items.Count != ids.Count) throw ErrorFor(ProgressErrors.ItemNotFound);
        var catalog = _catalog.Current;
        var defs = items.Select(item => catalog.Find(item.DefId)).ToList();
        if (defs.Any(def => def is null || !ProgressRules.IsExchangeable(def))) throw ErrorFor(ProgressErrors.ItemNotExchangeable);
        if (items.Any(item => item.LockedBy is not null)) throw ErrorFor(ProgressErrors.ItemLocked);
        var account = await _store.FindAccountAsync(userId, ct);
        if (account is not null && items.Any(item => account.Equipped.Values.Contains(item.Id))) throw ErrorFor(ProgressErrors.ItemEquipped);
        return defs.Sum(def => catalog.XpValue(def!));
    }

    private async Task<ExchangeResultDto> ResultAsync(XpExchange exchange, CancellationToken ct)
    {
        var progress = await EnsureProgressAsync(exchange.UserId, ct);
        var level = exchange.ResultLevel ?? progress.Level;
        var xp = exchange.ResultXp ?? progress.Xp;
        var granted = await _store.Items
            .Find(i => i.OwnerId == exchange.UserId && i.LastTxId == exchange.Id && i.Source == MarketItemSources.Level)
            .Project(i => i.DefId)
            .ToListAsync(ct);
        var isMax = level >= ProgressRules.MaxLevel;
        var catalog = _catalog.Current;
        var newly = catalog.LevelRewards.Where(r => granted.Contains(r.DefId)).Select(r => r.DefId).Distinct(StringComparer.Ordinal).ToList();
        return new ExchangeResultDto(
            level, xp, isMax ? 0 : ProgressRules.XpToNext(level), isMax, exchange.Xp,
            newly.Where(id => catalog.Find(id)?.Category == MarketCategories.Frame).ToList(),
            newly.Where(id => catalog.Find(id)?.Category == MarketCategories.Title).ToList(),
            await _market.GetWalletAsync(exchange.UserId, ct));
    }

    /// <summary>Runs (or resumes) an exchange. Safe to run concurrently with itself; see <see cref="XpExchange"/>.</summary>
    internal async Task<XpExchange> AdvanceAsync(XpExchange exchange, CancellationToken ct)
    {
        switch (exchange.State)
        {
            case ChestOpeningStates.Done:
            case ChestOpeningStates.Failed:
                return exchange;
            case ChestOpeningStates.RollingBack:
                return await FinishRollbackAsync(exchange, exchange.Error ?? MarketErrors.Busy, ct);
        }

        var lockKey = ExchangeLock(exchange.Id);
        if (!exchange.Committed)
        {
            // Ids are sorted, so two exchanges over the same items cannot each hold what the other needs.
            foreach (var itemId in exchange.ItemIds)
            {
                if (await _store.LockItemAsync(itemId, exchange.UserId, lockKey, ct)) continue;
                var missing = await _store.Items.CountDocumentsAsync(i => i.Id == itemId && i.OwnerId == exchange.UserId, cancellationToken: ct) == 0;
                return await RollBackAsync(exchange, missing ? ProgressErrors.ItemNotFound : ProgressErrors.ItemLocked, ct);
            }
            // A slower equip may have landed before the lock did.
            var account = await _store.FindAccountAsync(exchange.UserId, ct);
            if (account is not null && exchange.ItemIds.Any(account.Equipped.Values.Contains))
                return await RollBackAsync(exchange, ProgressErrors.ItemEquipped, ct);
            if ((await EnsureProgressAsync(exchange.UserId, ct)).Level >= ProgressRules.MaxLevel)
                return await RollBackAsync(exchange, ProgressErrors.MaxLevel, ct);

            // Point of no return: from here the exchange only rolls forward.
            var committed = await _store.XpExchanges.UpdateOneAsync(
                e => e.Id == exchange.Id && e.State == ChestOpeningStates.Pending && !e.Committed,
                Builders<XpExchange>.Update.Set(e => e.Committed, true).Set(e => e.UpdatedAt, Now),
                cancellationToken: ct);
            if (committed.ModifiedCount == 0) return await ReloadAndAdvanceAsync(exchange.Id, ct);
            exchange.Committed = true;
        }

        await _store.Items.DeleteManyAsync(i => exchange.ItemIds.Contains(i.Id) && i.OwnerId == exchange.UserId && i.LockedBy == lockKey, ct);
        await _store.ApplyWalletAsync(exchange.UserId, ExchangeOpKey(exchange.Id), 0, slotDelta: -exchange.ItemIds.Count, ct: ct);
        var (level, xp) = await PayXpAsync(exchange.UserId, ExchangeOpKey(exchange.Id), exchange.Xp, ct);
        await GrantLevelRewardsAsync(exchange.UserId, level, exchange.Id, ct);

        await _store.XpExchanges.UpdateOneAsync(e => e.Id == exchange.Id,
            Builders<XpExchange>.Update
                .Set(e => e.State, ChestOpeningStates.Done)
                .Set(e => e.ResultLevel, level)
                .Set(e => e.ResultXp, xp)
                .Set(e => e.UpdatedAt, Now),
            cancellationToken: ct);
        exchange.State = ChestOpeningStates.Done;
        exchange.ResultLevel = level;
        exchange.ResultXp = xp;
        return exchange;
    }

    /// <summary>Compare-and-set on level and XP, so parallel exchanges add up; the operation key pays each one once.</summary>
    private async Task<(int Level, int Xp)> PayXpAsync(string userId, string opKey, long gain, CancellationToken ct)
    {
        for (var attempt = 0; attempt < XpWriteAttempts; attempt++)
        {
            var progress = await EnsureProgressAsync(userId, ct);
            if (progress.Ops.Contains(opKey)) return (progress.Level, progress.Xp);
            var (level, xp) = ProgressRules.Apply(progress.Level, progress.Xp, gain);
            var written = await _store.PlayerProgress.UpdateOneAsync(
                p => p.Id == userId && p.Level == progress.Level && p.Xp == progress.Xp && !p.Ops.Contains(opKey),
                Builders<PlayerProgress>.Update
                    .Set(p => p.Level, level)
                    .Set(p => p.Xp, xp)
                    .PushEach(p => p.Ops, new[] { opKey }, slice: -OpsWindow)
                    .Set(p => p.UpdatedAt, Now),
                cancellationToken: ct);
            if (written.ModifiedCount == 1) return (level, xp);
        }
        throw MarketService.Error(409, MarketErrors.Busy, "The market changed; please try again.");
    }

    private async Task<XpExchange> RollBackAsync(XpExchange exchange, string reason, CancellationToken ct)
    {
        var started = await _store.XpExchanges.UpdateOneAsync(
            e => e.Id == exchange.Id && e.State == ChestOpeningStates.Pending && !e.Committed,
            Builders<XpExchange>.Update
                .Set(e => e.State, ChestOpeningStates.RollingBack)
                .Set(e => e.Error, reason)
                .Set(e => e.UpdatedAt, Now),
            cancellationToken: ct);
        // Another runner got past the commit point or started the rollback first: follow it.
        if (started.ModifiedCount == 0) return await ReloadAndAdvanceAsync(exchange.Id, ct);
        return await FinishRollbackAsync(exchange, reason, ct);
    }

    private async Task<XpExchange> FinishRollbackAsync(XpExchange exchange, string reason, CancellationToken ct)
    {
        var lockKey = ExchangeLock(exchange.Id);
        await _store.Items.UpdateManyAsync(i => i.LockedBy == lockKey,
            Builders<MarketItem>.Update.Set(i => i.LockedBy, null), cancellationToken: ct);
        await _store.XpExchanges.UpdateOneAsync(e => e.Id == exchange.Id,
            Builders<XpExchange>.Update
                .Set(e => e.State, ChestOpeningStates.Failed)
                .Set(e => e.Error, reason)
                .Set(e => e.UpdatedAt, Now),
            cancellationToken: ct);
        exchange.State = ChestOpeningStates.Failed;
        exchange.Error = reason;
        return exchange;
    }

    private async Task<XpExchange> ReloadAndAdvanceAsync(string exchangeId, CancellationToken ct) =>
        await AdvanceAsync(await _store.XpExchanges.Find(e => e.Id == exchangeId).FirstAsync(ct), ct);

    // ------------------------------------------------------------------ earned cosmetics

    /// <summary>
    /// Every reward at or below the level, not just the ones just passed: a reward an admin adds later reaches those
    /// already past it the next time their profile opens. A retired item is no longer handed out.
    /// </summary>
    private async Task GrantLevelRewardsAsync(string userId, int level, string? exchangeId, CancellationToken ct)
    {
        var catalog = _catalog.Current;
        foreach (var reward in catalog.LevelRewards.Where(reward => reward.Level <= level && catalog.Find(reward.DefId)?.Retired != true))
            await GrantAsync(userId, reward.DefId, MarketItemSources.Level, exchangeId, ct);
    }

    /// <summary>Earned cosmetics take no bag slot: a full bag must never block a reward, and they can never leave the account.</summary>
    private async Task GrantAsync(string userId, string defId, string source, string? txId, CancellationToken ct)
    {
        try
        {
            await _store.Items.InsertOneAsync(new MarketItem
            {
                Id = EarnedItemId(userId, defId),
                OwnerId = userId,
                DefId = defId,
                Source = source,
                LastTxId = txId,
                AcquiredAt = Now
            }, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Already granted.
        }
    }

    /// <summary>Recounts a detective's record and grants whatever is newly earned. Idempotent; runs when a profile opens and when a game ends.</summary>
    public async Task<IReadOnlyList<AchievementProgress>> SyncAchievementsAsync(string userId, CancellationToken ct = default)
    {
        var catalog = _catalog.Current;
        var achievements = AchievementRules.Evaluate(await LoadStatsAsync(userId, ct), catalog.Achievements);
        foreach (var achievement in achievements.Where(a => a.Earned && catalog.Find(a.Def.TitleDefId)?.Retired != true))
            await GrantAsync(userId, achievement.Def.TitleDefId, MarketItemSources.Achievement, null, ct);
        return achievements;
    }

    private async Task<PlayerStats> LoadStatsAsync(string userId, CancellationToken ct)
    {
        var context = _store.Context;
        var results = await context.GameResults
            .Find(Builders<GameResult>.Filter.AnyEq(r => r.Players, userId))
            .Project(r => new { r.RoomId, r.Success, r.CreatedAt })
            .ToListAsync(ct);
        var rooms = await context.Rooms
            .Find(Builders<GameRoom>.Filter.ElemMatch(r => r.Players, p => p.UserId == userId))
            .Project(r => new { r.Id, r.GameplayState })
            .ToListAsync(ct);
        var states = rooms.Where(room => room.GameplayState is not null).ToDictionary(room => room.Id, room => room.GameplayState!);

        var noHintWins = results.Count(result => result.Success
            && states.TryGetValue(result.RoomId, out var state)
            && state.UsedHintIds.Count == 0 && state.LeadHintCount == 0);
        var watch = await _store.Items.CountDocumentsAsync(i => i.OwnerId == userId && i.DefId == AchievementRules.Watch217DefId, cancellationToken: ct);

        return new PlayerStats(
            results.Count,
            results.Count(result => result.Success),
            results.Count(result => result.Success && AchievementRules.IsMidnight(result.CreatedAt)),
            noHintWins,
            states.Values.Sum(state => state.ClueDiscoveries.Count(record => record.DiscoveredByUserId == userId)),
            states.Values.Sum(state => state.TestimonyDiscoveries.Count(record => record.DiscoveredByUserId == userId)),
            watch > 0);
    }

    // ------------------------------------------------------------------ avatar

    public async Task<ProgressDto> SetAvatarAsync(string userId, string? avatar, CancellationToken ct = default)
    {
        var progress = await EnsureProgressAsync(userId, ct);
        var chooseUpload = avatar == AvatarImageProcessor.UploadedAvatar && !string.IsNullOrEmpty(progress.AvatarUrl);
        if (!chooseUpload && !CosmeticCatalog.IsPresetAvatar(avatar))
            throw MarketService.Error(400, ProgressErrors.UnknownAvatar, "Choose one of the avatars on offer.");
        await _store.PlayerProgress.UpdateOneAsync(p => p.Id == userId,
            Builders<PlayerProgress>.Update.Set(p => p.Avatar, avatar).Set(p => p.UpdatedAt, Now),
            cancellationToken: ct);
        return await GetMeAsync(userId, ct);
    }

    public async Task<ProgressDto> UploadAvatarAsync(string userId, byte[] file, CancellationToken ct = default)
    {
        if (_avatars?.IsAvailable != true)
            throw MarketService.Error(409, AvatarErrors.Unavailable, "Uploading a picture is not available right now.");
        var square = await AvatarImageProcessor.ToSquareAsync(file, ct);
        var url = await _avatars.UploadAsync(userId, square, ct);
        await EnsureProgressAsync(userId, ct);
        await _store.PlayerProgress.UpdateOneAsync(p => p.Id == userId,
            Builders<PlayerProgress>.Update
                .Set(p => p.Avatar, AvatarImageProcessor.UploadedAvatar)
                .Set(p => p.AvatarUrl, url)
                .Set(p => p.AvatarUploadedAt, Now)
                .Set(p => p.UpdatedAt, Now),
            cancellationToken: ct);
        return await GetMeAsync(userId, ct);
    }

    // ------------------------------------------------------------------ admin

    /// <summary>
    /// Puts a detective at a level and XP and grants what that level is owed, once: the operation key sets it once and earned
    /// items have fixed ids. Nothing is taken back on the way down, so the answer lists what stays above the level.
    /// </summary>
    internal async Task<(int Level, int Xp, IReadOnlyList<string> KeptAboveLevel)> AdminSetProgressAsync(
        string userId, int level, int xp, string opKey, string operationId, CancellationToken ct)
    {
        await EnsureProgressAsync(userId, ct);
        await _store.PlayerProgress.UpdateOneAsync(
            p => p.Id == userId && !p.Ops.Contains(opKey),
            Builders<PlayerProgress>.Update
                .Set(p => p.Level, level)
                .Set(p => p.Xp, xp)
                .PushEach(p => p.Ops, new[] { opKey }, slice: -OpsWindow)
                .Set(p => p.UpdatedAt, Now),
            cancellationToken: ct);
        await GrantLevelRewardsAsync(userId, level, operationId, ct);

        var earned = await _store.Items
            .Find(i => i.OwnerId == userId && i.Source == MarketItemSources.Level)
            .Project(i => i.DefId)
            .ToListAsync(ct);
        return (level, xp, Admin.AdminPlayersRules.RewardsAbove(level, _catalog.Current.LevelRewards, earned));
    }

    /// <summary>Forgets an uploaded picture. Null when there is none. The default avatar only replaces it if it was the one in use.</summary>
    internal async Task<AdminClearedAvatar?> AdminClearAvatarAsync(string userId, CancellationToken ct)
    {
        var progress = await _store.PlayerProgress.Find(p => p.Id == userId).FirstOrDefaultAsync(ct);
        if (string.IsNullOrEmpty(progress?.AvatarUrl)) return null;
        var avatar = progress.Avatar == AvatarImageProcessor.UploadedAvatar ? CosmeticCatalog.DefaultAvatar : progress.Avatar;
        var cleared = await _store.PlayerProgress.UpdateOneAsync(
            p => p.Id == userId && p.AvatarUrl == progress.AvatarUrl,
            Builders<PlayerProgress>.Update
                .Set(p => p.Avatar, avatar)
                .Set(p => p.AvatarUrl, null)
                .Set(p => p.AvatarUploadedAt, null)
                .Set(p => p.UpdatedAt, Now),
            cancellationToken: ct);
        return cleared.ModifiedCount == 0 ? null : new AdminClearedAvatar(progress.Avatar, progress.AvatarUrl, avatar);
    }

    // ------------------------------------------------------------------ recovery

    /// <summary>Resumes exchanges older than <paramref name="staleAfter"/>; they finish or fail exactly as a retry would.</summary>
    public async Task<int> RecoverAsync(TimeSpan staleAfter, CancellationToken ct = default)
    {
        var cutoff = Now - staleAfter;
        var stale = await _store.XpExchanges
            .Find(e => (e.State == ChestOpeningStates.Pending || e.State == ChestOpeningStates.RollingBack) && e.UpdatedAt <= cutoff)
            .SortBy(e => e.UpdatedAt).Limit(50).ToListAsync(ct);
        var done = 0;
        foreach (var exchange in stale)
        {
            // Lease: only one sweeper resumes an exchange.
            var leased = await _store.XpExchanges.UpdateOneAsync(e => e.Id == exchange.Id && e.UpdatedAt == exchange.UpdatedAt,
                Builders<XpExchange>.Update.Set(e => e.UpdatedAt, Now), cancellationToken: ct);
            if (leased.ModifiedCount == 0) continue;
            try
            {
                await AdvanceAsync(exchange, ct);
                done++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogError(exception, "Progress recovery could not resume exchange {ExchangeId}.", exchange.Id);
            }
        }
        return done;
    }
}
