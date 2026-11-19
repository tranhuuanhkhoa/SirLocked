using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Configurations;

public sealed class ChestPrice
{
    public long Chest { get; set; }
    public long Key { get; set; }
}

/// <summary>
/// Prices a chest starts with when the catalog is first seeded, in xu, by chest id. Override with Chests__Prices__chest_np__Key.
/// Once seeded, the live prices are in the chests collection and this no longer changes them.
/// </summary>
public sealed class ChestSettings
{
    public Dictionary<string, ChestPrice> Prices { get; set; } = new(StringComparer.Ordinal)
    {
        ["chest_np"] = new ChestPrice { Chest = 120, Key = 180 },
        ["chest_nb"] = new ChestPrice { Chest = 170, Key = 250 },
        ["chest_sm"] = new ChestPrice { Chest = 140, Key = 210 },
    };

    /// <summary>
    /// False: the shop sells keys only and refuses to sell chests, which players get from rewards such as the weekly
    /// challenge instead. Chests already held, bought or traded still open. Override with Chests__SellChests.
    /// </summary>
    public bool SellChests { get; set; } = true;

    public ChestPrice PriceOf(string chestId) => Prices[chestId];

    /// <summary>Every chest needs valid prices, and opening one must cost more than it pays out on average.</summary>
    public static bool IsValid(ChestSettings settings) =>
        ChestCatalog.Chests.All(chest =>
            settings.Prices.TryGetValue(chest.Id, out var price)
            && MarketRules.ValidatePrice(price.Chest) is null
            && MarketRules.ValidatePrice(price.Key) is null
            && ChestCatalog.ExpectedValue(chest) < price.Chest + price.Key);
}
