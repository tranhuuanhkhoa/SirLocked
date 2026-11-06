using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models.Market;

// Chợ đồ (item market). Standalone MongoDB has no multi-document transactions, so every
// cross-document change is a journaled sequence of conditional single-document writes:
// wallet writes carry an operation key (deduplicated through Ops), item writes are guarded by
// owner + lock, listings/orders/offers move through status values claimed by a transaction id.

/// <summary>One per user (_id = userId): coins, coins held by buy orders, inventory slots, equipped items.</summary>
[BsonIgnoreExtraElements]
public class MarketAccount
{
    [BsonId] public string Id { get; set; } = string.Empty;
    /// <summary>Spendable coins ("xu"). Never negative: every debit is guarded by Balance &gt;= amount.</summary>
    public long Balance { get; set; }
    /// <summary>Coins escrowed by open buy orders.</summary>
    public long Held { get; set; }
    /// <summary>Inventory slots in use: owned items plus one reserved slot per open buy order.</summary>
    public int Slots { get; set; }
    /// <summary>Category → item instance id ("ĐANG DÙNG").</summary>
    public Dictionary<string, string> Equipped { get; set; } = new();
    /// <summary>Recently applied wallet operation keys (bounded window) so a replayed step is a no-op.</summary>
    public List<string> Ops { get; set; } = new();
    /// <summary>Permanent money-backed credit receipts. Never prune with the bounded game-operation window.</summary>
    public List<long> PaidTopUpIds { get; set; } = new();
    public bool StarterItemsIssued { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>One owned cosmetic item instance (unique id). Exactly one owner at any time.</summary>
[BsonIgnoreExtraElements]
public class MarketItem
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string OwnerId { get; set; } = string.Empty;
    public string DefId { get; set; } = string.Empty;
    /// <summary>null = free; "listing:&lt;id&gt;" while for sale; "tx:&lt;id&gt;" while a trade moves it; "chest:&lt;id&gt;" while a chest opening spends it; "xp:&lt;id&gt;" while an exchange burns it.</summary>
    public string? LockedBy { get; set; }
    public string Source { get; set; } = MarketItemSources.Starter;
    public string? LastTxId { get; set; }
    public DateTime AcquiredAt { get; set; }
}

public static class MarketItemSources
{
    public const string Starter = "STARTER";
    public const string Market = "MARKET";
    public const string Trade = "TRADE";
    public const string Grant = "GRANT";
    public const string Shop = "SHOP";
    public const string Chest = "CHEST";
    /// <summary>Granted on reaching a level. Takes no bag slot and cannot leave the account.</summary>
    public const string Level = "LEVEL";
    /// <summary>Granted for an achievement. Takes no bag slot and cannot leave the account.</summary>
    public const string Achievement = "ACHIEVEMENT";

    public static bool IsEarned(string? source) => source is Level or Achievement;
}

public static class MarketListingStatus
{
    public const string Opening = "OPENING";     // inserted, item not yet locked
    public const string Active = "ACTIVE";
    public const string Pending = "PENDING";     // claimed by a buy transaction
    public const string Sold = "SOLD";
    public const string Cancelled = "CANCELLED";
}

[BsonIgnoreExtraElements]
public class MarketListing
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string SellerId { get; set; } = string.Empty;
    public string SellerName { get; set; } = string.Empty;
    public string ItemId { get; set; } = string.Empty;
    public string DefId { get; set; } = string.Empty;
    /// <summary>Price the buyer pays. The seller receives Price − fee.</summary>
    public long Price { get; set; }
    public string Status { get; set; } = MarketListingStatus.Opening;
    public string? TxId { get; set; }
    public string? BuyerId { get; set; }
    public long? SoldPrice { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
}

public static class MarketOrderStatus
{
    public const string Opening = "OPENING";     // inserted, coins not yet held
    public const string Active = "ACTIVE";
    public const string Pending = "PENDING";     // claimed by a fill transaction
    public const string Filled = "FILLED";
    public const string Cancelled = "CANCELLED";
}

/// <summary>Buy order (bid) for one item of a type. Holds Price coins and one inventory slot while open.</summary>
[BsonIgnoreExtraElements]
public class MarketBuyOrder
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string BuyerId { get; set; } = string.Empty;
    public string BuyerName { get; set; } = string.Empty;
    public string DefId { get; set; } = string.Empty;
    public long Price { get; set; }
    public string Status { get; set; } = MarketOrderStatus.Opening;
    public bool Held { get; set; }
    /// <summary>True once the held coins/slot went back to the buyer after a cancel.</summary>
    public bool Released { get; set; }
    public string? TxId { get; set; }
    public string? ItemId { get; set; }
    public long? FilledPrice { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
}

/// <summary>Completed sale (_id = transaction id, so recording it twice is impossible).</summary>
[BsonIgnoreExtraElements]
public class MarketSale
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string DefId { get; set; } = string.Empty;
    public string ItemId { get; set; } = string.Empty;
    public long Price { get; set; }
    public long Fee { get; set; }
    public string SellerId { get; set; } = string.Empty;
    public string BuyerId { get; set; } = string.Empty;
    public string ListingId { get; set; } = string.Empty;
    public string? OrderId { get; set; }
    public DateTime At { get; set; }
}

