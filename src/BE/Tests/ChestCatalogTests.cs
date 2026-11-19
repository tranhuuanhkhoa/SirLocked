using Microsoft.Extensions.Configuration;
using SirLocked.Api.Configurations;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

public class ChestCatalogTests
{
    private sealed class SeededRandom : IChestRandom
    {
        private readonly Random _random;
        public SeededRandom(int seed) => _random = new Random(seed);
        public int NextInt(int exclusiveMax) => _random.Next(exclusiveMax);
    }

    private sealed class ScriptedRandom : IChestRandom
    {
        private readonly Queue<int> _values;
        public ScriptedRandom(params int[] values) => _values = new Queue<int>(values);
        public int NextInt(int exclusiveMax) => _values.Dequeue();
    }

    // ----- drop table

    [Fact]
    public void DropRates_AddUpToExactlyOneHundredPercent()
    {
        Assert.Equal(ChestCatalog.RateDenominator, ChestCatalog.DropRates.Sum(rate => rate.Weight));
        Assert.Equal(100m, ChestCatalog.DropRates.Sum(rate => rate.Percent));
    }

    [Fact]
    public void DropRates_PublishTheApprovedOddsForEveryRarity()
    {
        var odds = ChestCatalog.DropRates.ToDictionary(rate => rate.Rarity, rate => rate.Percent);
        Assert.Equal(79.92m, odds[MarketRarities.Common]);
        Assert.Equal(15.98m, odds[MarketRarities.Rare]);
        Assert.Equal(3.20m, odds[MarketRarities.Epic]);
        Assert.Equal(0.64m, odds[MarketRarities.Legendary]);
        Assert.Equal(0.26m, odds[MarketRarities.Mystery]);
        Assert.Equal(MarketRarities.All.OrderBy(rarity => rarity), odds.Keys.OrderBy(rarity => rarity));
    }

    [Fact]
    public void Roll_OverAMillionDraws_MatchesThePublishedOdds_AndIsUniformInsideARarity()
    {
        const int draws = 1_000_000;
        var chest = ChestCatalog.Chests[0];
        var random = new SeededRandom(20261103);
        var counts = new Dictionary<string, int>();
        for (var i = 0; i < draws; i++)
        {
            var id = ChestCatalog.Roll(chest, random).Id;
            counts[id] = counts.GetValueOrDefault(id) + 1;
        }

        foreach (var rate in ChestCatalog.DropRates)
        {
            var pool = chest.Pools[rate.Rarity];
            var hits = pool.Sum(def => counts.GetValueOrDefault(def.Id));
            var percent = hits * 100d / draws;
            Assert.InRange(percent, (double)rate.Percent - 0.1, (double)rate.Percent + 0.1);
            var fairShare = hits / (double)pool.Count;
            Assert.All(pool, def => Assert.InRange(counts.GetValueOrDefault(def.Id), fairShare * 0.9, fairShare * 1.1));
        }
    }

    [Theory]
    [InlineData(0, MarketRarities.Common)]
    [InlineData(7991, MarketRarities.Common)]
    [InlineData(7992, MarketRarities.Rare)]
    [InlineData(9589, MarketRarities.Rare)]
    [InlineData(9590, MarketRarities.Epic)]
    [InlineData(9909, MarketRarities.Epic)]
    [InlineData(9910, MarketRarities.Legendary)]
    [InlineData(9973, MarketRarities.Legendary)]
    [InlineData(9974, MarketRarities.Mystery)]
    [InlineData(9999, MarketRarities.Mystery)]
    public void Roll_MapsEveryTicketBoundaryToTheRightRarity(int ticket, string rarity)
    {
        var def = ChestCatalog.Roll(ChestCatalog.Chests[0], new ScriptedRandom(ticket, 0));
        Assert.Equal(rarity, def.Rarity);
    }

    [Fact]
    public void CryptoRandom_StaysInsideTheRequestedRange()
    {
        var random = new CryptoChestRandom();
        for (var i = 0; i < 1000; i++) Assert.InRange(random.NextInt(3), 0, 2);
    }

    // ----- contents

    [Fact]
    public void EveryChest_HasItemsForEveryRarity_MatchingThePrototypeShape()
    {
        Assert.Equal(3, ChestCatalog.Chests.Count);
        foreach (var chest in ChestCatalog.Chests)
        {
            Assert.All(MarketRarities.All, rarity => Assert.NotEmpty(chest.Pools[rarity]));
            var curios = chest.Items.Where(item => item.Category == MarketCategories.Curio).ToList();
            Assert.Equal(10, curios.Count);
            Assert.Equal(3, curios.Count(item => item.Rarity == MarketRarities.Common));
            Assert.Equal(3, curios.Count(item => item.Rarity == MarketRarities.Rare));
            Assert.Equal(2, curios.Count(item => item.Rarity == MarketRarities.Epic));
            Assert.Single(curios, item => item.Rarity == MarketRarities.Legendary);
            Assert.Single(curios, item => item.Rarity == MarketRarities.Mystery);
        }
    }

    [Theory]
    [InlineData("VC-0388", "Sổ tay da bò", MarketRarities.Common)]
    [InlineData("VC-0436", "Kính lúp đồng", MarketRarities.Rare)]
    [InlineData("VC-0405", "Huy hiệu sở", MarketRarities.Epic)]      // myth → "Quý"
    [InlineData("VC-0430", "Trâm hồng ngọc", MarketRarities.Legendary)]
    [InlineData("VC-0217", "Đồng hồ 2:17", MarketRarities.Mystery)]  // gold → "Bí ẩn"
    [InlineData("NB-1199", "Lam ngọc Tràng Tiền", MarketRarities.Mystery)]
    [InlineData("SM-0399", "Ngọc bội rồng", MarketRarities.Mystery)]
    public void PrototypeItems_KeepTheirCodeNameAndMappedRarity(string id, string name, string rarity)
    {
        var def = MarketCatalog.Find(id)!;
        Assert.Equal(name, def.Name);
        Assert.Equal(rarity, def.Rarity);
        Assert.Equal(MarketCategories.Curio, def.Category);
    }

