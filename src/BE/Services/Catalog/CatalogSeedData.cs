using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Catalog;

/// <summary>Everything one seed version adds. Each list holds only what is new in that version.</summary>
public sealed record CatalogSeedBatch(
    IReadOnlyList<CatalogItem> Items,
    IReadOnlyList<CatalogChest> Chests,
    IReadOnlyList<CatalogLevelReward> LevelRewards,
    IReadOnlyList<CatalogAchievement> Achievements,
    ProgressSettingsDocument? Progress,
    Func<CatalogStore, CancellationToken, Task<int>>? Upgrade = null);

/// <summary>
/// Turns the static catalogs (MarketCatalog, ChestCatalog, CosmeticCatalog, AchievementRules, ProgressRules) into
/// documents. Those classes are seed data only: at runtime everything reads ICatalogProvider.
/// To add seed later, raise <see cref="CurrentVersion"/> and return only the new entries for that version.
/// </summary>
public static class CatalogSeedData
{
    public const int CurrentVersion = 4;

    // Same colours as CHEST_LOOKS in src/FE/Client/js/pages/chest/chestSprites.js.
    private static CatalogChestLook LookOf(string iconKey) => iconKey switch
    {
        "chest_seal" => new() { Template = "seal", Light = "240,164,58", Hi = "255,222,150", Core = "255,236,190" },
        "chest_bank" => new() { Template = "bank", Light = "120,190,230", Hi = "205,235,255", Core = "236,248,255" },
        "chest_lacquer" => new() { Template = "lacquer", Light = "70,200,150", Hi = "170,250,210", Core = "222,255,238" },
        _ => throw new ArgumentOutOfRangeException(nameof(iconKey), iconKey, "A seeded chest needs a look."),
    };

    public static CatalogSeedBatch ForVersion(int version, ChestSettings prices, DateTime now) => version switch
    {
        1 => Version1(prices, now),
        2 => Version2(now),
        3 => Version3(now),
        4 => Version4(),
        _ => throw new ArgumentOutOfRangeException(nameof(version), version, "No such catalog seed version."),
    };

    private static CatalogSeedBatch Version1(ChestSettings prices, DateTime now)
    {
        var drops = ChestCatalog.Chests
            .SelectMany(chest => chest.Items)
            .Where(def => CosmeticCatalog.IsCosmetic(def.Category))
            .Select(def => def.Id)
            .ToHashSet(StringComparer.Ordinal);

        // The outfits and their chest came later (versions 2 and 3); SortOrder still follows MarketCatalog.All.
        var items = MarketCatalog.All
            .Select((def, index) => ToItem(def, index))
            .Where(item => !Later.Contains(item.Id))
            .ToList();

        CatalogItem ToItem(MarketItemDef def, int index) => new()
        {
            Id = def.Id,
            Category = def.Category,
            Rarity = def.Rarity,
            Name = def.Name,
            NameEn = def.NameEn,
            // A cosmetic that drops from chests gets its description from the pools it sits in.
            Description = drops.Contains(def.Id) ? string.Empty : def.Description,
            DescriptionEn = drops.Contains(def.Id) ? string.Empty : def.DescriptionEn,
            ReferencePrice = def.ReferencePrice,
            Tradable = def.Tradable,
            Retired = false,
            SortOrder = index,
            CreatedAt = now,
            UpdatedAt = now,
            UpdatedBy = null,
            Version = 1,
            Visual = new CatalogVisual
            {
                IconKey = def.IconKey,
                BuiltinId = CosmeticCatalog.IsCosmetic(def.Category) ? BuiltinIdOf(def.Id) : null,
                Params = new BsonDocument(),
            },
        };

        var chests = ChestCatalog.Chests.Select((chest, index) =>
        {
            var price = prices.PriceOf(chest.Id);
            return new CatalogChest
            {
                Id = chest.Id,
                KeyDefId = chest.KeyDefId,
                Name = chest.Name,
                NameEn = chest.NameEn,
                Subtitle = chest.Subtitle,
                SubtitleEn = chest.SubtitleEn,
                KeyName = chest.KeyName,
                KeyNameEn = chest.KeyNameEn,
                IconKey = chest.IconKey,
                KeyIconKey = chest.KeyIconKey,
                Look = LookOf(chest.IconKey),
                Prices = new CatalogChestPrices { Chest = price.Chest, Key = price.Key },
                DropWeights = ChestCatalog.DropRates.ToDictionary(rate => rate.Rarity, rate => rate.Weight, StringComparer.Ordinal),
                Pool = chest.Items.Select(def => def.Id).ToList(),
                Active = true,
                SortOrder = index,
                Version = 1,
                UpdatedBy = null,
                CreatedAt = now,
                UpdatedAt = now,
            };
        }).ToList();

        var levelRewards = CosmeticCatalog.LevelRewards
            .Select(reward => new CatalogLevelReward { Id = CatalogLevelReward.IdOf(reward.Level, reward.DefId), Level = reward.Level, DefId = reward.DefId })
            .ToList();

        var achievements = AchievementRules.Catalog
            .Select((achievement, index) => new CatalogAchievement
            {
                TitleDefId = achievement.TitleDefId,
                Metric = achievement.Metric,
                Target = achievement.Target,
                SortOrder = index,
            })
            .ToList();

        var progress = new ProgressSettingsDocument { RareXp = ProgressRules.RareXp, EpicXp = ProgressRules.EpicXp };
        return new CatalogSeedBatch(items, chests, levelRewards, achievements, progress);
    }

