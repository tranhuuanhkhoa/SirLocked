using SirLocked.Api.DTOs.Market;

namespace SirLocked.Api.DTOs.Admin;

/// <summary>One bucket of a count, by rarity or by category.</summary>
public sealed record AdminCountRowDto(string Key, long Count);

/// <summary>Coins that entered (starter, game rewards, admin) and left (chest shop, market fee, admin) on one market day.</summary>
public sealed record AdminFlowDayDto(
    DateOnly Day,
    long Starter,
    long GameRewards,
    long AdminIn,
    long ChestShop,
    long MarketFees,
    long AdminOut,
    long Net);

public sealed record AdminFlowTotalsDto(
    long Starter,
    long GameRewards,
    long AdminIn,
    long ChestShop,
    long MarketFees,
    long AdminOut,
    long Net);

public sealed record AdminRichPlayerDto(string UserId, string FullName, long Balance, long Held);

public sealed record AdminEconomyOverviewDto(
    long CoinsInCirculation,
    long CoinsHeld,
    IReadOnlyList<AdminCountRowDto> ItemsByRarity,
    IReadOnlyList<AdminCountRowDto> ItemsByCategory,
    IReadOnlyList<AdminFlowDayDto> Days,
    AdminFlowTotalsDto Totals,
    IReadOnlyList<AdminRichPlayerDto> Richest);

public sealed record AdminEconomyDashboardDto(
    long NewPlayersToday,
    long GamesToday,
    long ChestOpensToday,
    long CoinsInCirculation,
    long StuckOperations,
    long PendingAvatars);

public sealed record AdminListingRowDto(
    string Id,
    string ItemId,
    ItemDefDto Def,
    string UserId,
    string UserName,
    long Price,
    long ReferencePrice,
    string? PriceFlag,
    string Status,
    DateTime CreatedAt);

public sealed record AdminOrderRowDto(
    string Id,
    ItemDefDto Def,
    string UserId,
    string UserName,
    long Price,
    long ReferencePrice,
    string? PriceFlag,
    string Status,
    DateTime CreatedAt);

public sealed record AdminSaleRowDto(
    string Id,
    ItemDefDto Def,
    string ItemId,
    long Price,
    long Fee,
    string? PriceFlag,
    string SellerId,
    string SellerName,
    string BuyerId,
    string BuyerName,
    string ListingId,
    string? OrderId,
    DateTime At);

public sealed record AdminPriceAnomalyDto(
    string Kind,
    string? ListingId,
    string? SaleId,
    ItemDefDto Def,
    long Price,
    long ReferencePrice,
    string Flag,
    string UserId,
    string UserName,
    DateTime At);

public sealed record AdminFunnelDto(
    string ReceiverId,
    string ReceiverName,
    long Coins,
    int Items,
    IReadOnlyList<string> GiverIds,
    IReadOnlyList<string> GiverNames,
    IReadOnlyList<string> TradeIds);

public sealed record AdminRepeatedPairDto(
    string FirstId,
    string FirstName,
    string SecondId,
    string SecondName,
    int Trades,
    DateTime LastAt);

public sealed record AdminAnomaliesDto(
    IReadOnlyList<AdminPriceAnomalyDto> Prices,
    IReadOnlyList<AdminFunnelDto> Funnels,
    IReadOnlyList<AdminRepeatedPairDto> RepeatedPairs,
    DateTime Since,
    // True when more rows existed than one scan reads, so the lists may be incomplete.
    bool Truncated);

public sealed record AdminStuckRowDto(
    string Kind,
    string Id,
    string State,
    string? UserId,
    DateTime UpdatedAt,
    long AgeSeconds,
    string? Detail);

public sealed record AdminStuckDto(IReadOnlyList<AdminStuckRowDto> Items, int StuckAfterMinutes, bool Truncated);

/// <summary>What one press of "Chạy khôi phục" did, and what is still stuck afterwards.</summary>
public sealed record AdminRecoveryReportDto(
    int Resumed,
    int MarketTransactions,
    int MarketListings,
    int MarketOrders,
    int MarketLocks,
    int MarketRewards,
    int MarketStarterGrants,
    int MarketMatches,
    int ChestOpenings,
    int ChestPurchases,
    int XpExchanges,
    int AdminOperations,
    int StillStuck);
