using System.Globalization;
using System.Text;
using SirLocked.Api.Models.Market;

namespace SirLocked.Api.Services.Market;

/// <summary>Stable error codes; the frontend maps each one to a Vietnamese/English message.</summary>
public static class MarketErrors
{
    public const string InvalidPrice = "MARKET_INVALID_PRICE";
    public const string UnknownItemType = "MARKET_UNKNOWN_ITEM_TYPE";
    public const string ItemNotFound = "MARKET_ITEM_NOT_FOUND";
    public const string ItemLocked = "MARKET_ITEM_LOCKED";
    public const string ListingNotFound = "MARKET_LISTING_NOT_FOUND";
    public const string ListingUnavailable = "MARKET_LISTING_UNAVAILABLE";
    public const string CannotBuyOwn = "MARKET_CANNOT_BUY_OWN";
    public const string InsufficientFunds = "MARKET_INSUFFICIENT_FUNDS";
    public const string InventoryFull = "MARKET_INVENTORY_FULL";
    public const string NoListingAtPrice = "MARKET_NO_LISTING_AT_PRICE";
    public const string OrderNotFound = "MARKET_ORDER_NOT_FOUND";
    public const string OrderUnavailable = "MARKET_ORDER_UNAVAILABLE";
    public const string TooManyListings = "MARKET_TOO_MANY_LISTINGS";
    public const string TooManyOrders = "MARKET_TOO_MANY_ORDERS";
    public const string TradeNotFound = "MARKET_TRADE_NOT_FOUND";
    public const string TradeClosed = "MARKET_TRADE_CLOSED";
    public const string TradeSelf = "MARKET_TRADE_SELF";
    public const string TradeEmpty = "MARKET_TRADE_EMPTY";
    public const string TradeTooManyItems = "MARKET_TRADE_TOO_MANY_ITEMS";
    public const string TradeInvalidCoins = "MARKET_TRADE_INVALID_COINS";
    public const string TradeCoinsNotAllowed = "MARKET_TRADE_COINS_NOT_ALLOWED";
    public const string TradeDuplicateItem = "MARKET_TRADE_DUPLICATE_ITEM";
    public const string TradeMessageTooLong = "MARKET_TRADE_MESSAGE_TOO_LONG";
    public const string TradeItemUnavailable = "MARKET_TRADE_ITEM_UNAVAILABLE";
    public const string TradeSenderFunds = "MARKET_TRADE_SENDER_FUNDS";
    public const string TradeSenderInventory = "MARKET_TRADE_SENDER_INVENTORY";
    public const string TradeRecipientFunds = "MARKET_TRADE_RECIPIENT_FUNDS";
    public const string TradeRecipientInventory = "MARKET_TRADE_RECIPIENT_INVENTORY";
    public const string TradeTooManyPending = "MARKET_TRADE_TOO_MANY_PENDING";
    public const string UserNotFound = "MARKET_USER_NOT_FOUND";
    public const string RequestInProgress = "MARKET_REQUEST_IN_PROGRESS";
    public const string InvalidRequestId = "MARKET_INVALID_REQUEST_ID";
    public const string Busy = "MARKET_BUSY";
    public const string EmailNotVerified = "MARKET_EMAIL_NOT_VERIFIED";
    public const string NotEquippable = "MARKET_ITEM_NOT_EQUIPPABLE";
    public const string ItemNotTradable = "MARKET_ITEM_NOT_TRADABLE";
}

public sealed record DailyAggregate(DateOnly Day, long Sum, int Count, long Min, long Max);

public sealed record DailyPrice(DateOnly Day, long? Average, long? Low, long? High, int Volume);

/// <summary>
/// Price history over a window of days ending today (oldest first). <c>Line</c> is the average price per
/// day carried forward over days without sales, null before the first sale.
/// </summary>
public sealed record PriceHistory(
    IReadOnlyList<DailyPrice> Days,
    IReadOnlyList<long?> Line,
    long? Low,
    long? High,
    int? ChangePercent,
    int Volume);

