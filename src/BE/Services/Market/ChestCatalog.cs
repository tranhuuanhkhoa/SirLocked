using System.Security.Cryptography;
using SirLocked.Api.Models.Catalog;

namespace SirLocked.Api.Services.Market;

/// <summary>Source of randomness for chest rolls; injected so tests can replay a fixed sequence.</summary>
public interface IChestRandom
{
    /// <summary>A uniform integer in [0, <paramref name="exclusiveMax"/>).</summary>
    int NextInt(int exclusiveMax);
}

public sealed class CryptoChestRandom : IChestRandom
{
    public int NextInt(int exclusiveMax) => RandomNumberGenerator.GetInt32(exclusiveMax);
}

/// <summary>Chance of one rarity, as a share of <see cref="ChestCatalog.RateDenominator"/>.</summary>
public sealed record ChestDropRate(string Rarity, int Weight)
{
    public decimal Percent => Weight * 100m / ChestCatalog.RateDenominator;
}

/// <summary>What the shop charges for one chest and for its key, in xu.</summary>
public sealed record ChestShopPrice(long Chest, long Key);

/// <summary>One chest type. Its item instances live in inventories under <see cref="Id"/>; <see cref="KeyDefId"/> opens it.</summary>
public sealed class ChestDef
{
    public ChestDef(
        string id, string keyDefId, string name, string nameEn, string subtitle, string subtitleEn,
        string keyName, string keyNameEn, string iconKey, string keyIconKey, IReadOnlyList<MarketItemDef> items,
        IReadOnlyList<ChestDropRate>? dropRates = null, ChestShopPrice? prices = null, bool active = true, CatalogChestLook? look = null,
        int challengeWeight = 0)
    {
        Id = id;
        KeyDefId = keyDefId;
        Name = name;
        NameEn = nameEn;
        Subtitle = subtitle;
        SubtitleEn = subtitleEn;
        KeyName = keyName;
        KeyNameEn = keyNameEn;
        IconKey = iconKey;
        KeyIconKey = keyIconKey;
        Items = items;
        DropRates = dropRates ?? ChestCatalog.DropRates;
        Prices = prices ?? new ChestShopPrice(0, 0);
        Active = active;
        Look = look;
        ChallengeWeight = challengeWeight;
        Pools = MarketRarities.All.ToDictionary(
            rarity => rarity,
            rarity => (IReadOnlyList<MarketItemDef>)items.Where(item => item.Rarity == rarity).ToList());
    }

    public string Id { get; }
    public string KeyDefId { get; }
    public string Name { get; }
    public string NameEn { get; }
    public string Subtitle { get; }
    public string SubtitleEn { get; }
    public string KeyName { get; }
    public string KeyNameEn { get; }
    public string IconKey { get; }
    public string KeyIconKey { get; }
    public IReadOnlyList<MarketItemDef> Items { get; }
    public IReadOnlyDictionary<string, IReadOnlyList<MarketItemDef>> Pools { get; }
    public IReadOnlyList<ChestDropRate> DropRates { get; }
    public ChestShopPrice Prices { get; }
    /// <summary>Off means hidden from the chest page and not sold. Copies already owned can still be opened.</summary>
    public bool Active { get; }
    /// <summary>The drawing and light colours. Null on the seed classes.</summary>
    public CatalogChestLook? Look { get; }
    /// <summary>The effective weight in the weekly challenge drop. 0 means this chest never drops from it.</summary>
    public int ChallengeWeight { get; }

    /// <summary>Picks a rarity by <see cref="DropRates"/>, then one item of that rarity uniformly.</summary>
    public MarketItemDef Roll(IChestRandom random)
    {
        var ticket = random.NextInt(ChestCatalog.RateDenominator);
        var rarity = DropRates[^1].Rarity;
        foreach (var rate in DropRates)
        {
            if (ticket < rate.Weight)
            {
                rarity = rate.Rarity;
                break;
            }
            ticket -= rate.Weight;
        }
        var pool = PoolFor(rarity);
        return pool[random.NextInt(pool.Count)];
    }

    /// <summary>Average <see cref="MarketItemDef.ReferencePrice"/> one opening pays out.</summary>
    public decimal ExpectedValue() =>
        DropRates.Where(rate => rate.Weight > 0 && PoolFor(rate.Rarity).Count > 0)
            .Sum(rate => rate.Percent / 100m * (decimal)PoolFor(rate.Rarity).Average(def => def.ReferencePrice));

