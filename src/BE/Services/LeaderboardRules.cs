using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// Pure leaderboard logic (team grouping, first-success selection, metric sorting, ranking).
/// No I/O, so it is fully unit-testable. The service does the Mongo reads and hands the joined
/// data here.
/// </summary>
public static class LeaderboardRules
{
    public const int DefaultLimit = 100;
    public const int MaxLimit = 100;

    public static LeaderboardDto Build(
        IEnumerable<GameResult> results,
        IReadOnlyDictionary<string, GameRoom> roomsById,
        string? metric,
        int limit,
        DateTime? after = null,
        DateTime? before = null)
    {
        var safeMetric = LeaderboardMetrics.Normalize(metric);
        var safeLimit = limit <= 0 ? DefaultLimit : Math.Min(limit, MaxLimit);

        // Only successful solves count; one row per team = its FIRST success (earliest createdAt),
        // so replaying a case you already cracked never earns extra rankings. An optional
        // [after, before) window restricts to plays in that period (used by the weekly challenge).
        var firstSuccessPerTeam = results
            .Where(r => r.Success && r.Players.Count > 0)
            .Where(r => (after is null || r.CreatedAt >= after) && (before is null || r.CreatedAt < before))
            .GroupBy(TeamKey)
            .Select(group => group.OrderBy(r => r.CreatedAt).First())
            .Select(r => ToEntry(r, roomsById))
            .ToList();

        var ranked = (safeMetric == LeaderboardMetrics.TopScore
            ? firstSuccessPerTeam
                .OrderByDescending(e => e.Score)
                .ThenBy(e => e.SolveTimeSeconds ?? int.MaxValue)
                .ThenBy(e => e.CompletedAt)
            // fastest: a solve with no derivable time cannot be ranked here, so drop it.
            : firstSuccessPerTeam
                .Where(e => e.SolveTimeSeconds.HasValue)
                .OrderBy(e => e.SolveTimeSeconds!.Value)
                .ThenBy(e => e.CompletedAt))
            .ToList();

        return new LeaderboardDto
        {
            Metric = safeMetric,
            TotalRanked = ranked.Count,
            Entries = ranked
                .Take(safeLimit)
                .Select((e, index) => new LeaderboardEntryDto
                {
                    Rank = index + 1,
                    TeamDisplay = e.TeamDisplay,
                    SolveTimeSeconds = e.SolveTimeSeconds,
                    Score = e.Score,
                    CompletedAt = e.CompletedAt
                })
                .ToList()
        };
    }

    /// <summary>A team is the set of player ids, order-independent, so the same pair maps to one key.</summary>
    private static string TeamKey(GameResult r) => string.Join(
        "|",
        r.Players.Where(p => !string.IsNullOrEmpty(p)).Distinct().OrderBy(p => p, StringComparer.Ordinal));

    private static Entry ToEntry(GameResult r, IReadOnlyDictionary<string, GameRoom> roomsById)
    {
        GameRoom? room = null;
        if (!string.IsNullOrEmpty(r.RoomId))
        {
            roomsById.TryGetValue(r.RoomId, out room);
        }

        return new Entry
        {
            TeamDisplay = TeamDisplay(room),
            SolveTimeSeconds = SolveTimeSeconds(r, room),
            Score = r.ScoreSummary?.TotalScore ?? 0,
            CompletedAt = room?.GameplayState?.CompletedAt ?? r.CreatedAt
        };
    }

    /// <summary>
    /// Duration lives only on the embedded GameRoom.GameplayState (GameResult has no duration).
    /// Returns null when the room was cleaned up so the entry can be excluded from the time metric.
    /// </summary>
    private static int? SolveTimeSeconds(GameResult r, GameRoom? room)
    {
        var state = room?.GameplayState;
        if (state is null)
        {
            return null;
        }
        var end = state.CompletedAt ?? r.CreatedAt;
        var span = end - state.StartedAt;
        return span > TimeSpan.Zero ? (int)Math.Round(span.TotalSeconds) : null;
    }

    private static string TeamDisplay(GameRoom? room)
    {
        var names = room?.Players
            .Select(p => p.Username?.Trim())
            .Where(n => !string.IsNullOrEmpty(n))
            .ToList();
        return names is { Count: > 0 } ? string.Join(" & ", names) : "Đội ẩn danh";
    }

    private sealed class Entry
    {
        public string TeamDisplay = string.Empty;
        public int? SolveTimeSeconds;
        public int Score;
        public DateTime CompletedAt;
    }
}
