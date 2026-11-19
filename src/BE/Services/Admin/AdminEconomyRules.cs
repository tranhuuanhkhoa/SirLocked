using System.Text;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>An accepted trade, flattened so the rules stay free of I/O. "From" proposed it; "To" answered.</summary>
public sealed record TradeFact(
    string Id,
    string FromId,
    string ToId,
    long FromCoins,
    long ToCoins,
    int FromItems,
    int ToItems,
    DateTime At);

/// <summary>Coins from one source on one market day.</summary>
public sealed record FlowFact(DateOnly Day, string Source, long Amount);

public sealed record FunnelFlag(string ReceiverId, long Coins, int Items, IReadOnlyList<string> GiverIds, IReadOnlyList<string> TradeIds);

public sealed record RepeatedPairFlag(string FirstId, string SecondId, int Trades, DateTime LastAt);

/// <summary>Pure economy-desk rules: what looks unusual, and how the coin flows add up. They only flag; nothing here acts.</summary>
public static class AdminEconomyRules
{
    public const string PriceHigh = "HIGH";
    public const string PriceLow = "LOW";
    public const int PriceHighMultiple = 10;
    /// <summary>Below this share of the reference, in percent, a price is flagged as low.</summary>
    public const int PriceLowPercent = 10;

    public static readonly TimeSpan FreshAccountAge = TimeSpan.FromHours(24);
    /// <summary>The whole starter grant: the amount a throwaway account exists to hand over.</summary>
    public const long FunnelCoins = MarketRules.StarterCoins;
    public const int FunnelItems = 3;
    public const int RepeatedPairTrades = 5;
    public const int AnomalyWindowDays = 7;

    public const int StuckAfterMinutes = 5;

    public const string FlowStarter = "STARTER";
    public const string FlowGameRewards = "GAME_REWARDS";
    public const string FlowAdminIn = "ADMIN_IN";
    public const string FlowChestShop = "CHEST_SHOP";
    public const string FlowMarketFees = "MARKET_FEES";
    public const string FlowAdminOut = "ADMIN_OUT";

    public const string StuckListing = "LISTING";
    public const string StuckOrder = "ORDER";
    public const string StuckTrade = "TRADE";
    public const string StuckTransaction = "TRANSACTION";
    public const string StuckChestOpening = "CHEST_OPENING";
    public const string StuckChestPurchase = "CHEST_PURCHASE";
    public const string StuckXpExchange = "XP_EXCHANGE";
    public const string StuckAdminOperation = "ADMIN_OPERATION";

    /// <summary>Ten times the reference or more, or under a tenth of it. Without a reference there is nothing to compare with.</summary>
    public static string? PriceAnomaly(long price, long referencePrice)
    {
        if (referencePrice <= 0) return null;
        if (price >= referencePrice * PriceHighMultiple) return PriceHigh;
        if (price * 100 < referencePrice * PriceLowPercent) return PriceLow;
        return null;
    }

    /// <summary>
    /// Who received a lot from accounts under a day old, added up per receiver. What a fresh account gives away is what
    /// matters: farming the starter grant runs from the new account to the main one, whichever side proposed the trade.
    /// </summary>
    public static IReadOnlyList<FunnelFlag> FindNewAccountFunnels(IEnumerable<TradeFact> trades, IReadOnlyDictionary<string, DateTime> accountCreatedAt)
    {
        bool IsFresh(string userId, DateTime at) =>
            accountCreatedAt.TryGetValue(userId, out var created) && at - created <= FreshAccountAge;

        var flows = new List<(string Receiver, string Giver, long Coins, int Items, string TradeId)>();
        foreach (var trade in trades)
        {
            if (IsFresh(trade.FromId, trade.At) && (trade.FromCoins > 0 || trade.FromItems > 0))
                flows.Add((trade.ToId, trade.FromId, trade.FromCoins, trade.FromItems, trade.Id));
            if (IsFresh(trade.ToId, trade.At) && (trade.ToCoins > 0 || trade.ToItems > 0))
                flows.Add((trade.FromId, trade.ToId, trade.ToCoins, trade.ToItems, trade.Id));
        }
        return flows
            .GroupBy(flow => flow.Receiver, StringComparer.Ordinal)
            .Select(group => new FunnelFlag(
                group.Key,
                group.Sum(flow => flow.Coins),
                group.Sum(flow => flow.Items),
                group.Select(flow => flow.Giver).Distinct(StringComparer.Ordinal).OrderBy(id => id, StringComparer.Ordinal).ToList(),
                group.Select(flow => flow.TradeId).Distinct(StringComparer.Ordinal).ToList()))
            .Where(flag => flag.Coins >= FunnelCoins || flag.Items >= FunnelItems)
            .OrderByDescending(flag => flag.Coins).ThenByDescending(flag => flag.Items)
            .ToList();
    }

