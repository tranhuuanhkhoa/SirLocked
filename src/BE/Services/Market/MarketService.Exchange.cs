using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Market;

namespace SirLocked.Api.Services.Market;

/// <summary>Listings, buy orders and the BUY transaction that settles a sale.</summary>
public sealed partial class MarketService
{
    internal const string ListingLockPrefix = "listing:";
    internal const string TxLockPrefix = "tx:";
    internal const string ChestLockPrefix = "chest:";
    /// <summary>Item lock held while an exchange for XP burns the item. Released by <see cref="ProgressService"/>, never by the market sweep.</summary>
    internal const string XpLockPrefix = "xp:";

    internal static string ListingLock(string listingId) => ListingLockPrefix + listingId;
    internal static string TxLock(string txId) => TxLockPrefix + txId;
    internal static string OrderHoldKey(string orderId) => $"order:{orderId}:hold";
    internal static string OrderReleaseKey(string orderId) => $"order:{orderId}:release";
    private static string StepKey(MarketTx tx, string step) => $"tx:{tx.Id}:{step}";

    /// <summary>Result of one settlement attempt between a listing and a buyer.</summary>
    internal sealed record MatchOutcome(MarketSale? Sale, string? Error)
    {
        public static MatchOutcome Ok(MarketSale sale) => new(sale, null);
        public static MatchOutcome Fail(string error) => new(null, error);
    }

    // ------------------------------------------------------------------ listings

    public async Task<ListingResultDto> CreateListingAsync(CurrentUser user, string itemId, long price, CancellationToken ct = default)
    {
        if (MarketRules.ValidatePrice(price) is { } priceError)
            throw Error(400, priceError, $"Price must be between {MarketRules.MinPrice} and {MarketRules.MaxPrice} xu.");
        await RequireVerifiedAsync(user.Id, ct);
        await EnsureAccountAsync(user.Id, ct);
        var item = await _store.Items.Find(i => i.Id == itemId && i.OwnerId == user.Id).FirstOrDefaultAsync(ct)
            ?? throw Error(404, MarketErrors.ItemNotFound, "This item is not in your inventory.");
        if (item.LockedBy is not null)
            throw Error(409, MarketErrors.ItemLocked, "This item is already for sale or inside a trade.");
        var def = _catalog.Current.Find(item.DefId) ?? throw Error(409, MarketErrors.UnknownItemType, "Unknown item type.");
        if (!def.Tradable) throw ErrorFor(MarketErrors.ItemNotTradable);
        var open = await _store.Listings.CountDocumentsAsync(
            l => l.SellerId == user.Id && (l.Status == MarketListingStatus.Opening || l.Status == MarketListingStatus.Active
                                           || l.Status == MarketListingStatus.Pending), cancellationToken: ct);
        if (open >= MarketRules.MaxOpenListingsPerUser)
            throw Error(409, MarketErrors.TooManyListings, "You have too many items for sale.");

        var now = Now;
        var listing = new MarketListing
        {
            Id = MarketStore.NewId(),
            SellerId = user.Id,
            SellerName = user.FullName,
            ItemId = item.Id,
            DefId = def.Id,
            Price = price,
            Status = MarketListingStatus.Opening,
            CreatedAt = now,
            UpdatedAt = now
        };
        // Insert first, then lock the item under the listing's id: an interrupted listing is visible
        // (OPENING) and the recovery sweep cancels it and frees the item.
        await _store.Listings.InsertOneAsync(listing, cancellationToken: ct);
        if (!await _store.LockItemAsync(item.Id, user.Id, ListingLock(listing.Id), ct))
        {
            await CloseListingAsync(listing.Id, MarketListingStatus.Opening, MarketListingStatus.Cancelled, ct);
            throw Error(409, MarketErrors.ItemLocked, "This item is already for sale or inside a trade.");
        }
        await _store.UnequipItemAsync(user.Id, def.Category, item.Id, ct);
        await _store.Listings.UpdateOneAsync(
            l => l.Id == listing.Id && l.Status == MarketListingStatus.Opening,
            Builders<MarketListing>.Update.Set(l => l.Status, MarketListingStatus.Active).Set(l => l.UpdatedAt, Now),
            cancellationToken: ct);
        listing.Status = MarketListingStatus.Active;

        var sale = await MatchListingAsync(listing, ct);
        var fresh = await _store.Listings.Find(l => l.Id == listing.Id).FirstAsync(ct);
        return new ListingResultDto(ToListingDto(fresh), sale is null ? null : ToSaleDto(sale, user.Id), await WalletAsync(user.Id, ct));
    }

