using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

public class AdminChestsRulesTests
{
    private static CatalogItem Item(string id, string rarity, long price, bool retired = false, string category = MarketCategories.Curio) => new()
    {
        Id = id, Category = category, Rarity = rarity, Name = id, NameEn = id, ReferencePrice = price, Retired = retired,
        Visual = new CatalogVisual { IconKey = "lantern" },
    };

    /// <summary>80% Common split over two items, 20% Rare with one live item and one retired. Costs 100 + 200.</summary>
    private static (CatalogChest Chest, Dictionary<string, CatalogItem> Items) Fixture()
    {
        var items = new[]
        {
            Item("c1", MarketRarities.Common, 10),
            Item("c2", MarketRarities.Common, 30),
            Item("r1", MarketRarities.Rare, 100),
            Item("r2", MarketRarities.Rare, 900, retired: true),
            Item("e1", MarketRarities.Epic, 500),
        }.ToDictionary(item => item.Id, StringComparer.Ordinal);
        var chest = new CatalogChest
        {
            Id = "chest_x", KeyDefId = "key_x",
            Name = "Hòm X", NameEn = "Chest X", Subtitle = "Phụ đề", SubtitleEn = "Subtitle", KeyName = "chìa X", KeyNameEn = "key X",
            IconKey = "chest_seal", KeyIconKey = "key_loupe",
            Look = new CatalogChestLook { Template = "seal", Light = "240,164,58", Hi = "255,222,150", Core = "255,236,190" },
            Prices = new CatalogChestPrices { Chest = 100, Key = 200 },
            DropWeights = new Dictionary<string, int> { [MarketRarities.Common] = 8000, [MarketRarities.Rare] = 2000 },
            Pool = new List<string> { "c1", "c2", "r1", "r2" },
            Active = true,
        };
        return (chest, items);
    }

    private static CatalogChest Copy(CatalogChest chest) => AdminChestsRules.Clone(chest);

    private static IEnumerable<string> CodesOf(IEnumerable<CatalogRuleViolation> violations) => violations.Select(v => v.Code);

    // ------------------------------------------------------------------ the table

    [Fact]
    public void AValidTablePasses()
    {
        var (chest, items) = Fixture();

        Assert.Empty(AdminChestsRules.Validate(chest, chest, items));
    }

    [Fact]
    public void WeightsThatDoNotTotalTenThousandAreRefused()
    {
        var (chest, items) = Fixture();
        var draft = Copy(chest);
        draft.DropWeights[MarketRarities.Common] = 7000;

        var violation = Assert.Single(AdminChestsRules.Validate(chest, draft, items));

        Assert.Equal(CatalogRuleCodes.WeightsTotal, violation.Code);
    }

    [Fact]
    public void ARarityWithAWeightButNoLiveItemIsRefused()
    {
        var (chest, items) = Fixture();
        var draft = Copy(chest);
        draft.Pool.Remove("r1"); // r2 is still listed, but it is retired.

        Assert.Contains(CatalogRuleCodes.RarityEmpty, CodesOf(AdminChestsRules.Validate(chest, draft, items)));
    }

    [Fact]
    public void ATableThatPaysOutMoreThanItCostsIsRefused()
    {
        var (chest, items) = Fixture();
        var draft = Copy(chest);
        draft.Prices.Chest = 2;
        draft.Prices.Key = 2;

        Assert.Contains(CatalogRuleCodes.ExpectedValueTooHigh, CodesOf(AdminChestsRules.Validate(chest, draft, items)));
    }

    [Fact]
    public void TheSameItemTwiceInAPoolIsRefused_BecauseItWouldDoubleItsChance()
    {
        var (chest, items) = Fixture();
        var draft = Copy(chest);
        draft.Pool.Add("c1");

        Assert.Contains(AdminChestsRules.PoolDuplicate, CodesOf(AdminChestsRules.Validate(chest, draft, items)));
    }

    [Fact]
    public void ARetiredItemCannotBeAdded()
    {
        var (chest, items) = Fixture();
        chest.Pool.Remove("r2");
        var draft = Copy(chest);
        draft.Pool.Add("r2");

        Assert.Contains(AdminChestsRules.PoolRetiredItem, CodesOf(AdminChestsRules.Validate(chest, draft, items)));
    }

    [Fact]
    public void ARetiredItemAlreadyListedMayStay()
    {
        var (chest, items) = Fixture();

        Assert.DoesNotContain(AdminChestsRules.PoolRetiredItem, CodesOf(AdminChestsRules.Validate(chest, Copy(chest), items)));
    }

