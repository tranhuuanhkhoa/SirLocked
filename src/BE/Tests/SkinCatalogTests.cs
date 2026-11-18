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
        var sherlock = Assert.Single(SkinCatalog.ItemDefs, def => def.Category == MarketCategories.SkinSherlock);
        var watson = Assert.Single(SkinCatalog.ItemDefs, def => def.Category == MarketCategories.SkinWatson);

        Assert.Equal(SkinCatalog.SherlockWhitechapel, sherlock.Id);
        Assert.Equal(SkinCatalog.WatsonWhitechapel, watson.Id);
        Assert.All(SkinCatalog.ItemDefs, def =>
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

        Assert.Equal(2, CatalogSeedData.CurrentVersion);
        Assert.DoesNotContain(one.Items, item => SkinCatalog.IsSkin(item.Category));
        Assert.Equal(SkinCatalog.ItemDefs.Select(def => def.Id), two.Items.Select(item => item.Id));
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