    /// <summary>Version 2: the detectives' outfits (<see cref="SkinCatalog"/>). Items only; version 3 adds the chest they drop from.</summary>
    private static CatalogSeedBatch Version2(DateTime now)
    {
        var items = SkinCatalog.Outfits.Select(def => new CatalogItem
        {
            Id = def.Id,
            Category = def.Category,
            Rarity = def.Rarity,
            Name = def.Name,
            NameEn = def.NameEn,
            Description = def.Description,
            DescriptionEn = def.DescriptionEn,
            ReferencePrice = def.ReferencePrice,
            Tradable = def.Tradable,
            Retired = false,
            SortOrder = OrderOf(def.Id),
            CreatedAt = now,
            UpdatedAt = now,
            UpdatedBy = null,
            Version = 1,
            Visual = new CatalogVisual { ImageUrl = def.Visual?.ImageUrl, Params = new BsonDocument() },
        }).ToList();
        return new CatalogSeedBatch(items, Array.Empty<CatalogChest>(), Array.Empty<CatalogLevelReward>(), Array.Empty<CatalogAchievement>(), null);
    }

    /// <summary>
    /// Version 3: the Whitechapel chest and its key, the one chest the outfits drop from. A new chest only: the chests
    /// that already exist, and whatever an admin changed in them, stay exactly as they are.
    /// </summary>
    private static CatalogSeedBatch Version3(DateTime now)
    {
        var items = SkinCatalog.ChestAndKey.Select(def => new CatalogItem
        {
            Id = def.Id,
            Category = def.Category,
            Rarity = def.Rarity,
            Name = def.Name,
            NameEn = def.NameEn,
            Description = def.Description,
            DescriptionEn = def.DescriptionEn,
            ReferencePrice = def.ReferencePrice,
            Tradable = def.Tradable,
            Retired = false,
            SortOrder = OrderOf(def.Id),
            CreatedAt = now,
            UpdatedAt = now,
            UpdatedBy = null,
            Version = 1,
            Visual = new CatalogVisual { IconKey = def.IconKey, Params = new BsonDocument() },
        }).ToList();

        var chests = SkinCatalog.Chests.Select((chest, index) => new CatalogChest
        {
            Id = chest.Id,
            KeyDefId = chest.KeyDefId,
            Name = chest.Name,
            NameEn = chest.NameEn,
            Subtitle = chest.Subtitle,
            SubtitleEn = chest.SubtitleEn,
            KeyName = chest.KeyName,
            KeyNameEn = chest.KeyNameEn,
            IconKey = chest.IconKey,
            KeyIconKey = chest.KeyIconKey,
            Look = SkinCatalog.WhitechapelLook(),
            Prices = new CatalogChestPrices { Chest = chest.Prices.Chest, Key = chest.Prices.Key },
            DropWeights = chest.DropRates.ToDictionary(rate => rate.Rarity, rate => rate.Weight, StringComparer.Ordinal),
            Pool = chest.Items.Select(def => def.Id).ToList(),
            Active = true,
            SortOrder = ChestCatalog.Chests.Count + index,
            Version = 1,
            UpdatedBy = null,
            CreatedAt = now,
            UpdatedAt = now,
        }).ToList();
        return new CatalogSeedBatch(items, chests, Array.Empty<CatalogLevelReward>(), Array.Empty<CatalogAchievement>(), null);
    }

