using SirLocked.Api.Configurations;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Weekly;
using Xunit;

namespace SirLocked.Tests;

/// <summary>Which cases the weekly challenge may pick on its own, and how the rules loosen when too few qualify.</summary>
public sealed class ChallengePickRulesTests
{
    private sealed class ScriptedRandom(params int[] values) : IChestRandom
    {
        private readonly Queue<int> _values = new(values);

        public int NextInt(int exclusiveMax) => _values.Count > 0 ? _values.Dequeue() : 0;
    }

    private static ChallengeCandidate Case(string id, double rating, int reviews) => new(id, rating, reviews);

    private static readonly ChallengeCandidate A = Case("A", 4.5, 6);
    private static readonly ChallengeCandidate B = Case("B", 4.2, 5);
    private static readonly ChallengeCandidate C = Case("C", 3.9, 10);
    private static readonly ChallengeCandidate D = Case("D", 5.0, 2);
    private static readonly ChallengeCandidate E = Case("E", 3.6, 1);
    private static readonly ChallengeCandidate F = Case("F", 0, 0);

    private static ChallengeCandidate[] Everyone => [A, B, C, D, E, F];

    private static string[] Ids(ChallengePool pool) => pool.Cases.Select(c => c.CaseId).Order(StringComparer.Ordinal).ToArray();

    [Fact]
    public void Step0_SkipsRecentWeeks()
    {
        var pool = ChallengePickRules.Eligible(Everyone, ["A"], "A", new WeeklyChallengeSettings());

        Assert.Equal(0, pool.Step);
        Assert.Equal(new[] { "B" }, Ids(pool));
    }

    [Fact]
    public void Step1_AllowsOlderRecent()
    {
        var pool = ChallengePickRules.Eligible(Everyone, ["A", "B"], "B", new WeeklyChallengeSettings());

        Assert.Equal(1, pool.Step);
        Assert.Equal(new[] { "A" }, Ids(pool));
    }

    [Fact]
    public void Step3_OneReview()
    {
        ChallengeCandidate[] all = [C, D, E, F];

        var pool = ChallengePickRules.Eligible(all, [], null, new WeeklyChallengeSettings());

        Assert.Equal(3, pool.Step);
        Assert.Equal(new[] { "D" }, Ids(pool));
    }

    [Fact]
    public void Step2_ThreeReviews()
    {
        var g = Case("G", 4.1, 3);
        ChallengeCandidate[] all = [C, D, E, F, g];

        var pool = ChallengePickRules.Eligible(all, [], null, new WeeklyChallengeSettings());

        Assert.Equal(2, pool.Step);
        Assert.Equal(new[] { "G" }, Ids(pool));
    }

    [Fact]
    public void Step2_NeedsFewerThanThreeWhenMinReviewsIsLower()
    {
        // MinReviews 2 makes min(3, 2) = 2, so D (2 reviews) already qualifies at step 0.
        var pool = ChallengePickRules.Eligible([C, D, E, F], [], null, new WeeklyChallengeSettings { MinReviews = 2 });

        Assert.Equal(0, pool.Step);
        Assert.Equal(new[] { "D" }, Ids(pool));
    }

    [Fact]
    public void Step4_RelaxesRating()
    {
        ChallengeCandidate[] all = [C, E, F];

        var pool = ChallengePickRules.Eligible(all, [], null, new WeeklyChallengeSettings());

        Assert.Equal(4, pool.Step);
        Assert.Equal(new[] { "C", "E" }, Ids(pool));
    }

    [Fact]
    public void Step5_TopRatedWhenNothingElse()
    {
        var h = Case("H", 0, 0);

        var pool = ChallengePickRules.Eligible([F, h], [], null, new WeeklyChallengeSettings());

        Assert.Equal(5, pool.Step);
        Assert.Equal(new[] { "F", "H" }, Ids(pool));
    }