/// <summary>A trade offer as typed by the sender, before anything is looked up.</summary>
public sealed record TradeDraft(
    string FromUserId,
    string ToUserId,
    IReadOnlyList<string> OfferItemIds,
    long OfferCoins,
    IReadOnlyList<string> RequestItemIds,
    long RequestCoins,
    string? Message);

/// <summary>Pure economy rules: no I/O, so fees, matching and validation are unit-testable.</summary>
public static class MarketRules
{
    public const int InventorySlots = 12;
    public const long StarterCoins = 500;
    public const long WinReward = 120;
    public const long LossReward = 30;
    public const int FeePercent = 5;
    /// <summary>2 xu so the seller always receives at least 1 xu after the minimum 1 xu fee.</summary>
    public const long MinPrice = 2;
    public const long MaxPrice = 1_000_000;
    public const int MaxTradeItemsPerSide = 6;
    public const long MaxTradeCoins = 1_000_000;
    public const int MaxTradeMessageLength = 200;
    public const int MaxOpenListingsPerUser = InventorySlots;
    public const int MaxOpenOrdersPerUser = 10;
    public const int MaxPendingOutgoingTrades = 10;
    public const int OpsWindow = 256;
    /// <summary>Market days follow Vietnam time (UTC+7) so "hôm nay" matches the players' calendar.</summary>
    public static readonly TimeSpan DayOffset = TimeSpan.FromHours(7);

    /// <summary>5% of the price, rounded half up, at least 1 xu (Market.dc.html: max(1, round(price × 0.05))).</summary>
    public static long Fee(long price) => price <= 0 ? 0 : Math.Max(1, (price * FeePercent + 50) / 100);

    public static long SellerProceeds(long price) => Math.Max(0, price - Fee(price));

    public static string? ValidatePrice(long price) =>
        price < MinPrice || price > MaxPrice ? MarketErrors.InvalidPrice : null;

    public static long RewardFor(bool won) => won ? WinReward : LossReward;

    public static bool Crosses(long ask, long bid) => ask <= bid;

    /// <summary>A crossing pair trades at the resting (older) side's price; the newcomer gets the better deal.</summary>
    public static long MatchPrice(long listingPrice, DateTime listingCreatedAt, long orderPrice, DateTime orderCreatedAt) =>
        orderCreatedAt <= listingCreatedAt ? orderPrice : listingPrice;

    /// <summary>Bids a new listing can fill: price at least the ask, not the seller's own, best price then oldest first.</summary>
    public static IReadOnlyList<MarketBuyOrder> SelectBidsFor(MarketListing listing, IEnumerable<MarketBuyOrder> orders) =>
        orders
            .Where(order => order.Status == MarketOrderStatus.Active
                            && order.DefId == listing.DefId
                            && order.BuyerId != listing.SellerId
                            && Crosses(listing.Price, order.Price))
            .OrderByDescending(order => order.Price)
            .ThenBy(order => order.CreatedAt)
            .ThenBy(order => order.Id, StringComparer.Ordinal)
            .ToList();

    /// <summary>Asks a buy order can take: price at most the bid, not the buyer's own, cheapest then oldest first.</summary>
    public static IReadOnlyList<MarketListing> SelectAsksFor(MarketBuyOrder order, IEnumerable<MarketListing> listings) =>
        listings
            .Where(listing => listing.Status == MarketListingStatus.Active
                              && listing.DefId == order.DefId
                              && listing.SellerId != order.BuyerId
                              && Crosses(listing.Price, order.Price))
            .OrderBy(listing => listing.Price)
            .ThenBy(listing => listing.CreatedAt)
            .ThenBy(listing => listing.Id, StringComparer.Ordinal)
            .ToList();

    /// <summary>Slots are reserved before a transfer (positive part) and released after it (negative part),
    /// so a rollback never has to re-take a slot that may meanwhile have been used.</summary>
    public static int ReservePart(int slotDelta) => Math.Max(0, slotDelta);

