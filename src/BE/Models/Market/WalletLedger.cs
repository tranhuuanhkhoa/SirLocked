using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models.Market;

/// <summary>
/// "Sổ ghi" of the two-coin wallet (VUAN-7): one entry per operation, keyed by the operation key, so an operation is
/// recorded once however often it is replayed. Written PENDING before the wallet changes and APPLIED (with the deltas
/// that really happened) after; the wallet write itself stays deduplicated by <see cref="MarketAccount.Ops"/>.
/// </summary>
[BsonIgnoreExtraElements]
public class WalletLedgerEntry
{
    /// <summary>The operation key, e.g. <c>vip-hold:&lt;draftId&gt;</c>.</summary>
    [BsonId] public string Id { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    /// <summary><see cref="WalletLedgerKinds"/>.</summary>
    public string Kind { get; set; } = string.Empty;
    /// <summary>What the operation belongs to: a draft id, a room id, a payout id…</summary>
    public string RefId { get; set; } = string.Empty;
    public string State { get; set; } = WalletLedgerStates.Pending;
    /// <summary>Change of the ordinary balance ("xu nạp").</summary>
    public long BalanceDelta { get; set; }
    public long BonusDelta { get; set; }
    public long HeldDelta { get; set; }
    public long BonusHeldDelta { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public static class WalletLedgerStates
{
    public const string Pending = "PENDING";
    public const string Applied = "APPLIED";
    /// <summary>The guards refused it (not enough coins). Nothing changed.</summary>
    public const string Rejected = "REJECTED";
}

public static class WalletLedgerKinds
{
    public const string VipHold = "VIP_HOLD";
    public const string VipCharge = "VIP_CHARGE";
    public const string VipRefund = "VIP_REFUND";
    public const string HintPurchase = "HINT_PURCHASE";
    public const string AuthorShare = "AUTHOR_SHARE";
    public const string AuthorTier = "AUTHOR_TIER";
    public const string AuthorRevoke = "AUTHOR_REVOKE";
    public const string ChestPurchase = "CHEST_PURCHASE";
}