    /// <summary>
    /// Retiring an item can empty a rarity that still has a weight. CatalogRules rejects that when a table is saved, so
    /// this is only the last line of defence: the nearest rarity below (then above) pays, instead of the opening failing.
    /// </summary>
    private IReadOnlyList<MarketItemDef> PoolFor(string rarity)
    {
        var rank = MarketRarities.Rank(rarity);
        return MarketRarities.All
            .OrderBy(other => MarketRarities.Rank(other) <= rank ? 2 * (rank - MarketRarities.Rank(other)) : 2 * (MarketRarities.Rank(other) - rank) + 1)
            .Select(other => Pools[other])
            .FirstOrDefault(pool => pool.Count > 0) ?? Array.Empty<MarketItemDef>();
    }
}

/// <summary>
/// The one place that defines what chests contain and how they pay out. A roll first picks a rarity by
/// <see cref="DropRates"/>, then one item of that rarity uniformly. Shop prices live in ChestSettings.
/// Seed data only: at runtime read ICatalogProvider, where each chest has its own table, pool and prices.
/// </summary>
public static class ChestCatalog
{
    public const int RateDenominator = 10_000;

    public static readonly IReadOnlyList<ChestDropRate> DropRates = new[]
    {
        new ChestDropRate(MarketRarities.Common, 7992),
        new ChestDropRate(MarketRarities.Rare, 1598),
        new ChestDropRate(MarketRarities.Epic, 320),
        new ChestDropRate(MarketRarities.Legendary, 64),
        new ChestDropRate(MarketRarities.Mystery, 26),
    };

    private static MarketItemDef Curio(
        string id, string rarity, string name, string nameEn, string description, string descriptionEn, long price, string iconKey) =>
        new(id, MarketCategories.Curio, rarity, name, nameEn, description, descriptionEn, price, iconKey);

    private static readonly MarketItemDef[] SealItems =
    {
        Curio("VC-0388", MarketRarities.Common, "Sổ tay da bò", "Leather notebook",
            "Sổ tay bìa da, vài trang đầu đã bị xé mất.", "A leather-bound notebook with the first pages torn out.", 70, "notebook"),
        Curio("VC-0402", MarketRarities.Common, "Phiếu vân tay", "Fingerprint card",
            "Phiếu lấy dấu vân tay của sở, mực còn chưa khô hẳn.", "A precinct fingerprint card, the ink barely dry.", 80, "fingerprint"),
        Curio("VC-0411", MarketRarities.Common, "Kính lúp", "Field magnifier",
            "Kính lúp cán gỗ loại nào thám tử cũng có một chiếc.", "The wooden-handled lens every detective keeps close.", 90, "magnifier"),
        Curio("VC-0391", MarketRarities.Rare, "Đèn bão", "Storm lantern",
            "Đèn bão từng soi đường cho một đêm khám nghiệm ngoài bến.", "A lantern that lit one long night of work on the docks.", 280, "lantern"),
        Curio("VC-0419", MarketRarities.Rare, "Mũ thợ săn", "Deerstalker hat",
            "Mũ dạ hai vành, vẫn còn mùi khói thuốc.", "A double-brimmed tweed hat that still smells of smoke.", 320, "hat"),
        Curio("VC-0436", MarketRarities.Rare, "Kính lúp đồng", "Bronze magnifier",
            "Vành đồng sáng bóng vì được lau mỗi ngày.", "A bronze rim polished bright from daily care.", 360, "magnifier_gold"),
        Curio("VC-0405", MarketRarities.Epic, "Huy hiệu sở", "Precinct badge",
            "Huy hiệu sở cảnh sát cũ, số hiệu đã bị mài đi.", "An old precinct badge with its number filed away.", 960, "badge"),
        Curio("VC-0423", MarketRarities.Epic, "Tẩu thạch nam", "Briar pipe",
            "Tẩu gỗ thạch nam của một thám tử đã về hưu.", "The briar pipe of a long-retired detective.", 1100, "pipe"),
        Curio("VC-0430", MarketRarities.Legendary, "Trâm hồng ngọc", "Ruby hairpin",
            "Chiếc trâm hồng ngọc từng là tâm điểm của cả một vụ án.", "A ruby hairpin that once sat at the heart of a case.", 3400, "hairpin"),
        Curio("VC-0217", MarketRarities.Mystery, "Đồng hồ 2:17", "The 2:17 watch",
            "Kim đồng hồ dừng ở 2 giờ 17 và không ai biết vì sao.", "Its hands stopped at 2:17 and no one knows why.", 12000, "watch"),
    };

