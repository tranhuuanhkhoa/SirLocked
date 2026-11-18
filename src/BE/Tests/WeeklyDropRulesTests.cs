using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Weekly;
using Xunit;

namespace SirLocked.Tests;

/// <summary>Which chests the weekly challenge can drop, and with what odds. Null weight means the default for that chest id.</summary>
public sealed class WeeklyDropRulesTests
{
    private sealed class ScriptedRandom(params int[] values) : IChestRandom
    {
        private readonly Queue<int> _values = new(values);

        public int NextInt(int exclusiveMax) => _values.Count > 0 ? _values.Dequeue() : 0;
    }

    private static CatalogSeedBatch Seed() => CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow);

    private static CatalogSnapshot Build(CatalogSeedBatch batch) =>
        CatalogSnapshot.Build(batch.Items, batch.Chests, batch.LevelRewards, batch.Achievements, batch.Progress);

    [Fact]
    public void Odds_DefaultsAre60_30_10()
    {
        var odds = WeeklyDropRules.Odds(CatalogSeedData.ToSnapshot(new ChestSettings()).Chests);

        Assert.Equal(new[] { "chest_np", "chest_sm", "chest_nb" }, odds.Select(odd => odd.Chest.Id));
        Assert.Equal(new[] { 60.00m, 30.00m, 10.00m }, odds.Select(odd => odd.Percent));
    }

    [Fact]
    public void Odds_IgnoresInactiveAndZero()
    {
        var batch = Seed();
        batch.Chests.Single(chest => chest.Id == "chest_nb").Active = false;
        batch.Chests.Single(chest => chest.Id == "chest_sm").ChallengeWeight = 0;

        var odds = WeeklyDropRules.Odds(Build(batch).Chests);

        var only = Assert.Single(odds);
        Assert.Equal("chest_np", only.Chest.Id);
        Assert.Equal(100.00m, only.Percent);
    }

    [Fact]
    public void Odds_EmptyWhenNothingDrops()
    {
        var batch = Seed();
        foreach (var chest in batch.Chests) chest.ChallengeWeight = 0;

        var odds = WeeklyDropRules.Odds(Build(batch).Chests);

        Assert.Empty(odds);
        Assert.Null(WeeklyDropRules.RollChest(odds, new ScriptedRandom(0)));
    }

    [Theory]
    [InlineData(0, "chest_np")]
    [InlineData(59, "chest_np")]
    [InlineData(60, "chest_sm")]
    [InlineData(89, "chest_sm")]
    [InlineData(90, "chest_nb")]
    [InlineData(99, "chest_nb")]
    public void RollChest_FollowsTheWeights(int ticket, string expected)
    {
        var odds = WeeklyDropRules.Odds(CatalogSeedData.ToSnapshot(new ChestSettings()).Chests);

        var chest = WeeklyDropRules.RollChest(odds, new ScriptedRandom(ticket));

        Assert.Equal(expected, chest?.Id);
    }

    [Fact]
    public void EffectiveWeight_NullUsesDefault_ExplicitWins()
    {
        Assert.Equal(60, WeeklyDropRules.EffectiveWeight(new CatalogChest { Id = "chest_np", ChallengeWeight = null }));
        Assert.Equal(0, WeeklyDropRules.EffectiveWeight(new CatalogChest { Id = "chest_np", ChallengeWeight = 0 }));
        Assert.Equal(0, WeeklyDropRules.EffectiveWeight(new CatalogChest { Id = "chest_new", ChallengeWeight = null }));
        Assert.Equal(25, WeeklyDropRules.EffectiveWeight(new CatalogChest { Id = "chest_new", ChallengeWeight = 25 }));
    }

    [Fact]
    public void Percents_ShareTheActiveChestsWithAWeight_AndShowZeroForTheRest()
    {
        var chests = new List<CatalogChest>
        {
            new() { Id = "chest_np", Active = true, ChallengeWeight = 30 },
            new() { Id = "chest_sm", Active = true, ChallengeWeight = null }, // default 30
            new() { Id = "chest_nb", Active = true, ChallengeWeight = null }, // default 10
            new() { Id = "chest_off", Active = false, ChallengeWeight = 500 },
            new() { Id = "chest_zero", Active = true, ChallengeWeight = 0 },
            new() { Id = "chest_new", Active = true, ChallengeWeight = null }, // default 0
        };

        var percents = WeeklyDropRules.Percents(chests);

        Assert.Equal(42.86m, percents["chest_np"]);
        Assert.Equal(42.86m, percents["chest_sm"]);
        Assert.Equal(14.29m, percents["chest_nb"]);
        Assert.Equal(0m, percents["chest_off"]);
        Assert.Equal(0m, percents["chest_zero"]);
        Assert.Equal(0m, percents["chest_new"]);
    }

    [Fact]
    public void Percents_AreAllZeroWhenNothingCanDrop()
    {
        var percents = WeeklyDropRules.Percents(new[] { new CatalogChest { Id = "chest_np", Active = false } });

        Assert.Equal(0m, percents["chest_np"]);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(10_001)]
    public void ValidateChest_RejectsNegativeOrHugeChallengeWeight(int weight)
    {
        var batch = Seed();
        var chest = batch.Chests.Single(c => c.Id == "chest_np");
        chest.ChallengeWeight = weight;

        var violation = Assert.Single(CatalogRules.ValidateChest(chest, batch.Items.ToDictionary(item => item.Id)));

        Assert.Equal(CatalogRuleCodes.WeightInvalid, violation.Code);
        Assert.Contains("Thử thách tuần", violation.Message);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10_000)]
    public void ValidateChest_AcceptsTheLimits(int weight)
    {
        var batch = Seed();
        var chest = batch.Chests.Single(c => c.Id == "chest_np");
        chest.ChallengeWeight = weight;

        Assert.Empty(CatalogRules.ValidateChest(chest, batch.Items.ToDictionary(item => item.Id)));
    }

    [Fact]
    public void ChestDef_CarriesTheEffectiveWeight()
    {
        var batch = Seed();
        batch.Chests.Single(chest => chest.Id == "chest_sm").ChallengeWeight = 5;
        var snapshot = Build(batch);

        Assert.Equal(60, snapshot.FindChest("chest_np")!.ChallengeWeight);
        Assert.Equal(5, snapshot.FindChest("chest_sm")!.ChallengeWeight);
        Assert.Equal(10, snapshot.FindChest("chest_nb")!.ChallengeWeight);
    }
}
