using System.Globalization;
using System.Text.RegularExpressions;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>A rarity whose share of the table changed, in percent.</summary>
public sealed record AdminChestWeightChange(string Rarity, decimal Before, decimal After);

/// <summary>Any other field of a chest that changed, as text. <see cref="Field"/> is the stored name, such as "prices.key".</summary>
public sealed record AdminChestFieldChange(string Field, string Before, string After);

/// <summary>What separates two versions of a chest: what the confirmation dialog shows and the history records.</summary>
public sealed record AdminChestDiff(
    IReadOnlyList<string> Added,
    IReadOnlyList<string> Removed,
    IReadOnlyList<AdminChestWeightChange> Weights,
    IReadOnlyList<AdminChestFieldChange> Fields,
    bool Reordered)
{
    public bool IsEmpty => Added.Count == 0 && Removed.Count == 0 && Weights.Count == 0 && Fields.Count == 0 && !Reordered;
}

/// <summary>
/// The Chests and items admin area's own rules, on top of the shared <see cref="CatalogRules"/>. Pure functions, so the
/// live checks on the page and the check before a write are the same reading. Messages go to the admin as they are.
/// </summary>
public static class AdminChestsRules
{
    public const string TextInvalid = "ADMIN_TEXT_INVALID";
    public const string LookInvalid = "CHEST_LOOK_INVALID";
    public const string PoolDuplicate = "CHEST_POOL_DUPLICATE";
    public const string PoolRetiredItem = "CHEST_POOL_RETIRED_ITEM";
    public const string ItemIconRequired = "ITEM_ICON_REQUIRED";
    public const string ItemIconInvalid = "ITEM_ICON_INVALID";
    public const string ItemImageInvalid = "ITEM_IMAGE_INVALID";
    public const string ItemRarityInvalid = "ITEM_RARITY_INVALID";

    public const int MaxNameLength = 80;
    public const int MaxDescriptionLength = 400;

    private const string CurioPrefix = "CU-";

    private static readonly Regex CurioId = new(@"^CU-(\d+)$", RegexOptions.Compiled);
    private static readonly Regex IconKey = new(@"^[A-Za-z0-9_.-]{1,64}$", RegexOptions.Compiled);
    private static readonly Regex Colour = new(@"^(\d{1,3}),(\d{1,3}),(\d{1,3})$", RegexOptions.Compiled);

    /// <summary>Each drawing and the sprites that go with it, as in chestSprites.js.</summary>
    private static readonly IReadOnlyDictionary<string, (string Chest, string Key)> Drawings =
        new Dictionary<string, (string, string)>(StringComparer.Ordinal)
        {
            ["seal"] = ("chest_seal", "key_loupe"),
            ["bank"] = ("chest_bank", "key_gear"),
            ["lacquer"] = ("chest_lacquer", "key_jade"),
        };

    public static (string Chest, string Key) IconsOf(string template) => Drawings[template];

    public static bool IsKnownDrawing(string? template) => template is not null && Drawings.ContainsKey(template);

    /// <summary>Cosmetics belong to their own admin page, chests and keys to the chest they open.</summary>
    public static bool IsEditableHere(string category) =>
        category is not (MarketCategories.Frame or MarketCategories.Title or MarketCategories.Entrance
            or MarketCategories.Chest or MarketCategories.Key);