    public static int ReleasePart(int slotDelta) => Math.Min(0, slotDelta);

    public static bool HasRoom(int slotsUsed, int incoming, int cap = InventorySlots) =>
        incoming <= 0 || slotsUsed + incoming <= cap;

    /// <summary>
    /// Shape checks for a new trade offer (ownership is checked against the database afterwards).
    /// <paramref name="allowCoins"/> false: any coins on either side are refused, so an offer needs at least one item.
    /// </summary>
    public static string? ValidateTradeDraft(TradeDraft draft, bool allowCoins = true)
    {
        if (string.IsNullOrWhiteSpace(draft.ToUserId) || draft.ToUserId == draft.FromUserId)
            return MarketErrors.TradeSelf;
        if (draft.OfferItemIds.Count > MaxTradeItemsPerSide || draft.RequestItemIds.Count > MaxTradeItemsPerSide)
            return MarketErrors.TradeTooManyItems;
        if (draft.OfferCoins < 0 || draft.OfferCoins > MaxTradeCoins
            || draft.RequestCoins < 0 || draft.RequestCoins > MaxTradeCoins)
            return MarketErrors.TradeInvalidCoins;
        if (!allowCoins && (draft.OfferCoins != 0 || draft.RequestCoins != 0))
            return MarketErrors.TradeCoinsNotAllowed;
        var all = draft.OfferItemIds.Concat(draft.RequestItemIds).ToList();
        if (all.Any(string.IsNullOrWhiteSpace) || all.Distinct(StringComparer.Ordinal).Count() != all.Count)
            return MarketErrors.TradeDuplicateItem;
        if (draft.OfferItemIds.Count == 0 && draft.RequestItemIds.Count == 0
            && draft.OfferCoins == 0 && draft.RequestCoins == 0)
            return MarketErrors.TradeEmpty;
        if (SanitizeMessage(draft.Message).Length > MaxTradeMessageLength)
            return MarketErrors.TradeMessageTooLong;
        return null;
    }

    /// <summary>
    /// Accept-time ownership check: every offered item must still belong to the sender, every requested
    /// item to the recipient, and none may be locked (listed for sale or inside another trade).
    /// </summary>
    public static string? ValidateTradeItems(
        IReadOnlyList<string> fromItemIds,
        IReadOnlyList<string> toItemIds,
        string fromUserId,
        string toUserId,
        IReadOnlyDictionary<string, MarketItem> itemsById,
        string? allowedLock = null)
    {
        bool Usable(string itemId, string owner) =>
            itemsById.TryGetValue(itemId, out var item)
            && item.OwnerId == owner
            && (item.LockedBy is null || item.LockedBy == allowedLock);
        return fromItemIds.All(id => Usable(id, fromUserId)) && toItemIds.All(id => Usable(id, toUserId))
            ? null
            : MarketErrors.TradeItemUnavailable;
    }

    /// <summary>Coin and slot check for both sides of an offer against current wallets.</summary>
    public static string? ValidateTradeBalances(
        MarketAccount from, MarketAccount to,
        int fromItemCount, int toItemCount,
        long fromCoins, long toCoins,
        int cap = InventorySlots)
    {
        if (from.Balance < fromCoins) return MarketErrors.TradeSenderFunds;
        if (!HasRoom(from.Slots, toItemCount - fromItemCount, cap)) return MarketErrors.TradeSenderInventory;
        if (to.Balance < toCoins) return MarketErrors.TradeRecipientFunds;
        if (!HasRoom(to.Slots, fromItemCount - toItemCount, cap)) return MarketErrors.TradeRecipientInventory;
        return null;
    }

    /// <summary>Recipient-side problems keep the offer open (the recipient can fix them and retry).</summary>
    public static bool IsRecipientSideFailure(string code) =>
        code is MarketErrors.TradeRecipientFunds or MarketErrors.TradeRecipientInventory;

