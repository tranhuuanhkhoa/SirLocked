using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>One broken rule: a stable code for code and tests, and a Vietnamese message to show the admin as is.</summary>
public sealed record CatalogRuleViolation(string Code, string Message);

public static class CatalogRuleCodes
{
    public const string DefinitionOwned = "CATALOG_DEF_OWNED";
    public const string DefinitionInUse = "CATALOG_DEF_IN_USE";
    public const string DefinitionIdChanged = "CATALOG_DEF_ID_CHANGED";
    public const string WeightsTotal = "CHEST_WEIGHTS_TOTAL";
    public const string WeightInvalid = "CHEST_WEIGHT_INVALID";
    public const string RarityEmpty = "CHEST_RARITY_EMPTY";
    public const string PoolUnknownItem = "CHEST_POOL_UNKNOWN_ITEM";
    public const string PoolForbiddenItem = "CHEST_POOL_FORBIDDEN_ITEM";
    public const string ExpectedValueTooHigh = "CHEST_EXPECTED_VALUE_TOO_HIGH";
    public const string PriceInvalid = "CATALOG_PRICE_INVALID";
}

/// <summary>
/// The rules the catalog must keep, whichever admin page changes it. Pure functions, so every agent and test shares
/// one reading of them. A write endpoint checks these on the server before it saves; see docs/admin-contracts.md.
/// </summary>
public static class CatalogRules
{
    public const int WeightDenominator = ChestCatalog.RateDenominator;

    /// <summary>
    /// An item type with copies in circulation can only be retired, never deleted. One that something still points at
    /// must be freed first (see <see cref="ReferencesTo"/>): a level reward would otherwise grant an item with no type behind it.
    /// </summary>
    public static CatalogRuleViolation? ValidateDelete(string defId, long ownedCopies, IReadOnlyCollection<string> references)
    {
        if (ownedCopies > 0)
            return new CatalogRuleViolation(CatalogRuleCodes.DefinitionOwned,
                $"Không thể xóa {defId} vì đang có {ownedCopies} bản thuộc về người chơi. Hãy cho ngừng phát hành (retired).");
        return references.Count > 0
            ? new CatalogRuleViolation(CatalogRuleCodes.DefinitionInUse,
                $"Không thể xóa {defId} vì còn được dùng ở: {string.Join(", ", references)}.")
            : null;
    }

    /// <summary>What still points at an item type, in words an admin can act on. Empty means nothing does.</summary>
    public static IReadOnlyList<string> ReferencesTo(
        string defId, IEnumerable<CatalogChest> chests, IEnumerable<CatalogLevelReward> levelRewards, IEnumerable<CatalogAchievement> achievements)
    {
        var references = new List<string>();
        foreach (var chest in chests)
        {
            if (chest.Id == defId) references.Add($"chính là {chest.Name}");
            if (chest.KeyDefId == defId) references.Add($"chìa của {chest.Name}");
            if (chest.Pool?.Contains(defId, StringComparer.Ordinal) == true) references.Add($"nội dung {chest.Name}");
        }
        references.AddRange(levelRewards.Where(reward => reward.DefId == defId).Select(reward => $"phần thưởng cấp {reward.Level}"));
        if (achievements.Any(achievement => achievement.TitleDefId == defId)) references.Add("danh hiệu thành tích");
        return references;
    }

    /// <summary>Inventories, listings and journals all point at the defId, so it stays what it was at creation.</summary>
    public static CatalogRuleViolation? ValidateDefIdUnchanged(string currentId, string? submittedId) =>
        string.Equals(currentId, submittedId, StringComparison.Ordinal)
            ? null
            : new CatalogRuleViolation(CatalogRuleCodes.DefinitionIdChanged,
                $"Mã vật phẩm {currentId} không được đổi sau khi tạo.");

    /// <summary>A shop or reference price must pass the same limits as a market price.</summary>
    public static CatalogRuleViolation? ValidatePrice(string label, long price) =>
        MarketRules.ValidatePrice(price) is null
            ? null
            : new CatalogRuleViolation(CatalogRuleCodes.PriceInvalid, $"{label} ({price:N0} xu) nằm ngoài giới hạn cho phép.");