    public async Task<ListingDto> CancelListingAsync(string userId, string listingId, CancellationToken ct = default)
    {
        var listing = await _store.Listings.Find(l => l.Id == listingId && l.SellerId == userId).FirstOrDefaultAsync(ct)
            ?? throw Error(404, MarketErrors.ListingNotFound, "Listing not found.");
        var cancelled = await _store.Listings.UpdateOneAsync(
            l => l.Id == listingId && l.SellerId == userId && l.Status == MarketListingStatus.Active,
            Builders<MarketListing>.Update
                .Set(l => l.Status, MarketListingStatus.Cancelled)
                .Set(l => l.ClosedAt, Now)
                .Set(l => l.UpdatedAt, Now),
            cancellationToken: ct);
        if (cancelled.ModifiedCount == 0)
        {
            throw listing.Status == MarketListingStatus.Pending
                ? Error(409, MarketErrors.Busy, "Someone is buying this item right now.")
                : Error(409, MarketErrors.ListingUnavailable, "This listing is already closed.");
        }
        await _store.UnlockItemAsync(listing.ItemId, ListingLock(listing.Id), ct);
        var fresh = await _store.Listings.Find(l => l.Id == listingId).FirstAsync(ct);
        return ToListingDto(fresh);
    }

    private async Task CloseListingAsync(string listingId, string fromStatus, string toStatus, CancellationToken ct) =>
        await _store.Listings.UpdateOneAsync(
            l => l.Id == listingId && l.Status == fromStatus,
            Builders<MarketListing>.Update.Set(l => l.Status, toStatus).Set(l => l.ClosedAt, Now).Set(l => l.UpdatedAt, Now),
            cancellationToken: ct);

