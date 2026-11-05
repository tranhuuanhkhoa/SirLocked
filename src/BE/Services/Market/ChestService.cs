using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.Services.Market;

/// <summary>Stable error codes; the frontend maps each one to a Vietnamese/English message.</summary>
public static class ChestErrors
{
    public const string ChestNone = "CHEST_NONE";
    public const string KeyNone = "KEY_NONE";
    public const string Funds = "FUNDS";
    public const string SlotsFull = "SLOTS_FULL";
    public const string InProgress = "IN_PROGRESS";
    public const string NotForSale = "CHEST_NOT_FOR_SALE";
    public const string PriceChanged = "CHEST_PRICE_CHANGED";
}

public sealed record ChestRecoveryReport(int Openings, int Purchases)
{
    public int Total => Openings + Purchases;
}

/// <summary>
/// Mở hòm: buys chests and keys from the shop and opens chests. The server alone decides the result. Like
/// the market it runs on a standalone MongoDB, so an opening is a journaled sequence of conditional writes on
/// one <see cref="ChestOpening"/>: record the rolled reward, lock one free chest and key, commit, spend them,
/// create the reward, settle the slot count. Every step is idempotent, so a retry or the recovery sweep can
/// resume it at any point.
/// </summary>
public sealed class ChestService
{
    private readonly MarketStore _store;
    private readonly MarketService _market;
    private readonly IChestRandom _random;
    private readonly ICatalogProvider _catalog;
    private readonly ILogger<ChestService> _logger;

    public ChestService(
        MarketStore store, MarketService market, IChestRandom random, IOptions<ChestSettings> settings, ILogger<ChestService> logger,
        ICatalogProvider? catalog = null)
    {
        _store = store;
        _market = market;
        _random = random;
        // Prices come from the catalog; the settings only price the seed.
        _catalog = catalog ?? new FixedCatalogProvider(settings.Value);
        _logger = logger;
    }

    private DateTime Now => _store.Now;

    internal static string OpeningLock(string openingId) => MarketService.ChestLockPrefix + openingId;
    internal static string OpeningOpKey(string openingId) => $"chest:open:{openingId}";
    internal static string PurchaseOpKey(string purchaseId) => $"chest:buy:{purchaseId}";

    private static ApiException ErrorFor(string? code) => code switch
    {
        ChestErrors.ChestNone => MarketService.Error(409, code, "You have no free chest of this type."),
        ChestErrors.KeyNone => MarketService.Error(409, code, "You have no free key for this chest."),
        ChestErrors.Funds => MarketService.Error(409, code, "You do not have enough coins."),
        ChestErrors.SlotsFull => MarketService.Error(409, code, "Your inventory is full."),
        ChestErrors.InProgress => MarketService.Error(409, code, "This request is still being processed."),
        ChestErrors.NotForSale => MarketService.Error(409, code, "This chest is no longer on sale."),
        ChestErrors.PriceChanged => MarketService.Error(409, code, "The price has changed; please check it and try again."),
        _ => MarketService.Error(409, code ?? MarketErrors.Busy, "The market changed; please try again."),
    };

    private ChestDef RequireChest(string? chestId) =>
        _catalog.Current.FindChest(chestId) ?? throw MarketService.Error(404, MarketErrors.UnknownItemType, "Unknown chest.");

    private static string OperationId(string userId, string? idempotencyKey)
    {
        if (string.IsNullOrEmpty(idempotencyKey) || !MarketService.RequestIdPattern.IsMatch(idempotencyKey))
            throw MarketService.Error(400, MarketErrors.InvalidRequestId, "idempotencyKey must be 8-64 letters, digits, '-' or '_'.");
        return $"{userId}:{idempotencyKey}";
    }

    private static ApiException KeyReused() =>
        MarketService.Error(400, MarketErrors.InvalidRequestId, "This idempotencyKey was already used for another operation.");

    // ------------------------------------------------------------------ reads

