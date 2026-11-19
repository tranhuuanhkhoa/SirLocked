using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.Services.Market;

public static class MarketCategories
{
    public const string Magnifier = "MAGNIFIER";
    public const string Stamp = "STAMP";
    public const string Pins = "PINS";
    public const string Folder = "FOLDER";
    public const string Badge = "BADGE";
    public const string Board = "BOARD";
    public const string Watch = "WATCH";
    public const string Chest = "CHEST";
    public const string Key = "KEY";
    public const string Curio = "CURIO";
    public const string Frame = "FRAME";
    public const string Title = "TITLE";
    public const string Entrance = "ENTRANCE";
    /// <summary>Outfits of the two detectives. One slot each, so a detective can wear a Sherlock and a Watson outfit at once.</summary>
    public const string SkinSherlock = "SKIN_SHERLOCK";
    public const string SkinWatson = "SKIN_WATSON";

    /// <summary>Display order of the "DANH MỤC" list.</summary>
    public static readonly IReadOnlyList<string> All = new[] { Magnifier, Stamp, Pins, Folder, Badge, Board, Watch, Chest, Key, Curio, Frame, Title, Entrance, SkinSherlock, SkinWatson };

    public static bool IsValid(string? category) => category is not null && All.Contains(category);

    /// <summary>Chests, keys and collectibles only sit in the bag; gear can be put in use ("ĐANG DÙNG").</summary>
    public static bool IsEquippable(string? category) => IsValid(category) && category is not (Chest or Key or Curio);
}

public static class MarketRarities
{
    public const string Common = "COMMON";
    public const string Rare = "RARE";
    public const string Epic = "EPIC";
    public const string Legendary = "LEGENDARY";
    public const string Mystery = "MYSTERY";

    public static readonly IReadOnlyList<string> All = new[] { Common, Rare, Epic, Legendary, Mystery };

    public static bool IsValid(string? rarity) => rarity is not null && All.Contains(rarity);

    public static int Rank(string rarity) => rarity switch
    {
        Common => 0,
        Rare => 1,
        Epic => 2,
        Legendary => 3,
        Mystery => 4,
        _ => -1
    };
}

/// <summary>A cosmetic investigation-gear item type. Instances in inventories point here by <see cref="Id"/>.</summary>
public sealed record MarketItemDef(
    string Id,
    string Category,
    string Rarity,
    string Name,
    string NameEn,
    string Description,
    string DescriptionEn,
    long ReferencePrice,
    string? IconKey = null,
    bool Tradable = true,
    ItemVisual? Visual = null,
    bool Retired = false);