    [Theory]
    [InlineData("granite")]
    [InlineData("")]
    public void AnUnknownDrawingIsRefused(string template)
    {
        var (chest, items) = Fixture();
        var draft = Copy(chest);
        draft.Look.Template = template;

        Assert.Contains(AdminChestsRules.LookInvalid, CodesOf(AdminChestsRules.Validate(chest, draft, items)));
    }

    [Theory]
    [InlineData("256,0,0")]
    [InlineData("red")]
    [InlineData("1,2")]
    [InlineData("1,2,3);background:url(x")]
    public void ALightColourMustBeThreeBytes(string colour)
    {
        var (chest, items) = Fixture();
        var draft = Copy(chest);
        draft.Look.Light = colour;

        Assert.Contains(AdminChestsRules.LookInvalid, CodesOf(AdminChestsRules.Validate(chest, draft, items)));
    }

    [Fact]
    public void AChestNeedsItsNames()
    {
        var (chest, items) = Fixture();
        var draft = Copy(chest);
        draft.Name = "   ";
        draft.KeyNameEn = "";

        Assert.Equal(2, CodesOf(AdminChestsRules.Validate(chest, draft, items)).Count(code => code == AdminChestsRules.TextInvalid));
    }

    // ------------------------------------------------------------------ the real rate of each item

    [Fact]
    public void EachItemGetsItsRaritysChanceDividedByTheLiveItemsOfThatRarity()
    {
        var (chest, items) = Fixture();

        var rates = AdminChestsRules.ItemRates(chest, items);

        Assert.Equal(40m, rates["c1"]);
        Assert.Equal(40m, rates["c2"]);
        Assert.Equal(20m, rates["r1"]);
    }

    [Fact]
    public void ARetiredItemHasNoChance()
    {
        var (chest, items) = Fixture();

        Assert.Equal(0m, AdminChestsRules.ItemRates(chest, items)["r2"]);
    }

    [Fact]
    public void AnItemWhoseRarityHasNoWeightHasNoChance()
    {
        var (chest, items) = Fixture();
        chest.Pool.Add("e1");

        Assert.Equal(0m, AdminChestsRules.ItemRates(chest, items)["e1"]);
    }

    // ------------------------------------------------------------------ comparing two versions

    [Fact]
    public void ADiffListsItemsAddedAndRemovedAndWeightsChanged()
    {
        var (before, _) = Fixture();
        var after = Copy(before);
        after.Pool.Remove("c2");
        after.Pool.Add("e1");
        after.DropWeights[MarketRarities.Common] = 7000;
        after.DropWeights[MarketRarities.Rare] = 2000;
        after.DropWeights[MarketRarities.Epic] = 1000;

        var diff = AdminChestsRules.Diff(before, after);

        Assert.Equal(new[] { "e1" }, diff.Added);
        Assert.Equal(new[] { "c2" }, diff.Removed);
        Assert.Equal(new[]
        {
            new AdminChestWeightChange(MarketRarities.Common, 80m, 70m),
            new AdminChestWeightChange(MarketRarities.Epic, 0m, 10m),
        }, diff.Weights);
        Assert.False(diff.IsEmpty);
    }

    [Fact]
    public void ADiffNamesEveryOtherFieldThatChanged()
    {
        var (before, _) = Fixture();
        var after = Copy(before);
        after.Name = "Hòm Y";
        after.Prices.Key = 250;
        after.Active = false;
        after.Look.Hi = "1,2,3";

        var fields = AdminChestsRules.Diff(before, after).Fields;

        Assert.Contains(new AdminChestFieldChange("name", "Hòm X", "Hòm Y"), fields);
        Assert.Contains(new AdminChestFieldChange("prices.key", "200", "250"), fields);
        Assert.Contains(new AdminChestFieldChange("active", "true", "false"), fields);
        Assert.Contains(new AdminChestFieldChange("look.hi", "255,222,150", "1,2,3"), fields);
        Assert.Equal(4, fields.Count);
    }

    [Fact]
    public void TwoEqualVersionsHaveNoDiff_EvenWithAZeroWeightSpelledOut()
    {
        var (before, _) = Fixture();
        var after = Copy(before);
        after.DropWeights[MarketRarities.Mystery] = 0;

        Assert.True(AdminChestsRules.Diff(before, after).IsEmpty);
    }

    [Fact]
    public void Diff_ReportsChallengeWeight()
    {
        var (before, _) = Fixture();
        before.Id = "chest_np";
        before.ChallengeWeight = null; // the default for chest_np, 60
        var after = Copy(before);
        after.ChallengeWeight = 25;

        var diff = AdminChestsRules.Diff(before, after);

        Assert.Equal(new AdminChestFieldChange("challengeWeight", "60", "25"), Assert.Single(diff.Fields));
        Assert.False(diff.IsEmpty);
    }