    /// <summary>A new or restored listing fills the best resting buy order at that order's price.</summary>
    private async Task<MarketSale?> MatchListingAsync(MarketListing listing, CancellationToken ct)
    {
        for (var round = 0; round < 3; round++)
        {
            var candidates = await _store.Orders
                .Find(o => o.DefId == listing.DefId && o.Status == MarketOrderStatus.Active
                           && o.Price >= listing.Price && o.BuyerId != listing.SellerId)
                .SortByDescending(o => o.Price).ThenBy(o => o.CreatedAt).Limit(5).ToListAsync(ct);
            var ordered = MarketRules.SelectBidsFor(listing, candidates);
            if (ordered.Count == 0) return null;
            foreach (var order in ordered)
            {
                var outcome = await ExecuteMatchAsync(listing, order, order.BuyerId, ct);
                if (outcome.Sale is not null) return outcome.Sale;
                if (outcome.Error != MarketErrors.OrderUnavailable) return null;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------ buying

    public async Task<PurchaseResultDto> BuyListingAsync(CurrentUser user, string listingId, CancellationToken ct = default)
    {
        var listing = await _store.Listings.Find(l => l.Id == listingId).FirstOrDefaultAsync(ct)
            ?? throw Error(404, MarketErrors.ListingNotFound, "Listing not found.");
        if (listing.SellerId == user.Id) throw Error(400, MarketErrors.CannotBuyOwn, "You cannot buy your own listing.");
        if (listing.Status != MarketListingStatus.Active) throw ErrorFor(MarketErrors.ListingUnavailable);
        await RequireVerifiedAsync(user.Id, ct);
        RequireCanBuy(await EnsureAccountAsync(user.Id, ct), listing.Price);
        var outcome = await ExecuteMatchAsync(listing, null, user.Id, ct);
        if (outcome.Sale is null) throw ErrorFor(outcome.Error ?? MarketErrors.ListingUnavailable);
        return new PurchaseResultDto(ToSaleDto(outcome.Sale, user.Id), await WalletAsync(user.Id, ct));
    }

    /// <summary>"MUA NGAY": buys the cheapest listing of a type, never above the price the buyer saw.</summary>
    public async Task<PurchaseResultDto> BuyLowestAsync(CurrentUser user, string defId, long maxPrice, CancellationToken ct = default)
    {
        var def = _catalog.Current.Find(defId) ?? throw Error(404, MarketErrors.UnknownItemType, "Unknown item type.");
        if (!def.Tradable) throw ErrorFor(MarketErrors.ItemNotTradable);
        if (MarketRules.ValidatePrice(maxPrice) is not null) throw ErrorFor(MarketErrors.NoListingAtPrice);
        await RequireVerifiedAsync(user.Id, ct);
        var account = await EnsureAccountAsync(user.Id, ct);
        for (var round = 0; round < 3; round++)
        {
            var candidates = await _store.Listings
                .Find(l => l.DefId == def.Id && l.Status == MarketListingStatus.Active && l.Price <= maxPrice && l.SellerId != user.Id)
                .SortBy(l => l.Price).ThenBy(l => l.CreatedAt).Limit(5).ToListAsync(ct);
            if (candidates.Count == 0) break;
            RequireCanBuy(account, candidates[0].Price);
            foreach (var listing in candidates)
            {
                var outcome = await ExecuteMatchAsync(listing, null, user.Id, ct);
                if (outcome.Sale is not null)
                    return new PurchaseResultDto(ToSaleDto(outcome.Sale, user.Id), await WalletAsync(user.Id, ct));
                if (outcome.Error != MarketErrors.ListingUnavailable) throw ErrorFor(outcome.Error!);
            }
        }
        throw ErrorFor(MarketErrors.NoListingAtPrice);
    }

    /// <summary>Cheap pre-check so a buyer who cannot pay never claims (and briefly blocks) a listing.</summary>
    private static void RequireCanBuy(MarketAccount account, long price)
    {
        if (account.Balance < price) throw ErrorFor(MarketErrors.InsufficientFunds);
        if (!MarketRules.HasRoom(account.Slots, 1)) throw ErrorFor(MarketErrors.InventoryFull);
    }

    // ------------------------------------------------------------------ buy orders

    public async Task<OrderResultDto> PlaceOrderAsync(CurrentUser user, string defId, long price, CancellationToken ct = default)
    {
        var def = _catalog.Current.Find(defId) ?? throw Error(404, MarketErrors.UnknownItemType, "Unknown item type.");
        if (!def.Tradable) throw ErrorFor(MarketErrors.ItemNotTradable);
        if (MarketRules.ValidatePrice(price) is { } priceError)
            throw Error(400, priceError, $"Price must be between {MarketRules.MinPrice} and {MarketRules.MaxPrice} xu.");
        await RequireVerifiedAsync(user.Id, ct);
        await EnsureAccountAsync(user.Id, ct);
        var open = await _store.Orders.CountDocumentsAsync(
            o => o.BuyerId == user.Id && (o.Status == MarketOrderStatus.Opening || o.Status == MarketOrderStatus.Active
                                          || o.Status == MarketOrderStatus.Pending), cancellationToken: ct);
        if (open >= MarketRules.MaxOpenOrdersPerUser)
            throw Error(409, MarketErrors.TooManyOrders, "You have too many open buy orders.");

        var now = Now;
        var order = new MarketBuyOrder
        {
            Id = MarketStore.NewId(),
            BuyerId = user.Id,
            BuyerName = user.FullName,
            DefId = def.Id,
            Price = price,
            Status = MarketOrderStatus.Opening,
            CreatedAt = now,
            UpdatedAt = now
        };
        await _store.Orders.InsertOneAsync(order, cancellationToken: ct);
        // Escrow: the coins move from Balance to Held and one slot is reserved for the item.
        var hold = await _store.ApplyWalletAsync(user.Id, OrderHoldKey(order.Id), -price, heldDelta: price, slotDelta: 1, ct: ct);
        if (hold == WalletWrite.Rejected)
        {
            await _store.Orders.UpdateOneAsync(o => o.Id == order.Id && o.Status == MarketOrderStatus.Opening,
                Builders<MarketBuyOrder>.Update.Set(o => o.Status, MarketOrderStatus.Cancelled)
                    .Set(o => o.Released, true).Set(o => o.ClosedAt, Now).Set(o => o.UpdatedAt, Now), cancellationToken: ct);
            var account = await _store.FindAccountAsync(user.Id, ct);
            throw ErrorFor(account is not null && account.Balance < price ? MarketErrors.InsufficientFunds : MarketErrors.InventoryFull);
        }
        await _store.Orders.UpdateOneAsync(o => o.Id == order.Id && o.Status == MarketOrderStatus.Opening,
            Builders<MarketBuyOrder>.Update.Set(o => o.Status, MarketOrderStatus.Active).Set(o => o.Held, true).Set(o => o.UpdatedAt, Now),
            cancellationToken: ct);
        order.Status = MarketOrderStatus.Active;
        order.Held = true;

        var sale = await MatchOrderAsync(order, ct);
        var fresh = await _store.Orders.Find(o => o.Id == order.Id).FirstAsync(ct);
        return new OrderResultDto(ToOrderDto(fresh), sale is null ? null : ToSaleDto(sale, user.Id), await WalletAsync(user.Id, ct));
    }

    /// <summary>A new buy order takes the cheapest resting listing at that listing's price (change goes back).</summary>
    private async Task<MarketSale?> MatchOrderAsync(MarketBuyOrder order, CancellationToken ct)
    {
        for (var round = 0; round < 3; round++)
        {
            var candidates = await _store.Listings
                .Find(l => l.DefId == order.DefId && l.Status == MarketListingStatus.Active
                           && l.Price <= order.Price && l.SellerId != order.BuyerId)
                .SortBy(l => l.Price).ThenBy(l => l.CreatedAt).Limit(5).ToListAsync(ct);
            var ordered = MarketRules.SelectAsksFor(order, candidates);
            if (ordered.Count == 0) return null;
            foreach (var listing in ordered)
            {
                var outcome = await ExecuteMatchAsync(listing, order, order.BuyerId, ct);
                if (outcome.Sale is not null) return outcome.Sale;
                if (outcome.Error != MarketErrors.ListingUnavailable) return null;
            }
        }
        return null;
    }

    public async Task<OrderDto> CancelOrderAsync(string userId, string orderId, CancellationToken ct = default)
    {
        var order = await _store.Orders.Find(o => o.Id == orderId && o.BuyerId == userId).FirstOrDefaultAsync(ct)
            ?? throw Error(404, MarketErrors.OrderNotFound, "Buy order not found.");
        var cancelled = await _store.Orders.UpdateOneAsync(
            o => o.Id == orderId && o.BuyerId == userId && o.Status == MarketOrderStatus.Active,
            Builders<MarketBuyOrder>.Update.Set(o => o.Status, MarketOrderStatus.Cancelled)
                .Set(o => o.ClosedAt, Now).Set(o => o.UpdatedAt, Now),
            cancellationToken: ct);
        if (cancelled.ModifiedCount == 0)
        {
            throw order.Status == MarketOrderStatus.Pending
                ? Error(409, MarketErrors.Busy, "This buy order is being filled right now.")
                : ErrorFor(MarketErrors.OrderUnavailable);
        }
        await ReleaseOrderAsync(order, ct);
        return ToOrderDto(await _store.Orders.Find(o => o.Id == orderId).FirstAsync(ct));
    }

    /// <summary>Returns a cancelled order's escrow (coins + reserved slot). Idempotent via its operation key.</summary>
    private async Task ReleaseOrderAsync(MarketBuyOrder order, CancellationToken ct)
    {
        if (order.Held)
            await _store.ApplyWalletAsync(order.BuyerId, OrderReleaseKey(order.Id), order.Price, heldDelta: -order.Price, slotDelta: -1, ct: ct);
        await _store.Orders.UpdateOneAsync(o => o.Id == order.Id,
            Builders<MarketBuyOrder>.Update.Set(o => o.Released, true).Set(o => o.UpdatedAt, Now), cancellationToken: ct);
    }

    // ------------------------------------------------------------------ BUY transaction

    /// <summary>
    /// Settles one listing with one buyer: either buy-now (paid from the balance) or a buy order
    /// (paid from its held coins). The trade price is the listing price for buy-now and the resting
    /// side's price for an order match.
    /// </summary>
    internal async Task<MatchOutcome> ExecuteMatchAsync(MarketListing listing, MarketBuyOrder? order, string buyerId, CancellationToken ct)
    {
        if (listing.SellerId == buyerId) return MatchOutcome.Fail(MarketErrors.CannotBuyOwn);
        var price = order is null
            ? listing.Price
            : MarketRules.MatchPrice(listing.Price, listing.CreatedAt, order.Price, order.CreatedAt);
        var now = Now;
        var tx = new MarketTx
        {
            Id = MarketStore.NewId(),
            Kind = MarketTxKinds.Buy,
            State = MarketTxStates.Pending,
            BuyerId = buyerId,
            SellerId = listing.SellerId,
            ListingId = listing.Id,
            OrderId = order?.Id,
            ItemId = listing.ItemId,
            DefId = listing.DefId,
            Price = price,
            Fee = MarketRules.Fee(price),
            Reserved = order?.Price ?? price,
            CreatedAt = now,
            UpdatedAt = now
        };
        await _store.Txs.InsertOneAsync(tx, cancellationToken: ct);
        return await AdvanceBuyAsync(tx, CancellationToken.None);
    }

    /// <summary>Runs (or resumes) a BUY transaction. Every step is idempotent; see MarketTx.</summary>
    internal async Task<MatchOutcome> AdvanceBuyAsync(MarketTx tx, CancellationToken ct)
    {
        switch (tx.State)
        {
            case MarketTxStates.Done:
                return MatchOutcome.Ok(await _store.Sales.Find(s => s.Id == tx.Id).FirstAsync(ct));
            case MarketTxStates.Failed:
                return MatchOutcome.Fail(tx.Error ?? MarketErrors.ListingUnavailable);
            case MarketTxStates.RollingBack:
                return await RollbackBuyAsync(tx, tx.Error ?? MarketErrors.ListingUnavailable, cancelListing: false, ct);
        }

        var buyer = tx.BuyerId!;
        var seller = tx.SellerId!;
        if (!tx.Committed)
        {
            // 1. Claim the listing first: only one transaction can, and the losers fail fast without
            //    touching any wallet.
            var listingClaim = await _store.Listings.UpdateOneAsync(
                l => l.Id == tx.ListingId && l.SellerId == seller && l.SellerId != buyer
                     && (l.Status == MarketListingStatus.Active || (l.Status == MarketListingStatus.Pending && l.TxId == tx.Id)),
                Builders<MarketListing>.Update.Set(l => l.Status, MarketListingStatus.Pending)
                    .Set(l => l.TxId, tx.Id).Set(l => l.BuyerId, buyer).Set(l => l.UpdatedAt, Now),
                cancellationToken: ct);
            if (listingClaim.MatchedCount == 0)
            {
                if (tx.Funded) return await RollbackBuyAsync(tx, MarketErrors.ListingUnavailable, cancelListing: false, ct);
                await FailTxAsync(tx, MarketErrors.ListingUnavailable, ct);
                return MatchOutcome.Fail(MarketErrors.ListingUnavailable);
            }

            // 2. Fund the purchase: buy-now debits the balance and reserves a slot (guarded so the balance
            //    never goes negative and the bag never overflows); a buy order spends its held coins.
            if (!tx.Funded)
            {
                if (tx.OrderId is null)
                {
                    var debit = await _store.ApplyWalletAsync(buyer, StepKey(tx, "debit"), -tx.Price, slotDelta: 1, ct: ct);
                    if (debit == WalletWrite.Rejected)
                        return await RollbackBuyAsync(tx, await DebitFailureAsync(buyer, tx.Price, ct), cancelListing: false, ct);
                }
                else
                {
                    var claimed = await _store.Orders.UpdateOneAsync(
                        o => o.Id == tx.OrderId && o.BuyerId == buyer
                             && (o.Status == MarketOrderStatus.Active || (o.Status == MarketOrderStatus.Pending && o.TxId == tx.Id)),
                        Builders<MarketBuyOrder>.Update.Set(o => o.Status, MarketOrderStatus.Pending).Set(o => o.TxId, tx.Id).Set(o => o.UpdatedAt, Now),
                        cancellationToken: ct);
                    if (claimed.MatchedCount == 0)
                        return await RollbackBuyAsync(tx, MarketErrors.OrderUnavailable, cancelListing: false, ct);
                    // The order's slot is already reserved; only the held coins are spent.
                    var spend = await _store.ApplyWalletAsync(buyer, StepKey(tx, "debit"), 0, heldDelta: -tx.Reserved, ct: ct);
                    if (spend == WalletWrite.Rejected)
                    {
                        _logger.LogError("Market tx {TxId}: buy order {OrderId} holds fewer coins than its price.", tx.Id, tx.OrderId);
                        return await RollbackBuyAsync(tx, MarketErrors.OrderUnavailable, cancelListing: false, ct);
                    }
                }
                tx.Funded = true;
                await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.Funded, true), ct);
            }

            // 3. Move the item (it is locked by the listing, so nobody else can move it).
            if (!await _store.MoveItemAsync(tx.ItemId!, seller, buyer, ListingLock(tx.ListingId!), tx.Id, MarketItemSources.Market, ct))
            {
                _logger.LogError("Market tx {TxId}: listing {ListingId} does not hold item {ItemId}; listing withdrawn.",
                    tx.Id, tx.ListingId, tx.ItemId);
                return await RollbackBuyAsync(tx, MarketErrors.ListingUnavailable, cancelListing: true, ct);
            }

            // Point of no return: from here the transaction only rolls forward.
            tx.Committed = true;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.Committed, true), ct);
        }