public static class TradeOfferStatus
{
    public const string Pending = "PENDING";
    public const string Accepting = "ACCEPTING";   // claimed by an accept transaction
    public const string Accepted = "ACCEPTED";
    public const string Declined = "DECLINED";
    public const string Cancelled = "CANCELLED";
    public const string Countered = "COUNTERED";
    public const string Failed = "FAILED";         // validation at accept time failed

    public static bool IsOpen(string status) => status is Pending or Accepting;
}

[BsonIgnoreExtraElements]
public class TradeItemRef
{
    public string ItemId { get; set; } = string.Empty;
    public string DefId { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class TradeOffer
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string FromUserId { get; set; } = string.Empty;
    public string FromName { get; set; } = string.Empty;
    public string ToUserId { get; set; } = string.Empty;
    public string ToName { get; set; } = string.Empty;
    /// <summary>Items the sender gives.</summary>
    public List<TradeItemRef> FromItems { get; set; } = new();
    /// <summary>Items the sender asks for (owned by the recipient).</summary>
    public List<TradeItemRef> ToItems { get; set; } = new();
    public long FromCoins { get; set; }
    public long ToCoins { get; set; }
    public string Message { get; set; } = string.Empty;
    public string Status { get; set; } = TradeOfferStatus.Pending;
    public string? FailReason { get; set; }
    public string? ParentId { get; set; }
    public string? CounterId { get; set; }
    public string? TxId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? RespondedAt { get; set; }
}

/// <summary>One coin reward per player per completed game (_id = "&lt;roomId&gt;:&lt;userId&gt;").</summary>
[BsonIgnoreExtraElements]
public class MarketReward
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string RoomId { get; set; } = string.Empty;
    public long Amount { get; set; }
    public bool Won { get; set; }
    public bool Applied { get; set; }
    public DateTime CreatedAt { get; set; }
}

public static class MarketTxKinds
{
    public const string Buy = "BUY";
    public const string Trade = "TRADE";
}

public static class MarketTxStates
{
    public const string Pending = "PENDING";
    public const string RollingBack = "ROLLING_BACK";
    public const string Done = "DONE";
    public const string Failed = "FAILED";   // rolled back, nothing changed hands
}

/// <summary>
/// Journal of one multi-document operation. Every step is idempotent and its completion is recorded
/// here, so the recovery worker can replay a transaction interrupted by a crash forwards (after the
/// commit point) or backwards (before it).
/// </summary>
[BsonIgnoreExtraElements]
public class MarketTx
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = MarketTxKinds.Buy;
    public string State { get; set; } = MarketTxStates.Pending;
    public string? Error { get; set; }
    public bool Committed { get; set; }

    // BUY (buy now, or a buy order filled by a listing)
    public string? BuyerId { get; set; }
    public string? SellerId { get; set; }
    public string? ListingId { get; set; }
    public string? OrderId { get; set; }
    public string? ItemId { get; set; }
    public string? DefId { get; set; }
    public long Price { get; set; }
    public long Fee { get; set; }
    /// <summary>Coins taken from the buyer before the match: the price, or the order's held amount.</summary>
    public long Reserved { get; set; }
    public bool Funded { get; set; }
    public bool SellerPaid { get; set; }
    public bool ChangeReturned { get; set; }
    public bool Refunded { get; set; }

    // TRADE
    public string? OfferId { get; set; }
    public string? FromId { get; set; }
    public string? ToId { get; set; }
    public List<string> FromItemIds { get; set; } = new();
    public List<string> ToItemIds { get; set; } = new();
    public long FromCoins { get; set; }
    public long ToCoins { get; set; }
    public bool FromDebited { get; set; }
    public bool ToDebited { get; set; }
    public bool FromCredited { get; set; }
    public bool ToCredited { get; set; }
    public bool FromRefunded { get; set; }
    public bool ToRefunded { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Idempotency record for a client request id (_id = "&lt;userId&gt;:&lt;requestId&gt;").</summary>
[BsonIgnoreExtraElements]
public class MarketRequest
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string State { get; set; } = "RUNNING";
    public string? ResultJson { get; set; }
    public DateTime CreatedAt { get; set; }
}
