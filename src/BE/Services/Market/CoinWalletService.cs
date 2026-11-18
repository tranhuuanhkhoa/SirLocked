using MongoDB.Driver;
using SirLocked.Api.Models.Market;

namespace SirLocked.Api.Services.Market;

/// <summary>What one journaled wallet operation did.</summary>
public readonly record struct CoinWalletResult(
    WalletWrite Write,
    long BalanceDelta,
    long BonusDelta,
    long HeldDelta,
    long BonusHeldDelta)
{
    public bool Succeeded => Write != WalletWrite.Rejected;
    public static CoinWalletResult Rejected => new(WalletWrite.Rejected, 0, 0, 0, 0);
}

/// <summary>
/// The two-coin wallet of VUAN-7: ordinary coins (<see cref="MarketAccount.Balance"/>, "xu nạp") and bonus coins
/// (<see cref="MarketAccount.BonusBalance"/>, "xu thưởng"). Every operation:
/// <list type="bullet">
/// <item>is one atomic single-document update guarded so no balance goes negative;</item>
/// <item>is idempotent by its operation key (the wallet's <c>Ops</c> window and the ledger entry with that id);</item>
/// <item>is written to the ledger (<c>walletLedger</c>): PENDING before the wallet changes, APPLIED or REJECTED after.</item>
/// </list>
/// Standalone MongoDB has no multi-document transactions; a crash between the wallet write and the ledger update leaves
/// a PENDING entry that the next replay of the same key completes.
/// </summary>
public sealed class CoinWalletService(MarketStore store, MarketService market, ILogger<CoinWalletService> logger)
{
    /// <summary>Gives bonus coins (author revenue share, author tier bonus).</summary>
    public Task<CoinWalletResult> CreditBonusAsync(
        string userId, string opKey, long amount, string kind, string refId, string? note = null, CancellationToken ct = default)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount), "A bonus credit must be positive.");
        return JournalExactAsync(userId, opKey, kind, refId, note, new Deltas(0, amount, 0, 0), ct);
    }

    /// <summary>Spends at a system sink (hint, chest, shop cosmetic): bonus coins first, then ordinary coins.</summary>
    public async Task<CoinWalletResult> SpendPreferBonusAsync(
        string userId, string opKey, long amount, string kind, string refId, string? note = null, CancellationToken ct = default)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount), "A spend must be positive.");
        var known = await BeginAsync(userId, opKey, kind, refId, note, ct);
        if (known is { } done) return done;
        await market.EnsureAccountAsync(userId, ct);
        var spend = await store.SpendPreferBonusAsync(userId, opKey, amount, ct: ct);
        if (spend.Write == WalletWrite.AlreadyApplied)
        {
            // Another call with the same key applied it and is about to record its split: wait for that record
            // instead of guessing. Only a call that died in between leaves the entry PENDING for good.
            for (var wait = 0; wait < 40; wait++)
            {
                var entry = await FindEntryAsync(opKey, ct);
                if (entry?.State == WalletLedgerStates.Applied)
                    return new CoinWalletResult(WalletWrite.AlreadyApplied,
                        entry.BalanceDelta, entry.BonusDelta, entry.HeldDelta, entry.BonusHeldDelta);
                await Task.Delay(25, ct);
            }
        }
        var deltas = spend.Write == WalletWrite.Applied
            ? new Deltas(-spend.FromBalance, -spend.FromBonus, 0, 0)
            // A replay after a crash: the split was decided by the lost call. Record the total against the balance.
            : new Deltas(-amount, 0, 0, 0);
        return await FinishAsync(opKey, spend.Write, deltas,
            spend.Write == WalletWrite.AlreadyApplied ? "split unknown: applied before the ledger was updated" : null, ct);
    }

    /// <summary>
    /// Escrows a VIP case order: <paramref name="fromBalance"/> ordinary coins move to <c>Held</c> and
    /// <paramref name="fromBonus"/> bonus coins to <c>BonusHeld</c>. The parts are decided by the caller before the
    /// write and stored on the order, so a refund always knows where the coins came from.
    /// </summary>
    public Task<CoinWalletResult> HoldAsync(
        string userId, string opKey, long fromBalance, long fromBonus, string kind, string refId, CancellationToken ct = default)
    {
        if (fromBalance < 0 || fromBonus < 0 || fromBalance + fromBonus <= 0)
            throw new ArgumentOutOfRangeException(nameof(fromBalance), "A hold must take a positive amount.");
        return JournalExactAsync(userId, opKey, kind, refId, null,
            new Deltas(-fromBalance, -fromBonus, fromBalance, fromBonus), ct);
    }

    /// <summary>
    /// Ends (part of) an escrow: <paramref name="heldBalance"/> and <paramref name="heldBonus"/> leave the escrow;
    /// <paramref name="refundBalance"/> and <paramref name="refundBonus"/> of them go back to the spendable balances and
    /// the rest is spent. Refunds can never exceed what leaves the escrow.
    /// </summary>
    public Task<CoinWalletResult> SettleHoldAsync(
        string userId, string opKey, long heldBalance, long heldBonus, long refundBalance, long refundBonus,
        string kind, string refId, string? note = null, CancellationToken ct = default)
    {
        if (heldBalance < 0 || heldBonus < 0 || refundBalance < 0 || refundBonus < 0
            || refundBalance > heldBalance || refundBonus > heldBonus)
            throw new ArgumentOutOfRangeException(nameof(refundBalance), "A settlement must stay within the escrow.");
        return JournalExactAsync(userId, opKey, kind, refId, note,
            new Deltas(refundBalance, refundBonus, -heldBalance, -heldBonus), ct);
    }

    /// <summary>Takes back bonus coins (an admin revoking an author payout). Never touches ordinary coins.</summary>
    public Task<CoinWalletResult> DebitBonusAsync(
        string userId, string opKey, long amount, string kind, string refId, string? note = null, CancellationToken ct = default)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount), "A bonus debit must be positive.");
        return JournalExactAsync(userId, opKey, kind, refId, note, new Deltas(0, -amount, 0, 0), ct);
    }

    public Task<WalletLedgerEntry?> FindEntryAsync(string opKey, CancellationToken ct = default) =>
        store.WalletLedger.Find(entry => entry.Id == opKey).FirstOrDefaultAsync(ct)!;

    // ------------------------------------------------------------------ journal

    private readonly record struct Deltas(long Balance, long Bonus, long Held, long BonusHeld);

    private async Task<CoinWalletResult> JournalExactAsync(
        string userId, string opKey, string kind, string refId, string? note, Deltas deltas, CancellationToken ct)
    {
        var known = await BeginAsync(userId, opKey, kind, refId, note, ct);
        if (known is { } done) return done;
        await market.EnsureAccountAsync(userId, ct);
        var write = await store.ApplyWalletAsync(userId, opKey, deltas.Balance, heldDelta: deltas.Held, ct: ct,
            bonusDelta: deltas.Bonus, bonusHeldDelta: deltas.BonusHeld);
        return await FinishAsync(opKey, write, deltas, null, ct);
    }

    /// <summary>Returns the stored result when the key was applied before; otherwise makes sure a PENDING entry exists.</summary>
    private async Task<CoinWalletResult?> BeginAsync(
        string userId, string opKey, string kind, string refId, string? note, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(userId)) throw new ArgumentException("A wallet operation needs a user.", nameof(userId));
        if (string.IsNullOrWhiteSpace(opKey)) throw new ArgumentException("A wallet operation needs a key.", nameof(opKey));
        var now = store.Now;
        var existing = await store.WalletLedger.FindOneAndUpdateAsync(
            Builders<WalletLedgerEntry>.Filter.Eq(entry => entry.Id, opKey),
            Builders<WalletLedgerEntry>.Update
                .SetOnInsert(entry => entry.UserId, userId)
                .SetOnInsert(entry => entry.Kind, kind)
                .SetOnInsert(entry => entry.RefId, refId)
                .SetOnInsert(entry => entry.State, WalletLedgerStates.Pending)
                .SetOnInsert(entry => entry.Note, note)
                .SetOnInsert(entry => entry.CreatedAt, now)
                .SetOnInsert(entry => entry.UpdatedAt, now),
            new FindOneAndUpdateOptions<WalletLedgerEntry> { IsUpsert = true, ReturnDocument = ReturnDocument.After },
            ct);
        if (!string.Equals(existing.UserId, userId, StringComparison.Ordinal))
            throw new InvalidOperationException($"Wallet operation key {opKey} belongs to another user.");
        if (existing.State == WalletLedgerStates.Applied)
            return new CoinWalletResult(WalletWrite.AlreadyApplied,
                existing.BalanceDelta, existing.BonusDelta, existing.HeldDelta, existing.BonusHeldDelta);
        return null;
    }

    private async Task<CoinWalletResult> FinishAsync(string opKey, WalletWrite write, Deltas deltas, string? note, CancellationToken ct)
    {
        var update = Builders<WalletLedgerEntry>.Update.Set(entry => entry.UpdatedAt, store.Now);
        if (write == WalletWrite.Rejected)
        {
            await store.WalletLedger.UpdateOneAsync(
                entry => entry.Id == opKey && entry.State != WalletLedgerStates.Applied,
                update.Set(entry => entry.State, WalletLedgerStates.Rejected), cancellationToken: ct);
            return CoinWalletResult.Rejected;
        }
        update = update
            .Set(entry => entry.State, WalletLedgerStates.Applied)
            .Set(entry => entry.BalanceDelta, deltas.Balance)
            .Set(entry => entry.BonusDelta, deltas.Bonus)
            .Set(entry => entry.HeldDelta, deltas.Held)
            .Set(entry => entry.BonusHeldDelta, deltas.BonusHeld);
        if (note is not null)
        {
            update = update.Set(entry => entry.Note, note);
            logger.LogWarning("Wallet operation {OpKey}: {Note}.", opKey, note);
        }
        await store.WalletLedger.UpdateOneAsync(
            entry => entry.Id == opKey && entry.State != WalletLedgerStates.Applied, update, cancellationToken: ct);
        return new CoinWalletResult(write, deltas.Balance, deltas.Bonus, deltas.Held, deltas.BonusHeld);
    }
}
