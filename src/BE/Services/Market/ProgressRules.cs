namespace SirLocked.Api.Services.Market;

/// <summary>Stable error codes; the frontend maps each one to a Vietnamese/English message.</summary>
public static class ProgressErrors
{
    public const string MaxLevel = "XP_MAX_LEVEL";
    public const string NoItems = "XP_NO_ITEMS";
    public const string ItemNotFound = "XP_ITEM_NOT_FOUND";
    public const string ItemLocked = "XP_ITEM_LOCKED";
    public const string ItemEquipped = "XP_ITEM_EQUIPPED";
    public const string ItemNotExchangeable = "XP_ITEM_NOT_EXCHANGEABLE";
    public const string UnknownAvatar = "AVATAR_UNKNOWN";
}

public static class AvatarErrors
{
    public const string TooLarge = "AVATAR_TOO_LARGE";
    public const string BadImage = "AVATAR_BAD_IMAGE";
    public const string Unavailable = "AVATAR_UNAVAILABLE";
}

/// <summary>Pure level and experience rules ("KN"): no I/O, so the curve is unit-testable.</summary>
public static class ProgressRules
{
    public const int MaxLevel = 50;
    public const int MilestoneStep = 10;
    public const long RareXp = 150;
    public const long EpicXp = 600;

    /// <summary>XP needed to go from <paramref name="level"/> to the next one.</summary>
    public static int XpToNext(int level) => 200 + 40 * (level - 1);

    /// <summary>Adds XP, levelling up as often as it pays for. At the cap XP stops: the rest is lost and the bar stays empty.</summary>
    public static (int Level, int Xp) Apply(int level, int xp, long gain)
    {
        if (level >= MaxLevel) return (MaxLevel, 0);
        var total = xp + gain;
        while (level < MaxLevel && total >= XpToNext(level))
        {
            total -= XpToNext(level);
            level++;
        }
        return level >= MaxLevel ? (MaxLevel, 0) : (level, (int)total);
    }

    /// <summary>Every tenth level passed when climbing from <paramref name="from"/> (excluded) to <paramref name="to"/> (included).</summary>
    public static IReadOnlyList<int> MilestonesBetween(int from, int to)
    {
        var levels = new List<int>();
        for (var level = from / MilestoneStep * MilestoneStep + MilestoneStep; level <= Math.Min(to, MaxLevel); level += MilestoneStep)
            levels.Add(level);
        return levels;
    }

    /// <summary>
    /// Only rare and epic items pay XP. Chests and keys never do. Neither do cosmetics a detective earned: a level
    /// reward is granted again by its level, so burning one would be free XP.
    /// </summary>
    public static bool IsExchangeable(MarketItemDef def) =>
        def.Tradable
        && def.Category is not (MarketCategories.Chest or MarketCategories.Key)
        && def.Rarity is MarketRarities.Rare or MarketRarities.Epic;

    public static long XpValue(MarketItemDef def) =>
        !IsExchangeable(def) ? 0 : def.Rarity == MarketRarities.Epic ? EpicXp : RareXp;
}

/// <summary>A detective's record, flattened from gameResults, rooms and the inventory so the rules stay I/O-free.</summary>
public sealed record PlayerStats(
    int Played,
    int Won,
    int MidnightWins,
    int NoHintWins,
    int CluesFound,
    int TestimoniesRecorded,
    bool OwnsWatch217);

/// <summary>A title granted for play. <see cref="Count"/> is null when the record cannot tell who did it.</summary>
public sealed record AchievementDef(string TitleDefId, int Target, Func<PlayerStats, int>? Count)
{
    public bool Countable => Count is not null;
}

public sealed record AchievementProgress(AchievementDef Def, int Count, bool Earned);

public static class AchievementRules
{
    public const string Watch217DefId = "VC-0217";

    public static readonly IReadOnlyList<AchievementDef> Catalog = new[]
    {
        new AchievementDef(CosmeticCatalog.TitlePrefix + "khach-quen", 10, stats => stats.Played),
        new AchievementDef(CosmeticCatalog.TitlePrefix + "ghi-chep", 50, stats => stats.TestimoniesRecorded),
        new AchievementDef(CosmeticCatalog.TitlePrefix + "mat-tinh", 100, stats => stats.CluesFound),
        // A room stores which puzzles were solved, not by whom, and the action log is off for V3 cases.
        new AchievementDef(CosmeticCatalog.TitlePrefix + "tho-khoa", 25, null),
        new AchievementDef(CosmeticCatalog.TitlePrefix + "bach-nguyet", 1, stats => stats.MidnightWins),
        new AchievementDef(CosmeticCatalog.TitlePrefix + "doc-dau-vet", 1, stats => stats.NoHintWins),
        new AchievementDef(CosmeticCatalog.TitlePrefix + "huyet-kiem", 50, stats => stats.Won),
        new AchievementDef(CosmeticCatalog.TitlePrefix + "giu-gio", 1, stats => stats.OwnsWatch217 ? 1 : 0),
    };

    public static IReadOnlyList<AchievementProgress> Evaluate(PlayerStats stats) =>
        Catalog.Select(def =>
        {
            var count = def.Count?.Invoke(stats) ?? 0;
            return new AchievementProgress(def, count, def.Countable && count >= def.Target);
        }).ToList();

    /// <summary>"Lúc nửa đêm": the first hour of the day on the players' calendar (see <see cref="MarketRules.DayOffset"/>).</summary>
    public static bool IsMidnight(DateTime utc) => utc.Add(MarketRules.DayOffset).Hour == 0;
}
