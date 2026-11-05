namespace SirLocked.Api.Services.Market;

/// <summary>A level at which a detective receives a cosmetic for free.</summary>
public sealed record LevelReward(int Level, string DefId);

/// <summary>
/// Hồ sơ thám tử: avatar frames, titles and lobby entrances, taken entry by entry from the approved prototype
/// (frames.js, titles.js, fx.js). Ids carry the category as a prefix because titles and entrances share names
/// ("hac-duc", "kim-long", "phuong-hoang"); the frontend strips it to reach its drawing code.
/// Chest drops are tradable like any item. What a detective earns (levels, achievements, defaults) is not.
/// The lists here are seed data only: at runtime read ICatalogProvider. The id prefixes and defaults are still read from here.
/// </summary>
public static class CosmeticCatalog
{
    public const string FramePrefix = "frame_";
    public const string TitlePrefix = "title_";
    public const string EntrancePrefix = "entrance_";

    public const string DefaultTitleDefId = TitlePrefix + "tan-binh";
    public const string DefaultEntranceDefId = EntrancePrefix + "lang-le";
    public const string DefaultAvatar = "nonla";

    private const string Seal = "chest_np";
    private const string Bank = "chest_nb";
    private const string Lacquer = "chest_sm";

    // Rough value by rarity. Kept near the curios of the same rarity, so chests stay worth less than they cost.
    private static long Price(string rarity) => rarity switch
    {
        MarketRarities.Rare => 340,
        MarketRarities.Epic => 1100,
        MarketRarities.Legendary => 3600,
        MarketRarities.Mystery => 12000,
        _ => 100,
    };

    private static readonly Dictionary<string, (string Vi, string En)> ChestNames = new()
    {
        [Seal] = ("Hòm Niêm Phong", "the Sealed Case"),
        [Bank] = ("Két Nhà Băng", "the Bank Safe"),
        [Lacquer] = ("Tráp Sơn Mài", "the Lacquer Box"),
    };

    public static (string Vi, string En) Kind(string category) => category switch
    {
        MarketCategories.Frame => ("Viền avatar", "Avatar frame"),
        MarketCategories.Title => ("Danh hiệu", "Title"),
        _ => ("Hiệu ứng vào sảnh", "Lobby entrance"),
    };

    private static string PrefixOf(string category) => category switch
    {
        MarketCategories.Frame => FramePrefix,
        MarketCategories.Title => TitlePrefix,
        _ => EntrancePrefix,
    };

    private static MarketItemDef Def(string category, string id, string rarity, string name, string nameEn, string how, string howEn, bool tradable)
    {
        var (kindVi, kindEn) = Kind(category);
        var defId = PrefixOf(category) + id;
        return new MarketItemDef(defId, category, rarity, name, nameEn, $"{kindVi}. {how}.", $"{kindEn}. {howEn}.", Price(rarity), defId, tradable);
    }

    private static readonly Dictionary<string, List<MarketItemDef>> Drops = new()
    {
        [Seal] = new List<MarketItemDef>(),
        [Bank] = new List<MarketItemDef>(),
        [Lacquer] = new List<MarketItemDef>(),
    };

    private static MarketItemDef Chest(string category, string id, string rarity, string name, string nameEn, params string[] chests)
    {
        var how = chests.Length == Drops.Count ? "Bí ẩn, ra từ mọi hòm" : "Ra từ " + string.Join(", ", chests.Select(chest => ChestNames[chest].Vi));
        var howEn = chests.Length == Drops.Count ? "A mystery from every chest" : "Drops from " + string.Join(", ", chests.Select(chest => ChestNames[chest].En));
        var def = Def(category, id, rarity, name, nameEn, how, howEn, tradable: true);
        foreach (var chest in chests) Drops[chest].Add(def);
        return def;
    }

    private static MarketItemDef Earned(string category, string id, string rarity, string name, string nameEn, string how, string howEn) =>
        Def(category, id, rarity, name, nameEn, how, howEn, tradable: false);