    private static readonly MarketItemDef[] BankItems =
    {
        Curio("NB-1101", MarketRarities.Common, "Đồng xu lỗ vuông", "Square-holed coin",
            "Đồng xu cổ lẫn trong một túi tiền ký gửi.", "An old coin found in a deposited purse.", 90, "coin"),
        Curio("NB-1104", MarketRarities.Common, "Sổ séc", "Chequebook",
            "Sổ séc còn dở, tờ cuối mang một chữ ký lạ.", "A half-used chequebook, its last stub signed in a strange hand.", 110, "cheque"),
        Curio("NB-1107", MarketRarities.Common, "Bút máy", "Fountain pen",
            "Bút máy của một viên thư ký cẩn thận.", "The fountain pen of a very careful clerk.", 130, "pen"),
        Curio("NB-1112", MarketRarities.Rare, "Kính một tròng", "Monocle",
            "Kính một tròng để soi các chữ ký giả.", "A monocle for looking at forged signatures.", 360, "monocle"),
        Curio("NB-1115", MarketRarities.Rare, "Túi tiền", "Money pouch",
            "Túi vải thô, vẫn còn niêm phong của nhà băng.", "A coarse pouch still carrying the bank's seal.", 410, "moneybag"),
        Curio("NB-1118", MarketRarities.Rare, "Mũ chóp", "Top hat",
            "Mũ chóp của vị khách quen ở quầy ký gửi.", "The top hat of a regular at the deposit counter.", 460, "tophat"),
        Curio("NB-1123", MarketRarities.Epic, "Thỏi vàng", "Gold ingot",
            "Thỏi vàng không có trong bất kỳ sổ sách nào.", "A gold ingot that appears in no ledger.", 1250, "goldbar"),
        Curio("NB-1126", MarketRarities.Epic, "Con dấu nhà băng", "Bank seal stamp",
            "Con dấu thật đóng trên những giấy tờ giả.", "A genuine stamp pressed onto forged papers.", 1520, "stamp"),
        Curio("NB-1131", MarketRarities.Legendary, "Nhẫn kim cương", "Diamond ring",
            "Chiếc nhẫn không ai đến nhận suốt ba mươi năm.", "A ring nobody has claimed in thirty years.", 4850, "ring"),
        Curio("NB-1199", MarketRarities.Mystery, "Lam ngọc Tràng Tiền", "Trang Tien sapphire",
            "Viên lam ngọc biến mất khỏi két trước khi két được mở.", "A sapphire that vanished before the safe was ever opened.", 18000, "sapphire"),
    };

    private static readonly MarketItemDef[] LacquerItems =
    {
        Curio("SM-0301", MarketRarities.Common, "Quạt giấy", "Paper fan",
            "Quạt giấy vẽ tay, nan tre đã ngả màu.", "A hand-painted fan on darkened bamboo ribs.", 80, "fan"),
        Curio("SM-0304", MarketRarities.Common, "Chén trà men lam", "Blue-glazed teacup",
            "Chén trà còn in vệt son của người uống cuối cùng.", "A teacup still marked by its last drinker's lipstick.", 90, "teacup"),
        Curio("SM-0307", MarketRarities.Common, "Đèn lồng giấy", "Paper lantern",
            "Đèn lồng đỏ treo trước một căn nhà phố Hàng Bạc.", "A red lantern from a house on Hang Bac street.", 100, "paperlamp"),
        Curio("SM-0312", MarketRarities.Rare, "Cuộn tranh thủy mặc", "Ink-wash scroll",
            "Cuộn tranh với con dấu đỏ không ai đọc ra.", "A scroll with a red seal nobody can read.", 320, "scroll"),
        Curio("SM-0315", MarketRarities.Rare, "Lược ngà", "Ivory comb",
            "Chiếc lược cổ còn vương một sợi tóc dài.", "An antique comb with one long hair still caught in it.", 360, "comb"),
        Curio("SM-0318", MarketRarities.Rare, "Bình men lam", "Blue-glazed vase",
            "Bình men lam có vết nứt được hàn rất khéo.", "A blue-glazed vase with a skilfully mended crack.", 400, "vase"),
        Curio("SM-0323", MarketRarities.Epic, "Ấn ngọc", "Jade seal",
            "Ấn ngọc khắc tên một người chưa từng tồn tại.", "A jade seal carved with the name of someone who never existed.", 1100, "jadeseal"),
        Curio("SM-0326", MarketRarities.Epic, "Gương đồng", "Bronze mirror",
            "Gương đồng soi rõ những gì sau lưng người cầm.", "A bronze mirror that shows what stands behind you.", 1300, "mirror"),
        Curio("SM-0331", MarketRarities.Legendary, "Mặt nạ hát bội", "Hát bội mask",
            "Mặt nạ tuồng từng được đeo trong đêm xảy ra vụ án.", "An opera mask worn on the very night of the crime.", 3900, "mask"),
        Curio("SM-0399", MarketRarities.Mystery, "Ngọc bội rồng", "Dragon jade pendant",
            "Ngọc bội rồng, chỉ một nửa, nửa kia chưa ai tìm thấy.", "One half of a dragon pendant; the other was never found.", 14000, "pendant"),
    };

