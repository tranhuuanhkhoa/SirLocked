using MongoDB.Bson;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

public class CatalogSnapshotTests
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
    public void ACosmeticSaysWhereItDropsByReadingThePools()
    {
        var batch = Seed();
        var bank = batch.Chests.Single(chest => chest.Id == "chest_nb");
        bank.Pool.Add("frame_thach");

        var def = Build(batch).Find("frame_thach")!;

        Assert.Equal("Viền avatar. Ra từ Hòm Niêm Phong, Két Nhà Băng.", def.Description);
        Assert.Equal("Avatar frame. Drops from the Sealed Case, the Bank Safe.", def.DescriptionEn);
    }

    [Fact]
    public void ACosmeticLeftInNoChestStopsNamingOne()
    {
        var batch = Seed();
        batch.Chests.Single(chest => chest.Id == "chest_np").Pool.Remove("frame_thach");

        Assert.Equal("Viền avatar.", Build(batch).Find("frame_thach")!.Description);
    }

    [Fact]
    public void AChestThatIsSwitchedOffIsNotNamedAsASource()
    {
        var batch = Seed();
        batch.Chests.Single(chest => chest.Id == "chest_np").Active = false;

        var snapshot = Build(batch);

        Assert.Equal("Viền avatar.", snapshot.Find("frame_thach")!.Description);
        Assert.Equal("Danh hiệu. Bí ẩn, ra từ mọi hòm.", snapshot.Find("title_long-phung")!.Description);
        Assert.Equal(new[] { "chest_nb", "chest_sm" }, snapshot.ActiveChests.Select(chest => chest.Id));
        Assert.NotNull(snapshot.FindChest("chest_np"));
    }

    [Fact]
    public void ADescriptionAnAdminWroteIsKept()
    {
        var batch = Seed();
        var item = batch.Items.Single(i => i.Id == "frame_thach");
        item.Description = "Mô tả riêng.";
        item.DescriptionEn = "My own words.";

        var def = Build(batch).Find("frame_thach")!;

        Assert.Equal("Mô tả riêng.", def.Description);
        Assert.Equal("My own words.", def.DescriptionEn);
    }

    [Fact]
    public void ARetiredItemStopsDroppingButStaysResolvable()
    {
        var batch = Seed();
        batch.Items.Single(item => item.Id == "VC-0411").Retired = true;

        var snapshot = Build(batch);

        Assert.True(snapshot.Find("VC-0411")!.Retired);
        Assert.Contains(snapshot.All, def => def.Id == "VC-0411");
        Assert.DoesNotContain(snapshot.FindChest("chest_np")!.Items, def => def.Id == "VC-0411");
    }

    [Fact]
    public void EachChestRollsByItsOwnTable()
    {
        var batch = Seed();
        var sealTable = batch.Chests.Single(chest => chest.Id == "chest_np").DropWeights;
        sealTable[MarketRarities.Common] = 0;
        sealTable[MarketRarities.Mystery] = 10_000 - sealTable[MarketRarities.Rare] - sealTable[MarketRarities.Epic] - sealTable[MarketRarities.Legendary];

        var snapshot = Build(batch);

        // Ticket 0 would be Common under the seed table; here Common has no weight, so it lands on Rare.
        Assert.Equal(MarketRarities.Rare, snapshot.FindChest("chest_np")!.Roll(new ScriptedRandom(0, 0)).Rarity);
        Assert.Equal(MarketRarities.Common, snapshot.FindChest("chest_nb")!.Roll(new ScriptedRandom(0, 0)).Rarity);
    }

    [Fact]
    public void ARollIntoAnEmptiedRarityPaysTheNearestOneInsteadOfFailing()
    {
        var batch = Seed();
        foreach (var item in batch.Items.Where(item => item.Rarity == MarketRarities.Mystery)) item.Retired = true;

        var snapshot = Build(batch);

        Assert.Equal(MarketRarities.Legendary, snapshot.FindChest("chest_np")!.Roll(new ScriptedRandom(9999, 0)).Rarity);
        Assert.Contains(snapshot.Problems, problem => problem.Contains("chest_np", StringComparison.Ordinal) && problem.Contains(MarketRarities.Mystery, StringComparison.Ordinal));
    }

    [Fact]
    public void AnEmptiedRarityBelowFallsUpward()
    {
        var batch = Seed();
        foreach (var item in batch.Items.Where(item => item.Rarity == MarketRarities.Common)) item.Retired = true;

        var snapshot = Build(batch);

        Assert.Equal(MarketRarities.Rare, snapshot.FindChest("chest_np")!.Roll(new ScriptedRandom(0, 0)).Rarity);
    }

    [Fact]
    public void AnUnknownMetricCannotBeEarnedAndIsReported()
    {
        var batch = Seed();
        batch.Achievements.Single(a => a.TitleDefId == "title_khach-quen").Metric = "NoSuchCount";

        var snapshot = Build(batch);
        var def = snapshot.Achievements.Single(a => a.TitleDefId == "title_khach-quen");
        var progress = AchievementRules.Evaluate(new PlayerStats(99, 99, 99, 99, 99, 99, true), snapshot.Achievements)
            .Single(a => a.Def.TitleDefId == "title_khach-quen");

        Assert.False(def.Countable);
        Assert.False(progress.Earned);
        Assert.Contains(snapshot.Problems, problem => problem.Contains("NoSuchCount", StringComparison.Ordinal));
    }

    [Fact]
    public void DanglingReferencesAreReportedAndLeftOut()
    {
        var batch = Seed();
        batch.Chests.Single(chest => chest.Id == "chest_np").Pool.Add("no_such_item");
        ((List<CatalogLevelReward>)batch.LevelRewards).Add(new CatalogLevelReward { Id = "5:gone", Level = 5, DefId = "gone" });

        var snapshot = Build(batch);

        Assert.DoesNotContain(snapshot.FindChest("chest_np")!.Items, def => def.Id == "no_such_item");
        Assert.Contains(snapshot.Problems, problem => problem.Contains("no_such_item", StringComparison.Ordinal));
        Assert.Contains(snapshot.Problems, problem => problem.Contains("gone", StringComparison.Ordinal));
    }

    [Fact]
    public void TheSeedHasNoProblems() => Assert.Empty(Build(Seed()).Problems);

    [Fact]
    public void TemplateParamsReachTheVisualAsPlainValues()
    {
        var batch = Seed();
        var item = batch.Items.Single(i => i.Id == "frame_thach");
        item.Visual.Template = "painted";
        item.Visual.ImageUrl = "https://example.test/frame.webp";
        item.Visual.Params = new BsonDocument
        {
            ["hole"] = new BsonDocument { ["x"] = 120, ["y"] = 130, ["r"] = 64.5 },
            ["live"] = new BsonDocument { ["comet"] = new BsonArray { "255,200,100", 1.5, 2 } },
        };

        var visual = Build(batch).Find("frame_thach")!.Visual!;

        Assert.Equal("painted", visual.Template);
        Assert.Equal("https://example.test/frame.webp", visual.ImageUrl);
        var json = System.Text.Json.JsonSerializer.Serialize(visual.Params);
        Assert.Contains("\"hole\":{\"x\":120,\"y\":130,\"r\":64.5}", json);
        Assert.Contains("\"comet\":[\"255,200,100\",1.5,2]", json);
    }

    [Fact]
    public void XpRatesComeFromTheSettingsDocument()
    {
        var batch = Seed() with { Progress = new ProgressSettingsDocument { RareXp = 200, EpicXp = 900 } };

        var snapshot = Build(batch);

        Assert.Equal(200, snapshot.XpValue(snapshot.Find("VC-0391")!));
        Assert.Equal(900, snapshot.XpValue(snapshot.Find("VC-0405")!));
        Assert.Equal(0, snapshot.XpValue(snapshot.Find("VC-0411")!));
    }

    [Fact]
    public void TheFixedProviderServesTheSeedAndIgnoresInvalidate()
    {
        var provider = new FixedCatalogProvider(new ChestSettings());
        var before = provider.Current;

        provider.Invalidate();

        Assert.Same(before, provider.Current);
        Assert.Equal(MarketCatalog.All.Count, before.All.Count);
    }
}
