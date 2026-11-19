using System.Globalization;

namespace SirLocked.Api.Services.Weekly;

/// <summary>
/// One challenge week: it starts at 00:00 on a Wednesday UTC (07:00 Wednesday in Vietnam) and lasts seven
/// days. <see cref="EndUtc"/> is exclusive, so it is also the start of the next week.
/// The key is the Wednesday's date as yyyy-MM-dd, for example 2026-11-18.
/// </summary>
public readonly record struct ChallengeWeek(string Key, DateTime StartUtc, DateTime EndUtc)
{
    private const string KeyFormat = "yyyy-MM-dd";
    private const int LengthInDays = 7;

    /// <summary>The week that contains this moment. A moment that is not UTC is converted first.</summary>
    public static ChallengeWeek Containing(DateTime utc)
    {
        var moment = utc.ToUniversalTime();
        var daysSinceWednesday = ((int)moment.DayOfWeek - (int)DayOfWeek.Wednesday + 7) % 7;
        return FromStart(moment.Date.AddDays(-daysSinceWednesday));
    }

    /// <summary>The week for a key such as 2026-11-18. Throws <see cref="ArgumentException"/> when the key is not a Wednesday date.</summary>
    public static ChallengeWeek FromKey(string key)
    {
        if (!DateTime.TryParseExact(key, KeyFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            || date.DayOfWeek != DayOfWeek.Wednesday)
        {
            throw new ArgumentException($"'{key}' is not a challenge week key (a Wednesday as {KeyFormat}).", nameof(key));
        }

        return FromStart(DateTime.SpecifyKind(date, DateTimeKind.Utc));
    }

    /// <summary>The week that came this many whole weeks earlier.</summary>
    public ChallengeWeek Previous(int weeks = 1) => FromStart(StartUtc.AddDays(-LengthInDays * weeks));

    /// <summary>True when the moment falls in this week: start inclusive, end exclusive.</summary>
    public bool Contains(DateTime utc)
    {
        var moment = utc.ToUniversalTime();
        return StartUtc <= moment && moment < EndUtc;
    }

    private static ChallengeWeek FromStart(DateTime startUtc) =>
        new(startUtc.ToString(KeyFormat, CultureInfo.InvariantCulture), startUtc, startUtc.AddDays(LengthInDays));
}
