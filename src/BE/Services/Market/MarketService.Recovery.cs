using MongoDB.Driver;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Market;

namespace SirLocked.Api.Services.Market;

public sealed record MarketRecoveryReport(
    int Transactions,
    int Listings,
    int Orders,
    int Locks,
    int Rewards,
    int StarterGrants,
    int Matches)
{
    public int Total => Transactions + Listings + Orders + Locks + Rewards + StarterGrants + Matches;
}

/// <summary>
/// Crash recovery. A request can die between two of its single-document writes; this sweep finds
/// work older than <c>staleAfter</c> and finishes it: journaled transactions are replayed (forward after
/// their commit point, backward before it), half-open listings/orders are withdrawn, orphaned locks and
/// escrow are released, and missed game rewards are paid.
/// </summary>
public sealed partial class MarketService
{
    public async Task<MarketRecoveryReport> RecoverAsync(TimeSpan staleAfter, CancellationToken ct = default)
    {
        var cutoff = Now - staleAfter;
        var transactions = await RecoverTransactionsAsync(cutoff, ct);
        var listings = await RecoverOpeningListingsAsync(cutoff, ct);
        var orders = await RecoverOrdersAsync(cutoff, ct);
        var locks = await RecoverLocksAsync(ct);
        var rewards = await RecoverRewardsAsync(cutoff, ct);
        var starters = await RecoverStarterGrantsAsync(cutoff, ct);
        var matches = await MatchCrossedBooksAsync(ct);
        return new MarketRecoveryReport(transactions, listings, orders, locks, rewards, starters, matches);
    }

    private async Task<int> RecoverTransactionsAsync(DateTime cutoff, CancellationToken ct)
    {
        var stale = await _store.Txs
            .Find(t => (t.State == MarketTxStates.Pending || t.State == MarketTxStates.RollingBack) && t.UpdatedAt < cutoff)
            .SortBy(t => t.UpdatedAt).Limit(50).ToListAsync(ct);
        var done = 0;
        foreach (var tx in stale)
        {
            // Lease: only one sweeper resumes a transaction.
            var leased = await _store.Txs.UpdateOneAsync(t => t.Id == tx.Id && t.UpdatedAt == tx.UpdatedAt,
                Builders<MarketTx>.Update.Set(t => t.UpdatedAt, Now), cancellationToken: ct);
            if (leased.ModifiedCount == 0) continue;
            try
            {
                if (tx.Kind == MarketTxKinds.Trade) await AdvanceTradeAsync(tx, ct);
                else await AdvanceBuyAsync(tx, ct);
                done++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogError(exception, "Market recovery could not resume tx {TxId}.", tx.Id);
            }
        }
        return done;
    }

    private async Task<int> RecoverOpeningListingsAsync(DateTime cutoff, CancellationToken ct)
    {
        var stale = await _store.Listings
            .Find(l => l.Status == MarketListingStatus.Opening && l.UpdatedAt < cutoff).Limit(100).ToListAsync(ct);
        var done = 0;
        foreach (var listing in stale)
        {
            var cancelled = await _store.Listings.UpdateOneAsync(
                l => l.Id == listing.Id && l.Status == MarketListingStatus.Opening,
                Builders<MarketListing>.Update.Set(l => l.Status, MarketListingStatus.Cancelled)
                    .Set(l => l.ClosedAt, Now).Set(l => l.UpdatedAt, Now), cancellationToken: ct);
            if (cancelled.ModifiedCount == 0) continue;
            await _store.UnlockItemAsync(listing.ItemId, ListingLock(listing.Id), ct);
            done++;
        }
        return done;
    }

    private async Task<int> RecoverOrdersAsync(DateTime cutoff, CancellationToken ct)
    {
        var done = 0;
        var opening = await _store.Orders
            .Find(o => o.Status == MarketOrderStatus.Opening && o.UpdatedAt < cutoff).Limit(100).ToListAsync(ct);
        foreach (var order in opening)
        {
            var cancelled = await _store.Orders.UpdateOneAsync(
                o => o.Id == order.Id && o.Status == MarketOrderStatus.Opening,
                Builders<MarketBuyOrder>.Update.Set(o => o.Status, MarketOrderStatus.Cancelled)
                    .Set(o => o.ClosedAt, Now).Set(o => o.UpdatedAt, Now), cancellationToken: ct);
            if (cancelled.ModifiedCount == 0) continue;
            // The escrow may or may not have been taken before the crash; the hold key says which.
            var holdKey = OrderHoldKey(order.Id);
            order.Held = await _store.Accounts.CountDocumentsAsync(
                Builders<MarketAccount>.Filter.Eq(a => a.Id, order.BuyerId) & Builders<MarketAccount>.Filter.AnyEq(a => a.Ops, holdKey),
                cancellationToken: ct) > 0;
            if (order.Held)
                await _store.Orders.UpdateOneAsync(o => o.Id == order.Id,
                    Builders<MarketBuyOrder>.Update.Set(o => o.Held, true), cancellationToken: ct);
            await ReleaseOrderAsync(order, ct);
            done++;
        }

        var unreleased = await _store.Orders
            .Find(o => o.Status == MarketOrderStatus.Cancelled && o.Held && !o.Released && o.UpdatedAt < cutoff)
            .Limit(100).ToListAsync(ct);
        foreach (var order in unreleased)
        {
            await ReleaseOrderAsync(order, ct);
            done++;
        }
        return done;
    }