    private static readonly MarketItemDef[] Frames =
    {
        Earned(MarketCategories.Frame, "dong", MarketRarities.Common, "Đồng Cổ", "Ancient Bronze", "Mở ở cấp 10", "Unlocked at level 10"),
        Earned(MarketCategories.Frame, "bac", MarketRarities.Rare, "Bạc Nguyệt", "Silver Moon", "Mở ở cấp 20", "Unlocked at level 20"),
        Earned(MarketCategories.Frame, "ngoc", MarketRarities.Epic, "Bích Ngọc", "Emerald Jade", "Mở ở cấp 30", "Unlocked at level 30"),
        Earned(MarketCategories.Frame, "vang", MarketRarities.Legendary, "Hoàng Kim Bát Quái", "Golden Bagua", "Mở ở cấp 40", "Unlocked at level 40"),
        Earned(MarketCategories.Frame, "truong", MarketRarities.Mystery, "Thám Trưởng", "Chief Detective", "Mở ở cấp 50", "Unlocked at level 50"),
        Chest(MarketCategories.Frame, "thach", MarketRarities.Rare, "Thạch Phù", "Stone Talisman", Seal),
        Chest(MarketCategories.Frame, "mac", MarketRarities.Epic, "Mặc Ảnh", "Ink Shadow", Lacquer),
        Chest(MarketCategories.Frame, "bang", MarketRarities.Epic, "Hàn Băng", "Deep Frost", Lacquer),
        Chest(MarketCategories.Frame, "sonmai", MarketRarities.Epic, "Sơn Mài Anh Đào", "Cherry Lacquer", Lacquer),
        Chest(MarketCategories.Frame, "ulinh", MarketRarities.Legendary, "U Linh Giáo Đường", "Haunted Cathedral", Seal),
        Chest(MarketCategories.Frame, "vankiem", MarketRarities.Legendary, "Vạn Kiếm", "Ten Thousand Swords", Bank),
        Chest(MarketCategories.Frame, "hacduc", MarketRarities.Legendary, "Hắc Dực", "Black Wings", Seal),
        Chest(MarketCategories.Frame, "kimlong", MarketRarities.Mystery, "Kim Long", "Golden Dragon", Bank),
        Chest(MarketCategories.Frame, "phuong", MarketRarities.Mystery, "Phượng Hoàng", "Phoenix", Lacquer),
        Chest(MarketCategories.Frame, "tinhkhong", MarketRarities.Epic, "Tinh Không Nguyệt Dạ", "Starlit Moon Night", Seal),
        Chest(MarketCategories.Frame, "lua", MarketRarities.Legendary, "Hỏa Luân", "Wheel of Fire", Bank),
    };

    private static readonly MarketItemDef[] Titles =
    {
        Earned(MarketCategories.Title, "tan-binh", MarketRarities.Common, "Tân Binh", "Rookie", "Mặc định", "The default"),
        Earned(MarketCategories.Title, "khach-quen", MarketRarities.Common, "Khách Quen Sở Cẩm", "Precinct Regular", "Chơi 10 vụ", "Play 10 cases"),
        Earned(MarketCategories.Title, "ghi-chep", MarketRarities.Common, "Người Ghi Chép", "The Note Taker", "Ghi 50 lời khai", "Record 50 statements"),
        Earned(MarketCategories.Title, "mat-tinh", MarketRarities.Rare, "Mắt Tinh Tường", "Keen Eye", "Tìm 100 manh mối", "Find 100 clues"),
        Earned(MarketCategories.Title, "tho-khoa", MarketRarities.Rare, "Thợ Mở Khóa", "Locksmith", "Giải 25 câu đố ổ khóa", "Solve 25 lock puzzles"),
        Chest(MarketCategories.Title, "san-manh-moi", MarketRarities.Rare, "Kẻ Săn Manh Mối", "Clue Hunter", Seal),
        Earned(MarketCategories.Title, "bach-nguyet", MarketRarities.Rare, "Bạch Nguyệt Thám Tử", "White Moon Detective", "Phá án lúc nửa đêm", "Solve a case at midnight"),
        Chest(MarketCategories.Title, "an-si", MarketRarities.Epic, "Ẩn Sĩ Trúc Lâm", "Bamboo Hermit", Lacquer),
        Earned(MarketCategories.Title, "doc-dau-vet", MarketRarities.Epic, "Kẻ Đọc Dấu Vết", "Trace Reader", "Phá án không dùng gợi ý", "Solve a case without hints"),
        Earned(MarketCategories.Title, "van-tay", MarketRarities.Epic, "Chuyên Gia Vân Tay", "Fingerprint Expert", "Đạt cấp 30", "Reach level 30"),
        Chest(MarketCategories.Title, "han-bang", MarketRarities.Epic, "Hàn Băng Tâm Thám", "Frozen-Hearted Sleuth", Lacquer),
        Chest(MarketCategories.Title, "anh-dao", MarketRarities.Epic, "Anh Đào Lạc Phố", "Cherry Blossom Street", Lacquer),
        Chest(MarketCategories.Title, "mac-thu", MarketRarities.Epic, "Mặc Ảnh Thư Sinh", "Ink Shadow Scholar", Seal),
        Chest(MarketCategories.Title, "tinh-khong", MarketRarities.Epic, "Tinh Không Dạ Hành", "Starlit Night Walker", Seal),
        Chest(MarketCategories.Title, "vo-song", MarketRarities.Legendary, "Vô Song Kiếm Khách", "Peerless Swordsman", Bank),
        Earned(MarketCategories.Title, "huyet-kiem", MarketRarities.Legendary, "Huyết Kiếm Truy Hung", "Blood Blade Pursuer", "Thắng 50 vụ", "Win 50 cases"),
        Chest(MarketCategories.Title, "bong-ma", MarketRarities.Legendary, "Bóng Ma Bến Sương", "Ghost of Fog Wharf", Seal),
        Earned(MarketCategories.Title, "tham-tu-truong", MarketRarities.Legendary, "Thám Tử Trưởng", "Chief Inspector", "Đạt cấp 50", "Reach level 50"),
        Chest(MarketCategories.Title, "hoa-luan", MarketRarities.Legendary, "Hỏa Luân Phán Quan", "Fire Wheel Judge", Bank),
        Chest(MarketCategories.Title, "hac-duc", MarketRarities.Legendary, "Hắc Dực Dạ Quân", "Lord of Black Wings", Seal),
        Chest(MarketCategories.Title, "long-phung", MarketRarities.Mystery, "Long Phụng Thần Thám", "Dragon and Phoenix Sleuth", Seal, Bank, Lacquer),
        Chest(MarketCategories.Title, "kim-long", MarketRarities.Mystery, "Kim Long Phá Án", "Golden Dragon Solver", Bank),
        Earned(MarketCategories.Title, "giu-gio", MarketRarities.Mystery, "Người Giữ Giờ 2:17", "Keeper of 2:17", "Sở hữu Đồng hồ 2:17", "Own the 2:17 watch"),
        Chest(MarketCategories.Title, "phuong-hoang", MarketRarities.Mystery, "Phượng Hoàng Bất Tử", "Undying Phoenix", Lacquer),
        Chest(MarketCategories.Title, "thien-menh", MarketRarities.Mystery, "Thiên Mệnh Thần Thám", "Heaven-Chosen Sleuth", Seal),
    };