    [Fact]
    public void Step5_OnlyCaseIsKeptEvenIfItRanLastWeek()
    {
        var pool = ChallengePickRules.Eligible([F], [], "F", new WeeklyChallengeSettings());

        Assert.Equal(5, pool.Step);
        Assert.Equal(new[] { "F" }, Ids(pool));
    }

    [Fact]
    public void Step5_DropsLastWeekAndKeepsOnlyTheHighestRated()
    {
        var low = Case("L", 3.4, 4);
        var lower = Case("M", 2.0, 9);
        var last = Case("Z", 3.4, 4);
        // Nothing reaches 3.5, so step 5 runs: Z is last week's case, L beats M.
        var pool = ChallengePickRules.Eligible([low, lower, last], [], "Z", new WeeklyChallengeSettings());

        Assert.Equal(5, pool.Step);
        Assert.Equal(new[] { "L" }, Ids(pool));
    }

    [Fact]
    public void Step5_UnratedCountsAsZero()
    {
        var rated = Case("R", 1.5, 2);
        var unrated = Case("U", 0, 0);

        var pool = ChallengePickRules.Eligible([unrated, rated], [], null, new WeeklyChallengeSettings());

        Assert.Equal(5, pool.Step);
        Assert.Equal(new[] { "R" }, Ids(pool));
    }

    [Fact]
    public void Thresholds_AreInclusive()
    {
        // Exactly 4.0 stars and exactly 5 reviews qualify at step 0.
        var edge = Case("EDGE", 4.0, 5);

        var pool = ChallengePickRules.Eligible([edge, C], [], null, new WeeklyChallengeSettings());

        Assert.Equal(0, pool.Step);
        Assert.Equal(new[] { "EDGE" }, Ids(pool));
    }

    [Fact]
    public void Step4_RatingThresholdIsInclusive()
    {
        var edge = Case("EDGE", 3.5, 1);

        var pool = ChallengePickRules.Eligible([edge, F], [], null, new WeeklyChallengeSettings());

        Assert.Equal(4, pool.Step);
        Assert.Equal(new[] { "EDGE" }, Ids(pool));
    }

    [Fact]
    public void LastWeekIsExcludedAtEveryLaterStep()
    {
        // A is the only 4-star case with enough reviews, but it ran last week: no step lets it back in while E exists.
        var pool = ChallengePickRules.Eligible([A, E], ["A"], "A", new WeeklyChallengeSettings());

        Assert.Equal(4, pool.Step);
        Assert.Equal(new[] { "E" }, Ids(pool));
    }

    [Fact]
    public void Eligible_UsesSettings()
    {
        var settings = new WeeklyChallengeSettings { MinAverageRating = 4.5, MinReviews = 6 };

        var pool = ChallengePickRules.Eligible(Everyone, [], null, settings);

        Assert.Equal(0, pool.Step);
        Assert.Equal(new[] { "A" }, Ids(pool));
    }

    [Fact]
    public void Eligible_EmptyInput_GivesEmpty()
    {
        var pool = ChallengePickRules.Eligible([], ["A"], "A", new WeeklyChallengeSettings());

        Assert.Empty(pool.Cases);
        Assert.Equal(5, pool.Step);
    }

    [Fact]
    public void Pick_IsUniformByIndex()
    {
        var pool = new ChallengePool([B, A], 0);

        var picked = ChallengePickRules.Pick(pool, new ScriptedRandom(1));

        Assert.Equal("B", picked?.CaseId);
    }

    [Fact]
    public void Pick_FirstIndexIsTheSmallestCaseId()
    {
        var pool = new ChallengePool([B, A], 0);

        var picked = ChallengePickRules.Pick(pool, new ScriptedRandom(0));

        Assert.Equal("A", picked?.CaseId);
    }

    [Fact]
    public void Pick_EmptyPoolGivesNull()
    {
        Assert.Null(ChallengePickRules.Pick(new ChallengePool([], 5), new ScriptedRandom(0)));
    }
}