    [Fact]
    public void Diff_TreatsNoWeightAndTheSpelledOutDefaultAsTheSame()
    {
        var (before, _) = Fixture();
        before.Id = "chest_np";
        before.ChallengeWeight = null;
        var after = Copy(before);
        after.ChallengeWeight = 60;

        Assert.True(AdminChestsRules.Diff(before, after).IsEmpty);
    }

    [Theory]
    [InlineData(25)]
    [InlineData(0)]
    [InlineData(null)]
    public void Clone_CopiesChallengeWeight(int? weight)
    {
        var (chest, _) = Fixture();
        chest.ChallengeWeight = weight;

        Assert.Equal(weight, AdminChestsRules.Clone(chest).ChallengeWeight);
    }

    [Fact]
    public void ReorderingAPoolIsAChangeEvenWithNothingAddedOrRemoved()
    {
        var (before, _) = Fixture();
        var after = Copy(before);
        after.Pool.Reverse();

        var diff = AdminChestsRules.Diff(before, after);

        Assert.False(diff.IsEmpty);
        Assert.Empty(diff.Added);
        Assert.Empty(diff.Removed);
    }

    // ------------------------------------------------------------------ generated ids

    [Fact]
    public void TheFirstCurioIdStartsTheSeries()
    {
        Assert.Equal("CU-0001", AdminChestsRules.NextCurioId(new[] { "VC-0217", "frame_dong" }));
    }

    [Fact]
    public void ACurioIdFollowsTheHighestInUse_NotTheCount()
    {
        Assert.Equal("CU-0008", AdminChestsRules.NextCurioId(new[] { "CU-0001", "CU-0007", "VC-9000" }));
    }

    [Fact]
    public void ACurioIdKeepsGrowingPastFourDigits()
    {
        Assert.Equal("CU-10000", AdminChestsRules.NextCurioId(new[] { "CU-9999" }));
    }