    private static readonly MarketItemDef[] Entrances =
    {
        Earned(MarketCategories.Entrance, "lang-le", MarketRarities.Common, "Bước Vào Lặng Lẽ", "Quiet Arrival", "Mặc định", "The default"),
        Chest(MarketCategories.Entrance, "anh-trang", MarketRarities.Rare, "Ánh Trăng Soi Lối", "Moonlit Path", Seal),
        Chest(MarketCategories.Entrance, "mac-vu", MarketRarities.Epic, "Mặc Vụ Ẩn Thân", "Ink Mist Veil", Lacquer),
        Chest(MarketCategories.Entrance, "truc-lam", MarketRarities.Epic, "Trúc Lâm Phong Vũ", "Bamboo Wind and Rain", Lacquer),
        Chest(MarketCategories.Entrance, "van-kiem", MarketRarities.Legendary, "Vạn Kiếm Quy Tông", "Ten Thousand Swords Return", Bank),
        Chest(MarketCategories.Entrance, "huyet-nguyet", MarketRarities.Legendary, "Huyết Nguyệt", "Blood Moon", Bank),
        Chest(MarketCategories.Entrance, "hac-duc", MarketRarities.Legendary, "Hắc Dực Giáng Lâm", "Black Wings Descend", Seal),
        Chest(MarketCategories.Entrance, "than-tham", MarketRarities.Legendary, "Thần Thám Soi Án", "The Sleuth's Lens", Seal),
        Chest(MarketCategories.Entrance, "kim-long", MarketRarities.Mystery, "Kim Long Giáng Thế", "Golden Dragon Descends", Bank),
        Chest(MarketCategories.Entrance, "phuong-hoang", MarketRarities.Mystery, "Phượng Hoàng Niết Bàn", "Phoenix Rebirth", Lacquer),
    };

    public static readonly IReadOnlyList<MarketItemDef> ItemDefs = Frames.Concat(Titles).Concat(Entrances).ToList();

    /// <summary>Granted on reaching a level; see <see cref="ProgressRules.MilestonesBetween"/>.</summary>
    public static readonly IReadOnlyList<LevelReward> LevelRewards = new[]
    {
        new LevelReward(10, FramePrefix + "dong"),
        new LevelReward(20, FramePrefix + "bac"),
        new LevelReward(30, FramePrefix + "ngoc"),
        new LevelReward(30, TitlePrefix + "van-tay"),
        new LevelReward(40, FramePrefix + "vang"),
        new LevelReward(50, FramePrefix + "truong"),
        new LevelReward(50, TitlePrefix + "tham-tu-truong"),
    };

    private static readonly string[] PresetAvatars = { "nonla", "nu", "kiem", "qua" };

    public static bool IsPresetAvatar(string? avatar) => avatar is not null && PresetAvatars.Contains(avatar, StringComparer.Ordinal);

    public static bool IsCosmetic(string? category) => category is MarketCategories.Frame or MarketCategories.Title or MarketCategories.Entrance;

    /// <summary>What one chest adds to its curios. Chest rolls pick a rarity first, so this does not change the published odds.</summary>
    public static IReadOnlyList<MarketItemDef> ForChest(string chestId) => Drops[chestId];
}