    public static string SanitizeMessage(string? message)
    {
        if (string.IsNullOrWhiteSpace(message)) return string.Empty;
        var builder = new StringBuilder(message.Length);
        foreach (var ch in message.Trim())
        {
            if (ch == '\n' || ch == '\r' || ch == '\t') builder.Append(' ');
            else if (!char.IsControl(ch)) builder.Append(ch);
        }
        return builder.ToString().Trim();
    }

    /// <summary>Lower-case, diacritics removed (đ → d) so "kinh lup" finds "Kính lúp".</summary>
    public static string NormalizeSearch(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        var decomposed = text.Trim().ToLowerInvariant().Replace('đ', 'd').Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) builder.Append(ch);
        }
        return string.Join(' ', builder.ToString().Normalize(NormalizationForm.FormC)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    public static bool MatchesSearch(MarketItemDef def, string normalizedQuery) =>
        normalizedQuery.Length == 0
        || NormalizeSearch(def.Name).Contains(normalizedQuery, StringComparison.Ordinal)
        || NormalizeSearch(def.NameEn).Contains(normalizedQuery, StringComparison.Ordinal);

    public static DateOnly MarketDay(DateTime utc) => DateOnly.FromDateTime(utc.Add(DayOffset));

    /// <summary>UTC instant at which the market day <paramref name="daysBack"/> days before today began.</summary>
    public static DateTime WindowStartUtc(DateTime nowUtc, int days)
    {
        var today = MarketDay(nowUtc);
        var first = today.AddDays(-(days - 1));
        return DateTime.SpecifyKind(first.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc) - DayOffset;
    }

    public static IReadOnlyList<DailyAggregate> AggregateDaily(IEnumerable<(DateTime At, long Price)> sales) =>
        sales
            .GroupBy(sale => MarketDay(sale.At))
            .Select(group => new DailyAggregate(
                group.Key,
                group.Sum(sale => sale.Price),
                group.Count(),
                group.Min(sale => sale.Price),
                group.Max(sale => sale.Price)))
            .OrderBy(day => day.Day)
            .ToList();

    public static PriceHistory BuildHistory(IEnumerable<DailyAggregate> aggregates, DateTime nowUtc, int days)
    {
        var today = MarketDay(nowUtc);
        var first = today.AddDays(-(days - 1));
        var byDay = aggregates
            .Where(day => day.Day >= first && day.Day <= today && day.Count > 0)
            .GroupBy(day => day.Day)
            .ToDictionary(group => group.Key, group => new DailyAggregate(
                group.Key,
                group.Sum(day => day.Sum),
                group.Sum(day => day.Count),
                group.Min(day => day.Min),
                group.Max(day => day.Max)));

        var points = new List<DailyPrice>(days);
        var line = new List<long?>(days);
        long? carried = null;
        for (var i = 0; i < days; i++)
        {
            var day = first.AddDays(i);
            if (byDay.TryGetValue(day, out var aggregate))
            {
                var average = (long)Math.Round((decimal)aggregate.Sum / aggregate.Count, MidpointRounding.AwayFromZero);
                points.Add(new DailyPrice(day, average, aggregate.Min, aggregate.Max, aggregate.Count));
                carried = average;
            }
            else
            {
                points.Add(new DailyPrice(day, null, null, null, 0));
            }
            line.Add(carried);
        }

        var traded = points.Where(point => point.Volume > 0).ToList();
        long? low = traded.Count == 0 ? null : traded.Min(point => point.Low);
        long? high = traded.Count == 0 ? null : traded.Max(point => point.High);
        var firstValue = line.FirstOrDefault(value => value.HasValue);
        var lastValue = line.LastOrDefault(value => value.HasValue);
        int? change = firstValue is > 0 && lastValue.HasValue && traded.Count > 1
            ? (int)Math.Round((decimal)(lastValue.Value - firstValue.Value) * 100 / firstValue.Value, MidpointRounding.AwayFromZero)
            : null;
        return new PriceHistory(points, line, low, high, change, traded.Sum(point => point.Volume));
    }
}
