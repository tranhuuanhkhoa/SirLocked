using SirLocked.Api.Configurations;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The catalog has to match the approved prototype (ho-so-src: frames.js, titles.js, fx.js) entry for entry.</summary>
public class CosmeticCatalogTests
{
    private const string Seal = "chest_np";
    private const string Bank = "chest_nb";
    private const string Lacquer = "chest_sm";

    // id, rarity, chest ids it drops from ("" when it does not come from a chest).
    public static readonly TheoryData<string, string, string> Table = new()
    {
        // ----- frames
        { "frame_dong", MarketRarities.Common, "" },
        { "frame_bac", MarketRarities.Rare, "" },
        { "frame_ngoc", MarketRarities.Epic, "" },
        { "frame_vang", MarketRarities.Legendary, "" },
        { "frame_truong", MarketRarities.Mystery, "" },
        { "frame_thach", MarketRarities.Rare, Seal },
        { "frame_mac", MarketRarities.Epic, Lacquer },
        { "frame_bang", MarketRarities.Epic, Lacquer },
        { "frame_sonmai", MarketRarities.Epic, Lacquer },
        { "frame_ulinh", MarketRarities.Legendary, Seal },
        { "frame_vankiem", MarketRarities.Legendary, Bank },
        { "frame_hacduc", MarketRarities.Legendary, Seal },
        { "frame_kimlong", MarketRarities.Mystery, Bank },
        { "frame_phuong", MarketRarities.Mystery, Lacquer },
        { "frame_tinhkhong", MarketRarities.Epic, Seal },
        { "frame_lua", MarketRarities.Legendary, Bank },
        // ----- titles
        { "title_tan-binh", MarketRarities.Common, "" },
        { "title_khach-quen", MarketRarities.Common, "" },
        { "title_ghi-chep", MarketRarities.Common, "" },
        { "title_mat-tinh", MarketRarities.Rare, "" },
        { "title_tho-khoa", MarketRarities.Rare, "" },
        { "title_san-manh-moi", MarketRarities.Rare, Seal },
        { "title_bach-nguyet", MarketRarities.Rare, "" },
        { "title_an-si", MarketRarities.Epic, Lacquer },
        { "title_doc-dau-vet", MarketRarities.Epic, "" },
        { "title_van-tay", MarketRarities.Epic, "" },
        { "title_han-bang", MarketRarities.Epic, Lacquer },
        { "title_anh-dao", MarketRarities.Epic, Lacquer },
        { "title_mac-thu", MarketRarities.Epic, Seal },
        { "title_tinh-khong", MarketRarities.Epic, Seal },
        { "title_vo-song", MarketRarities.Legendary, Bank },
        { "title_huyet-kiem", MarketRarities.Legendary, "" },
        { "title_bong-ma", MarketRarities.Legendary, Seal },
        { "title_tham-tu-truong", MarketRarities.Legendary, "" },
        { "title_hoa-luan", MarketRarities.Legendary, Bank },
        { "title_hac-duc", MarketRarities.Legendary, Seal },
        { "title_long-phung", MarketRarities.Mystery, $"{Seal},{Bank},{Lacquer}" },
        { "title_kim-long", MarketRarities.Mystery, Bank },
        { "title_giu-gio", MarketRarities.Mystery, "" },
        { "title_phuong-hoang", MarketRarities.Mystery, Lacquer },
        { "title_thien-menh", MarketRarities.Mystery, Seal },
        // ----- entrances
        { "entrance_lang-le", MarketRarities.Common, "" },
        { "entrance_anh-trang", MarketRarities.Rare, Seal },
        { "entrance_mac-vu", MarketRarities.Epic, Lacquer },
        { "entrance_truc-lam", MarketRarities.Epic, Lacquer },
        { "entrance_van-kiem", MarketRarities.Legendary, Bank },
        { "entrance_huyet-nguyet", MarketRarities.Legendary, Bank },
        { "entrance_hac-duc", MarketRarities.Legendary, Seal },
        { "entrance_than-tham", MarketRarities.Legendary, Seal },
        { "entrance_kim-long", MarketRarities.Mystery, Bank },
        { "entrance_phuong-hoang", MarketRarities.Mystery, Lacquer },
    };

