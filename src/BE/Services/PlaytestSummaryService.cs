using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Playtest;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Reads playtest events and folds them into the numbers the Phase 2 exit criteria need.
/// The fold itself is a pure static so it can be tested without MongoDB.
/// </summary>
public sealed class PlaytestSummaryService
{
    public const int DefaultRangeDays = 7;
    public const int MaxRangeDays = 90;

    /// <summary>
    /// The range caps time, not volume. This caps volume: a dashboard load must degrade into a
    /// partial answer rather than pull an unbounded collection into the API process.
    /// </summary>
    public const int MaxEventsPerSummary = 200_000;

    private readonly MongoDbContext _db;
    private readonly TimeProvider _timeProvider;

    public PlaytestSummaryService(MongoDbContext db, TimeProvider timeProvider)
    {
        _db = db;
        _timeProvider = timeProvider;
    }

    public async Task<PlaytestSummaryResponse> GetSummaryAsync(
        DateTime? from,
        DateTime? to,
        CancellationToken cancellationToken = default)
    {
        var (rangeStart, rangeEnd) = ResolveRange(from, to, _timeProvider.GetUtcNow().UtcDateTime);
        // One extra document is read purely to detect the overflow; it is never summarised.
        var events = await _db.PlaytestEvents
            .Find(record => record.Timestamp >= rangeStart && record.Timestamp < rangeEnd)
            .SortBy(record => record.Timestamp)
            .Limit(MaxEventsPerSummary + 1)
            .ToListAsync(cancellationToken);

        var isTruncated = events.Count > MaxEventsPerSummary;
        if (isTruncated) events.RemoveRange(MaxEventsPerSummary, events.Count - MaxEventsPerSummary);

        var summary = Summarize(events);
        summary.From = rangeStart;
        summary.To = rangeEnd;
        summary.EventCount = events.Count;
        summary.IsTruncated = isTruncated;
        return summary;
    }

    /// <summary>Defaults to the last week and refuses windows wide enough to outlive retention.</summary>
    public static (DateTime From, DateTime To) ResolveRange(DateTime? from, DateTime? to, DateTime utcNow)
    {
        var rangeEnd = AsUtc(to ?? utcNow);
        var rangeStart = AsUtc(from ?? rangeEnd.AddDays(-DefaultRangeDays));
        if (rangeEnd <= rangeStart)
        {
            throw ApiException.BadRequest("'to' must be later than 'from'.");
        }
        if ((rangeEnd - rangeStart).TotalDays > MaxRangeDays)
        {
            throw ApiException.BadRequest($"The requested range must not exceed {MaxRangeDays} days.");
        }
        return (rangeStart, rangeEnd);
    }

    public static PlaytestSummaryResponse Summarize(IReadOnlyList<PlaytestEventRecord> events)
    {
        var waitingMsByRole = SumDurationByRole(events, PlaytestEventType.WaitingEnded);
        return new PlaytestSummaryResponse
        {
            SessionCount = events
                .Select(record => record.SessionPseudonym)
                .Distinct(StringComparer.Ordinal)
                .Count(),
            WaitingMsByRole = waitingMsByRole,
            WaitingImbalancePct = ImbalancePct(
                waitingMsByRole.GetValueOrDefault(PlayerRole.Investigator),
                waitingMsByRole.GetValueOrDefault(PlayerRole.Interrogator)),
            NotebookOpenMsByRole = SumDurationByRole(events, PlaytestEventType.PrivateNotebookClosed),
            ConfrontationOutcomes = new Dictionary<string, int>(StringComparer.Ordinal)
            {
                [nameof(PlaytestEventType.ResolvedCorrect)] = Count(events, PlaytestEventType.ResolvedCorrect),
                [nameof(PlaytestEventType.ResolvedIncorrect)] = Count(events, PlaytestEventType.ResolvedIncorrect),
                [nameof(PlaytestEventType.Cancelled)] = Count(events, PlaytestEventType.Cancelled)
            },
            MedianRevisionsPerAttempt = Median(MaxRevisionPerAttempt(events)),
            MedianStageMs = Median(StageGapsMs(events)),
            HintCountByTier = events
                .Where(record => record.EventType == PlaytestEventType.HintUsed && record.Count.HasValue)
                .GroupBy(record => record.Count!.Value)
                .OrderBy(group => group.Key)
                .ToDictionary(group => group.Key, group => group.Count()),
            OptimisticRetryCount = Count(events, PlaytestEventType.OptimisticRetry),
            ReconnectRestoredCount = Count(events, PlaytestEventType.ReconnectRestored)
        };
    }

    private static int Count(IReadOnlyList<PlaytestEventRecord> events, PlaytestEventType eventType) =>
        events.Count(record => record.EventType == eventType);

    /// <summary>Both roles are always present so a zero reads as "no time", not "no data".</summary>
    private static Dictionary<string, long> SumDurationByRole(
        IReadOnlyList<PlaytestEventRecord> events,
        PlaytestEventType eventType)
    {
        var totals = new Dictionary<string, long>(StringComparer.Ordinal)
        {
            [PlayerRole.Investigator] = 0,
            [PlayerRole.Interrogator] = 0
        };
        foreach (var record in events.Where(record => record.EventType == eventType && record.DurationMs.HasValue))
        {
            var role = string.IsNullOrWhiteSpace(record.Role) ? "UNKNOWN" : record.Role;
            totals[role] = totals.GetValueOrDefault(role) + record.DurationMs!.Value;
        }
        return totals;
    }

    private static double? ImbalancePct(long investigatorMs, long interrogatorMs)
    {
        var larger = Math.Max(investigatorMs, interrogatorMs);
        if (investigatorMs <= 0 || interrogatorMs <= 0 || larger == 0) return null;
        return Math.Abs(investigatorMs - interrogatorMs) / (double)larger * 100d;
    }

    private static List<double> MaxRevisionPerAttempt(IReadOnlyList<PlaytestEventRecord> events) =>
        events
            .Where(record => !string.IsNullOrEmpty(record.AttemptId) && record.Revision.HasValue)
            .GroupBy(record => record.AttemptId!, StringComparer.Ordinal)
            .Select(group => (double)group.Max(record => record.Revision!.Value))
            .ToList();

    private static List<double> StageGapsMs(IReadOnlyList<PlaytestEventRecord> events)
    {
        var gaps = new List<double>();
        foreach (var session in events
                     .Where(record => record.EventType == PlaytestEventType.StageCompleted)
                     .GroupBy(record => record.SessionPseudonym, StringComparer.Ordinal))
        {
            var ordered = session.OrderBy(record => record.Timestamp).ToList();
            for (var index = 1; index < ordered.Count; index++)
            {
                gaps.Add((ordered[index].Timestamp - ordered[index - 1].Timestamp).TotalMilliseconds);
            }
        }
        return gaps;
    }

    private static double? Median(IReadOnlyList<double> values)
    {
        if (values.Count == 0) return null;
        var sorted = values.OrderBy(value => value).ToList();
        var middle = sorted.Count / 2;
        return sorted.Count % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2d;
    }

    private static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };
}
