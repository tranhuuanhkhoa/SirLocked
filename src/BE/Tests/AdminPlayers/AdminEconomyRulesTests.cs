using SirLocked.Api.Services.Admin;
using Xunit;

namespace SirLocked.Tests.AdminPlayers;

public class AdminEconomyRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 5, 3, 0, 0, DateTimeKind.Utc);

    private static TradeFact Trade(string from, string to, long fromCoins = 0, long toCoins = 0, int fromItems = 0, int toItems = 0, DateTime? at = null, string? id = null) =>
        new(id ?? Guid.NewGuid().ToString("N"), from, to, fromCoins, toCoins, fromItems, toItems, at ?? Now);

    // ------------------------------------------------------------------ prices

    [Theory]
    [InlineData(1000, 100, AdminEconomyRules.PriceHigh)]  // exactly ten times
    [InlineData(5000, 100, AdminEconomyRules.PriceHigh)]
    [InlineData(999, 100, null)]
    [InlineData(10, 100, null)]                           // exactly 10% is not below it
    [InlineData(9, 100, AdminEconomyRules.PriceLow)]
    [InlineData(100, 100, null)]
    [InlineData(1000, 0, null)]                           // no reference, nothing to compare with
    public void APriceIsFlaggedAgainstItsReference(long price, long reference, string? expected) =>
        Assert.Equal(expected, AdminEconomyRules.PriceAnomaly(price, reference));

    // ------------------------------------------------------------------ funnels

    [Fact]
    public void CoinsFromAFreshAccountAreFlaggedOnTheReceiver()
    {
        var created = new Dictionary<string, DateTime> { ["new"] = Now.AddHours(-2), ["main"] = Now.AddYears(-1) };

        var flags = AdminEconomyRules.FindNewAccountFunnels(new[] { Trade("new", "main", fromCoins: AdminEconomyRules.FunnelCoins) }, created);

        var flag = Assert.Single(flags);
        Assert.Equal("main", flag.ReceiverId);
        Assert.Equal(AdminEconomyRules.FunnelCoins, flag.Coins);
        Assert.Equal(new[] { "new" }, flag.GiverIds);
    }

    [Fact]
    public void WhatTheOlderSideGivesIsNotAFunnel()
    {
        var created = new Dictionary<string, DateTime> { ["new"] = Now.AddHours(-2), ["main"] = Now.AddYears(-1) };

        // main gave the coins and items to the new account: a gift, not farming the starter grant.
        Assert.Empty(AdminEconomyRules.FindNewAccountFunnels(new[] { Trade("main", "new", fromCoins: 5000, fromItems: 6) }, created));
    }

    [Fact]
    public void TheRequestedSideOfATradeCountsToo()
    {
        var created = new Dictionary<string, DateTime> { ["new"] = Now.AddHours(-2), ["main"] = Now.AddYears(-1) };

        // main proposed it, and the new account answered with items.
        var flag = Assert.Single(AdminEconomyRules.FindNewAccountFunnels(new[] { Trade("main", "new", toItems: AdminEconomyRules.FunnelItems) }, created));
        Assert.Equal("main", flag.ReceiverId);
        Assert.Equal(AdminEconomyRules.FunnelItems, flag.Items);
    }

    [Fact]
    public void SmallAmountsAddUpAcrossFreshAccounts()
    {
        var created = new Dictionary<string, DateTime> { ["n1"] = Now.AddHours(-1), ["n2"] = Now.AddHours(-1), ["main"] = Now.AddYears(-1) };
        var half = AdminEconomyRules.FunnelCoins / 2;

        var flag = Assert.Single(AdminEconomyRules.FindNewAccountFunnels(new[] { Trade("n1", "main", fromCoins: half), Trade("n2", "main", fromCoins: half) }, created));

        Assert.Equal(half * 2, flag.Coins);
        Assert.Equal(new[] { "n1", "n2" }, flag.GiverIds);
    }

    [Fact]
    public void BelowTheThresholdNothingIsFlagged()
    {
        var created = new Dictionary<string, DateTime> { ["new"] = Now.AddHours(-1), ["main"] = Now.AddYears(-1) };
        Assert.Empty(AdminEconomyRules.FindNewAccountFunnels(
            new[] { Trade("new", "main", fromCoins: AdminEconomyRules.FunnelCoins - 1, fromItems: AdminEconomyRules.FunnelItems - 1) }, created));
    }

    [Fact]
    public void AnAccountOlderThanADayIsNotFresh()
    {
        var created = new Dictionary<string, DateTime> { ["old"] = Now.AddHours(-25), ["main"] = Now.AddYears(-1) };
        Assert.Empty(AdminEconomyRules.FindNewAccountFunnels(new[] { Trade("old", "main", fromCoins: 9000) }, created));
    }

    [Fact]
    public void AnUnknownAccountIsNotCalledFresh()
    {
        Assert.Empty(AdminEconomyRules.FindNewAccountFunnels(new[] { Trade("ghost", "main", fromCoins: 9000) }, new Dictionary<string, DateTime>()));
    }

    // ------------------------------------------------------------------ repeated pairs

    [Fact]
    public void TradesBackAndForthCountAsOnePair()
    {
        var trades = Enumerable.Range(0, AdminEconomyRules.RepeatedPairTrades)
            .Select(i => i % 2 == 0 ? Trade("a", "b") : Trade("b", "a")).ToList();

        var flag = Assert.Single(AdminEconomyRules.FindRepeatedPairs(trades));

        Assert.Equal(AdminEconomyRules.RepeatedPairTrades, flag.Trades);
        Assert.Equal(new[] { "a", "b" }, new[] { flag.FirstId, flag.SecondId });
    }

    [Fact]
    public void FewerTradesThanTheThresholdAreNormal()
    {
        var trades = Enumerable.Range(0, AdminEconomyRules.RepeatedPairTrades - 1).Select(_ => Trade("a", "b")).ToList();
        Assert.Empty(AdminEconomyRules.FindRepeatedPairs(trades));
    }

    // ------------------------------------------------------------------ flows

    [Fact]
    public void EveryDayOfTheWindowHasARow_OldestFirst()
    {
        var day = AdminEconomyRules.MarketDayOf(Now);
        var rows = AdminEconomyRules.BuildFlowDays(Now, 7, new[]
        {
            new FlowFact(day, AdminEconomyRules.FlowStarter, 1000),
            new FlowFact(day, AdminEconomyRules.FlowChestShop, 300),
            new FlowFact(day.AddDays(-6), AdminEconomyRules.FlowAdminIn, 50),
            new FlowFact(day.AddDays(-6), AdminEconomyRules.FlowAdminOut, 20),
            new FlowFact(day.AddDays(-7), AdminEconomyRules.FlowAdminIn, 9999), // outside the window
        });

        Assert.Equal(7, rows.Count);
        Assert.Equal(day.AddDays(-6), rows[0].Day);
        Assert.Equal(day, rows[^1].Day);
        Assert.Equal(1000, rows[^1].Starter);
        Assert.Equal(300, rows[^1].ChestShop);
        Assert.Equal(700, rows[^1].Net);
        Assert.Equal(50, rows[0].AdminIn);
        Assert.Equal(20, rows[0].AdminOut);
        Assert.Equal(30, rows[0].Net);
        Assert.Equal(0, rows[1].Net);
    }

    [Theory]
    [InlineData(7, 7)]
    [InlineData(30, 30)]
    [InlineData(0, 7)]
    [InlineData(90, 30)]
    [InlineData(8, 7)]
    public void OnlySevenOrThirtyDayWindowsExist(int asked, int expected) =>
        Assert.Equal(expected, AdminEconomyRules.NormalizeDays(asked));

    // ------------------------------------------------------------------ csv

    [Theory]
    [InlineData("plain", "plain")]
    [InlineData("a,b", "\"a,b\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("line\nbreak", "\"line\nbreak\"")]
    [InlineData("=1+1", "'=1+1")]   // a name must not run as a formula in a spreadsheet
    [InlineData("+84 90", "'+84 90")]
    [InlineData("-5", "'-5")]
    [InlineData("@cmd", "'@cmd")]
    [InlineData("=a,b", "\"'=a,b\"")]
    public void CsvFieldsAreEscaped(string value, string expected) => Assert.Equal(expected, AdminEconomyRules.CsvField(value));
}
