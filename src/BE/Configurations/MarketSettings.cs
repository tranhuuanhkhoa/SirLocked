namespace SirLocked.Api.Configurations;

/// <summary>Rules of Chợ đồ that the team can change without a code change. Section "Market".</summary>
public sealed class MarketSettings
{
    /// <summary>
    /// False: trade offers carry items only. A new offer or counter-offer with coins is refused, and a pending offer
    /// made earlier with coins can no longer be accepted (it can still be declined, cancelled or countered without coins).
    /// Override with Market__TradeCoins.
    /// </summary>
    public bool TradeCoins { get; set; } = true;

    /// <summary>
    /// True: the bag has no fixed size. It shows <see cref="Services.Market.MarketRules.InventorySlots"/> cells and grows
    /// as items come in, up to <see cref="Services.Market.MarketRules.GrowingBagSlots"/> (a safety ceiling only).
    /// False: the bag holds <see cref="Services.Market.MarketRules.InventorySlots"/> items. Override with Market__BagGrows.
    /// </summary>
    public bool BagGrows { get; set; }
}
