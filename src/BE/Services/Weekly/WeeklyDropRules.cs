using SirLocked.Api.Models;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Weekly;

/// <summary>One chest that the weekly challenge can drop, with its share of the drops as a percentage rounded to two places.</summary>
public sealed record WeeklyChestOdds(ChestDef Chest, decimal Percent);

/// <summary>What evaluating one player's game for the weekly chest came to.</summary>
public static class WeeklyDropStatuses
{
    /// <summary>The chest of this week is in the bag (now or earlier, from this game).</summary>
    public const string Granted = "GRANTED";
    /// <summary>This game dropped the week's chest, but the bag is full: it waits for the player to claim it.</summary>
    public const string Waiting = "WAITING";
    /// <summary>The game was not the case of the challenge in the week it was played.</summary>
    public const string NotChallenge = "NOT_CHALLENGE";
    /// <summary>Below the score the challenge needs, or no score at all.</summary>
    public const string LowScore = "LOW_SCORE";
    /// <summary>The wrong culprit was accused.</summary>
    public const string NotSolved = "NOT_SOLVED";
    /// <summary>The player wrote the case.</summary>
    public const string Author = "AUTHOR";
    /// <summary>A guest, or an account without a verified e-mail or not active.</summary>
    public const string Unverified = "UNVERIFIED";
    /// <summary>The account already has this week's chest, from another game.</summary>
    public const string AlreadyThisWeek = "ALREADY_THIS_WEEK";
    /// <summary>No chest can drop (all switched off or weighted 0), so nothing was rolled.</summary>
    public const string NoChest = "NO_CHEST";
}

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
            .Select(chest => new WeeklyChestOdds(chest, Share(chest.ChallengeWeight, total)))
            .ToList();
    }

    /// <summary>
    /// The share of the weekly drops of every stored chest, by id, in percent rounded to two places. Same reading as
    /// <see cref="Odds"/>: only an active chest with an effective weight above zero counts, and every other chest shows 0.
    /// </summary>
    public static IReadOnlyDictionary<string, decimal> Percents(IEnumerable<CatalogChest> chests)
    {
        var all = chests.ToList();
        bool Drops(CatalogChest chest) => chest.Active && EffectiveWeight(chest) > 0;
        var total = all.Where(Drops).Sum(chest => (long)EffectiveWeight(chest));
        return all.ToDictionary(
            chest => chest.Id,
            chest => Drops(chest) ? Share(EffectiveWeight(chest), total) : 0m,
            StringComparer.Ordinal);
    }

    private static decimal Share(int weight, long total) => Math.Round(weight * 100m / total, 2);

    /// <summary>
    /// Why this player's game earns no weekly chest, as one of <see cref="WeeklyDropStatuses"/>, or null when it does.
    /// Checked in this order: the score (missing or below <paramref name="minScore"/>), the culprit, the author of the
    /// case, then the account (<paramref name="verifiedActive"/>: a verified e-mail and an active account, never a guest).
    /// </summary>
    public static string? Ineligibility(GameResult result, string userId, string? authorUserId, bool verifiedActive, int minScore)
    {
        if (result.ScoreSummary is null || result.ScoreSummary.TotalScore < minScore) return WeeklyDropStatuses.LowScore;
        if (!result.Success) return WeeklyDropStatuses.NotSolved;
        if (!string.IsNullOrEmpty(authorUserId) && string.Equals(authorUserId, userId, StringComparison.Ordinal))
            return WeeklyDropStatuses.Author;
        if (!verifiedActive) return WeeklyDropStatuses.Unverified;
        return null;
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