        // 4. Pay the seller (price − 5% fee) and release the slot the item used.
        if (!tx.SellerPaid)
        {
            await _store.ApplyWalletAsync(seller, StepKey(tx, "credit"), tx.Price - tx.Fee, slotDelta: -1, ct: ct);
            tx.SellerPaid = true;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.SellerPaid, true), ct);
        }
        // 5. A buy order that paid less than it held gets the difference back.
        if (tx.OrderId is not null && tx.Reserved > tx.Price && !tx.ChangeReturned)
        {
            await _store.ApplyWalletAsync(buyer, StepKey(tx, "change"), tx.Reserved - tx.Price, ct: ct);
            tx.ChangeReturned = true;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.ChangeReturned, true), ct);
        }

        // 6. Record the sale (keyed by the tx id) and close the listing / order.
        var sale = new MarketSale
        {
            Id = tx.Id,
            DefId = tx.DefId!,
            ItemId = tx.ItemId!,
            Price = tx.Price,
            Fee = tx.Fee,
            SellerId = seller,
            BuyerId = buyer,
            ListingId = tx.ListingId!,
            OrderId = tx.OrderId,
            At = Now
        };
        try
        {
            await _store.Sales.InsertOneAsync(sale, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            sale = await _store.Sales.Find(s => s.Id == tx.Id).FirstAsync(ct);
        }
        await _store.Listings.UpdateOneAsync(l => l.Id == tx.ListingId && l.TxId == tx.Id,
            Builders<MarketListing>.Update.Set(l => l.Status, MarketListingStatus.Sold).Set(l => l.SoldPrice, tx.Price)
                .Set(l => l.ClosedAt, Now).Set(l => l.UpdatedAt, Now), cancellationToken: ct);
        if (tx.OrderId is not null)
        {
            await _store.Orders.UpdateOneAsync(o => o.Id == tx.OrderId && o.TxId == tx.Id,
                Builders<MarketBuyOrder>.Update.Set(o => o.Status, MarketOrderStatus.Filled).Set(o => o.ItemId, tx.ItemId)
                    .Set(o => o.FilledPrice, tx.Price).Set(o => o.ClosedAt, Now).Set(o => o.UpdatedAt, Now), cancellationToken: ct);
        }
        await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.State, MarketTxStates.Done), ct);
        tx.State = MarketTxStates.Done;
        return MatchOutcome.Ok(sale);
    }

    private async Task<MatchOutcome> RollbackBuyAsync(MarketTx tx, string reason, bool cancelListing, CancellationToken ct)
    {
        if (tx.Committed)
        {
            _logger.LogError("Market tx {TxId} cannot roll back after commit; resuming forward.", tx.Id);
            tx.State = MarketTxStates.Pending;
            return await AdvanceBuyAsync(tx, ct);
        }
        if (tx.State != MarketTxStates.RollingBack)
        {
            tx.State = MarketTxStates.RollingBack;
            tx.Error = reason;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update
                .Set(t => t.State, MarketTxStates.RollingBack).Set(t => t.Error, reason), ct);
        }
        var buyer = tx.BuyerId!;
        if (tx.Funded && !tx.Refunded)
        {
            if (tx.OrderId is null)
                await _store.ApplyWalletAsync(buyer, StepKey(tx, "refund"), tx.Price, slotDelta: -1, ct: ct);
            else
                await _store.ApplyWalletAsync(buyer, StepKey(tx, "refund"), 0, heldDelta: tx.Reserved, ct: ct);
            tx.Refunded = true;
            await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.Refunded, true), ct);
        }
        if (tx.OrderId is not null)
        {
            await _store.Orders.UpdateOneAsync(
                o => o.Id == tx.OrderId && o.Status == MarketOrderStatus.Pending && o.TxId == tx.Id,
                Builders<MarketBuyOrder>.Update.Set(o => o.Status, MarketOrderStatus.Active).Set(o => o.TxId, null).Set(o => o.UpdatedAt, Now),
                cancellationToken: ct);
        }
        var listingUpdate = Builders<MarketListing>.Update.Set(l => l.TxId, null).Set(l => l.BuyerId, null).Set(l => l.UpdatedAt, Now);
        listingUpdate = cancelListing
            ? listingUpdate.Set(l => l.Status, MarketListingStatus.Cancelled).Set(l => l.ClosedAt, Now)
            : listingUpdate.Set(l => l.Status, MarketListingStatus.Active);
        await _store.Listings.UpdateOneAsync(
            l => l.Id == tx.ListingId && l.Status == MarketListingStatus.Pending && l.TxId == tx.Id, listingUpdate, cancellationToken: ct);
        if (cancelListing) await _store.UnlockItemAsync(tx.ItemId!, ListingLock(tx.ListingId!), ct);
        await FailTxAsync(tx, reason, ct);
        return MatchOutcome.Fail(reason);
    }

    /// <summary>Why a guarded debit was refused: not enough coins, a full bag, or a concurrent change.</summary>
    private async Task<string> DebitFailureAsync(string userId, long amount, CancellationToken ct)
    {
        var account = await _store.FindAccountAsync(userId, ct);
        if (account is null || account.Balance < amount) return MarketErrors.InsufficientFunds;
        if (!MarketRules.HasRoom(account.Slots, 1)) return MarketErrors.InventoryFull;
        return MarketErrors.Busy;
    }

    private async Task FailTxAsync(MarketTx tx, string reason, CancellationToken ct)
    {
        tx.State = MarketTxStates.Failed;
        tx.Error = reason;
        await _store.TouchTxAsync(tx.Id, Builders<MarketTx>.Update.Set(t => t.State, MarketTxStates.Failed).Set(t => t.Error, reason), ct);
    }
}