    /// <summary>Every rule a chest must pass to be saved. Empty means it can be saved.</summary>
    public static IReadOnlyList<CatalogRuleViolation> ValidateChest(CatalogChest chest, IReadOnlyDictionary<string, CatalogItem> items)
    {
        var violations = new List<CatalogRuleViolation>();

        if (ValidatePrice("Giá hòm", chest.Prices.Chest) is { } chestPrice) violations.Add(chestPrice);
        if (ValidatePrice("Giá chìa", chest.Prices.Key) is { } keyPrice) violations.Add(keyPrice);

        foreach (var (rarity, weight) in chest.DropWeights)
        {
            if (!MarketRarities.IsValid(rarity))
                violations.Add(new CatalogRuleViolation(CatalogRuleCodes.WeightInvalid, $"Độ hiếm {rarity} không tồn tại."));
            else if (weight < 0)
                violations.Add(new CatalogRuleViolation(CatalogRuleCodes.WeightInvalid, $"Trọng số của {rarity} không được âm."));
        }

        var total = chest.DropWeights.Values.Sum(weight => (long)weight);
        if (total != WeightDenominator)
            violations.Add(new CatalogRuleViolation(CatalogRuleCodes.WeightsTotal,
                $"Tổng trọng số phải bằng {WeightDenominator:N0}, hiện là {total:N0}."));

        foreach (var defId in chest.Pool)
        {
            if (!items.TryGetValue(defId, out var item))
                violations.Add(new CatalogRuleViolation(CatalogRuleCodes.PoolUnknownItem, $"Vật phẩm {defId} không có trong danh mục."));
            else if (item.Category is MarketCategories.Chest or MarketCategories.Key)
                violations.Add(new CatalogRuleViolation(CatalogRuleCodes.PoolForbiddenItem, $"Không thể cho hòm hoặc chìa ({defId}) vào trong hòm."));
        }

        foreach (var (rarity, weight) in chest.DropWeights.Where(pair => pair.Value > 0 && MarketRarities.IsValid(pair.Key)))
        {
            if (!LivePool(chest, items).Any(item => item.Rarity == rarity))
                violations.Add(new CatalogRuleViolation(CatalogRuleCodes.RarityEmpty,
                    $"Độ hiếm {rarity} có trọng số {weight:N0} nhưng hòm không có món nào đang phát hành thuộc độ hiếm này."));
        }

        var cost = chest.Prices.Chest + chest.Prices.Key;
        var expected = ExpectedValue(chest, items);
        if (expected >= cost)
            violations.Add(new CatalogRuleViolation(CatalogRuleCodes.ExpectedValueTooHigh,
                $"Giá trị kỳ vọng mỗi lần mở ({expected:N0} xu) phải nhỏ hơn giá hòm + giá chìa ({cost:N0} xu)."));

        return violations;
    }

    /// <summary>Average reference price one opening pays out, by the same reading of the table that a roll uses.</summary>
    public static decimal ExpectedValue(CatalogChest chest, IReadOnlyDictionary<string, CatalogItem> items)
    {
        var pool = LivePool(chest, items).ToList();
        return chest.DropWeights
            .Where(pair => pair.Value > 0)
            .Sum(pair =>
            {
                var sameRarity = pool.Where(item => item.Rarity == pair.Key).ToList();
                return sameRarity.Count == 0 ? 0m : pair.Value / (decimal)WeightDenominator * (decimal)sameRarity.Average(item => item.ReferencePrice);
            });
    }

    /// <summary>What can actually drop: pool entries that exist and are not retired.</summary>
    private static IEnumerable<CatalogItem> LivePool(CatalogChest chest, IReadOnlyDictionary<string, CatalogItem> items) =>
        chest.Pool
            .Select(defId => items.GetValueOrDefault(defId))
            .Where(item => item is { Retired: false })!;
}