    [Fact]
    public void Catalog_ListsThreeChestsThreeKeysAndThirtyCurios_EachWithAnIconAndBothLanguages()
    {
        // The prototype's three chests; the Whitechapel chest of the outfits comes from SkinCatalog.
        Assert.Equal(3, ChestCatalog.ItemDefs.Count(def => def.Category == MarketCategories.Chest));
        Assert.Equal(3, ChestCatalog.ItemDefs.Count(def => def.Category == MarketCategories.Key));
        Assert.Equal(4, MarketCatalog.All.Count(def => def.Category == MarketCategories.Chest));
        Assert.Equal(30, MarketCatalog.All.Count(def => def.Category == MarketCategories.Curio));
        Assert.All(ChestCatalog.ItemDefs, def =>
        {
            Assert.False(string.IsNullOrWhiteSpace(def.IconKey));
            Assert.False(string.IsNullOrWhiteSpace(def.NameEn));
            Assert.False(string.IsNullOrWhiteSpace(def.DescriptionEn));
            Assert.Same(def, MarketCatalog.Find(def.Id));
        });
        Assert.All(ChestCatalog.Chests, chest =>
        {
            Assert.Equal(MarketCategories.Chest, MarketCatalog.Find(chest.Id)!.Category);
            Assert.Equal(MarketCategories.Key, MarketCatalog.Find(chest.KeyDefId)!.Category);
        });
    }

    [Fact]
    public void ReferencePrice_RisesWithRarity_InsideEveryChest()
    {
        foreach (var chest in ChestCatalog.Chests)
        {
            var ordered = MarketRarities.All.OrderBy(MarketRarities.Rank).Select(rarity => chest.Pools[rarity]).ToList();
            for (var i = 1; i < ordered.Count; i++)
                Assert.True(ordered[i].Min(def => def.ReferencePrice) > ordered[i - 1].Max(def => def.ReferencePrice),
                    $"{chest.Id}: rank {i} must cost more than rank {i - 1}");
        }
    }

    // ----- rarity & categories

    [Fact]
    public void Mystery_IsAValidRarity_RankedAboveLegendary()
    {
        Assert.True(MarketRarities.IsValid("MYSTERY"));
        Assert.Equal(4, MarketRarities.Rank(MarketRarities.Mystery));
        Assert.True(MarketRarities.Rank(MarketRarities.Mystery) > MarketRarities.Rank(MarketRarities.Legendary));
        Assert.Contains(MarketRarities.Mystery, MarketRarities.All);
    }

    [Theory]
    [InlineData(MarketCategories.Chest, false)]
    [InlineData(MarketCategories.Key, false)]
    [InlineData(MarketCategories.Curio, false)]
    [InlineData(MarketCategories.Magnifier, true)]
    [InlineData(MarketCategories.Watch, true)]
    public void OnlyGearCanBeEquipped(string category, bool equippable)
    {
        Assert.True(MarketCategories.IsValid(category));
        Assert.Equal(equippable, MarketCategories.IsEquippable(category));
    }

    // ----- prices

    [Fact]
    public void ExpectedValue_IsBelowTheCostOfOpening_ForEveryChestAtDefaultPrices()
    {
        var settings = new ChestSettings();
        foreach (var chest in ChestCatalog.Chests)
        {
            var price = settings.PriceOf(chest.Id);
            Assert.True(ChestCatalog.ExpectedValue(chest) < price.Chest + price.Key,
                $"{chest.Id}: EV {ChestCatalog.ExpectedValue(chest)} must stay below {price.Chest + price.Key}");
        }
        Assert.True(ChestSettings.IsValid(settings));
    }

    [Fact]
    public void Settings_RejectAPriceTableThatPaysOutMoreThanItCosts_OrMissesAChest()
    {
        var cheap = new ChestSettings();
        cheap.Prices["chest_np"] = new ChestPrice { Chest = 2, Key = 2 };
        Assert.False(ChestSettings.IsValid(cheap));

        var missing = new ChestSettings();
        missing.Prices.Remove("chest_nb");
        Assert.False(ChestSettings.IsValid(missing));
    }

    [Fact]
    public void AppSettings_PriceTableMatchesTheDefaultsInCode()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "ApiConfig", "appsettings.json");
        var configuration = new ConfigurationBuilder().AddJsonFile(path).Build();
        var section = configuration.GetSection("Chests:Prices");
        Assert.True(section.Exists());
        var defaults = new ChestSettings();
        foreach (var chest in ChestCatalog.Chests)
        {
            Assert.Equal(defaults.PriceOf(chest.Id).Chest, section.GetValue<long>($"{chest.Id}:Chest"));
            Assert.Equal(defaults.PriceOf(chest.Id).Key, section.GetValue<long>($"{chest.Id}:Key"));
        }
    }

    [Fact]
    public void ChestAndKey_ReferencePrices_MatchTheShopPrices()
    {
        var settings = new ChestSettings();
        foreach (var chest in ChestCatalog.Chests)
        {
            Assert.Equal(settings.PriceOf(chest.Id).Chest, MarketCatalog.Find(chest.Id)!.ReferencePrice);
            Assert.Equal(settings.PriceOf(chest.Id).Key, MarketCatalog.Find(chest.KeyDefId)!.ReferencePrice);
        }
    }
}
