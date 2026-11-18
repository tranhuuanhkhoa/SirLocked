namespace SirLocked.Api.Services.Vip;

/// <summary>
/// Which model writes a step of a VIP order (part 3 of VUAN-7): Haiku for light work (the order brief and content
/// check, JSON format repairs), Sonnet for everything else, Opus only for the third try of a step the main model failed
/// twice. ADMIN overrides (step name prefix → model) replace the main model of matching steps.
/// </summary>
public static class VipModelRouter
{
    public const string BriefStep = "VipBrief";
    public const string JsonRepairStep = "VipJsonRepair";
    public const string AssetPlanStep = "VipAssetPlan";

    /// <summary>Steps the light model writes.</summary>
    public static readonly IReadOnlyList<string> LightSteps = [BriefStep, JsonRepairStep];

    public sealed record Choice(string Model, string Role);

    public static Choice Resolve(VipModelSettings settings, string step, int attemptNumber)
    {
        var name = step ?? string.Empty;
        var light = LightSteps.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal));
        var overrideModel = (settings.StepOverrides ?? new Dictionary<string, string>())
            .Where(item => name.StartsWith(item.Key, StringComparison.Ordinal))
            .OrderByDescending(item => item.Key.Length)
            .Select(item => item.Value)
            .FirstOrDefault();
        if (light) return new Choice(overrideModel ?? settings.Light, "light");
        // The third try of a step the main model failed twice goes to the rescue model, overrides included.
        if (attemptNumber >= settings.RescueFromAttempt) return new Choice(settings.Rescue, "rescue");
        return overrideModel is null ? new Choice(settings.Main, "main") : new Choice(overrideModel, "override");
    }

    /// <summary>
    /// USD cost of one call from its usage. Input tokens are the uncached part; cache reads and writes are priced on
    /// their own; a batch call costs half.
    /// </summary>
    public static decimal CostUsd(VipModelPrice price, ClaudeApiUsage usage, bool batch)
    {
        var cost = (usage.InputTokens * price.InputUsdPerMTok
                    + usage.OutputTokens * price.OutputUsdPerMTok
                    + usage.CacheReadTokens * price.CacheReadUsdPerMTok
                    + usage.CacheWriteTokens * price.CacheWriteUsdPerMTok) / 1_000_000m;
        return Math.Round(batch ? cost / 2m : cost, 6, MidpointRounding.AwayFromZero);
    }

    public static long ToVnd(decimal usd, decimal usdToVnd) =>
        (long)Math.Ceiling(Math.Max(0m, usd) * Math.Max(0m, usdToVnd));

    /// <summary>Coins a spend in VND corresponds to, rounded up.</summary>
    public static long ToXu(long vnd, int vndPerXu) =>
        vndPerXu <= 0 ? vnd : (long)Math.Ceiling(Math.Max(0, vnd) / (decimal)vndPerXu);
}