    /// <summary>
    /// Version 4: the Whitechapel chest gets its own drawing. Version 3 gave it the Sealed Case's; a database that still
    /// has that one is moved to the new drawing, chest and chest item alike. An admin who picked another drawing keeps it.
    /// </summary>
    private static CatalogSeedBatch Version4() => new(
        Array.Empty<CatalogItem>(), Array.Empty<CatalogChest>(), Array.Empty<CatalogLevelReward>(), Array.Empty<CatalogAchievement>(), null,
        UpgradeWhitechapelDrawingAsync);

    private static async Task<int> UpgradeWhitechapelDrawingAsync(CatalogStore store, CancellationToken ct)
    {
        const string oldTemplate = "seal", oldIcon = "chest_seal";
        var chest = await store.Chests.UpdateOneAsync(
            c => c.Id == SkinCatalog.WhitechapelChestId && c.Look.Template == oldTemplate && c.IconKey == oldIcon,
            Builders<CatalogChest>.Update
                .Set(c => c.Look.Template, SkinCatalog.WhitechapelTemplate)
                .Set(c => c.IconKey, SkinCatalog.WhitechapelIcon),
            cancellationToken: ct);
        var item = await store.Items.UpdateOneAsync(
            i => i.Id == SkinCatalog.WhitechapelChestId && i.Visual.IconKey == oldIcon,
            Builders<CatalogItem>.Update.Set(i => i.Visual.IconKey, SkinCatalog.WhitechapelIcon),
            cancellationToken: ct);
        return (int)(chest.ModifiedCount + item.ModifiedCount);
    }

    /// <summary>What versions 2 and 3 add, kept out of version 1.</summary>
    private static readonly HashSet<string> Later = SkinCatalog.ItemDefs.Select(def => def.Id).ToHashSet(StringComparer.Ordinal);

    private static int OrderOf(string defId) => MarketCatalog.All.Select(def => def.Id).ToList().IndexOf(defId);

    /// <summary>"frame_kimlong" becomes "kimlong": the id of the drawing code once the category prefix is gone.</summary>
    private static string BuiltinIdOf(string defId)
    {
        foreach (var prefix in new[] { CosmeticCatalog.FramePrefix, CosmeticCatalog.TitlePrefix, CosmeticCatalog.EntrancePrefix })
        {
            if (defId.StartsWith(prefix, StringComparison.Ordinal)) return defId[prefix.Length..];
        }
        return defId;
    }

    /// <summary>What a database that has taken every seed version holds. Used before the first load and when no provider is wired.</summary>
    public static CatalogSnapshot ToSnapshot(ChestSettings prices)
    {
        var now = DateTime.UtcNow;
        var batches = Enumerable.Range(1, CurrentVersion).Select(version => ForVersion(version, prices, now)).ToList();
        return CatalogSnapshot.Build(
            batches.SelectMany(batch => batch.Items),
            batches.SelectMany(batch => batch.Chests),
            batches.SelectMany(batch => batch.LevelRewards),
            batches.SelectMany(batch => batch.Achievements),
            batches.Select(batch => batch.Progress).LastOrDefault(progress => progress is not null));
    }
}
