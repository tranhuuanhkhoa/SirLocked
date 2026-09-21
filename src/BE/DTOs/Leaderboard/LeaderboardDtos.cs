namespace SirLocked.Api.DTOs.Leaderboard;

public static class LeaderboardMetrics
{
    /// <summary>Fastest first-time solves (ascending solve time).</summary>
    public const string Fastest = "fastest";
    /// <summary>Highest score (descending).</summary>
    public const string TopScore = "topScore";

    public static string Normalize(string? metric) =>
        string.Equals(metric, TopScore, StringComparison.OrdinalIgnoreCase) ? TopScore : Fastest;
}

/// <summary>One ranked team on a case leaderboard.</summary>
public class LeaderboardEntryDto
{
    public int Rank { get; set; }
    /// <summary>Both players' names ("Alice &amp; Bob"), or a fallback when the room is gone.</summary>
    public string TeamDisplay { get; set; } = string.Empty;
    /// <summary>Solve duration in seconds; null when it could not be derived (room cleaned up).</summary>
    public int? SolveTimeSeconds { get; set; }
    public int Score { get; set; }
    public DateTime CompletedAt { get; set; }
}

public class LeaderboardDto
{
    public string Metric { get; set; } = LeaderboardMetrics.Fastest;
    public List<LeaderboardEntryDto> Entries { get; set; } = new();
    /// <summary>Total teams qualifying for this metric (before the limit is applied).</summary>
    public int TotalRanked { get; set; }
}
