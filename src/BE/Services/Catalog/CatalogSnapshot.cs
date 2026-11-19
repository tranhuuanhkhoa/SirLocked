using MongoDB.Bson;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Weekly;

namespace SirLocked.Api.Services.Catalog;

/// <summary>How one item type is drawn, in the form the API sends it.</summary>
public sealed record ItemVisual(
    string? IconKey,
    string? ImageUrl,
    string? BuiltinId,
    string? Template,
    IReadOnlyDictionary<string, object?> Params);

/// <summary>
/// One immutable reading of the whole catalog. Take it once per operation so everything that operation sees is
/// consistent. <see cref="All"/> keeps retired items, because owned copies still need their names and icons;
/// <see cref="ChestDef.Items"/> leaves them out, because they can no longer drop.
/// </summary>
public sealed class CatalogSnapshot
{
    private readonly Dictionary<string, MarketItemDef> _byId;
    private readonly Dictionary<string, ChestDef> _chestsById;

    private CatalogSnapshot(
        IReadOnlyList<MarketItemDef> all,
        IReadOnlyList<ChestDef> chests,
        IReadOnlyList<LevelReward> levelRewards,
        IReadOnlyList<AchievementDef> achievements,
        long rareXp,
        long epicXp,
        IReadOnlyList<string> problems)
    {
        All = all;
        Chests = chests;
        ActiveChests = chests.Where(chest => chest.Active).ToList();
        LevelRewards = levelRewards;
        Achievements = achievements;
        RareXp = rareXp;
        EpicXp = epicXp;
        Problems = problems;
        _byId = all.ToDictionary(def => def.Id, StringComparer.Ordinal);
        _chestsById = chests.ToDictionary(chest => chest.Id, StringComparer.Ordinal);
    }

    public IReadOnlyList<MarketItemDef> All { get; }
    /// <summary>Every chest in display order, switched off or not. A chest someone already owns must stay resolvable.</summary>
    public IReadOnlyList<ChestDef> Chests { get; }
    public IReadOnlyList<ChestDef> ActiveChests { get; }
    public IReadOnlyList<LevelReward> LevelRewards { get; }
    public IReadOnlyList<AchievementDef> Achievements { get; }
    public long RareXp { get; }
    public long EpicXp { get; }
    /// <summary>What did not add up in the stored data. The provider logs it; players are served the rest.</summary>
    public IReadOnlyList<string> Problems { get; }

    public MarketItemDef? Find(string? id) => id is not null && _byId.TryGetValue(id, out var def) ? def : null;

    public ChestDef? FindChest(string? id) => id is not null && _chestsById.TryGetValue(id, out var chest) ? chest : null;

    public long XpValue(MarketItemDef def) => ProgressRules.XpValue(def, RareXp, EpicXp);

    public static CatalogSnapshot Build(
        IEnumerable<CatalogItem> items,
        IEnumerable<CatalogChest> chests,
        IEnumerable<CatalogLevelReward> levelRewards,
        IEnumerable<CatalogAchievement> achievements,
        ProgressSettingsDocument? progress,
        IEnumerable<string>? loadProblems = null)
    {
        var problems = new List<string>(loadProblems ?? Array.Empty<string>());
        var orderedChests = chests.OrderBy(chest => chest.SortOrder).ThenBy(chest => chest.Id, StringComparer.Ordinal).ToList();
        foreach (var chest in orderedChests)
        {
            // Stored as null by a hand edit. Such a chest pays out nothing and cannot be bought, which the checks below report.
            chest.Pool ??= new List<string>();
            chest.DropWeights ??= new Dictionary<string, int>(StringComparer.Ordinal);
            chest.Prices ??= new CatalogChestPrices();
        }
        var activeChests = orderedChests.Where(chest => chest.Active).ToList();

        var defs = new List<MarketItemDef>();
        foreach (var item in items.OrderBy(item => item.SortOrder).ThenBy(item => item.Id, StringComparer.Ordinal))
        {
            if (MarketCategories.IsValid(item.Category) && MarketRarities.IsValid(item.Rarity)) defs.Add(ToDef(item, activeChests));
            else problems.Add($"Item {item.Id} was left out: category \"{item.Category}\" and rarity \"{item.Rarity}\" must both be valid.");
        }
        var byId = defs.ToDictionary(def => def.Id, StringComparer.Ordinal);

        var chestDefs = orderedChests.Select(chest => ToChest(chest, byId, problems)).ToList();

        var rewards = levelRewards
            .OrderBy(reward => reward.Level).ThenBy(reward => reward.DefId, StringComparer.Ordinal)
            .Select(reward => new LevelReward(reward.Level, reward.DefId))
            .ToList();
        // Granting one of these would put an item in an inventory with no type behind it.
        foreach (var reward in rewards.Where(reward => !byId.ContainsKey(reward.DefId)))
            problems.Add($"Level reward {reward.Level} points at unknown item {reward.DefId}; it was left out.");
        rewards.RemoveAll(reward => !byId.ContainsKey(reward.DefId));

        var titles = achievements
            .OrderBy(achievement => achievement.SortOrder).ThenBy(achievement => achievement.TitleDefId, StringComparer.Ordinal)
            .Select(achievement => new AchievementDef(
                achievement.TitleDefId, achievement.Target, AchievementMetrics.CounterOf(achievement.Metric), achievement.Metric))
            .ToList();
        foreach (var title in titles.Where(title => title.Metric is not null && !title.Countable))
            problems.Add($"Achievement {title.TitleDefId} uses unknown metric {title.Metric}; nobody can earn it until that is fixed.");
        foreach (var title in titles.Where(title => !byId.ContainsKey(title.TitleDefId)))
            problems.Add($"Achievement {title.TitleDefId} names a title that does not exist; it was left out.");
        titles.RemoveAll(title => !byId.ContainsKey(title.TitleDefId));

        return new CatalogSnapshot(
            defs, chestDefs, rewards, titles,
            progress?.RareXp ?? ProgressRules.RareXp,
            progress?.EpicXp ?? ProgressRules.EpicXp,
            problems);
    }