    public async Task<ChestListDto> ListAsync(string userId, CancellationToken ct = default)
    {
        await _market.EnsureAccountAsync(userId, ct);
        var catalog = _catalog.Current;
        var counts = await CountFreeAsync(userId, catalog.Chests.SelectMany(chest => new[] { chest.Id, chest.KeyDefId }).ToList(), ct);
        ChestDto Dto(ChestDef chest) => ToDto(chest, counts.GetValueOrDefault(chest.Id), counts.GetValueOrDefault(chest.KeyDefId));
        var offSale = catalog.Chests
            .Where(chest => !chest.Active && (counts.GetValueOrDefault(chest.Id) > 0 || counts.GetValueOrDefault(chest.KeyDefId) > 0))
            .Select(Dto).ToList();
        var odds = (catalog.ActiveChests.FirstOrDefault()?.DropRates ?? Array.Empty<ChestDropRate>())
            .Select(rate => new ChestOddsDto(rate.Rarity, rate.Percent)).ToList();
        return new ChestListDto(catalog.ActiveChests.Select(Dto).ToList(), odds, offSale, await _market.GetWalletAsync(userId, ct));
    }

    /// <summary>A chest as players see it, with whatever counts the caller says they hold.</summary>
    internal static ChestDto ToDto(ChestDef chest, int chestCount, int keyCount) => new(
        chest.Id, chest.KeyDefId, chest.Name, chest.NameEn, chest.Subtitle, chest.SubtitleEn,
        chest.KeyName, chest.KeyNameEn, chest.IconKey, chest.KeyIconKey, chest.Prices.Chest, chest.Prices.Key,
        chestCount, keyCount,
        // A rarity with no chance stays out: players pay for this list, so it must not promise what cannot drop.
        chest.Items
            .Where(item => chest.DropRates.Any(rate => rate.Rarity == item.Rarity && rate.Weight > 0))
            .Select(MarketService.ToDefDto).ToList(),
        chest.Look is { } look ? new ChestLookDto(look.Template, look.Light, look.Hi, look.Core) : null,
        chest.DropRates.Select(rate => new ChestOddsDto(rate.Rarity, rate.Percent)).ToList(),
        chest.Active);

    private async Task<Dictionary<string, int>> CountFreeAsync(string userId, IReadOnlyCollection<string> defIds, CancellationToken ct)
    {
        var defs = await _store.Items
            .Find(i => i.OwnerId == userId && i.LockedBy == null && defIds.Contains(i.DefId))
            .Project(i => i.DefId)
            .ToListAsync(ct);
        return defs.GroupBy(id => id).ToDictionary(group => group.Key, group => group.Count());
    }

    private async Task<(int Chests, int Keys)> CountChestAsync(string userId, ChestDef chest, CancellationToken ct)
    {
        var counts = await CountFreeAsync(userId, new[] { chest.Id, chest.KeyDefId }, ct);
        return (counts.GetValueOrDefault(chest.Id), counts.GetValueOrDefault(chest.KeyDefId));
    }

    // ------------------------------------------------------------------ opening

    public async Task<ChestOpenResultDto> OpenAsync(CurrentUser user, string chestId, string? idempotencyKey, CancellationToken ct = default)
    {
        var chest = RequireChest(chestId);
        var id = OperationId(user.Id, idempotencyKey);
        await _market.RequireVerifiedAsync(user.Id, ct);
        await _market.EnsureAccountAsync(user.Id, ct);

        var opening = await _store.ChestOpenings.Find(o => o.Id == id).FirstOrDefaultAsync(ct);
        if (opening is null)
        {
            // Cheap pre-check so a click without a chest or key leaves no document behind. The locks below decide races.
            var (chests, keys) = await CountChestAsync(user.Id, chest, ct);
            if (chests < 1) throw ErrorFor(ChestErrors.ChestNone);
            if (keys < 1) throw ErrorFor(ChestErrors.KeyNone);
            // Every item retired: nothing to pay out, and nothing has been spent.
            if (chest.Items.Count == 0) throw ErrorFor(null);

            var now = Now;
            var fresh = new ChestOpening
            {
                Id = id,
                UserId = user.Id,
                ChestDefId = chest.Id,
                KeyDefId = chest.KeyDefId,
                RewardDefId = chest.Roll(_random).Id,
                RewardItemId = MarketStore.NewId(),
                CreatedAt = now,
                UpdatedAt = now
            };
            try
            {
                await _store.ChestOpenings.InsertOneAsync(fresh, cancellationToken: ct);
                // The opening now exists: a disconnecting client must not abandon it halfway.
                opening = await AdvanceOpeningAsync(fresh, CancellationToken.None);
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                opening = await _store.ChestOpenings.Find(o => o.Id == id).FirstAsync(ct);
            }
        }

        if (opening.ChestDefId != chest.Id) throw KeyReused();
        return opening.State switch
        {
            ChestOpeningStates.Done => await OpenResultAsync(opening, chest, ct),
            ChestOpeningStates.Failed => throw ErrorFor(opening.Error),
            _ => throw ErrorFor(ChestErrors.InProgress),
        };
    }

