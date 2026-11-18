using System.Globalization;
using SirLocked.Api.Services.Weekly;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The challenge week runs from 00:00 Wednesday UTC (07:00 Wednesday in Vietnam) for seven days.</summary>
public sealed class ChallengeWeekTests
{
    [Theory]
    [InlineData("2026-11-18T00:00:00Z", "2026-11-18")]   // thứ Tư 07:00 VN
    [InlineData("2026-11-17T23:59:59Z", "2026-11-11")]   // thứ Tư 06:59:59 VN
    [InlineData("2026-11-24T16:59:59Z", "2026-11-18")]   // thứ Ba 23:59 VN
    [InlineData("2027-01-05T10:00:00Z", "2026-12-30")]   // tuần vắt qua năm
    public void Containing_StartsOnWednesdayMidnightUtc(string at, string key)
    {
        var week = ChallengeWeek.Containing(DateTime.Parse(at, null, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal));
        Assert.Equal(key, week.Key);
        Assert.Equal(DayOfWeek.Wednesday, week.StartUtc.DayOfWeek);
        Assert.Equal(TimeSpan.Zero, week.StartUtc.TimeOfDay);
        Assert.Equal(week.StartUtc.AddDays(7), week.EndUtc);
        Assert.Equal(DateTimeKind.Utc, week.StartUtc.Kind);
    }

    [Fact] public void FromKey_RoundTrips() => Assert.Equal(ChallengeWeek.Containing(new DateTime(2026, 11, 20, 3, 0, 0, DateTimeKind.Utc)), ChallengeWeek.FromKey("2026-11-18"));
    [Fact] public void Previous_GoesBackWholeWeeks() => Assert.Equal("2026-10-21", ChallengeWeek.FromKey("2026-11-18").Previous(4).Key);
    [Fact] public void Contains_EndIsExclusive() { var w = ChallengeWeek.FromKey("2026-11-18"); Assert.True(w.Contains(w.StartUtc)); Assert.False(w.Contains(w.EndUtc)); }
    [Fact] public void FromKey_RejectsANonWednesday() => Assert.Throws<ArgumentException>(() => ChallengeWeek.FromKey("2026-11-19"));
}
