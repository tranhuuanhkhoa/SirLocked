using SirLocked.Api.DTOs.Badge;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

/// <summary>Covers the achievement catalog logic in <see cref="BadgeRules"/> (the DB join is in BadgeService).</summary>
public class BadgeServiceTests
{
    private static readonly DateTime Now = new(2026, 6, 19, 12, 0, 0, DateTimeKind.Utc);

    private static BadgePlay Play(
        bool hasStats = true, bool usedHint = false, int? durationSeconds = 300,
        int wrongDeduction = 0, int wrongEvidence = 0, int cameraMiss = 0, int score = 50, string title = "The Manor") =>
        new("case-1", title, hasStats, usedHint, durationSeconds, wrongDeduction, wrongEvidence, cameraMiss, score, Now);

    private static bool Earned(IEnumerable<BadgeDto> badges, string key) =>
        badges.First(b => b.Key == key).Earned;

    [Fact]
    public void NoPlays_ReturnsFullCatalog_AllUnearned()
    {
        var badges = BadgeRules.Evaluate(Array.Empty<BadgePlay>());

        Assert.Equal(BadgeRules.Catalog.Count, badges.Count);
        Assert.All(badges, b => Assert.False(b.Earned));
        Assert.All(badges, b => Assert.Null(b.EarnedContext));
    }

    [Fact]
    public void FirstSolve_EarnedWhenAnyWin()
    {
        var badges = BadgeRules.Evaluate(new[] { Play() });
        Assert.True(Earned(badges, "first_solve"));
    }

    [Fact]
    public void NoHint_FalseWhenHintUsed_TrueWhenNot()
    {
        Assert.False(Earned(BadgeRules.Evaluate(new[] { Play(usedHint: true) }), "no_hint"));
        Assert.True(Earned(BadgeRules.Evaluate(new[] { Play(usedHint: false) }), "no_hint"));
    }

    [Fact]
    public void Speed_TrueUnderTenMinutes_FalseOver()
    {
        Assert.True(Earned(BadgeRules.Evaluate(new[] { Play(durationSeconds: 540) }), "speed_demon"));
        Assert.False(Earned(BadgeRules.Evaluate(new[] { Play(durationSeconds: 900) }), "speed_demon"));
    }

    [Fact]
    public void Speed_FalseWhenDurationUnknown()
    {
        Assert.False(Earned(BadgeRules.Evaluate(new[] { Play(durationSeconds: null) }), "speed_demon"));
    }

    [Fact]
    public void Flawless_RequiresNoWrongDeductionOrEvidence()
    {
        Assert.True(Earned(BadgeRules.Evaluate(new[] { Play(wrongDeduction: 0, wrongEvidence: 0) }), "flawless"));
        Assert.False(Earned(BadgeRules.Evaluate(new[] { Play(wrongDeduction: 1) }), "flawless"));
        Assert.False(Earned(BadgeRules.Evaluate(new[] { Play(wrongEvidence: 2) }), "flawless"));
    }

    [Fact]
    public void StatDerivedBadges_NotAwardedWhenStatsMissing()
    {
        // A win whose room/state was unavailable must not falsely earn clean-run badges.
        var badges = BadgeRules.Evaluate(new[] { Play(hasStats: false, durationSeconds: null) });
        Assert.False(Earned(badges, "no_hint"));
        Assert.False(Earned(badges, "flawless"));
        Assert.False(Earned(badges, "sharp_eye"));
        Assert.True(Earned(badges, "first_solve"));  // GameResult-only badges still count
    }

    [Fact]
    public void Master_RequiresScoreThreshold()
    {
        Assert.True(Earned(BadgeRules.Evaluate(new[] { Play(score: 90) }), "master"));
        Assert.False(Earned(BadgeRules.Evaluate(new[] { Play(score: 89) }), "master"));
    }

    [Fact]
    public void EarnedContext_IncludesCaseAndTime()
    {
        var badges = BadgeRules.Evaluate(new[] { Play(durationSeconds: 512, title: "Bell & Low Tide") });
        var speed = badges.First(b => b.Key == "speed_demon");
        Assert.True(speed.Earned);
        Assert.Contains("Bell & Low Tide", speed.EarnedContext);
        Assert.Contains("8:32", speed.EarnedContext);  // 512s = 8:32
    }

    [Fact]
    public void BadgeEarned_FromAnyOfMultiplePlays()
    {
        // First play used a hint; a later play did not -> no_hint earned overall.
        var badges = BadgeRules.Evaluate(new[] { Play(usedHint: true), Play(usedHint: false) });
        Assert.True(Earned(badges, "no_hint"));
    }
}
