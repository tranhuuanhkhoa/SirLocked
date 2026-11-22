using SirLocked.Api.Services.Admin;
using Xunit;

namespace SirLocked.Tests;

public sealed class ActivityMetricsMathTests
{
    [Fact]
    public void BuildsZeroFilledDailyBucketsAndDistinctCounts()
    {
        var start = new DateOnly(2026, 3, 1);
        var active = new Dictionary<DateOnly, HashSet<string>>
        {
            [start] = ["a", "b"],
            [start.AddDays(2)] = ["b", "c"],
        };
        var daily = ActivityMetricsMath.BuildDaily(start, start.AddDays(2), active,
            new Dictionary<DateOnly, long> { [start.AddDays(1)] = 3 });

        Assert.Equal(new long[] { 2, 0, 2 }, daily.Select(day => day.ActiveUsers));
        Assert.Equal(new long[] { 0, 3, 0 }, daily.Select(day => day.NewUsers));
        Assert.Equal(3, ActivityMetricsMath.CountDistinctUsers(start, start.AddDays(2), active));
    }

    [Fact]
    public void ComputesRetentionFractionsAndLeavesFutureObservationsNull()
    {
        var today = new DateOnly(2026, 3, 10);
        var cohorts = new[]
        {
            new ActivityCohort("2026-03-09", ["a", "b"]),
            new ActivityCohort("2026-03-03", ["c", "d"]),
        };
        var activity = new Dictionary<DateOnly, HashSet<string>>
        {
            [today] = ["a", "c"],
        };

        var retention = ActivityMetricsMath.BuildRetention(today, cohorts, activity);
        var yesterday = Assert.Single(retention, item => item.CohortDay == "2026-03-09");
        var lastWeek = Assert.Single(retention, item => item.CohortDay == "2026-03-03");
        Assert.Equal(0.5, yesterday.D1);
        Assert.Null(yesterday.D7);
        Assert.Equal(0.5, lastWeek.D7);
        Assert.Equal(0, lastWeek.D1);
    }
}