    private async Task<ChestOpenResultDto> OpenResultAsync(ChestOpening opening, ChestDef chest, CancellationToken ct)
    {
        var (chests, keys) = await CountChestAsync(opening.UserId, chest, ct);
        return new ChestOpenResultDto(
            chest.Id, opening.RewardItemId, _market.DefDto(opening.RewardDefId), chests, keys,
            await _market.GetWalletAsync(opening.UserId, ct));
    }

    /// <summary>Runs (or resumes) an opening. Safe to run concurrently with itself; see <see cref="ChestOpening"/>.</summary>
    internal async Task<ChestOpening> AdvanceOpeningAsync(ChestOpening opening, CancellationToken ct)
    {
        switch (opening.State)
        {
            case ChestOpeningStates.Done:
            case ChestOpeningStates.Failed:
                return opening;
            case ChestOpeningStates.RollingBack:
                return await FinishRollbackAsync(opening, opening.Error ?? MarketErrors.Busy, ct);
        }

        var lockKey = OpeningLock(opening.Id);
        if (!opening.Committed)
        {
            // Each lock is one atomic claim, so two openings can never take the same chest or key.
            var chestItem = await LockOneAsync(opening.UserId, opening.ChestDefId, lockKey, ct);
            if (chestItem is null) return await RollBackAsync(opening, ChestErrors.ChestNone, ct);
            var keyItem = await LockOneAsync(opening.UserId, opening.KeyDefId, lockKey, ct);
            if (keyItem is null) return await RollBackAsync(opening, ChestErrors.KeyNone, ct);

            // Point of no return: from here the opening only rolls forward.
            var committed = await _store.ChestOpenings.UpdateOneAsync(
                o => o.Id == opening.Id && o.State == ChestOpeningStates.Pending && !o.Committed,
                Builders<ChestOpening>.Update
                    .Set(o => o.Committed, true)
                    .Set(o => o.ChestItemId, chestItem.Id)
                    .Set(o => o.KeyItemId, keyItem.Id)
                    .Set(o => o.UpdatedAt, Now),
                cancellationToken: ct);
            if (committed.ModifiedCount == 0) return await ReloadAndAdvanceAsync(opening.Id, ct);
            opening.Committed = true;
            opening.ChestItemId = chestItem.Id;
            opening.KeyItemId = keyItem.Id;
        }

        await SpendAsync(opening.ChestItemId!, opening.UserId, lockKey, ct);
        await SpendAsync(opening.KeyItemId!, opening.UserId, lockKey, ct);
        try
        {
            await _store.Items.InsertOneAsync(new MarketItem
            {
                Id = opening.RewardItemId,
                OwnerId = opening.UserId,
                DefId = opening.RewardDefId,
                Source = MarketItemSources.Chest,
                LastTxId = opening.Id,
                AcquiredAt = Now
            }, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // A replay: the reward already exists.
        }
        // Two items left and one came in. The net change only frees a slot, so a full bag can always open.
        await _store.ApplyWalletAsync(opening.UserId, OpeningOpKey(opening.Id), 0, slotDelta: -1, ct: ct);

        await _store.ChestOpenings.UpdateOneAsync(o => o.Id == opening.Id,
            Builders<ChestOpening>.Update.Set(o => o.State, ChestOpeningStates.Done).Set(o => o.UpdatedAt, Now),
            cancellationToken: ct);
        opening.State = ChestOpeningStates.Done;
        return opening;
    }

    /// <summary>Claims one free item of a type, preferring one this opening has already locked before a crash.</summary>
    private Task<MarketItem?> LockOneAsync(string userId, string defId, string lockKey, CancellationToken ct)
    {
        var filter = Builders<MarketItem>.Filter;
        return _store.Items.FindOneAndUpdateAsync<MarketItem?>(
            filter.Eq(i => i.OwnerId, userId)
            & filter.Eq(i => i.DefId, defId)
            & (filter.Eq(i => i.LockedBy, lockKey) | filter.Eq(i => i.LockedBy, null)),
            Builders<MarketItem>.Update.Set(i => i.LockedBy, lockKey),
            new FindOneAndUpdateOptions<MarketItem, MarketItem?>
            {
                // Descending puts strings before null, so an item already locked by this opening is picked first.
                Sort = Builders<MarketItem>.Sort.Descending(i => i.LockedBy).Ascending(i => i.AcquiredAt),
                ReturnDocument = ReturnDocument.After
            },
            ct);
    }

    private Task SpendAsync(string itemId, string userId, string lockKey, CancellationToken ct) =>
        _store.Items.DeleteOneAsync(i => i.Id == itemId && i.OwnerId == userId && i.LockedBy == lockKey, ct);

    private async Task<ChestOpening> RollBackAsync(ChestOpening opening, string reason, CancellationToken ct)
    {
        var started = await _store.ChestOpenings.UpdateOneAsync(
            o => o.Id == opening.Id && o.State == ChestOpeningStates.Pending && !o.Committed,
            Builders<ChestOpening>.Update
                .Set(o => o.State, ChestOpeningStates.RollingBack)
                .Set(o => o.Error, reason)
                .Set(o => o.UpdatedAt, Now),
            cancellationToken: ct);
        // Another runner got past the commit point or started the rollback first: follow it.
        if (started.ModifiedCount == 0) return await ReloadAndAdvanceAsync(opening.Id, ct);
        return await FinishRollbackAsync(opening, reason, ct);
    }

    private async Task<ChestOpening> FinishRollbackAsync(ChestOpening opening, string reason, CancellationToken ct)
    {
        var lockKey = OpeningLock(opening.Id);
        await _store.Items.UpdateManyAsync(i => i.LockedBy == lockKey,
            Builders<MarketItem>.Update.Set(i => i.LockedBy, null), cancellationToken: ct);
        await _store.ChestOpenings.UpdateOneAsync(o => o.Id == opening.Id,
            Builders<ChestOpening>.Update
                .Set(o => o.State, ChestOpeningStates.Failed)
                .Set(o => o.Error, reason)
                .Set(o => o.UpdatedAt, Now),
            cancellationToken: ct);
        opening.State = ChestOpeningStates.Failed;
        opening.Error = reason;
        return opening;
    }

    private async Task<ChestOpening> ReloadAndAdvanceAsync(string openingId, CancellationToken ct) =>
        await AdvanceOpeningAsync(await _store.ChestOpenings.Find(o => o.Id == openingId).FirstAsync(ct), ct);

    // ------------------------------------------------------------------ shop

    public Task<ChestPurchaseResultDto> BuyKeyAsync(
        CurrentUser user, string chestId, string? idempotencyKey, CancellationToken ct = default, long? expectedPrice = null)
    {
        var chest = RequireChest(chestId);
        return BuyAsync(user, chest, chest.KeyDefId, chest.Prices.Key, expectedPrice, idempotencyKey, ct);
    }

    public Task<ChestPurchaseResultDto> BuyChestAsync(
        CurrentUser user, string chestId, string? idempotencyKey, CancellationToken ct = default, long? expectedPrice = null)
    {
        var chest = RequireChest(chestId);
        return BuyAsync(user, chest, chest.Id, chest.Prices.Chest, expectedPrice, idempotencyKey, ct);
    }

    private async Task<ChestPurchaseResultDto> BuyAsync(
        CurrentUser user, ChestDef chest, string defId, long price, long? expectedPrice, string? idempotencyKey, CancellationToken ct)
    {
        var id = OperationId(user.Id, idempotencyKey);
        await _market.RequireVerifiedAsync(user.Id, ct);
        var account = await _market.EnsureAccountAsync(user.Id, ct);

        var purchase = await _store.ChestPurchases.Find(p => p.Id == id).FirstOrDefaultAsync(ct);
        if (purchase is null)
        {
            // Only a new purchase: retrying one that already went through still answers with its result.
            if (!chest.Active) throw ErrorFor(ChestErrors.NotForSale);
            if (expectedPrice is not null && expectedPrice != price) throw ErrorFor(ChestErrors.PriceChanged);
            // A price lost to a bad edit must not become a free chest.
            if (MarketRules.ValidatePrice(price) is not null) throw ErrorFor(null);
            if (account.Balance < price) throw ErrorFor(ChestErrors.Funds);
            if (!MarketRules.HasRoom(account.Slots, 1)) throw ErrorFor(ChestErrors.SlotsFull);

            var now = Now;
            var fresh = new ChestPurchase
            {
                Id = id,
                UserId = user.Id,
                ChestDefId = chest.Id,
                DefId = defId,
                Price = price,
                ItemId = MarketStore.NewId(),
                CreatedAt = now,
                UpdatedAt = now
            };
            try
            {
                await _store.ChestPurchases.InsertOneAsync(fresh, cancellationToken: ct);
                purchase = await AdvancePurchaseAsync(fresh, CancellationToken.None);
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                purchase = await _store.ChestPurchases.Find(p => p.Id == id).FirstAsync(ct);
            }
        }

        if (purchase.ChestDefId != chest.Id || purchase.DefId != defId) throw KeyReused();
        switch (purchase.State)
        {
            case ChestOpeningStates.Done:
                var (chests, keys) = await CountChestAsync(user.Id, chest, ct);
                return new ChestPurchaseResultDto(chest.Id, purchase.ItemId, _market.DefDto(purchase.DefId), chests, keys,
                    await _market.GetWalletAsync(user.Id, ct));
            case ChestOpeningStates.Failed:
                throw ErrorFor(purchase.Error);
            default:
                throw ErrorFor(ChestErrors.InProgress);
        }
    }

    /// <summary>Charges once (the operation key deduplicates) and creates the item once (its id is fixed in the journal).</summary>
    internal async Task<ChestPurchase> AdvancePurchaseAsync(ChestPurchase purchase, CancellationToken ct)
    {
        if (purchase.State != ChestOpeningStates.Pending) return purchase;

        var debit = await _store.ApplyWalletAsync(purchase.UserId, PurchaseOpKey(purchase.Id), -purchase.Price, slotDelta: 1, ct: ct);
        if (debit == WalletWrite.Rejected)
        {
            var reason = await DebitFailureAsync(purchase.UserId, purchase.Price, ct);
            await _store.ChestPurchases.UpdateOneAsync(
                p => p.Id == purchase.Id && p.State == ChestOpeningStates.Pending,
                Builders<ChestPurchase>.Update
                    .Set(p => p.State, ChestOpeningStates.Failed)
                    .Set(p => p.Error, reason)
                    .Set(p => p.UpdatedAt, Now),
                cancellationToken: ct);
            purchase.State = ChestOpeningStates.Failed;
            purchase.Error = reason;
            return purchase;
        }

        try
        {
            await _store.Items.InsertOneAsync(new MarketItem
            {
                Id = purchase.ItemId,
                OwnerId = purchase.UserId,
                DefId = purchase.DefId,
                Source = MarketItemSources.Shop,
                LastTxId = purchase.Id,
                AcquiredAt = Now
            }, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // A replay: the item already exists.
        }
        // Not conditional: once the coins are gone the purchase is done, whatever a slower runner concluded.
        await _store.ChestPurchases.UpdateOneAsync(p => p.Id == purchase.Id,
            Builders<ChestPurchase>.Update
                .Set(p => p.State, ChestOpeningStates.Done)
                .Unset(p => p.Error)
                .Set(p => p.UpdatedAt, Now),
            cancellationToken: ct);
        purchase.State = ChestOpeningStates.Done;
        return purchase;
    }

    private async Task<string> DebitFailureAsync(string userId, long amount, CancellationToken ct)
    {
        var account = await _store.FindAccountAsync(userId, ct);
        if (account is null || account.Balance < amount) return ChestErrors.Funds;
        if (!MarketRules.HasRoom(account.Slots, 1)) return ChestErrors.SlotsFull;
        return MarketErrors.Busy;
    }

    // ------------------------------------------------------------------ admin

    /// <summary>Operator tool for testing: gives chests and keys of one type to a detective (Source = GRANT).</summary>
    public async Task<WalletDto> AdminGrantAsync(string userId, string chestId, int chests, int keys, CancellationToken ct = default)
    {
        var chest = RequireChest(chestId);
        if (chests < 0 || keys < 0 || chests + keys < 1)
            throw MarketService.Error(400, MarketErrors.InvalidPrice, "Grant at least one chest or key.");
        var wallet = await _market.GetWalletForGrantAsync(userId, ct);
        if (!MarketRules.HasRoom(wallet.SlotsUsed, chests + keys)) throw ErrorFor(ChestErrors.SlotsFull);
        for (var i = 0; i < chests; i++) wallet = await _market.AdminGrantAsync(userId, chest.Id, 0, ct);
        for (var i = 0; i < keys; i++) wallet = await _market.AdminGrantAsync(userId, chest.KeyDefId, 0, ct);
        return wallet;
    }

    // ------------------------------------------------------------------ recovery

    /// <summary>Resumes openings and purchases older than <paramref name="staleAfter"/>; they finish or fail exactly as a retry would.</summary>
    public async Task<ChestRecoveryReport> RecoverAsync(TimeSpan staleAfter, CancellationToken ct = default)
    {
        var cutoff = Now - staleAfter;
        var openings = await RecoverOpeningsAsync(cutoff, ct);
        var purchases = await RecoverPurchasesAsync(cutoff, ct);
        return new ChestRecoveryReport(openings, purchases);
    }

    private async Task<int> RecoverOpeningsAsync(DateTime cutoff, CancellationToken ct)
    {
        var stale = await _store.ChestOpenings
            .Find(o => (o.State == ChestOpeningStates.Pending || o.State == ChestOpeningStates.RollingBack) && o.UpdatedAt < cutoff)
            .SortBy(o => o.UpdatedAt).Limit(50).ToListAsync(ct);
        var done = 0;
        foreach (var opening in stale)
        {
            // Lease: only one sweeper resumes an opening.
            var leased = await _store.ChestOpenings.UpdateOneAsync(o => o.Id == opening.Id && o.UpdatedAt == opening.UpdatedAt,
                Builders<ChestOpening>.Update.Set(o => o.UpdatedAt, Now), cancellationToken: ct);
            if (leased.ModifiedCount == 0) continue;
            try
            {
                await AdvanceOpeningAsync(opening, ct);
                done++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogError(exception, "Chest recovery could not resume opening {OpeningId}.", opening.Id);
            }
        }
        return done;
    }

    private async Task<int> RecoverPurchasesAsync(DateTime cutoff, CancellationToken ct)
    {
        var stale = await _store.ChestPurchases
            .Find(p => p.State == ChestOpeningStates.Pending && p.UpdatedAt < cutoff)
            .SortBy(p => p.UpdatedAt).Limit(50).ToListAsync(ct);
        var done = 0;
        foreach (var purchase in stale)
        {
            var leased = await _store.ChestPurchases.UpdateOneAsync(p => p.Id == purchase.Id && p.UpdatedAt == purchase.UpdatedAt,
                Builders<ChestPurchase>.Update.Set(p => p.UpdatedAt, Now), cancellationToken: ct);
            if (leased.ModifiedCount == 0) continue;
            try
            {
                await AdvancePurchaseAsync(purchase, ct);
                done++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogError(exception, "Chest recovery could not resume purchase {PurchaseId}.", purchase.Id);
            }
        }
        return done;
    }
}
