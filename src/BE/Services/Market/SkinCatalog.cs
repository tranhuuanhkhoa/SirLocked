using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.Services.Market;

/// <summary>
/// Outfits ("skin") of the two detectives. The item is an ordinary inventory item: it drops from the chests an admin
/// adds it to, trades on the market and is put on with the usual equip call, one slot per detective
/// (<see cref="MarketCategories.SkinSherlock"/>, <see cref="MarketCategories.SkinWatson"/>). The game reads the equipped
/// def id and draws the matching sprite sheets (src/FE/Client/js/game/playerSkins.ts), so a skin needs code as well as
/// a catalog entry: an id that the game does not know falls back to the normal look.
/// Seed data only (catalog seed version 2): at runtime read ICatalogProvider.
/// </summary>
public static class SkinCatalog
{
    public const string SherlockWhitechapel = "skin_sherlock_whitechapel";
    public const string WatsonWhitechapel = "skin_watson_whitechapel";

    /// <summary>Same-site picture, so the admin rules accept it and every environment serves it with the build.</summary>
    public const string ImageFolder = "/assets/pixel/skins/whitechapel/";

    private static ItemVisual Picture(string file) =>
        new(IconKey: null, ImageUrl: ImageFolder + file, BuiltinId: null, Template: null, Params: new Dictionary<string, object?>());

    public static readonly IReadOnlyList<MarketItemDef> ItemDefs = new MarketItemDef[]
    {
        new(SherlockWhitechapel, MarketCategories.SkinSherlock, MarketRarities.Legendary,
            "Sherlock · Kẻ Săn Bóng Đêm", "Sherlock · Night Hunter",
            "Bộ Đêm Whitechapel 1888. Áo khoác da đen có choàng vai, mũ rộng vành, kính lúp bạc bên hông. Ở cảnh đêm Sherlock xách đèn bão; đứng yên một lúc thì giơ kính lúp soi, dấu chân phát sáng hiện ra.",
            "Whitechapel Night 1888. A black leather greatcoat with a shoulder cape, a wide-brimmed hat and a silver magnifier at the belt. At night Sherlock carries a storm lantern; stand still a moment and he raises the magnifier, and glowing footprints appear.",
            5200, Visual: Picture("icon-sherlock.png")),
        new(WatsonWhitechapel, MarketCategories.SkinWatson, MarketRarities.Legendary,
            "Watson · Bác Sĩ Mỏ Quạ", "Watson · Plague Doctor",
            "Bộ Đêm Whitechapel 1888. Mặt nạ mỏ quạ có kính, mũ chóp ngắn, áo choàng sáp đen, gậy và túi da đựng lọ thuốc. Đứng yên một lúc thì Watson lắc lọ thuốc, khói thảo dược xanh tỏa ra từ mỏ.",
            "Whitechapel Night 1888. A beaked plague mask with goggles, a short top hat, a black waxed coat, a cane and a satchel of potions. Stand still a moment and Watson shakes a potion, and green herbal smoke drifts from the beak.",
            5200, Visual: Picture("icon-watson.png")),
    };

    public static bool IsSkin(string? category) => category is MarketCategories.SkinSherlock or MarketCategories.SkinWatson;
}
