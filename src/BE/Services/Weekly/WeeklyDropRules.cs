using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Weekly;

/// <summary>One chest that the weekly challenge can drop, with its share of the drops as a percentage rounded to two places.</summary>
public sealed record WeeklyChestOdds(ChestDef Chest, decimal Percent);

/// <summary>
/// Which chest a player gets for finishing the weekly challenge. A chest drops when it is active and its challenge
/// weight is above zero; the weights only matter against each other. Pure functions, so tests and the admin page
/// share one reading.
/// </summary>
public static class WeeklyDropRules
{
    /// <summary>The highest weight an admin can give one chest.</summary>
    public const int MaxWeight = 10_000;

    /// <summary>The weight a chest has until an admin sets one: the three shop chests drop 60 / 30 / 10, anything else never.</summary>
    public static int DefaultWeight(string chestId) => chestId switch
    {
        "chest_np" => 60,
        "chest_sm" => 30,
        "chest_nb" => 10,
        _ => 0,
    };

    /// <summary>The weight in force for a stored chest: the explicit value, or the default for its id when none was ever set.</summary>
    public static int EffectiveWeight(CatalogChest chest) => chest.ChallengeWeight ?? DefaultWeight(chest.Id);

    /// <summary>The chests that can drop, heaviest first (ties by id), each with its percentage of the total weight.</summary>
    public static IReadOnlyList<WeeklyChestOdds> Odds(IEnumerable<ChestDef> chests)
    {
        var droppable = chests
            .Where(chest => chest.Active && chest.ChallengeWeight > 0)
            .OrderByDescending(chest => chest.ChallengeWeight)
            .ThenBy(chest => chest.Id, StringComparer.Ordinal)
            .ToList();
        var total = droppable.Sum(chest => (long)chest.ChallengeWeight);
        return droppable
            .Select(chest => new WeeklyChestOdds(chest, Math.Round(chest.ChallengeWeight * 100m / total, 2)))
            .ToList();
    }

    /// <summary>Draws one chest by weight, walking the list in the order <see cref="Odds"/> gave. Null when nothing can drop.</summary>
    public static ChestDef? RollChest(IReadOnlyList<WeeklyChestOdds> odds, IChestRandom random)
    {
        if (odds.Count == 0) return null;
        var total = odds.Sum(odd => odd.Chest.ChallengeWeight);
        var ticket = random.NextInt(total);
        foreach (var odd in odds)
        {
            if (ticket < odd.Chest.ChallengeWeight) return odd.Chest;
            ticket -= odd.Chest.ChallengeWeight;
        }
        return odds[^1].Chest;
    }
}
