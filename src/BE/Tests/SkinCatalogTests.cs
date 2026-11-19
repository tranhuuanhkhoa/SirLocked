using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The detectives' outfits: two legendary items, one slot per detective, added by catalog seed version 2.</summary>
public class SkinCatalogTests
{
    [Fact]
    public void TheWhitechapelSetIsOneLegendaryOutfitPerDetective()
    {
        var sherlock = Assert.Single(SkinCatalog.Outfits, def => def.Category == MarketCategories.SkinSherlock);
        var watson = Assert.Single(SkinCatalog.Outfits, def => def.Category == MarketCategories.SkinWatson);

        Assert.Equal(SkinCatalog.SherlockWhitechapel, sherlock.Id);
        Assert.Equal(SkinCatalog.WatsonWhitechapel, watson.Id);
        Assert.Equal(2, SkinCatalog.Outfits.Count);
        Assert.All(SkinCatalog.Outfits, def =>
        {
            Assert.Equal(MarketRarities.Legendary, def.Rarity);
            Assert.True(def.Tradable);
            Assert.StartsWith(SkinCatalog.ImageFolder, def.Visual!.ImageUrl);
            Assert.Contains(def, MarketCatalog.All);
        });
    }

    [Fact]
    public void BothOutfitsCanBeWornAtOnceBecauseEachDetectiveHasItsOwnSlot()
    {
        Assert.Contains(MarketCategories.SkinSherlock, MarketCategories.All);
        Assert.Contains(MarketCategories.SkinWatson, MarketCategories.All);
        Assert.True(MarketCategories.IsEquippable(MarketCategories.SkinSherlock));
        Assert.True(MarketCategories.IsEquippable(MarketCategories.SkinWatson));
        Assert.NotEqual(MarketCategories.SkinSherlock, MarketCategories.SkinWatson);
        Assert.True(SkinCatalog.IsSkin(MarketCategories.SkinWatson));
        Assert.False(SkinCatalog.IsSkin(MarketCategories.Frame));
        Assert.False(CosmeticCatalog.IsCosmetic(MarketCategories.SkinSherlock));
    }

    [Fact]
    public void SeedVersionTwoAddsOnlyTheOutfitsAndVersionOneNoLongerCarriesThem()
    {
        var now = DateTime.UtcNow;
        var one = CatalogSeedData.ForVersion(1, new ChestSettings(), now);
        var two = CatalogSeedData.ForVersion(2, new ChestSettings(), now);

        Assert.Equal(4, CatalogSeedData.CurrentVersion);
        Assert.DoesNotContain(one.Items, item => SkinCatalog.ItemDefs.Any(def => def.Id == item.Id));
        Assert.DoesNotContain(one.Chests, chest => chest.Id == SkinCatalog.WhitechapelChestId);
        Assert.Equal(SkinCatalog.Outfits.Select(def => def.Id), two.Items.Select(item => item.Id));
        Assert.Empty(two.Chests);
        Assert.Empty(two.LevelRewards);
        Assert.Empty(two.Achievements);
        Assert.Null(two.Progress);
        Assert.All(two.Items, item =>
        {
            Assert.Equal(item.Id == SkinCatalog.SherlockWhitechapel ? "/assets/pixel/skins/whitechapel/icon-sherlock.png" : "/assets/pixel/skins/whitechapel/icon-watson.png", item.Visual.ImageUrl);
            Assert.Null(item.Visual.IconKey);
            Assert.Null(item.Visual.BuiltinId);
            Assert.NotEmpty(item.Description);
            Assert.Equal(MarketCatalog.All.Select(def => def.Id).ToList().IndexOf(item.Id), item.SortOrder);
        });
    }

    [Fact]
    public void SeedVersionThreeAddsTheWhitechapelChestAndItsKey()
    {
        var three = CatalogSeedData.ForVersion(3, new ChestSettings(), DateTime.UtcNow);

        Assert.Equal(new[] { SkinCatalog.WhitechapelChestId, SkinCatalog.WhitechapelKeyId }, three.Items.Select(item => item.Id));
        Assert.Equal((MarketCategories.Chest, "chest_whitechapel"), (three.Items[0].Category, three.Items[0].Visual.IconKey));
        Assert.Equal((MarketCategories.Key, "key_loupe"), (three.Items[1].Category, three.Items[1].Visual.IconKey));
        Assert.All(three.Items, item => Assert.False(item.Retired));
        var chest = Assert.Single(three.Chests);
        Assert.Equal("Hòm Đêm Whitechapel", chest.Name);
        Assert.Equal(SkinCatalog.WhitechapelKeyId, chest.KeyDefId);
        Assert.True(chest.Active);
        Assert.Equal(3, chest.SortOrder);
        Assert.Equal("whitechapel", chest.Look.Template);
        Assert.Equal(("chest_whitechapel", "key_loupe"), (chest.IconKey, chest.KeyIconKey));
        Assert.Equal("190,52,58", chest.Look.Light);
        Assert.Equal((180L, 260L), (chest.Prices.Chest, chest.Prices.Key));
        Assert.Contains(SkinCatalog.SherlockWhitechapel, chest.Pool);
        Assert.Contains(SkinCatalog.WatsonWhitechapel, chest.Pool);
        Assert.Empty(three.LevelRewards);
        Assert.Null(three.Progress);
    }

