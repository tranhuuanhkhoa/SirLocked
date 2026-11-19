using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.Services.Market;

/// <summary>
/// Outfits ("skin") of the two detectives and the chest they drop from. An outfit is an ordinary inventory item: it
/// drops from a chest, trades on the market and is put on with the usual equip call, one slot per detective
/// (<see cref="MarketCategories.SkinSherlock"/>, <see cref="MarketCategories.SkinWatson"/>). The game reads the equipped
/// def id and draws the matching sprite sheets (src/FE/Client/js/game/playerSkins.ts), so a skin needs code as well as
/// a catalog entry: an id that the game does not know falls back to the normal look.
/// Seed data only (catalog seed version 2: the outfits; version 3: their chest): at runtime read ICatalogProvider.
/// </summary>
public static class SkinCatalog
{
    public const string SherlockWhitechapel = "skin_sherlock_whitechapel";
    public const string WatsonWhitechapel = "skin_watson_whitechapel";
    public const string WhitechapelChestId = "chest_wc";
    public const string WhitechapelKeyId = "key_wc";

    /// <summary>Same-site picture, so the admin rules accept it and every environment serves it with the build.</summary>
    public const string ImageFolder = "/assets/pixel/skins/whitechapel/";

    private static ItemVisual Picture(string file) =>
        new(IconKey: null, ImageUrl: ImageFolder + file, BuiltinId: null, Template: null, Params: new Dictionary<string, object?>());

    /// <summary>The outfits themselves (seed version 2).</summary>
    public static readonly IReadOnlyList<MarketItemDef> Outfits = new MarketItemDef[]
    {
        new(SherlockWhitechapel, MarketCategories.SkinSherlock, MarketRarities.Legendary,
            "Sherlock · Kẻ Săn Bóng Đêm", "Sherlock · Night Hunter",
            "Bộ Đêm Whitechapel 1888. Áo khoác da đen có choàng vai, mũ rộng vành, kính lúp bạc bên hông. Lúc chạng vạng và ban đêm, Sherlock xách đèn bão; đứng yên một lúc thì giơ kính lúp soi, dấu chân phát sáng hiện ra.",
            "Whitechapel Night 1888. A black leather greatcoat with a shoulder cape, a wide-brimmed hat and a silver magnifier at the belt. At dusk and at night Sherlock carries a storm lantern; stand still a moment and he raises the magnifier, and glowing footprints appear.",
            5200, Visual: Picture("icon-sherlock.png")),
        new(WatsonWhitechapel, MarketCategories.SkinWatson, MarketRarities.Legendary,
            "Watson · Bác Sĩ Mỏ Quạ", "Watson · Plague Doctor",
            "Bộ Đêm Whitechapel 1888. Mặt nạ mỏ quạ có kính, mũ chóp ngắn, áo choàng sáp đen, gậy và túi da đựng lọ thuốc. Đứng yên một lúc thì Watson lắc lọ thuốc, khói thảo dược xanh tỏa ra từ mỏ.",
            "Whitechapel Night 1888. A beaked plague mask with goggles, a short top hat, a black waxed coat, a cane and a satchel of potions. Stand still a moment and Watson shakes a potion, and green herbal smoke drifts from the beak.",
            5200, Visual: Picture("icon-watson.png")),
    };

    /// <summary>The Whitechapel chest and its key (seed version 3). Its own drawing (onyx, silver, a storm-lantern lock), lit crimson.</summary>
    public static readonly IReadOnlyList<MarketItemDef> ChestAndKey = new MarketItemDef[]
    {
        new(WhitechapelChestId, MarketCategories.Chest, MarketRarities.Common, "Hòm Đêm Whitechapel", "Whitechapel Night Case",
            "Hòm vật chứng vớt lên từ sương mù phố Whitechapel năm 1888. Bộ trang phục Đêm Whitechapel chỉ có trong hòm này. Cần chìa kính lúp bạc để mở.",
            "An evidence case pulled from the Whitechapel fog of 1888. The Whitechapel Night outfits come only from this case. Opens with a silver loupe key.",
            180, "chest_whitechapel"),
        new(WhitechapelKeyId, MarketCategories.Key, MarketRarities.Common, "Chìa kính lúp bạc", "Silver loupe key",
            "Chìa bạc có tay cầm kính lúp, chỉ mở được Hòm Đêm Whitechapel.",
            "A silver key with a loupe for a bow. Opens only the Whitechapel Night Case.", 260, "key_loupe"),
    };