    /// <summary>Two accounts trading again and again, in either direction.</summary>
    public static IReadOnlyList<RepeatedPairFlag> FindRepeatedPairs(IEnumerable<TradeFact> trades) =>
        trades
            .GroupBy(trade => string.CompareOrdinal(trade.FromId, trade.ToId) <= 0 ? (First: trade.FromId, Second: trade.ToId) : (First: trade.ToId, Second: trade.FromId))
            .Where(group => group.Count() >= RepeatedPairTrades)
            .Select(group => new RepeatedPairFlag(group.Key.First, group.Key.Second, group.Count(), group.Max(trade => trade.At)))
            .OrderByDescending(flag => flag.Trades)
            .ToList();

    public static DateOnly MarketDayOf(DateTime utc) => MarketRules.MarketDay(utc);

    public static int NormalizeDays(int days) => days >= 30 ? 30 : 7;

    /// <summary>One row per day of the window, oldest first, so a quiet day shows as zero and not as a gap.</summary>
    public static IReadOnlyList<AdminFlowDayDto> BuildFlowDays(DateTime nowUtc, int days, IEnumerable<FlowFact> facts)
    {
        var byDay = facts.GroupBy(fact => fact.Day).ToDictionary(group => group.Key, group => group.ToList());
        long Sum(DateOnly day, string source) =>
            byDay.TryGetValue(day, out var rows) ? rows.Where(row => row.Source == source).Sum(row => row.Amount) : 0;

        var today = MarketDayOf(nowUtc);
        return Enumerable.Range(0, days).Select(offset =>
        {
            var day = today.AddDays(offset - days + 1);
            var starter = Sum(day, FlowStarter);
            var rewards = Sum(day, FlowGameRewards);
            var adminIn = Sum(day, FlowAdminIn);
            var chests = Sum(day, FlowChestShop);
            var fees = Sum(day, FlowMarketFees);
            var adminOut = Sum(day, FlowAdminOut);
            return new AdminFlowDayDto(day, starter, rewards, adminIn, chests, fees, adminOut, starter + rewards + adminIn - chests - fees - adminOut);
        }).ToList();
    }

    public static AdminFlowTotalsDto Totals(IReadOnlyCollection<AdminFlowDayDto> days) => new(
        days.Sum(day => day.Starter),
        days.Sum(day => day.GameRewards),
        days.Sum(day => day.AdminIn),
        days.Sum(day => day.ChestShop),
        days.Sum(day => day.MarketFees),
        days.Sum(day => day.AdminOut),
        days.Sum(day => day.Net));

    /// <summary>One CSV field. A leading = + - or @ would run as a formula in a spreadsheet, and player names are free text.</summary>
    public static string CsvField(string? value)
    {
        var text = value ?? string.Empty;
        if (text.Length > 0 && text[0] is '=' or '+' or '-' or '@' or '\t' or '\r') text = "'" + text;
        return text.IndexOfAny(new[] { ',', '"', '\n', '\r' }) < 0
            ? text
            : "\"" + text.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    public static byte[] ToCsvBytes(string csv) => Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray();
}