    [Fact]
    public void GeneratedCurioIdsNeverRepeat()
    {
        var taken = new List<string>();
        for (var i = 0; i < 300; i++) taken.Add(AdminChestsRules.NextCurioId(taken));

        Assert.Equal(300, taken.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void ANewChestAndItsKeyShareANumberThatIsFreeForBoth()
    {
        Assert.Equal(("chest_001", "key_001"), AdminChestsRules.NextChestIds(new[] { "chest_np", "key_np" }));
        Assert.Equal(("chest_002", "key_002"), AdminChestsRules.NextChestIds(new[] { "chest_001", "key_001" }));
        Assert.Equal(("chest_003", "key_003"), AdminChestsRules.NextChestIds(new[] { "chest_001", "key_002" }));
    }

    // ------------------------------------------------------------------ items

    [Theory]
    [InlineData("seal", "chest_seal", "key_loupe")]
    [InlineData("bank", "chest_bank", "key_gear")]
    [InlineData("lacquer", "chest_lacquer", "key_jade")]
    public void EachDrawingHasItsOwnChestAndKeySprite(string template, string chestIcon, string keyIcon)
    {
        Assert.Equal((chestIcon, keyIcon), AdminChestsRules.IconsOf(template));
    }

    [Fact]
    public void AValidCurioPasses()
    {
        Assert.Empty(AdminChestsRules.ValidateItem(Item("CU-0001", MarketRarities.Rare, 500)));
    }

    [Fact]
    public void ACurioNeedsAPicture()
    {
        var item = Item("CU-0001", MarketRarities.Rare, 500);
        item.Visual = new CatalogVisual();

        Assert.Contains(AdminChestsRules.ItemIconRequired, CodesOf(AdminChestsRules.ValidateItem(item)));
    }

    [Fact]
    public void AnOldGearItemMayStayDrawnByItsCategory()
    {
        var item = Item("mag-brass", MarketRarities.Common, 40, category: MarketCategories.Magnifier);
        item.Visual = new CatalogVisual();

        Assert.Empty(AdminChestsRules.ValidateItem(item));
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:image/svg+xml,<svg/>")]
    [InlineData("http://res.cloudinary.com/x.webp")]
    [InlineData("/assets/x.webp")]
    public void AnUploadedPictureMustBeAnHttpsUrl(string url)
    {
        var item = Item("CU-0001", MarketRarities.Rare, 500);
        item.Visual = new CatalogVisual { ImageUrl = url };

        Assert.Contains(AdminChestsRules.ItemImageInvalid, CodesOf(AdminChestsRules.ValidateItem(item)));
    }

    [Theory]
    [InlineData("frame_kim long")]
    [InlineData("<svg>")]
    public void ASpriteNameIsAPlainIdentifier(string iconKey)
    {
        var item = Item("CU-0001", MarketRarities.Rare, 500);
        item.Visual = new CatalogVisual { IconKey = iconKey };

        Assert.Contains(AdminChestsRules.ItemIconInvalid, CodesOf(AdminChestsRules.ValidateItem(item)));
    }

    [Fact]
    public void AnItemNeedsNamesARealRarityAndAPriceInRange()
    {
        var item = Item("CU-0001", "SHINY", 1);
        item.Name = " ";

        var codes = CodesOf(AdminChestsRules.ValidateItem(item)).ToList();

        Assert.Contains(AdminChestsRules.TextInvalid, codes);
        Assert.Contains(AdminChestsRules.ItemRarityInvalid, codes);
        Assert.Contains(CatalogRuleCodes.PriceInvalid, codes);
    }

    [Fact]
    public void EverySeededItemThatCanBeEditedHerePassesAsItIs()
    {
        var items = CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow).Items
            .Where(item => AdminChestsRules.IsEditableHere(item.Category));

        foreach (var item in items) Assert.True(!AdminChestsRules.ValidateItem(item).Any(), $"{item.Id} would be refused.");
    }

    [Theory]
    [InlineData(MarketCategories.Frame, false)]
    [InlineData(MarketCategories.Title, false)]
    [InlineData(MarketCategories.Entrance, false)]
    [InlineData(MarketCategories.Chest, false)]
    [InlineData(MarketCategories.Key, false)]
    [InlineData(MarketCategories.Curio, true)]
    [InlineData(MarketCategories.Magnifier, true)]
    public void OnlyCuriosAndGearAreManagedOnTheItemsPage(string category, bool editable)
    {
        Assert.Equal(editable, AdminChestsRules.IsEditableHere(category));
    }
    // ------------------------------------------------------------------ the chest's own picture

    [Fact]
    public void AnUploadedChestAndKeyPicturePass()
    {
        var (chest, items) = Fixture();
        var draft = Copy(chest);
        draft.Look.ImageUrl = "https://res.cloudinary.com/demo/image/upload/v1/sirlocked/chest.png";
        draft.Look.KeyImageUrl = "/assets/chests/key-whitechapel.webp";

        Assert.Empty(AdminChestsRules.Validate(chest, draft, items));
    }

    [Theory]
    [InlineData("http://example.com/chest.png")]
    [InlineData("javascript:alert(1)")]
    [InlineData("/assets/../secret.png")]
    [InlineData("chest.png")]
    [InlineData("HTTPS://res.cloudinary.com/demo/chest.png")]
    [InlineData("https://res.cloudinary.com/demo/my chest.png")]
    [InlineData("https://res.cloudinary.com/demo/chest.png\n")]
    [InlineData("https://res.cloudinary.com/demo/chest\".png")]
    public void AChestPictureMustBeAnUploadedOrShippedPicture(string url)
    {
        var (chest, items) = Fixture();
        var draft = Copy(chest);
        draft.Look.ImageUrl = url;
        var keyDraft = Copy(chest);
        keyDraft.Look.KeyImageUrl = url;

        Assert.Contains(AdminChestsRules.ChestImageInvalid, CodesOf(AdminChestsRules.Validate(chest, draft, items)));
        Assert.Contains(AdminChestsRules.ChestImageInvalid, CodesOf(AdminChestsRules.Validate(chest, keyDraft, items)));
    }

    [Fact]
    public void ACloneKeepsThePicturesAndADiffNamesThem()
    {
        var (before, _) = Fixture();
        before.Look.ImageUrl = "https://cdn.example/a.png";
        var after = Copy(before);

        Assert.Equal("https://cdn.example/a.png", after.Look.ImageUrl);
        Assert.Null(after.Look.KeyImageUrl);

        after.Look.ImageUrl = null;
        after.Look.KeyImageUrl = "https://cdn.example/k.png";
        var fields = AdminChestsRules.Diff(before, after).Fields;

        Assert.Contains(new AdminChestFieldChange("look.imageUrl", "https://cdn.example/a.png", ""), fields);
        Assert.Contains(new AdminChestFieldChange("look.keyImageUrl", "", "https://cdn.example/k.png"), fields);
        Assert.Equal(2, fields.Count);
    }
}