    private async Task<int> RecoverLocksAsync(CancellationToken ct)
    {
        var locked = await _store.Items.Find(i => i.LockedBy != null).Limit(500).ToListAsync(ct);
        if (locked.Count == 0) return 0;
        var listingIds = locked.Where(i => i.LockedBy!.StartsWith(ListingLockPrefix, StringComparison.Ordinal))
            .Select(i => i.LockedBy![ListingLockPrefix.Length..]).Distinct().ToList();
        var txIds = locked.Where(i => i.LockedBy!.StartsWith(TxLockPrefix, StringComparison.Ordinal))
            .Select(i => i.LockedBy![TxLockPrefix.Length..]).Distinct().ToList();
        var listings = (await _store.Listings.Find(l => listingIds.Contains(l.Id)).ToListAsync(ct)).ToDictionary(l => l.Id);
        var txs = (await _store.Txs.Find(t => txIds.Contains(t.Id)).ToListAsync(ct)).ToDictionary(t => t.Id);
        var done = 0;
        foreach (var item in locked)
        {
            var key = item.LockedBy!;
            var orphan = key.StartsWith(ListingLockPrefix, StringComparison.Ordinal)
                ? !listings.TryGetValue(key[ListingLockPrefix.Length..], out var listing) || listing.Status == MarketListingStatus.Cancelled
                : key.StartsWith(TxLockPrefix, StringComparison.Ordinal)
                  && (!txs.TryGetValue(key[TxLockPrefix.Length..], out var tx) || tx.State is MarketTxStates.Failed or MarketTxStates.Done);
            if (!orphan) continue;
            await _store.UnlockItemAsync(item.Id, key, ct);
            done++;
        }
        return done;
    }

    private async Task<int> RecoverRewardsAsync(DateTime cutoff, CancellationToken ct)
    {
        var done = 0;
        var unapplied = await _store.Rewards.Find(r => !r.Applied && r.CreatedAt < cutoff).Limit(200).ToListAsync(ct);
        foreach (var reward in unapplied)
        {
            await ApplyRewardAsync(reward, ct);
            done++;
        }

        // Results whose reward hook never ran (e.g. the process died right after persisting the result).
        var since = Now.AddHours(-48);
        var results = await _store.Context.GameResults
            .Find(r => r.CreatedAt >= since && r.CreatedAt < cutoff)
            .Project(r => new GameResult { RoomId = r.RoomId, Players = r.Players, Success = r.Success })
            .Limit(500).ToListAsync(ct);
        if (results.Count == 0) return done;
        var expected = results.SelectMany(r => r.Players.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => RewardId(r.RoomId, p)))
            .Distinct().ToList();
        var existing = (await _store.Rewards.Find(r => expected.Contains(r.Id)).Project(r => r.Id).ToListAsync(ct)).ToHashSet();
        foreach (var result in results.Where(r => r.Players.Any(p => !string.IsNullOrWhiteSpace(p) && !existing.Contains(RewardId(r.RoomId, p)))))
        {
            await GrantGameRewardsAsync(result, ct);
            done++;
        }
        return done;
    }

    private async Task<int> RecoverStarterGrantsAsync(DateTime cutoff, CancellationToken ct)
    {
        var pending = await _store.Accounts.Find(a => !a.StarterItemsIssued && a.CreatedAt < cutoff).Limit(100).ToListAsync(ct);
        foreach (var account in pending) await IssueStarterItemsAsync(account, ct);
        return pending.Count;
    }

    /// <summary>Settles any lowest ask that is at or below the highest bid (left crossed by a rolled-back match).</summary>
    private async Task<int> MatchCrossedBooksAsync(CancellationToken ct)
    {
        var ids = _catalog.Current.All.Select(def => def.Id).ToList();
        var books = await LoadBooksAsync(ids, ct);
        var matches = 0;
        foreach (var (defId, book) in books)
        {
            if (book.LowestAsk is not { } ask || book.HighestBid is not { } bid || !MarketRules.Crosses(ask, bid)) continue;
            var orders = await _store.Orders
                .Find(o => o.DefId == defId && o.Status == MarketOrderStatus.Active && o.Price >= ask)
                .SortByDescending(o => o.Price).ThenBy(o => o.CreatedAt).Limit(5).ToListAsync(ct);
            foreach (var order in orders)
            {
                if (await MatchOrderAsync(order, ct) is not null) matches++;
            }
        }
        return matches;
    }
}