    private static MarketItemDef ToDef(CatalogItem item, IReadOnlyList<CatalogChest> activeChests)
    {
        var (description, descriptionEn) = CosmeticCatalog.IsCosmetic(item.Category) && string.IsNullOrWhiteSpace(item.Description)
            ? CosmeticDescription(item, activeChests)
            : (item.Description, item.DescriptionEn);
        var visual = item.Visual ?? new CatalogVisual();
        return new MarketItemDef(
            item.Id, item.Category, item.Rarity, item.Name, item.NameEn, description, descriptionEn, item.ReferencePrice,
            visual.IconKey, item.Tradable,
            new ItemVisual(visual.IconKey, visual.ImageUrl, visual.BuiltinId, visual.Template, ToDictionary(visual.Params)),
            item.Retired);
    }

    /// <summary>A cosmetic says where it drops by reading the pools, so moving it between chests needs no rewriting.</summary>
    private static (string Vi, string En) CosmeticDescription(CatalogItem item, IReadOnlyList<CatalogChest> activeChests)
    {
        var (kindVi, kindEn) = CosmeticCatalog.Kind(item.Category);
        var sources = activeChests.Where(chest => chest.Pool.Contains(item.Id, StringComparer.Ordinal)).ToList();
        if (sources.Count == 0) return ($"{kindVi}.", $"{kindEn}.");
        if (sources.Count == activeChests.Count && activeChests.Count > 1)
            return ($"{kindVi}. Bí ẩn, ra từ mọi hòm.", $"{kindEn}. A mystery from every chest.");
        return (
            $"{kindVi}. Ra từ {string.Join(", ", sources.Select(chest => chest.Name))}.",
            $"{kindEn}. Drops from {string.Join(", ", sources.Select(chest => $"the {chest.NameEn}"))}.");
    }

    private static ChestDef ToChest(CatalogChest chest, IReadOnlyDictionary<string, MarketItemDef> byId, ICollection<string> problems)
    {
        var pool = new List<MarketItemDef>();
        foreach (var defId in chest.Pool)
        {
            if (!byId.TryGetValue(defId, out var def)) problems.Add($"Chest {chest.Id} lists unknown item {defId}.");
            else if (!def.Retired) pool.Add(def);
        }
        var rates = MarketRarities.All
            .Select(rarity => new ChestDropRate(rarity, chest.DropWeights.GetValueOrDefault(rarity)))
            .ToList();
        foreach (var rate in rates.Where(rate => rate.Weight > 0 && pool.All(def => def.Rarity != rate.Rarity)))
            problems.Add($"Chest {chest.Id} can roll {rate.Rarity} but has no such item left; that roll falls to the nearest rarity.");
        if (MarketRules.ValidatePrice(chest.Prices.Chest) is not null || MarketRules.ValidatePrice(chest.Prices.Key) is not null)
            problems.Add($"Chest {chest.Id} has an invalid price (chest {chest.Prices.Chest}, key {chest.Prices.Key}); the shop refuses to sell at it.");
        return new ChestDef(
            chest.Id, chest.KeyDefId, chest.Name, chest.NameEn, chest.Subtitle, chest.SubtitleEn,
            chest.KeyName, chest.KeyNameEn, chest.IconKey, chest.KeyIconKey, pool,
            rates, new ChestShopPrice(chest.Prices.Chest, chest.Prices.Key), chest.Active, chest.Look,
            WeeklyDropRules.EffectiveWeight(chest));
    }

    private static IReadOnlyDictionary<string, object?> ToDictionary(BsonDocument? document) =>
        document is null ? new Dictionary<string, object?>() : document.ToDictionary()!;
}
