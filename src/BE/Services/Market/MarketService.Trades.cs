using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Market;

namespace SirLocked.Api.Services.Market;

/// <summary>
/// Trade offers between two detectives: items + coins on each side, a message, accept / decline /
/// counter. Nothing is escrowed while an offer is pending; everything is re-validated and locked when
/// the recipient accepts, then moved by a journaled TRADE transaction.
/// </summary>
public sealed partial class MarketService
{
    public async Task<TradesDto> GetTradesAsync(string userId, CancellationToken ct = default)
    {
        await EnsureAccountAsync(userId, ct);
        var incoming = await _store.Trades
            .Find(t => t.ToUserId == userId && (t.Status == TradeOfferStatus.Pending || t.Status == TradeOfferStatus.Accepting))
            .SortByDescending(t => t.CreatedAt).Limit(30).ToListAsync(ct);
        var outgoing = await _store.Trades
            .Find(t => t.FromUserId == userId && (t.Status == TradeOfferStatus.Pending || t.Status == TradeOfferStatus.Accepting))
            .SortByDescending(t => t.CreatedAt).Limit(30).ToListAsync(ct);
        var history = await _store.Trades
            .Find(t => (t.FromUserId == userId || t.ToUserId == userId)
                       && t.Status != TradeOfferStatus.Pending && t.Status != TradeOfferStatus.Accepting)
            .SortByDescending(t => t.UpdatedAt).Limit(20).ToListAsync(ct);
        var open = incoming.Concat(outgoing).ToList();
        var itemIds = open.SelectMany(t => t.FromItems.Concat(t.ToItems)).Select(i => i.ItemId).Distinct().ToList();
        var items = itemIds.Count == 0
            ? new Dictionary<string, MarketItem>()
            : (await _store.Items.Find(i => itemIds.Contains(i.Id)).ToListAsync(ct)).ToDictionary(i => i.Id);
        return new TradesDto(
            incoming.Select(t => ToTradeDto(t, userId, items)).ToList(),
            outgoing.Select(t => ToTradeDto(t, userId, items)).ToList(),
            history.Select(t => ToTradeDto(t, userId, null)).ToList(),
            _tradeCoins);
    }

    private TradeOfferDto ToTradeDto(TradeOffer offer, string viewerId, IReadOnlyDictionary<string, MarketItem>? items)
    {
        bool Available(TradeItemRef reference, string owner) =>
            items is null
                ? offer.Status == TradeOfferStatus.Accepted
                : items.TryGetValue(reference.ItemId, out var item) && item.OwnerId == owner && item.LockedBy is null;
        return new TradeOfferDto(
            offer.Id,
            offer.ToUserId == viewerId ? "INCOMING" : "OUTGOING",
            new TradePartyDto(offer.FromUserId, offer.FromName),
            new TradePartyDto(offer.ToUserId, offer.ToName),
            offer.FromItems.Select(r => new TradeItemDto(r.ItemId, DefDto(r.DefId), Available(r, offer.FromUserId))).ToList(),
            offer.ToItems.Select(r => new TradeItemDto(r.ItemId, DefDto(r.DefId), Available(r, offer.ToUserId))).ToList(),
            offer.FromCoins,
            offer.ToCoins,
            offer.Message,
            offer.Status,
            offer.FailReason,
            offer.ParentId,
            offer.CounterId,
            offer.CreatedAt,
            offer.RespondedAt);
    }

    public async Task<TradeOfferDto> CreateTradeAsync(CurrentUser user, CreateTradeRequest request, CancellationToken ct = default)
    {
        var offer = await BuildOfferAsync(user, request.ToUserId, request, parentId: null, ct);
        await _store.Trades.InsertOneAsync(offer, cancellationToken: ct);
        return ToTradeDto(offer, user.Id, await LoadItemsAsync(offer, ct));
    }

