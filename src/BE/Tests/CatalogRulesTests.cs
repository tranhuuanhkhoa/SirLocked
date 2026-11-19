using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

public class CatalogRulesTests
{
    private static (CatalogChest Chest, Dictionary<string, CatalogItem> Items) Seal()
    {
        var batch = CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow);
        return (batch.Chests.Single(chest => chest.Id == "chest_np"), batch.Items.ToDictionary(item => item.Id));
    }

    private static IEnumerable<string> CodesOf(IEnumerable<CatalogRuleViolation> violations) => violations.Select(v => v.Code);

    [Theory]
    [InlineData("chest_np")]
    [InlineData("chest_nb")]
    [InlineData("chest_sm")]
    public void EverySeededChestPasses(string chestId)
    {
        var batch = CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow);
        var chest = batch.Chests.Single(c => c.Id == chestId);

        Assert.Empty(CatalogRules.ValidateChest(chest, batch.Items.ToDictionary(item => item.Id)));
    }

    [Fact]
    public void WeightsMustTotalTenThousand()
    {
        var (chest, items) = Seal();
        chest.DropWeights[MarketRarities.Common] += 1;

        var violation = Assert.Single(CatalogRules.ValidateChest(chest, items));

        Assert.Equal(CatalogRuleCodes.WeightsTotal, violation.Code);
        Assert.Contains("10", violation.Message);
    }

    [Fact]
    public void WeightsMayNotBeNegativeEvenWhenTheTotalIsRight()
    {
        var (chest, items) = Seal();
        chest.DropWeights[MarketRarities.Mystery] = -1;
        chest.DropWeights[MarketRarities.Common] += 27;

        Assert.Contains(CatalogRuleCodes.WeightInvalid, CodesOf(CatalogRules.ValidateChest(chest, items)));
    }

    [Fact]
    public void ARarityThatDoesNotExistIsRejected()
    {
        var (chest, items) = Seal();
        chest.DropWeights["ULTRA"] = 1;
        chest.DropWeights[MarketRarities.Common] -= 1;

        Assert.Contains(CatalogRuleCodes.WeightInvalid, CodesOf(CatalogRules.ValidateChest(chest, items)));
    }

    [Fact]
    public void ARarityWithWeightNeedsAnItem()
    {
        var (chest, items) = Seal();
        chest.Pool.RemoveAll(defId => items[defId].Rarity == MarketRarities.Mystery);

        Assert.Contains(CatalogRuleCodes.RarityEmpty, CodesOf(CatalogRules.ValidateChest(chest, items)));
    }

    [Fact]
    public void RetiredItemsDoNotCountAsAnItemOfTheirRarity()
    {
        var (chest, items) = Seal();
        foreach (var defId in chest.Pool.Where(id => items[id].Rarity == MarketRarities.Mystery)) items[defId].Retired = true;

        Assert.Contains(CatalogRuleCodes.RarityEmpty, CodesOf(CatalogRules.ValidateChest(chest, items)));
    }

    [Fact]
    public void ARarityWithoutWeightMayStayEmpty()
    {
        var (chest, items) = Seal();
        chest.Pool.RemoveAll(defId => items[defId].Rarity == MarketRarities.Mystery);
        chest.DropWeights[MarketRarities.Common] += chest.DropWeights[MarketRarities.Mystery];
        chest.DropWeights[MarketRarities.Mystery] = 0;

        Assert.Empty(CatalogRules.ValidateChest(chest, items));
    }

    [Fact]
    public void ThePoolMayOnlyNameItemsThatExist()
    {
        var (chest, items) = Seal();
        chest.Pool.Add("no_such_item");

        Assert.Contains(CatalogRuleCodes.PoolUnknownItem, CodesOf(CatalogRules.ValidateChest(chest, items)));
    }

    [Theory]
    [InlineData("chest_nb")]
    [InlineData("key_nb")]
    public void ChestsAndKeysCannotDropFromAChest(string defId)
    {
        var (chest, items) = Seal();
        chest.Pool.Add(defId);

        Assert.Contains(CatalogRuleCodes.PoolForbiddenItem, CodesOf(CatalogRules.ValidateChest(chest, items)));
    }

    [Fact]
    public void OpeningMustCostMoreThanItPaysOnAverage()
    {
        var (chest, items) = Seal();
        var expected = CatalogRules.ExpectedValue(chest, items);

        chest.Prices = new CatalogChestPrices { Chest = 2, Key = (long)Math.Floor(expected) - 2 };
        var violation = Assert.Single(CatalogRules.ValidateChest(chest, items));
        Assert.Equal(CatalogRuleCodes.ExpectedValueTooHigh, violation.Code);

        chest.Prices = new CatalogChestPrices { Chest = 2, Key = (long)Math.Ceiling(expected) };
        Assert.Empty(CatalogRules.ValidateChest(chest, items));
    }

    [Fact]
    public void ExpectedValueEqualToTheCostIsRejected()
    {
        var (chest, items) = Seal();
        foreach (var defId in chest.Pool) items[defId].ReferencePrice = 100;
        chest.Prices = new CatalogChestPrices { Chest = 40, Key = 60 };

        Assert.Equal(100m, CatalogRules.ExpectedValue(chest, items));
        Assert.Contains(CatalogRuleCodes.ExpectedValueTooHigh, CodesOf(CatalogRules.ValidateChest(chest, items)));
    }

    [Fact]
    public void ExpectedValueAgreesWithWhatARollPays()
    {
        var batch = CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow);
        var snapshot = CatalogSnapshot.Build(batch.Items, batch.Chests, batch.LevelRewards, batch.Achievements, batch.Progress);
        var items = batch.Items.ToDictionary(item => item.Id);

        foreach (var chest in batch.Chests)
            Assert.Equal(snapshot.FindChest(chest.Id)!.ExpectedValue(), CatalogRules.ExpectedValue(chest, items));
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(-5L)]
    [InlineData(long.MaxValue / 4)]
    public void PricesMustPassTheMarketLimits(long price)
    {
        var (chest, items) = Seal();
        chest.Prices = new CatalogChestPrices { Chest = price, Key = 100_000 };

        Assert.Contains(CatalogRuleCodes.PriceInvalid, CodesOf(CatalogRules.ValidateChest(chest, items)));
        Assert.NotNull(CatalogRules.ValidatePrice("Giá", price));
    }

    [Fact]
    public void AValidPriceHasNoViolation() => Assert.Null(CatalogRules.ValidatePrice("Giá", 500));

    [Fact]
    public void ATypeWithOwnedCopiesCannotBeDeleted()
    {
        var violation = CatalogRules.ValidateDelete("VC-0217", 3, Array.Empty<string>());

        Assert.Equal(CatalogRuleCodes.DefinitionOwned, violation!.Code);
        Assert.Contains("VC-0217", violation.Message);
        Assert.Null(CatalogRules.ValidateDelete("VC-0217", 0, Array.Empty<string>()));
    }

    [Fact]
    public void ATypeSomethingStillPointsAtCannotBeDeleted()
    {
        var batch = CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow);
        string[] References(string defId) => CatalogRules.ReferencesTo(defId, batch.Chests, batch.LevelRewards, batch.Achievements).ToArray();

        Assert.Contains(References("VC-0217"), text => text.Contains("Hòm Niêm Phong", StringComparison.Ordinal));
        Assert.Contains(References("chest_np"), text => text.Contains("Hòm Niêm Phong", StringComparison.Ordinal));
        Assert.Contains(References("key_np"), text => text.Contains("Hòm Niêm Phong", StringComparison.Ordinal));
        Assert.Contains(References("frame_dong"), text => text.Contains("cấp 10", StringComparison.Ordinal));
        Assert.Contains(References("title_huyet-kiem"), text => text.Contains("thành tích", StringComparison.Ordinal));
        Assert.Empty(References("mag_brass"));

        var violation = CatalogRules.ValidateDelete("VC-0217", 0, References("VC-0217"));
        Assert.Equal(CatalogRuleCodes.DefinitionInUse, violation!.Code);
        Assert.Contains("Hòm Niêm Phong", violation.Message);
        Assert.Null(CatalogRules.ValidateDelete("mag_brass", 0, References("mag_brass")));
    }

    [Theory]
    [InlineData("VC-0217", "VC-0217", false)]
    [InlineData("VC-0217", "VC-0218", true)]
    [InlineData("VC-0217", "vc-0217", true)]
    [InlineData("VC-0217", null, true)]
    public void ADefIdNeverChanges(string current, string? submitted, bool rejected)
    {
        var violation = CatalogRules.ValidateDefIdUnchanged(current, submitted);

        Assert.Equal(rejected, violation is not null);
        if (rejected) Assert.Equal(CatalogRuleCodes.DefinitionIdChanged, violation!.Code);
    }
}