    [Fact]
    public void TheWhitechapelChestIsTheOnlyChestWithTheOutfitsAndPassesTheAdminRules()
    {
        var snapshot = CatalogSeedData.ToSnapshot(new ChestSettings());
        var items = CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow).Items
            .Concat(CatalogSeedData.ForVersion(2, new ChestSettings(), DateTime.UtcNow).Items)
            .Concat(CatalogSeedData.ForVersion(3, new ChestSettings(), DateTime.UtcNow).Items)
            .ToDictionary(item => item.Id, StringComparer.Ordinal);
        var chest = Assert.Single(CatalogSeedData.ForVersion(3, new ChestSettings(), DateTime.UtcNow).Chests);

        // Saved as is by an admin, it would pass every rule: weights add up, every weighted rarity has items, value < price.
        Assert.Empty(CatalogRules.ValidateChest(chest, items));
        Assert.Empty(AdminChestsRules.Validate(chest, chest, items));
        Assert.True(CatalogRules.ExpectedValue(chest, items) < chest.Prices.Chest + chest.Prices.Key);
        Assert.Equal(10_000, chest.DropWeights.Values.Sum());
        Assert.Equal(100, chest.DropWeights[MarketRarities.Legendary]);

        // The outfits are its legendaries, and no other chest pays them out.
        var whitechapel = snapshot.FindChest(SkinCatalog.WhitechapelChestId)!;
        Assert.Equal(new[] { SkinCatalog.SherlockWhitechapel, SkinCatalog.WatsonWhitechapel },
            whitechapel.Pools[MarketRarities.Legendary].Select(def => def.Id));
        Assert.All(snapshot.Chests.Where(other => other.Id != SkinCatalog.WhitechapelChestId),
            other => Assert.DoesNotContain(other.Items, def => SkinCatalog.IsSkin(def.Category)));
        Assert.Equal(4, snapshot.ActiveChests.Count);
    }

    [Fact]
    public void TheWhitechapelChestHasItsOwnDrawingThatAnAdminCanPick()
    {
        Assert.True(AdminChestsRules.IsKnownDrawing("whitechapel"));
        Assert.Equal(("chest_whitechapel", "key_loupe"), AdminChestsRules.IconsOf("whitechapel"));
        Assert.Equal(("chest_seal", "key_loupe"), AdminChestsRules.IconsOf("seal"));
        Assert.False(AdminChestsRules.IsKnownDrawing("Whitechapel"));

        var chest = Assert.Single(CatalogSeedData.ForVersion(3, new ChestSettings(), DateTime.UtcNow).Chests);
        var draft = AdminChestsRules.Clone(chest);
        draft.Look.Template = "nope";
        var items = CatalogSeedData.ForVersion(1, new ChestSettings(), DateTime.UtcNow).Items
            .Concat(CatalogSeedData.ForVersion(2, new ChestSettings(), DateTime.UtcNow).Items)
            .Concat(CatalogSeedData.ForVersion(3, new ChestSettings(), DateTime.UtcNow).Items)
            .ToDictionary(item => item.Id, StringComparer.Ordinal);
        Assert.Contains(AdminChestsRules.Validate(chest, draft, items), violation => violation.Message.Contains("whitechapel", StringComparison.Ordinal));
    }

    [Fact]
    public void SeedVersionFourOnlyMovesTheWhitechapelChestToItsOwnDrawing()
    {
        var four = CatalogSeedData.ForVersion(4, new ChestSettings(), DateTime.UtcNow);

        Assert.Empty(four.Items);
        Assert.Empty(four.Chests);
        Assert.Empty(four.LevelRewards);
        Assert.Empty(four.Achievements);
        Assert.Null(four.Progress);
        Assert.NotNull(four.Upgrade);
        Assert.Equal("chest_whitechapel", CatalogSeedData.ToSnapshot(new ChestSettings()).FindChest(SkinCatalog.WhitechapelChestId)!.IconKey);
    }

    [Fact]
    public void AMysteryFromEveryChestIsStillFromEveryChestWithTheFourth()
    {
        var mysteries = SkinCatalog.MysteriesFromEveryChest();
        Assert.Contains("title_long-phung", mysteries);
        var snapshot = CatalogSeedData.ToSnapshot(new ChestSettings());
        Assert.Equal("Danh hiệu. Bí ẩn, ra từ mọi hòm.", snapshot.Find("title_long-phung")!.Description);
        Assert.All(mysteries, id => Assert.Contains(id, SkinCatalog.WhitechapelPool()));
    }

    [Fact]
    public void ADatabaseThatTookBothVersionsListsEveryItemInCatalogOrder()
    {
        var snapshot = CatalogSeedData.ToSnapshot(new ChestSettings());

        Assert.Equal(MarketCatalog.All.Select(def => def.Id), snapshot.All.Select(def => def.Id));
        Assert.Equal("/assets/pixel/skins/whitechapel/icon-watson.png", snapshot.Find(SkinCatalog.WatsonWhitechapel)!.Visual!.ImageUrl);
    }

    [Fact]
    public void TheAdminItemFormKeepsAcceptingTheShippedIcon()
    {
        var item = new CatalogItem
        {
            Id = SkinCatalog.SherlockWhitechapel,
            Category = MarketCategories.SkinSherlock,
            Rarity = MarketRarities.Legendary,
            Name = SkinCatalog.ItemDefs[0].Name,
            NameEn = SkinCatalog.ItemDefs[0].NameEn,
            Description = SkinCatalog.ItemDefs[0].Description,
            DescriptionEn = SkinCatalog.ItemDefs[0].DescriptionEn,
            ReferencePrice = SkinCatalog.ItemDefs[0].ReferencePrice,
            Visual = new CatalogVisual { ImageUrl = SkinCatalog.ItemDefs[0].Visual!.ImageUrl },
        };

        Assert.Empty(AdminChestsRules.ValidateItem(item));
        Assert.True(AdminChestsRules.IsEditableHere(MarketCategories.SkinSherlock));
    }

    [Theory]
    [InlineData("/assets/pixel/skins/whitechapel/icon-sherlock.png", true)]
    [InlineData("/assets/pixel/skins/x.webp", true)]
    [InlineData("/assets/../appsettings.json", false)]
    [InlineData("/assets/pixel/../../x.png", false)]
    [InlineData("//evil.example/assets/x.png", false)]
    [InlineData("/uploads/x.png", false)]
    [InlineData("/assets/x.svg", false)]
    [InlineData("http://example.com/x.png", false)]
    [InlineData("/assets/x.png?y=1", false)]
    public void OnlyPicturesShippedUnderAssetsCountAsSiteAssets(string url, bool expected)
    {
        Assert.Equal(expected, AdminChestsRules.IsSiteAsset(url));
    }

    [Fact]
    public void OnlyAnOutfitMayPointUnderAssetsAnythingElseStillNeedsAnUpload()
    {
        var curio = new CatalogItem
        {
            Id = "curio_y", Category = MarketCategories.Curio, Rarity = MarketRarities.Common, Name = "Y", NameEn = "Y",
            ReferencePrice = 10, Visual = new CatalogVisual { ImageUrl = "/assets/pixel/skins/whitechapel/icon-watson.png" },
        };
        var outfit = new CatalogItem
        {
            Id = "skin_x", Category = MarketCategories.SkinWatson, Rarity = MarketRarities.Legendary, Name = "Y", NameEn = "Y",
            ReferencePrice = 10, Visual = new CatalogVisual { ImageUrl = "/assets/../secret.png" },
        };

        Assert.Contains(AdminChestsRules.ValidateItem(curio), violation => violation.Code == AdminChestsRules.ItemImageInvalid);
        Assert.Contains(AdminChestsRules.ValidateItem(outfit), violation => violation.Code == AdminChestsRules.ItemImageInvalid);
    }

    [Fact]
    public void AnUploadedPictureStillHasToBeHttps()
    {
        var item = new CatalogItem
        {
            Id = "curio_x", Category = MarketCategories.Curio, Rarity = MarketRarities.Common, Name = "X", NameEn = "X",
            ReferencePrice = 10, Visual = new CatalogVisual { ImageUrl = "http://example.com/x.png" },
        };

        Assert.Contains(AdminChestsRules.ValidateItem(item), violation => violation.Code == AdminChestsRules.ItemImageInvalid);
    }
}