    public static CatalogChest Clone(CatalogChest chest) => new()
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
        Look = new CatalogChestLook { Template = chest.Look.Template, Light = chest.Look.Light, Hi = chest.Look.Hi, Core = chest.Look.Core },
        Prices = new CatalogChestPrices { Chest = chest.Prices.Chest, Key = chest.Prices.Key },
        DropWeights = new Dictionary<string, int>(chest.DropWeights, StringComparer.Ordinal),
        Pool = new List<string>(chest.Pool),
        Active = chest.Active,
        SortOrder = chest.SortOrder,
        Version = chest.Version,
        UpdatedBy = chest.UpdatedBy,
        CreatedAt = chest.CreatedAt,
        UpdatedAt = chest.UpdatedAt,
    };

    // ------------------------------------------------------------------ validation

    /// <summary>Everything that stops <paramref name="draft"/> from replacing <paramref name="before"/>. Empty means it can be saved.</summary>
    public static IReadOnlyList<CatalogRuleViolation> Validate(CatalogChest before, CatalogChest draft, IReadOnlyDictionary<string, CatalogItem> items)
    {
        var violations = new List<CatalogRuleViolation>();

        Text(violations, "Tên hòm", draft.Name, MaxNameLength);
        Text(violations, "Tên hòm (tiếng Anh)", draft.NameEn, MaxNameLength);
        Text(violations, "Tên chìa", draft.KeyName, MaxNameLength);
        Text(violations, "Tên chìa (tiếng Anh)", draft.KeyNameEn, MaxNameLength);
        Text(violations, "Phụ đề", draft.Subtitle, MaxNameLength, required: false);
        Text(violations, "Phụ đề (tiếng Anh)", draft.SubtitleEn, MaxNameLength, required: false);

        if (!IsKnownDrawing(draft.Look.Template))
            violations.Add(new CatalogRuleViolation(LookInvalid, $"Không có kiểu hòm \"{draft.Look.Template}\". Chọn seal, bank hoặc lacquer."));
        foreach (var (label, value) in new[] { ("ánh sáng", draft.Look.Light), ("ánh sáng phụ", draft.Look.Hi), ("lõi sáng", draft.Look.Core) })
        {
            if (!IsColour(value)) violations.Add(new CatalogRuleViolation(LookInvalid, $"Màu {label} \"{value}\" không hợp lệ."));
        }

        foreach (var duplicate in draft.Pool.GroupBy(id => id, StringComparer.Ordinal).Where(group => group.Count() > 1))
            violations.Add(new CatalogRuleViolation(PoolDuplicate, $"Vật phẩm {duplicate.Key} xuất hiện {duplicate.Count()} lần trong hòm."));

        var listed = before.Pool.ToHashSet(StringComparer.Ordinal);
        foreach (var added in draft.Pool.Where(id => !listed.Contains(id)).Distinct(StringComparer.Ordinal))
        {
            if (items.TryGetValue(added, out var item) && item.Retired)
                violations.Add(new CatalogRuleViolation(PoolRetiredItem, $"{item.Name} đã ngừng phát hành nên không thêm vào hòm được."));
        }

        violations.AddRange(CatalogRules.ValidateChest(draft, items));
        return violations;
    }

    /// <summary>What a form can get wrong about an item type. Rules that depend on chests are checked with <see cref="Validate"/>.</summary>
    public static IReadOnlyList<CatalogRuleViolation> ValidateItem(CatalogItem item)
    {
        var violations = new List<CatalogRuleViolation>();
        Text(violations, "Tên", item.Name, MaxNameLength);
        Text(violations, "Tên (tiếng Anh)", item.NameEn, MaxNameLength);
        Text(violations, "Mô tả", item.Description, MaxDescriptionLength, required: false);
        Text(violations, "Mô tả (tiếng Anh)", item.DescriptionEn, MaxDescriptionLength, required: false);

        if (!MarketRarities.IsValid(item.Rarity))
            violations.Add(new CatalogRuleViolation(ItemRarityInvalid, $"Độ hiếm \"{item.Rarity}\" không tồn tại."));
        if (CatalogRules.ValidatePrice("Giá tham chiếu", item.ReferencePrice) is { } price) violations.Add(price);

        var iconKey = item.Visual.IconKey;
        var imageUrl = item.Visual.ImageUrl;
        if (!string.IsNullOrEmpty(iconKey) && !IconKey.IsMatch(iconKey))
            violations.Add(new CatalogRuleViolation(ItemIconInvalid, $"Tên sprite \"{iconKey}\" không hợp lệ."));
        if (!string.IsNullOrEmpty(imageUrl) && !IsHttpsUrl(imageUrl))
            violations.Add(new CatalogRuleViolation(ItemImageInvalid, "Ảnh phải là địa chỉ https do trang tải ảnh trả về."));
        // Old gear is drawn by its category; a curio has no such drawing.
        if (item.Category == MarketCategories.Curio && string.IsNullOrEmpty(iconKey) && string.IsNullOrEmpty(imageUrl))
            violations.Add(new CatalogRuleViolation(ItemIconRequired, "Hãy chọn một sprite có sẵn hoặc tải ảnh lên."));
        return violations;
    }

    private static void Text(List<CatalogRuleViolation> violations, string label, string? value, int maxLength, bool required = true)
    {
        if (required && string.IsNullOrWhiteSpace(value))
            violations.Add(new CatalogRuleViolation(TextInvalid, $"{label} không được để trống."));
        else if (value?.Length > maxLength)
            violations.Add(new CatalogRuleViolation(TextInvalid, $"{label} dài quá {maxLength} ký tự."));
    }

    private static bool IsHttpsUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps;

    private static bool IsColour(string? value)
    {
        if (value is null) return false;
        var match = Colour.Match(value);
        return match.Success && match.Groups.Values.Skip(1).All(group => int.Parse(group.Value, CultureInfo.InvariantCulture) <= 255);
    }

    // ------------------------------------------------------------------ rates

    /// <summary>
    /// The real chance of each listed item, in percent: its rarity's share divided by the live items of that rarity.
    /// A retired item, or one of a rarity without a weight, has none. Same reading as <see cref="ChestDef.Roll"/>.
    /// </summary>
    public static IReadOnlyDictionary<string, decimal> ItemRates(CatalogChest chest, IReadOnlyDictionary<string, CatalogItem> items)
    {
        var live = chest.Pool
            .Select(id => items.GetValueOrDefault(id))
            .Where(item => item is { Retired: false })
            .Select(item => item!)
            .ToList();
        var counts = live.GroupBy(item => item.Rarity, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);

        var rates = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var id in chest.Pool)
        {
            var item = items.GetValueOrDefault(id);
            rates[id] = item is null || item.Retired
                ? 0m
                : Percent(chest.DropWeights.GetValueOrDefault(item.Rarity)) / counts[item.Rarity];
        }
        return rates;
    }

    private static decimal Percent(int weight) => weight * 100m / CatalogRules.WeightDenominator;

    // ------------------------------------------------------------------ comparing

    public static AdminChestDiff Diff(CatalogChest before, CatalogChest after)
    {
        var added = after.Pool.Where(id => !before.Pool.Contains(id, StringComparer.Ordinal)).Distinct(StringComparer.Ordinal).ToList();
        var removed = before.Pool.Where(id => !after.Pool.Contains(id, StringComparer.Ordinal)).Distinct(StringComparer.Ordinal).ToList();
        var reordered = added.Count == 0 && removed.Count == 0 && !before.Pool.SequenceEqual(after.Pool, StringComparer.Ordinal);

        var weights = MarketRarities.All
            .Select(rarity => (Rarity: rarity, Before: before.DropWeights.GetValueOrDefault(rarity), After: after.DropWeights.GetValueOrDefault(rarity)))
            .Where(change => change.Before != change.After)
            .Select(change => new AdminChestWeightChange(change.Rarity, Percent(change.Before), Percent(change.After)))
            .ToList();

        var fields = new List<AdminChestFieldChange>();
        void Compare(string field, string? was, string? now)
        {
            if (!string.Equals(was, now, StringComparison.Ordinal)) fields.Add(new AdminChestFieldChange(field, was ?? string.Empty, now ?? string.Empty));
        }
        Compare("name", before.Name, after.Name);
        Compare("nameEn", before.NameEn, after.NameEn);
        Compare("subtitle", before.Subtitle, after.Subtitle);
        Compare("subtitleEn", before.SubtitleEn, after.SubtitleEn);
        Compare("keyName", before.KeyName, after.KeyName);
        Compare("keyNameEn", before.KeyNameEn, after.KeyNameEn);
        Compare("prices.chest", Number(before.Prices.Chest), Number(after.Prices.Chest));
        Compare("prices.key", Number(before.Prices.Key), Number(after.Prices.Key));
        Compare("active", Flag(before.Active), Flag(after.Active));
        Compare("sortOrder", Number(before.SortOrder), Number(after.SortOrder));
        Compare("look.template", before.Look.Template, after.Look.Template);
        Compare("look.light", before.Look.Light, after.Look.Light);
        Compare("look.hi", before.Look.Hi, after.Look.Hi);
        Compare("look.core", before.Look.Core, after.Look.Core);

        return new AdminChestDiff(added, removed, weights, fields, reordered);
    }

    private static string Number(long value) => value.ToString(CultureInfo.InvariantCulture);

    private static string Flag(bool value) => value ? "true" : "false";

    // ------------------------------------------------------------------ generated ids

    /// <summary>One past the highest curio number in use, so a gap left by a deleted item is not reused while a later one exists.</summary>
    public static string NextCurioId(IEnumerable<string> taken)
    {
        var highest = 0L;
        foreach (var id in taken)
        {
            var match = CurioId.Match(id);
            if (match.Success && long.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var number) && number > highest)
                highest = number;
        }
        return $"{CurioPrefix}{(highest + 1).ToString("D4", CultureInfo.InvariantCulture)}";
    }

    /// <summary>The first number free for both the chest and its key.</summary>
    public static (string ChestId, string KeyId) NextChestIds(IEnumerable<string> taken)
    {
        var ids = taken.ToHashSet(StringComparer.Ordinal);
        for (var number = 1; ; number++)
        {
            var suffix = number.ToString("D3", CultureInfo.InvariantCulture);
            var (chest, key) = ($"chest_{suffix}", $"key_{suffix}");
            if (!ids.Contains(chest) && !ids.Contains(key)) return (chest, key);
        }
    }
}
