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
}