    /// <summary>Validates terms against current ownership and returns an unsaved PENDING offer.</summary>
    private async Task<TradeOffer> BuildOfferAsync(
        CurrentUser user, string toUserId, TradeTermsRequest terms, string? parentId, CancellationToken ct)
    {
        var offerIds = (terms.OfferItemIds ?? new List<string>()).Select(id => (id ?? string.Empty).Trim()).ToList();
        var requestIds = (terms.RequestItemIds ?? new List<string>()).Select(id => (id ?? string.Empty).Trim()).ToList();
        var draft = new TradeDraft(user.Id, (toUserId ?? string.Empty).Trim(), offerIds, terms.OfferCoins, requestIds, terms.RequestCoins, terms.Message);
        if (MarketRules.ValidateTradeDraft(draft, _tradeCoins) is { } shapeError)
            throw Error(400, shapeError, "This trade offer is not valid.");

        await RequireVerifiedAsync(user.Id, ct);
        var target = await FindActiveUserAsync(draft.ToUserId, ct)
            ?? throw Error(404, MarketErrors.UserNotFound, "No detective with this id was found.");
        var me = await EnsureAccountAsync(user.Id, ct);
        await EnsureAccountAsync(target.Id, ct);

        var pending = await _store.Trades.CountDocumentsAsync(
            t => t.FromUserId == user.Id && t.Status == TradeOfferStatus.Pending, cancellationToken: ct);
        if (pending >= MarketRules.MaxPendingOutgoingTrades)
            throw Error(409, MarketErrors.TradeTooManyPending, "You have too many pending trade offers.");

        var all = offerIds.Concat(requestIds).ToList();
        var items = all.Count == 0
            ? new Dictionary<string, MarketItem>()
            : (await _store.Items.Find(i => all.Contains(i.Id)).ToListAsync(ct)).ToDictionary(i => i.Id);
        if (MarketRules.ValidateTradeItems(offerIds, requestIds, user.Id, target.Id, items) is { } itemError)
            throw ErrorFor(itemError);
        if (items.Values.Any(item => _catalog.Current.Find(item.DefId)?.Tradable == false))
            throw ErrorFor(MarketErrors.ItemNotTradable);
        if (me.Balance < draft.OfferCoins) throw ErrorFor(MarketErrors.InsufficientFunds);

        var now = Now;
        return new TradeOffer
        {
            Id = MarketStore.NewId(),
            FromUserId = user.Id,
            FromName = user.FullName,
            ToUserId = target.Id,
            ToName = target.FullName,
            FromItems = offerIds.Select(id => new TradeItemRef { ItemId = id, DefId = items[id].DefId }).ToList(),
            ToItems = requestIds.Select(id => new TradeItemRef { ItemId = id, DefId = items[id].DefId }).ToList(),
            FromCoins = draft.OfferCoins,
            ToCoins = draft.RequestCoins,
            Message = MarketRules.SanitizeMessage(draft.Message),
            Status = TradeOfferStatus.Pending,
            ParentId = parentId,
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    private async Task<Dictionary<string, MarketItem>> LoadItemsAsync(TradeOffer offer, CancellationToken ct)
    {
        var ids = offer.FromItems.Concat(offer.ToItems).Select(r => r.ItemId).ToList();
        return ids.Count == 0
            ? new Dictionary<string, MarketItem>()
            : (await _store.Items.Find(i => ids.Contains(i.Id)).ToListAsync(ct)).ToDictionary(i => i.Id);
    }

    private async Task<TradeOffer> RequireOfferAsync(string offerId, string userId, CancellationToken ct)
    {
        var offer = await _store.Trades.Find(t => t.Id == offerId).FirstOrDefaultAsync(ct);
        if (offer is null || (offer.FromUserId != userId && offer.ToUserId != userId))
            throw Error(404, MarketErrors.TradeNotFound, "Trade offer not found.");
        return offer;
    }

    private async Task<TradeOfferDto> CloseOfferAsync(
        string userId, string offerId, bool asRecipient, string status, CancellationToken ct)
    {
        var offer = await RequireOfferAsync(offerId, userId, ct);
        if ((asRecipient ? offer.ToUserId : offer.FromUserId) != userId)
            throw Error(403, MarketErrors.TradeNotFound, "You cannot do that with this offer.");
        var now = Now;
        var closed = await _store.Trades.UpdateOneAsync(
            t => t.Id == offerId && t.Status == TradeOfferStatus.Pending,
            Builders<TradeOffer>.Update.Set(t => t.Status, status).Set(t => t.RespondedAt, now).Set(t => t.UpdatedAt, now),
            cancellationToken: ct);
        if (closed.ModifiedCount == 0) throw ErrorFor(MarketErrors.TradeClosed);
        var fresh = await _store.Trades.Find(t => t.Id == offerId).FirstAsync(ct);
        return ToTradeDto(fresh, userId, await LoadItemsAsync(fresh, ct));
    }

    public Task<TradeOfferDto> DeclineTradeAsync(string userId, string offerId, CancellationToken ct = default) =>
        CloseOfferAsync(userId, offerId, asRecipient: true, TradeOfferStatus.Declined, ct);

    public Task<TradeOfferDto> CancelTradeAsync(string userId, string offerId, CancellationToken ct = default) =>
        CloseOfferAsync(userId, offerId, asRecipient: false, TradeOfferStatus.Cancelled, ct);

    /// <summary>
    /// "PHẢN ĐỀ NGHỊ": the recipient answers with new terms. The new offer goes from the recipient back to
    /// the original sender and the original closes as COUNTERED.
    /// </summary>
    public async Task<TradeOfferDto> CounterTradeAsync(CurrentUser user, string offerId, TradeTermsRequest terms, CancellationToken ct = default)
    {
        var original = await RequireOfferAsync(offerId, user.Id, ct);
        if (original.ToUserId != user.Id) throw Error(403, MarketErrors.TradeNotFound, "Only the recipient can counter this offer.");
        if (original.Status != TradeOfferStatus.Pending) throw ErrorFor(MarketErrors.TradeClosed);
        var counter = await BuildOfferAsync(user, original.FromUserId, terms, original.Id, ct);
        await _store.Trades.InsertOneAsync(counter, cancellationToken: ct);
        var now = Now;
        var closed = await _store.Trades.UpdateOneAsync(
            t => t.Id == original.Id && t.Status == TradeOfferStatus.Pending,
            Builders<TradeOffer>.Update.Set(t => t.Status, TradeOfferStatus.Countered).Set(t => t.CounterId, counter.Id)
                .Set(t => t.RespondedAt, now).Set(t => t.UpdatedAt, now),
            cancellationToken: ct);
        if (closed.ModifiedCount == 0)
        {
            await _store.Trades.DeleteOneAsync(t => t.Id == counter.Id, CancellationToken.None);
            throw ErrorFor(MarketErrors.TradeClosed);
        }
        return ToTradeDto(counter, user.Id, await LoadItemsAsync(counter, ct));
    }

    public async Task<TradeOfferDto> AcceptTradeAsync(CurrentUser user, string offerId, CancellationToken ct = default)
    {
        var offer = await RequireOfferAsync(offerId, user.Id, ct);
        if (offer.ToUserId != user.Id) throw Error(403, MarketErrors.TradeNotFound, "Only the recipient can accept this offer.");
        if (offer.Status != TradeOfferStatus.Pending) throw ErrorFor(MarketErrors.TradeClosed);
        // An offer made with coins before they were switched off stays open, but only to be declined, cancelled or countered.
        if (!_tradeCoins && (offer.FromCoins > 0 || offer.ToCoins > 0)) throw ErrorFor(MarketErrors.TradeCoinsNotAllowed);
        await RequireVerifiedAsync(user.Id, ct);
        await EnsureAccountAsync(offer.FromUserId, ct);
        await EnsureAccountAsync(offer.ToUserId, ct);

        var now = Now;
        var tx = new MarketTx
        {
            Id = MarketStore.NewId(),
            Kind = MarketTxKinds.Trade,
            State = MarketTxStates.Pending,
            OfferId = offer.Id,
            FromId = offer.FromUserId,
            ToId = offer.ToUserId,
            FromItemIds = offer.FromItems.Select(r => r.ItemId).ToList(),
            ToItemIds = offer.ToItems.Select(r => r.ItemId).ToList(),
            FromCoins = offer.FromCoins,
            ToCoins = offer.ToCoins,
            CreatedAt = now,
            UpdatedAt = now
        };
        await _store.Txs.InsertOneAsync(tx, cancellationToken: ct);
        var error = await AdvanceTradeAsync(tx, CancellationToken.None);
        if (error is not null) throw ErrorFor(error);
        var fresh = await _store.Trades.Find(t => t.Id == offer.Id).FirstAsync(ct);
        return ToTradeDto(fresh, user.Id, null);
    }

    private static int FromSlotDelta(MarketTx tx) => tx.ToItemIds.Count - tx.FromItemIds.Count;

    /// <summary>Runs (or resumes) a TRADE transaction; returns an error code when it rolled back.</summary>
    internal async Task<string?> AdvanceTradeAsync(MarketTx tx, CancellationToken ct)
    {
        switch (tx.State)
        {
            case MarketTxStates.Done: return null;
            case MarketTxStates.Failed: return tx.Error ?? MarketErrors.TradeClosed;
            case MarketTxStates.RollingBack: return await RollbackTradeAsync(tx, tx.Error ?? MarketErrors.TradeClosed, ct);
        }
        var from = tx.FromId!;
        var to = tx.ToId!;
        var lockKey = TxLock(tx.Id);
        var fromDelta = FromSlotDelta(tx);
        var toDelta = -fromDelta;

        if (!tx.Committed)
        {
            // 1. Claim the offer: only one accept can run.
            var claimed = await _store.Trades.UpdateOneAsync(
                t => t.Id == tx.OfferId && t.ToUserId == to && t.FromUserId == from
                     && (t.Status == TradeOfferStatus.Pending || (t.Status == TradeOfferStatus.Accepting && t.TxId == tx.Id)),
                Builders<TradeOffer>.Update.Set(t => t.Status, TradeOfferStatus.Accepting).Set(t => t.TxId, tx.Id).Set(t => t.UpdatedAt, Now),
                cancellationToken: ct);
            if (claimed.MatchedCount == 0)
            {
                await FailTxAsync(tx, MarketErrors.TradeClosed, ct);
                return MarketErrors.TradeClosed;
            }

            // 2. Lock every item under this transaction; any listed/traded/moved item aborts the trade.
            foreach (var itemId in tx.FromItemIds)
            {
                if (!await _store.LockItemAsync(itemId, from, lockKey, ct))
                    return await RollbackTradeAsync(tx, MarketErrors.TradeItemUnavailable, ct);
            }
            foreach (var itemId in tx.ToItemIds)
            {
                if (!await _store.LockItemAsync(itemId, to, lockKey, ct))
                    return await RollbackTradeAsync(tx, MarketErrors.TradeItemUnavailable, ct);
            }

            // 3. Take coins and reserve incoming slots on both sides (guarded: never negative, never over the cap).
            if (!tx.FromDebited)
            {
                if (tx.FromCoins > 0 || MarketRules.ReservePart(fromDelta) > 0)
                {
                    var debit = await _store.ApplyWalletAsync(from, StepKey(tx, "from-debit"), -tx.FromCoins,
                        slotDelta: MarketRules.ReservePart(fromDelta), ct: ct);
                    if (debit == WalletWrite.Rejected)
                    {
                        var account = await _store.FindAccountAsync(from, ct);
                        return await RollbackTradeAsync(tx, account is not null && account.Balance < tx.FromCoins
                            ? MarketErrors.TradeSenderFunds : MarketErrors.TradeSenderInventory, ct);
                    }
                }
                tx.FromDebited = true;
                await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.FromDebited, true), ct);
            }
            if (!tx.ToDebited)
            {
                if (tx.ToCoins > 0 || MarketRules.ReservePart(toDelta) > 0)
                {
                    var debit = await _store.ApplyWalletAsync(to, StepKey(tx, "to-debit"), -tx.ToCoins,
                        slotDelta: MarketRules.ReservePart(toDelta), ct: ct);
                    if (debit == WalletWrite.Rejected)
                    {
                        var account = await _store.FindAccountAsync(to, ct);
                        return await RollbackTradeAsync(tx, account is not null && account.Balance < tx.ToCoins
                            ? MarketErrors.TradeRecipientFunds : MarketErrors.TradeRecipientInventory, ct);
                    }
                }
                tx.ToDebited = true;
                await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.ToDebited, true), ct);
            }