    private static readonly MarketItemDef[] ChestAndKeyDefs =
    {
        new("chest_np", MarketCategories.Chest, MarketRarities.Common, "Hòm Niêm Phong", "Sealed Case",
            "Hòm vật chứng còn nguyên niêm phong. Cần chìa kính lúp để mở.",
            "An evidence chest with its seal intact. Opens with a loupe key.", 120, "chest_seal"),
        new("key_np", MarketCategories.Key, MarketRarities.Common, "Chìa kính lúp", "Loupe key",
            "Chìa có tay cầm kính lúp, chỉ mở được Hòm Niêm Phong.",
            "A key with a loupe for a bow. Opens only the Sealed Case.", 180, "key_loupe"),
        new("chest_nb", MarketCategories.Chest, MarketRarities.Common, "Két Nhà Băng", "Bank Safe",
            "Két sắt từ hầm nhà băng. Cần chìa bánh răng để mở.",
            "A safe from the bank vault. Opens with a gear key.", 170, "chest_bank"),
        new("key_nb", MarketCategories.Key, MarketRarities.Common, "Chìa bánh răng", "Gear key",
            "Chìa có tay cầm bánh răng, chỉ mở được Két Nhà Băng.",
            "A key with a gear for a bow. Opens only the Bank Safe.", 250, "key_gear"),
        new("chest_sm", MarketCategories.Chest, MarketRarities.Common, "Tráp Sơn Mài", "Lacquer Box",
            "Tráp sơn mài khảm trai. Cần chìa ngọc bích để mở.",
            "A mother-of-pearl lacquer box. Opens with a jade key.", 140, "chest_lacquer"),
        new("key_sm", MarketCategories.Key, MarketRarities.Common, "Chìa ngọc bích", "Jade key",
            "Chìa có tay cầm ngọc bích, chỉ mở được Tráp Sơn Mài.",
            "A key with a jade bow. Opens only the Lacquer Box.", 210, "key_jade"),
    };

    /// <summary>Everything chests add to <see cref="MarketCatalog.All"/>: 3 chests, 3 keys, 30 curios. Cosmetics join the catalog through <see cref="CosmeticCatalog"/>.</summary>
    public static readonly IReadOnlyList<MarketItemDef> ItemDefs =
        ChestAndKeyDefs.Concat(SealItems).Concat(BankItems).Concat(LacquerItems).ToList();

    public static readonly IReadOnlyList<ChestDef> Chests = new[]
    {
        new ChestDef("chest_np", "key_np", "Hòm Niêm Phong", "Sealed Case", "Bến Sương · Nº 07", "Fog Wharf · Nº 07",
            "chìa kính lúp", "loupe key", "chest_seal", "key_loupe", SealItems.Concat(CosmeticCatalog.ForChest("chest_np")).ToList()),
        new ChestDef("chest_nb", "key_nb", "Két Nhà Băng", "Bank Safe", "Phố Tràng Tiền · Nº 12", "Trang Tien Street · Nº 12",
            "chìa bánh răng", "gear key", "chest_bank", "key_gear", BankItems.Concat(CosmeticCatalog.ForChest("chest_nb")).ToList()),
        new ChestDef("chest_sm", "key_sm", "Tráp Sơn Mài", "Lacquer Box", "Phố Hàng Bạc · Nº 03", "Hang Bac Street · Nº 03",
            "chìa ngọc bích", "jade key", "chest_lacquer", "key_jade", LacquerItems.Concat(CosmeticCatalog.ForChest("chest_sm")).ToList()),
    };

    public static ChestDef? Find(string? id) => Chests.FirstOrDefault(chest => chest.Id == id);

    public static MarketItemDef Roll(ChestDef chest, IChestRandom random) => chest.Roll(random);

    /// <summary>Average <see cref="MarketItemDef.ReferencePrice"/> one opening pays out.</summary>
    public static decimal ExpectedValue(ChestDef chest) => chest.ExpectedValue();
}