/// <summary>
/// Seed data only: at runtime read ICatalogProvider. The original catalog of cosmetic gear (Market.dc.html plus one "Thường" piece per category so the
/// starter grant and every category have an entry-level item), plus what chests add (see
/// <see cref="ChestCatalog"/>) and the detective profile (see <see cref="CosmeticCatalog"/>). Icons are drawn by the frontend: per category and tinted by rarity,
/// or from a pixel sprite when <see cref="MarketItemDef.IconKey"/> is set. Nothing here affects gameplay.
/// </summary>
public static class MarketCatalog
{
    public static readonly IReadOnlyList<MarketItemDef> All = new MarketItemDef[]
    {
        new("mag_brass", MarketCategories.Magnifier, MarketRarities.Common,
            "Kính lúp Đồng thau", "Brass magnifier",
            "Kính lúp tiêu chuẩn của mọi thám tử mới vào nghề.",
            "The standard lens of every new detective.", 120),
        new("mag_ebony", MarketCategories.Magnifier, MarketRarities.Rare,
            "Kính lúp cán gỗ mun", "Ebony-handled magnifier",
            "Cán gỗ mun đen bóng, tròng kính mài vát cho tầm nhìn sắc nét.",
            "A polished ebony handle and a bevelled lens for a sharper look.", 380),
        new("mag_crystal", MarketCategories.Magnifier, MarketRarities.Legendary,
            "Kính lúp Pha lê", "Crystal magnifier",
            "Tròng pha lê mài tay. Khi soi manh mối, viền kính lóe sáng.",
            "A hand-cut crystal lens. Its rim flashes when it finds a clue.", 4850),

        new("stamp_violet", MarketCategories.Stamp, MarketRarities.Common,
            "Con dấu mực tím", "Violet ink stamp",
            "Con dấu gỗ cũ của phòng lưu trữ, mực tím hơi nhòe.",
            "An old wooden archive stamp with slightly smudged violet ink.", 90),
        new("stamp_solved", MarketCategories.Stamp, MarketRarities.Epic,
            "Con dấu \"Đã phá án\"", "\"Case solved\" stamp",
            "Đóng dấu đỏ lên hồ sơ mỗi khi đội bạn buộc tội đúng hung thủ.",
            "Stamps the file in red whenever your team accuses the right culprit.", 960),

        new("pins_iron", MarketCategories.Pins, MarketRarities.Common,
            "Ghim sắt văn phòng", "Office iron pins",
            "Hộp ghim sắt mạ kẽm, đủ ghim mọi tấm ảnh lên bảng.",
            "A box of zinc-plated pins, enough for every photo on the board.", 60),
        new("thread_crimson", MarketCategories.Pins, MarketRarities.Rare,
            "Cuộn chỉ đỏ thẫm", "Crimson thread spool",
            "Đổi màu sợi chỉ nối manh mối trên bảng điều tra của bạn.",
            "Recolours the string that links clues on your evidence board.", 310),
        new("pins_221b", MarketCategories.Pins, MarketRarities.Rare,
            "Bộ ghim vàng 221B", "221B brass pin set",
            "Sáu chiếc ghim đồng thau khắc số 221B để ghim manh mối.",
            "Six brass pins engraved 221B for pinning clues.", 280),

        new("folder_kraft", MarketCategories.Folder, MarketRarities.Common,
            "Bìa hồ sơ giấy kraft", "Kraft case folder",
            "Bìa giấy kraft dày, mép đã sờn vì lật mở quá nhiều lần.",
            "A thick kraft folder, its edges worn from being opened so often.", 80),
        new("folder_leather", MarketCategories.Folder, MarketRarities.Epic,
            "Bìa hồ sơ da bò", "Leather case folder",
            "Bìa da bò sẫm màu cho Hồ sơ vụ án. Hiện ở mọi trận bạn tham gia.",
            "A dark leather cover for the case file, shown in every game you join.", 1180),

        new("badge_tin", MarketCategories.Badge, MarketRarities.Common,
            "Huy hiệu thiếc Tập sự", "Apprentice tin badge",
            "Huy hiệu thiếc phát cho thám tử tập sự trong ngày đầu nhận việc.",
            "The tin badge handed to apprentices on their first day.", 70),
        new("badge_fog", MarketCategories.Badge, MarketRarities.Legendary,
            "Huy hiệu Sương mù", "Fog season badge",
            "Huy hiệu hồ sơ dành cho đội phá án trong mùa Sương mù.",
            "A file badge for teams that solved cases in the Fog season.", 3400),

        new("board_cork", MarketCategories.Board, MarketRarities.Common,
            "Bảng bần văn phòng", "Office cork board",
            "Tấm bảng bần khung nhôm, loại treo ở mọi đồn cảnh sát.",
            "An aluminium-framed cork board, the kind in every police station.", 100),
        new("board_oak", MarketCategories.Board, MarketRarities.Epic,
            "Bảng điều tra gỗ sồi", "Oak evidence board",
            "Giao diện bảng manh mối khung gỗ sồi cho sảnh của bạn.",
            "An oak-framed evidence board look for your lobby.", 1520),

        new("watch_steel", MarketCategories.Watch, MarketRarities.Common,
            "Đồng hồ bỏ túi thép", "Steel pocket watch",
            "Đồng hồ thép giản dị, chạy chậm hai phút mỗi ngày.",
            "A plain steel watch that loses two minutes a day.", 110),
        new("watch_pocket", MarketCategories.Watch, MarketRarities.Rare,
            "Đồng hồ quả quýt", "Hunter-case pocket watch",
            "Hiện đồng hồ đếm giờ vụ án theo kiểu mặt đồng hồ cổ.",
            "Shows the case timer as an antique watch face.", 450),
    }.Concat(ChestCatalog.ItemDefs).Concat(CosmeticCatalog.ItemDefs).Concat(SkinCatalog.ItemDefs).ToList();

    private static readonly Dictionary<string, MarketItemDef> ById = All.ToDictionary(def => def.Id, StringComparer.Ordinal);

    /// <summary>Three entry-level items every detective receives with the starter coins.</summary>
    public static readonly IReadOnlyList<string> StarterItemIds = new[] { "mag_brass", "pins_iron", "folder_kraft" };

    public static MarketItemDef? Find(string? id) =>
        id is not null && ById.TryGetValue(id, out var def) ? def : null;
}
