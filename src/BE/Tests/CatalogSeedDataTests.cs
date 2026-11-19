using System.Text.Json;
using SirLocked.Api.Configurations;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

/// <summary>Moving the catalog into MongoDB must change nothing a player can see: the seed reads back as exactly what the static classes held.</summary>
public class CatalogSeedDataTests
{
    private static readonly CatalogSnapshot Seeded = CatalogSeedData.ToSnapshot(new ChestSettings());
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static string Json(MarketItemDef def) => JsonSerializer.Serialize(MarketService.ToDefDto(def with { Visual = null }), Web);

    [Fact]
    public void EveryItemKeepsItsIdOrderAndEveryPlayerVisibleField()
    {
        Assert.Equal(MarketCatalog.All.Select(def => def.Id), Seeded.All.Select(def => def.Id));
        Assert.All(MarketCatalog.All, expected => Assert.Equal(Json(expected), Json(Seeded.Find(expected.Id)!)));
    }

    [Fact]
    public void EveryChestKeepsItsTextPoolAndOdds()
    {
        var chests = ChestCatalog.Chests.Concat(SkinCatalog.Chests).ToList();
        Assert.Equal(chests.Select(chest => chest.Id), Seeded.Chests.Select(chest => chest.Id));
        foreach (var expected in chests)
        {
            var actual = Seeded.FindChest(expected.Id)!;
            Assert.Equal(expected.KeyDefId, actual.KeyDefId);
            Assert.Equal(expected.Name, actual.Name);
            Assert.Equal(expected.NameEn, actual.NameEn);
            Assert.Equal(expected.Subtitle, actual.Subtitle);
            Assert.Equal(expected.SubtitleEn, actual.SubtitleEn);
            Assert.Equal(expected.KeyName, actual.KeyName);
            Assert.Equal(expected.KeyNameEn, actual.KeyNameEn);
            Assert.Equal(expected.IconKey, actual.IconKey);
            Assert.Equal(expected.KeyIconKey, actual.KeyIconKey);
            Assert.Equal(expected.Items.Select(def => def.Id), actual.Items.Select(def => def.Id));
            Assert.Equal(expected.DropRates, actual.DropRates);
            Assert.True(actual.Active);
            Assert.Equal(expected.ExpectedValue(), actual.ExpectedValue());
        }
    }

    [Fact]
    public void PricesComeFromTheChestsConfiguration()
    {
        var settings = new ChestSettings();
        settings.Prices["chest_np"] = new ChestPrice { Chest = 999, Key = 1234 };

        var chest = CatalogSeedData.ToSnapshot(settings).FindChest("chest_np")!;

        Assert.Equal(new ChestShopPrice(999, 1234), chest.Prices);
        Assert.Equal(new ChestShopPrice(170, 250), CatalogSeedData.ToSnapshot(settings).FindChest("chest_nb")!.Prices);
    }

    [Fact]
    public void LevelRewardsAchievementsAndXpRatesAreCarriedOver()
    {
        Assert.Equal(CosmeticCatalog.LevelRewards, Seeded.LevelRewards);
        Assert.Equal(
            AchievementRules.Catalog.Select(def => (def.TitleDefId, def.Target, def.Metric, def.Countable)),
            Seeded.Achievements.Select(def => (def.TitleDefId, def.Target, def.Metric, def.Countable)));
        Assert.Equal(ProgressRules.RareXp, Seeded.RareXp);
        Assert.Equal(ProgressRules.EpicXp, Seeded.EpicXp);
    }

    [Fact]
    public void AchievementsCountWhatTheyCountedBeforeTheirMetricsGotNames()
    {
        var stats = new PlayerStats(Played: 1, Won: 2, MidnightWins: 3, NoHintWins: 4, CluesFound: 5, TestimoniesRecorded: 6, OwnsWatch217: true);
        var counts = AchievementRules.Evaluate(stats, Seeded.Achievements).ToDictionary(a => a.Def.TitleDefId, a => a.Count);

        Assert.Equal(1, counts["title_khach-quen"]);
        Assert.Equal(6, counts["title_ghi-chep"]);
        Assert.Equal(5, counts["title_mat-tinh"]);
        Assert.Equal(0, counts["title_tho-khoa"]);
        Assert.Equal(3, counts["title_bach-nguyet"]);
        Assert.Equal(4, counts["title_doc-dau-vet"]);
        Assert.Equal(2, counts["title_huyet-kiem"]);
        Assert.Equal(1, counts["title_giu-gio"]);
    }

    [Theory]
    [InlineData("frame_kimlong", "kimlong", "frame_kimlong")]
    [InlineData("title_long-phung", "long-phung", "title_long-phung")]
    [InlineData("entrance_van-kiem", "van-kiem", "entrance_van-kiem")]
    [InlineData("VC-0217", null, "watch")]
    [InlineData("chest_np", null, "chest_seal")]
    [InlineData("mag_brass", null, null)]
    public void VisualsFollowTheContract(string defId, string? builtinId, string? iconKey)
    {
        var visual = Seeded.Find(defId)!.Visual!;

        Assert.Equal(builtinId, visual.BuiltinId);
        Assert.Equal(iconKey, visual.IconKey);
        Assert.Null(visual.ImageUrl);
        Assert.Null(visual.Template);
        Assert.Empty(visual.Params);
    }

    [Fact]
    public void ChestLooksMatchTheDrawingsTheyAreNamedAfter()
    {
        var batch = CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow);

        Assert.Equal("seal", batch.Chests.Single(chest => chest.Id == "chest_np").Look.Template);
        Assert.Equal("bank", batch.Chests.Single(chest => chest.Id == "chest_nb").Look.Template);
        Assert.Equal("lacquer", batch.Chests.Single(chest => chest.Id == "chest_sm").Look.Template);
        Assert.All(batch.Chests, chest => Assert.Matches(@"^\d+,\d+,\d+$", chest.Look.Light));
    }
}
