using SirLocked.Api.Configurations;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Weekly;

/// <summary>A published case as the weekly pick sees it: its counted average stars and how many counted reviews that average rests on.</summary>
public sealed record ChallengeCandidate(string CaseId, double AverageRating, int ReviewCount);

/// <summary>The cases the weekly pick may choose from, and which loosening step (0 strictest, 5 loosest) produced them.</summary>
public sealed record ChallengePool(IReadOnlyList<ChallengeCandidate> Cases, int Step);

/// <summary>
/// Which case the weekly challenge picks on its own. A good case has enough stars and enough reviews and did not run
/// in the last few weeks; when none does, the rules loosen one step at a time so a week never goes without a case.
/// Pure functions: the caller reads the cases and their ratings, this only decides.
/// </summary>
public static class ChallengePickRules
{
    /// <summary>The step that always yields a case when there is at least one.</summary>
    private const int LastStep = 5;

    /// <summary>The loosest star rating that still counts as a fair case (step 4).</summary>
    private const double RelaxedRating = 3.5;

    /// <summary>Reviews needed at step 2, capped by the configured minimum.</summary>
    private const int FewReviews = 3;

    /// <summary>
    /// The cases that qualify at the first step that has any. Steps 0 to 4 need a star rating and a review count; step 0
    /// also skips every case in <paramref name="recentCaseIds"/>, the later ones only last week's case. Step 5 needs
    /// nothing and keeps the best-rated cases, dropping last week's unless it is the only one.
    /// </summary>
    public static ChallengePool Eligible(
        IReadOnlyList<ChallengeCandidate> all,
        IReadOnlyList<string> recentCaseIds,
        string? lastWeekCaseId,
        WeeklyChallengeSettings settings)
    {
        if (all.Count == 0) return new ChallengePool([], LastStep);

        var recent = new HashSet<string>(recentCaseIds, StringComparer.Ordinal);
        bool Recent(ChallengeCandidate c) => recent.Contains(c.CaseId);
        bool LastWeek(ChallengeCandidate c) => string.Equals(c.CaseId, lastWeekCaseId, StringComparison.Ordinal);

        var steps = new (double MinRating, int MinReviews, Func<ChallengeCandidate, bool> Excluded)[]
        {
            (settings.MinAverageRating, settings.MinReviews, Recent),
            (settings.MinAverageRating, settings.MinReviews, LastWeek),
            (settings.MinAverageRating, Math.Min(FewReviews, settings.MinReviews), LastWeek),
            (settings.MinAverageRating, 1, LastWeek),
            (RelaxedRating, 1, LastWeek),
        };

        for (var step = 0; step < steps.Length; step++)
        {
            var (minRating, minReviews, excluded) = steps[step];
            var found = all
                .Where(c => c.AverageRating >= minRating && c.ReviewCount >= minReviews && !excluded(c))
                .ToList();
            if (found.Count > 0) return new ChallengePool(found, step);
        }

        var rest = all.Where(c => !LastWeek(c)).ToList();
        if (rest.Count == 0) rest = [.. all];
        var best = rest.Max(Rating);
        return new ChallengePool(rest.Where(c => Rating(c) >= best).ToList(), LastStep);
    }

    /// <summary>One case chosen uniformly: the pool sorted by case id (ordinal) so the same random index always means the same case. Null when the pool is empty.</summary>
    public static ChallengeCandidate? Pick(ChallengePool pool, IChestRandom random)
    {
        if (pool.Cases.Count == 0) return null;
        var sorted = pool.Cases.OrderBy(c => c.CaseId, StringComparer.Ordinal).ToList();
        return sorted[random.NextInt(sorted.Count)];
    }

    /// <summary>A case nobody has reviewed counts as zero stars, whatever its stored average.</summary>
    private static double Rating(ChallengeCandidate c) => c.ReviewCount > 0 ? c.AverageRating : 0;
}
