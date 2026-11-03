using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

public class ProgressRulesTests
{
    // ----- XP curve

    [Theory]
    [InlineData(1, 200)]
    [InlineData(2, 240)]
    [InlineData(10, 560)]
    [InlineData(49, 2120)]
    public void XpToNext_FollowsThePrototypeFormula(int level, int expected) =>
        Assert.Equal(expected, ProgressRules.XpToNext(level));

    [Fact]
    public void TheWholeClimbToLevelFifty_Costs56840Xp()
    {
        var total = Enumerable.Range(1, ProgressRules.MaxLevel - 1).Sum(ProgressRules.XpToNext);
        Assert.Equal(56840, total);
        Assert.Equal((ProgressRules.MaxLevel, 0), ProgressRules.Apply(1, 0, total));
        Assert.Equal((ProgressRules.MaxLevel - 1, ProgressRules.XpToNext(49) - 1), ProgressRules.Apply(1, 0, total - 1));
    }

    // ----- applying XP

    [Fact]
    public void Apply_BelowTheNextLevel_OnlyAddsXp() =>
        Assert.Equal((1, 150), ProgressRules.Apply(1, 0, 150));

    [Fact]
    public void Apply_ExactlyTheNextLevel_LevelsUpWithNoRemainder() =>
        Assert.Equal((2, 0), ProgressRules.Apply(1, 50, 150));

    [Fact]
    public void Apply_CanClimbSeveralLevelsInOneGo()
    {
        // 200 + 240 + 280 + 320 = 1040 reaches level 5; 160 is left toward level 6.
        Assert.Equal((5, 160), ProgressRules.Apply(1, 0, 1200));
    }

    [Fact]
    public void Apply_StopsAtTheCap_AndDropsTheRest()
    {
        Assert.Equal((50, 0), ProgressRules.Apply(49, 2000, 600));
        Assert.Equal((50, 0), ProgressRules.Apply(1, 0, 10_000_000));
    }

    [Fact]
    public void Apply_AtTheCap_ChangesNothing() =>
        Assert.Equal((50, 0), ProgressRules.Apply(50, 0, 600));

    // ----- milestones

    [Theory]
    [InlineData(1, 9, new int[0])]
    [InlineData(9, 10, new[] { 10 })]
    [InlineData(10, 19, new int[0])]
    [InlineData(10, 20, new[] { 20 })]
    [InlineData(9, 31, new[] { 10, 20, 30 })]
    [InlineData(1, 50, new[] { 10, 20, 30, 40, 50 })]
    [InlineData(50, 50, new int[0])]
    public void MilestonesBetween_ListsEveryTenLevelsCrossed(int from, int to, int[] expected) =>
        Assert.Equal(expected, ProgressRules.MilestonesBetween(from, to));

    // ----- what can be exchanged

    private static MarketItemDef Def(string category, string rarity, bool tradable = true) =>
        new("x", category, rarity, "x", "x", "", "", 1, null, tradable);

    [Theory]
    [InlineData(MarketRarities.Rare, 150)]
    [InlineData(MarketRarities.Epic, 600)]
    public void XpValue_PaysByRarity(string rarity, long xp) =>
        Assert.Equal(xp, ProgressRules.XpValue(Def(MarketCategories.Curio, rarity)));

    [Theory]
    [InlineData(MarketRarities.Common)]
    [InlineData(MarketRarities.Legendary)]
    [InlineData(MarketRarities.Mystery)]
    public void OtherRarities_CannotBeExchanged(string rarity)
    {
        Assert.False(ProgressRules.IsExchangeable(Def(MarketCategories.Curio, rarity)));
        Assert.Equal(0, ProgressRules.XpValue(Def(MarketCategories.Curio, rarity)));
    }

    [Theory]
    [InlineData(MarketCategories.Chest)]
    [InlineData(MarketCategories.Key)]
    public void ChestsAndKeys_AreNeverExchangeable_WhateverTheirRarity(string category) =>
        Assert.False(ProgressRules.IsExchangeable(Def(category, MarketRarities.Rare)));

    [Fact]
    public void EarnedCosmetics_CannotBeExchanged_SoLevelRewardsCannotBeFarmed()
    {
        // Frame "Bạc Nguyệt" is RARE, but burning it would let the level grant hand it back for free XP.
        var silver = MarketCatalog.Find("frame_bac")!;
        Assert.Equal(MarketRarities.Rare, silver.Rarity);
        Assert.False(ProgressRules.IsExchangeable(silver));
    }

    [Fact]
    public void ChestCosmetics_AreExchangeableLikeAnyOtherRareOrEpicItem()
    {
        Assert.Equal(150, ProgressRules.XpValue(MarketCatalog.Find("frame_thach")!));
        Assert.Equal(600, ProgressRules.XpValue(MarketCatalog.Find("frame_mac")!));
    }
}