    /// <summary>Everything this file adds to <see cref="MarketCatalog.All"/>, in catalog order.</summary>
    public static readonly IReadOnlyList<MarketItemDef> ItemDefs = Outfits.Concat(ChestAndKey).ToList();

    /// <summary>Case-file gear that suits a night in Whitechapel, by rarity; the outfits are the legendaries.</summary>
    private static readonly string[] Gear =
    {
        "mag_brass", "stamp_violet", "pins_iron", "folder_kraft", "badge_tin", "board_cork", "watch_steel",
        "mag_ebony", "thread_crimson", "pins_221b", "watch_pocket",
        "stamp_solved", "folder_leather", "board_oak",
    };

    /// <summary>
    /// The mysteries every other chest pays out ("Bí ẩn, ra từ mọi hòm"). This chest pays them too, so their text stays
    /// true with a fourth chest in the shop.
    /// </summary>
    public static IReadOnlyList<string> MysteriesFromEveryChest() =>
        ChestCatalog.Chests
            .Select(chest => chest.Items.Where(item => item.Rarity == MarketRarities.Mystery).Select(item => item.Id))
            .Aggregate((left, right) => left.Intersect(right, StringComparer.Ordinal))
            .ToList();

    /// <summary>The ids the Whitechapel chest pays out, in display order.</summary>
    public static IReadOnlyList<string> WhitechapelPool() => Gear.Concat(Outfits.Select(def => def.Id)).Concat(MysteriesFromEveryChest()).ToList();

    /// <summary>Out of 10,000: an outfit is twice as likely as a legendary from the other chests (1% for the pair).</summary>
    public static IReadOnlyList<ChestDropRate> WhitechapelRates()
    {
        var mystery = MysteriesFromEveryChest().Count > 0 ? 26 : 0;
        return new[]
        {
            new ChestDropRate(MarketRarities.Common, 7900 - mystery),
            new ChestDropRate(MarketRarities.Rare, 1600),
            new ChestDropRate(MarketRarities.Epic, 400),
            new ChestDropRate(MarketRarities.Legendary, 100),
            new ChestDropRate(MarketRarities.Mystery, mystery),
        };
    }

    public static readonly ChestShopPrice WhitechapelPrices = new(Chest: 180, Key: 260);

    public const string WhitechapelTemplate = "whitechapel";
    public const string WhitechapelIcon = "chest_whitechapel";

    public static CatalogChestLook WhitechapelLook() => new() { Template = WhitechapelTemplate, Light = "190,52,58", Hi = "255,150,140", Core = "255,222,214" };

    private static readonly Lazy<ChestDef> Chest = new(() => new ChestDef(
        WhitechapelChestId, WhitechapelKeyId, "Hòm Đêm Whitechapel", "Whitechapel Night Case",
        "Phố Whitechapel · Nº 1888", "Whitechapel Road · Nº 1888", "chìa kính lúp bạc", "silver loupe key",
        WhitechapelIcon, "key_loupe",
        WhitechapelPool().Select(id => MarketCatalog.Find(id) ?? throw new InvalidOperationException($"Unknown item {id}.")).ToList(),
        WhitechapelRates(), WhitechapelPrices, active: true, look: WhitechapelLook()));

    /// <summary>The chests this file adds (seed version 3).</summary>
    public static IReadOnlyList<ChestDef> Chests => new[] { Chest.Value };

    public static bool IsSkin(string? category) => category is MarketCategories.SkinSherlock or MarketCategories.SkinWatson;
}
