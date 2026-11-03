using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

public class AchievementRulesTests
{
    private static readonly PlayerStats Nothing = new(0, 0, 0, 0, 0, 0, false);

    private static AchievementProgress Find(PlayerStats stats, string titleDefId) =>
        AchievementRules.Evaluate(stats).Single(progress => progress.Def.TitleDefId == titleDefId);

    public static readonly TheoryData<string, Func<PlayerStats, int, PlayerStats>, int> Thresholds = new()
    {
        { "title_khach-quen", (stats, count) => stats with { Played = count }, 10 },
        { "title_ghi-chep", (stats, count) => stats with { TestimoniesRecorded = count }, 50 },
        { "title_mat-tinh", (stats, count) => stats with { CluesFound = count }, 100 },
        { "title_bach-nguyet", (stats, count) => stats with { MidnightWins = count }, 1 },
        { "title_doc-dau-vet", (stats, count) => stats with { NoHintWins = count }, 1 },
        { "title_huyet-kiem", (stats, count) => stats with { Won = count }, 50 },
    };

    [Theory]
    [MemberData(nameof(Thresholds))]
    public void AnAchievement_IsEarnedExactlyAtItsTarget(string titleDefId, Func<PlayerStats, int, PlayerStats> with, int target)
    {
        var before = Find(with(Nothing, target - 1), titleDefId);
        Assert.False(before.Earned);
        Assert.Equal(target - 1, before.Count);
        Assert.Equal(target, before.Def.Target);

        Assert.True(Find(with(Nothing, target), titleDefId).Earned);
        Assert.True(Find(with(Nothing, target + 5), titleDefId).Earned);
    }

    [Fact]
    public void TheKeeperOfTheHour_NeedsTheWatch()
    {
        Assert.False(Find(Nothing, "title_giu-gio").Earned);
        Assert.True(Find(Nothing with { OwnsWatch217 = true }, "title_giu-gio").Earned);
    }

    [Fact]
    public void LockPuzzles_CannotBeCountedPerPlayer_SoTheTitleStaysClosed()
    {
        var progress = Find(new PlayerStats(999, 999, 999, 999, 999, 999, true), "title_tho-khoa");
        Assert.False(progress.Def.Countable);
        Assert.False(progress.Earned);
    }

    [Fact]
    public void TheCatalogCovers_EveryAchievementTitleOfThePrototype()
    {
        Assert.Equal(
            new[] { "title_bach-nguyet", "title_doc-dau-vet", "title_ghi-chep", "title_giu-gio", "title_huyet-kiem", "title_khach-quen", "title_mat-tinh", "title_tho-khoa" },
            AchievementRules.Catalog.Select(def => def.TitleDefId).OrderBy(id => id, StringComparer.Ordinal));
    }

    // Vietnam time is UTC+7, so midnight there is 17:00 UTC the day before.
    [Theory]
    [InlineData("2026-11-02T16:59:59Z", false)]
    [InlineData("2026-11-02T17:00:00Z", true)]
    [InlineData("2026-11-02T17:59:59Z", true)]
    [InlineData("2026-11-02T18:00:00Z", false)]
    [InlineData("2026-11-03T00:00:00Z", false)]
    public void Midnight_IsTheFirstHourOfTheDayInVietnam(string utc, bool expected) =>
        Assert.Equal(expected, AchievementRules.IsMidnight(DateTime.Parse(utc, null, System.Globalization.DateTimeStyles.AdjustToUniversal)));
}