            tx.Committed = true;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.Committed, true), ct);
        }

        // 4. Swap the items (each is locked by this transaction).
        foreach (var itemId in tx.FromItemIds)
        {
            if (!await _store.MoveItemAsync(itemId, from, to, lockKey, tx.Id, MarketItemSources.Trade, ct))
                _logger.LogError("Market trade tx {TxId}: item {ItemId} was not where the lock left it.", tx.Id, itemId);
        }
        foreach (var itemId in tx.ToItemIds)
        {
            if (!await _store.MoveItemAsync(itemId, to, from, lockKey, tx.Id, MarketItemSources.Trade, ct))
                _logger.LogError("Market trade tx {TxId}: item {ItemId} was not where the lock left it.", tx.Id, itemId);
        }

        // 5. Credit coins and release the slots of the items each side gave away.
        if (!tx.FromCredited)
        {
            if (tx.ToCoins > 0 || MarketRules.ReleasePart(fromDelta) < 0)
                await _store.ApplyWalletAsync(from, StepKey(tx, "from-credit"), tx.ToCoins, slotDelta: MarketRules.ReleasePart(fromDelta), ct: ct);
            tx.FromCredited = true;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.FromCredited, true), ct);
        }
        if (!tx.ToCredited)
        {
            if (tx.FromCoins > 0 || MarketRules.ReleasePart(toDelta) < 0)
                await _store.ApplyWalletAsync(to, StepKey(tx, "to-credit"), tx.FromCoins, slotDelta: MarketRules.ReleasePart(toDelta), ct: ct);
            tx.ToCredited = true;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.ToCredited, true), ct);
        }

        // Items that changed hands cannot stay equipped by their previous owner.
        foreach (var (itemId, owner) in tx.FromItemIds.Select(id => (id, from)).Concat(tx.ToItemIds.Select(id => (id, to))))
        {
            var item = await _store.Items.Find(i => i.Id == itemId).FirstOrDefaultAsync(ct);
            if (item is not null && _catalog.Current.Find(item.DefId) is { } def)
                await _store.UnequipItemAsync(owner, def.Category, itemId, ct);
        }

        var now = Now;
        await _store.Trades.UpdateOneAsync(t => t.Id == tx.OfferId && t.TxId == tx.Id,
            Builders<TradeOffer>.Update.Set(t => t.Status, TradeOfferStatus.Accepted).Set(t => t.RespondedAt, now).Set(t => t.UpdatedAt, now),
            cancellationToken: ct);
        await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.State, MarketTxStates.Done), ct);
        tx.State = MarketTxStates.Done;
        return null;
    }

    private async Task<string> RollbackTradeAsync(MarketTx tx, string reason, CancellationToken ct)
    {
        if (tx.Committed)
        {
            _logger.LogError("Market trade tx {TxId} cannot roll back after commit; resuming forward.", tx.Id);
            tx.State = MarketTxStates.Pending;
            return await AdvanceTradeAsync(tx, ct) ?? reason;
        }
        if (tx.State != MarketTxStates.RollingBack)
        {
            tx.State = MarketTxStates.RollingBack;
            tx.Error = reason;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.State, MarketTxStates.RollingBack).Set(t => t.Error, reason), ct);
        }
        var fromDelta = FromSlotDelta(tx);
        if (tx.FromDebited && !tx.FromRefunded)
        {
            if (tx.FromCoins > 0 || MarketRules.ReservePart(fromDelta) > 0)
                await _store.ApplyWalletAsync(tx.FromId!, StepKey(tx, "from-refund"), tx.FromCoins,
                    slotDelta: -MarketRules.ReservePart(fromDelta), ct: ct);
            tx.FromRefunded = true;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.FromRefunded, true), ct);
        }
        if (tx.ToDebited && !tx.ToRefunded)
        {
            if (tx.ToCoins > 0 || MarketRules.ReservePart(-fromDelta) > 0)
                await _store.ApplyWalletAsync(tx.ToId!, StepKey(tx, "to-refund"), tx.ToCoins,
                    slotDelta: -MarketRules.ReservePart(-fromDelta), ct: ct);
            tx.ToRefunded = true;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.ToRefunded, true), ct);
        }
        var lockKey = TxLock(tx.Id);
        await _store.Items.UpdateManyAsync(i => i.LockedBy == lockKey,
            Builders<MarketItem>.Update.Set(i => i.LockedBy, null), cancellationToken: ct);

        // Problems on the recipient's side keep the offer open so they can free a slot or top up and retry.
        var now = Now;
        var offerUpdate = MarketRules.IsRecipientSideFailure(reason)
            ? Builders<TradeOffer>.Update.Set(t => t.Status, TradeOfferStatus.Pending).Set(t => t.TxId, null).Set(t => t.UpdatedAt, now)
            : Builders<TradeOffer>.Update.Set(t => t.Status, TradeOfferStatus.Failed).Set(t => t.FailReason, reason)
                .Set(t => t.RespondedAt, now).Set(t => t.UpdatedAt, now);
        await _store.Trades.UpdateOneAsync(t => t.Id == tx.OfferId && t.Status == TradeOfferStatus.Accepting && t.TxId == tx.Id,
            offerUpdate, cancellationToken: ct);
        await FailTxAsync(tx, reason, ct);
        return reason;
    }
}
