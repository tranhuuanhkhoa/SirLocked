using System.ComponentModel.DataAnnotations;
using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.DTOs.Market;

public sealed record ItemDefDto(
    string Id,
    string Category,
    string Rarity,
    string Name,
    string NameEn,
    string Description,
    string DescriptionEn,
    long ReferencePrice,
    string? IconKey = null,
    bool Tradable = true,
    ItemVisual? Visual = null);

public sealed record WalletDto(
    long Balance,
    long Held,
    int SlotsUsed,
    int SlotCap,
    int ItemCount,
    int ReservedSlots,
    int FeePercent,
    long BonusBalance = 0,
    long BonusHeld = 0);

public sealed record MarketRowDto(
    ItemDefDto Def,
    int ListedCount,
    long? LowestAsk,
    long? HighestBid,
    int BidCount,
    IReadOnlyList<long?> Spark10,
    int? ChangePercent,
    int Volume30);

/// <summary>
/// One page of the ledger. <c>TotalCount</c> counts every category (the "All" button), <c>MatchCount</c> the rows of
/// the chosen category across all pages; <c>Page</c> is the page actually returned, which may differ from the one asked.
/// </summary>
public sealed record MarketBrowseDto(
    IReadOnlyList<MarketRowDto> Rows,
    IReadOnlyDictionary<string, int> CategoryCounts,
    int TotalCount,
    int MatchCount,
    int Page,
    int PageSize);

public sealed record DailyPriceDto(string Day, long? Average, long? Low, long? High, int Volume);

public sealed record PriceHistoryDto(
    IReadOnlyList<DailyPriceDto> Days,
    IReadOnlyList<long?> Line,
    long? Low,
    long? High,
    int? ChangePercent,
    int Volume);

public sealed record ListingRowDto(string ListingId, long Price, string SellerName, bool IsMine, DateTime CreatedAt);

public sealed record BidLevelDto(long Price, int Count);

public sealed record ListingDto(
    string ListingId,
    string ItemId,
    ItemDefDto Def,
    long Price,
    long Fee,
    long Proceeds,
    string Status,
    long? SoldPrice,
    DateTime CreatedAt,
    DateTime? ClosedAt);

public sealed record OrderDto(
    string OrderId,
    ItemDefDto Def,
    long Price,
    string Status,
    long? FilledPrice,
    DateTime CreatedAt,
    DateTime? ClosedAt);

public sealed record SaleDto(
    string SaleId,
    ItemDefDto Def,
    string ItemId,
    long Price,
    long Fee,
    // SOLD or BOUGHT from the caller's point of view.
    string Role,
    // Coins the caller gained (seller: price − fee) or spent (buyer: −price).
    long Net,
    DateTime At);

public sealed record MarketItemDetailDto(
    ItemDefDto Def,
    int ListedCount,
    long? LowestAsk,
    int BidCount,
    long? HighestBid,
    IReadOnlyList<ListingRowDto> Listings,
    IReadOnlyList<BidLevelDto> Bids,
    PriceHistoryDto History,
    IReadOnlyList<ListingDto> MyListings,
    IReadOnlyList<OrderDto> MyOrders,
    int OwnedCount);

public sealed record InventoryItemDto(
    string ItemId,
    ItemDefDto Def,
    bool Locked,
    // LISTED (for sale), TRADE (inside an accepting trade) or OPENING (a chest opening is spending it); null when free.
    string? LockReason,
    string? ListingId,
    long? ListingPrice,
    bool Equipped,
    string Source,
    DateTime AcquiredAt);

public sealed record InventoryDto(
    IReadOnlyList<InventoryItemDto> Items,
    WalletDto Wallet,
    IReadOnlyDictionary<string, string> Equipped);

public sealed record EquippedItemDto(string Category, string ItemId, ItemDefDto Def);

public sealed record ListingResultDto(ListingDto Listing, SaleDto? Sale, WalletDto Wallet);

public sealed record PurchaseResultDto(SaleDto Sale, WalletDto Wallet);

public sealed record OrderResultDto(OrderDto Order, SaleDto? Sale, WalletDto Wallet);

public sealed record MyMarketDto(
    IReadOnlyList<ListingDto> Listings,
    IReadOnlyList<OrderDto> Orders,
    IReadOnlyList<SaleDto> History);

public sealed record TradePartyDto(string UserId, string Name);

public sealed record TradeItemDto(string ItemId, ItemDefDto Def, bool Available);

public sealed record TradeOfferDto(
    string OfferId,
    // INCOMING or OUTGOING from the caller's point of view.
    string Direction,
    TradePartyDto From,
    TradePartyDto To,
    IReadOnlyList<TradeItemDto> FromItems,
    IReadOnlyList<TradeItemDto> ToItems,
    long FromCoins,
    long ToCoins,
    string Message,
    string Status,
    string? FailReason,
    string? ParentId,
    string? CounterId,
    DateTime CreatedAt,
    DateTime? RespondedAt);

public sealed record TradesDto(
    IReadOnlyList<TradeOfferDto> Incoming,
    IReadOnlyList<TradeOfferDto> Outgoing,
    IReadOnlyList<TradeOfferDto> History,
    // False: trades carry items only (Market:TradeCoins); the page hides the coin fields.
    bool CoinsAllowed = true);

public sealed record RewardDto(string RoomId, long Amount, bool Won, bool Applied);

public sealed record UserSearchDto(string UserId, string Username);

public sealed record PublicInventoryDto(TradePartyDto Owner, IReadOnlyList<InventoryItemDto> Items);

// ----- requests -----

public class CreateListingRequest
{
    [Required, StringLength(64, MinimumLength = 1)]
    public string ItemId { get; set; } = string.Empty;

    [Range(typeof(long), "2", "1000000", ErrorMessage = "Price must be between 2 and 1,000,000 xu.")]
    public long Price { get; set; }

    [StringLength(64)]
    public string? RequestId { get; set; }
}

public class BuyRequest
{
    /// <summary>Highest price the buyer accepts (the price shown to them). Required for buy-lowest.</summary>
    [Range(typeof(long), "0", "1000000")]
    public long? MaxPrice { get; set; }

    [StringLength(64)]
    public string? RequestId { get; set; }
}

public class PlaceOrderRequest
{
    [Required, StringLength(64, MinimumLength = 1)]
    public string DefId { get; set; } = string.Empty;

    [Range(typeof(long), "2", "1000000", ErrorMessage = "Price must be between 2 and 1,000,000 xu.")]
    public long Price { get; set; }

    [StringLength(64)]
    public string? RequestId { get; set; }
}

public class TradeTermsRequest
{
    [MaxLength(6)]
    public List<string> OfferItemIds { get; set; } = new();

    [Range(typeof(long), "0", "1000000")]
    public long OfferCoins { get; set; }

    [MaxLength(6)]
    public List<string> RequestItemIds { get; set; } = new();

    [Range(typeof(long), "0", "1000000")]
    public long RequestCoins { get; set; }

    [StringLength(400)]
    public string? Message { get; set; }

    [StringLength(64)]
    public string? RequestId { get; set; }
}

public class CreateTradeRequest : TradeTermsRequest
{
    [Required, StringLength(64, MinimumLength = 1)]
    public string ToUserId { get; set; } = string.Empty;
}

public class AdminGrantRequest
{
    [Required, StringLength(64, MinimumLength = 1)]
    public string UserId { get; set; } = string.Empty;

    [StringLength(64)]
    public string? DefId { get; set; }

    [Range(typeof(long), "0", "100000")]
    public long Coins { get; set; }
}