    [Theory]
    [MemberData(nameof(Table))]
    public void EveryEntry_HasItsMappedRarity_AndDropsFromExactlyTheRightChests(string id, string rarity, string chests)
    {
        var def = MarketCatalog.Find(id);
        Assert.NotNull(def);
        Assert.Equal(rarity, def!.Rarity);
        var expected = chests.Split(',', StringSplitOptions.RemoveEmptyEntries).OrderBy(c => c).ToArray();
        var actual = ChestCatalog.Chests.Where(chest => chest.Items.Any(item => item.Id == id)).Select(chest => chest.Id).OrderBy(c => c).ToArray();
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void TheCatalogHolds_ExactlyThePrototypeEntries()
    {
        Assert.Equal(16, MarketCatalog.All.Count(def => def.Category == MarketCategories.Frame));
        Assert.Equal(25, MarketCatalog.All.Count(def => def.Category == MarketCategories.Title));
        Assert.Equal(10, MarketCatalog.All.Count(def => def.Category == MarketCategories.Entrance));
        var listed = Table.Select(row => (string)row[0]).OrderBy(id => id, StringComparer.Ordinal);
        Assert.Equal(listed, CosmeticCatalog.ItemDefs.Select(def => def.Id).OrderBy(id => id, StringComparer.Ordinal));
        Assert.Null(MarketCatalog.Find("frame_none"));
    }

    [Theory]
    [InlineData("frame_", MarketCategories.Frame)]
    [InlineData("title_", MarketCategories.Title)]
    [InlineData("entrance_", MarketCategories.Entrance)]
    public void Ids_CarryTheirCategoryAsAPrefix_BecauseTitlesAndEntrancesShareNames(string prefix, string category)
    {
        Assert.All(CosmeticCatalog.ItemDefs.Where(def => def.Id.StartsWith(prefix, StringComparison.Ordinal)),
            def => Assert.Equal(category, def.Category));
        Assert.NotNull(MarketCatalog.Find("title_hac-duc"));
        Assert.NotNull(MarketCatalog.Find("entrance_hac-duc"));
    }

    [Fact]
    public void EveryEntry_HasBothLanguages_AndAnIcon()
    {
        Assert.All(CosmeticCatalog.ItemDefs, def =>
        {
            Assert.False(string.IsNullOrWhiteSpace(def.Name));
            Assert.False(string.IsNullOrWhiteSpace(def.NameEn));
            Assert.False(string.IsNullOrWhiteSpace(def.Description));
            Assert.False(string.IsNullOrWhiteSpace(def.DescriptionEn));
            Assert.False(string.IsNullOrWhiteSpace(def.IconKey));
            Assert.True(def.ReferencePrice > 0);
        });
    }

    // ----- categories

    [Theory]
    [InlineData(MarketCategories.Frame)]
    [InlineData(MarketCategories.Title)]
    [InlineData(MarketCategories.Entrance)]
    public void CosmeticCategories_AreValidAndEquippable(string category)
    {
        Assert.Contains(category, MarketCategories.All);
        Assert.True(MarketCategories.IsEquippable(category));
    }

    // ----- how they are obtained

    [Fact]
    public void LevelRewards_AreTheTenLevelFrames_AndTheTwoLevelTitles()
    {
        var rewards = CosmeticCatalog.LevelRewards.Select(reward => (reward.Level, reward.DefId)).ToArray();
        Assert.Equal(new[]
        {
            (10, "frame_dong"),
            (20, "frame_bac"),
            (30, "frame_ngoc"),
            (30, "title_van-tay"),
            (40, "frame_vang"),
            (50, "frame_truong"),
            (50, "title_tham-tu-truong"),
        }, rewards);
    }

    [Fact]
    public void WhatYouEarn_CannotBeTraded_ButChestDropsCan()
    {
        var earned = CosmeticCatalog.LevelRewards.Select(reward => reward.DefId)
            .Concat(AchievementRules.Catalog.Select(achievement => achievement.TitleDefId))
            .Append(CosmeticCatalog.DefaultTitleDefId)
            .Append(CosmeticCatalog.DefaultEntranceDefId)
            .Distinct()
            .ToList();
        Assert.All(earned, id => Assert.False(MarketCatalog.Find(id)!.Tradable, $"{id} must not be tradable"));
        var drops = ChestCatalog.Chests.SelectMany(chest => chest.Items).DistinctBy(def => def.Id).ToList();
        Assert.All(drops, def => Assert.True(def.Tradable, $"{def.Id} comes from a chest and must be tradable"));
        Assert.Equal(CosmeticCatalog.ItemDefs.Count, earned.Count + drops.Count(def => CosmeticCatalog.IsCosmetic(def.Category)));
    }

    [Fact]
    public void GearAndCurios_StayTradable() =>
        Assert.All(MarketCatalog.All.Where(def => !CosmeticCatalog.IsCosmetic(def.Category)), def => Assert.True(def.Tradable));

    [Theory]
    [InlineData("nonla", true)]
    [InlineData("nu", true)]
    [InlineData("kiem", true)]
    [InlineData("qua", true)]
    [InlineData("upload", false)]
    [InlineData("../x", false)]
    [InlineData("", false)]
    public void OnlyThePresetAvatars_CanBeChosenByName(string avatar, bool valid) =>
        Assert.Equal(valid, CosmeticCatalog.IsPresetAvatar(avatar));

    // ----- chests keep their economy

    [Fact]
    public void AddingCosmetics_KeepsThePublishedOddsAndTheCuriosInEveryChest()
    {
        Assert.Equal(new[] { 7992, 1598, 320, 64, 26 }, ChestCatalog.DropRates.Select(rate => rate.Weight));
        foreach (var chest in ChestCatalog.Chests)
            Assert.Equal(10, chest.Items.Count(item => item.Category == MarketCategories.Curio));
    }

    [Theory]
    [InlineData(Seal, 24)]
    [InlineData(Bank, 20)]
    [InlineData(Lacquer, 22)]
    public void EveryChest_ListsItsCuriosAndCosmetics(string chestId, int count) =>
        Assert.Equal(count, ChestCatalog.Find(chestId)!.Items.Count);

    [Fact]
    public void OpeningAChest_StillCostsMoreThanItPaysOut_OnAverage() =>
        Assert.True(ChestSettings.IsValid(new ChestSettings()));
}
