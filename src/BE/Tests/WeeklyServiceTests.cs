using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// Covers the pure weekly logic (admin gate, active-window selection) and the weekly-windowed
/// leaderboard filter. The Mongo upsert "deactivate old of same type" is verified by the live smoke.
/// </summary>
public class WeeklyServiceTests
{
    private static readonly DateTime WeekStart = new(2026, 6, 15, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime WeekEnd = new(2026, 6, 22, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Now = new(2026, 6, 18, 12, 0, 0, DateTimeKind.Utc);

    // --- admin gate ---

    [Fact]
    public void EnsureAdmin_AllowsAdmin()
    {
        WeeklyRules.EnsureAdmin(UserRole.Admin); // no throw
    }

    [Theory]
    [InlineData("PLAYER")]
    [InlineData("VIP")]
    [InlineData(null)]
    public void EnsureAdmin_BlocksNonAdmin(string? role)
    {
        var error = Assert.Throws<ApiException>(() => WeeklyRules.EnsureAdmin(role));
        Assert.Equal(403, error.StatusCode);
    }

    // --- active-window selection ---

    [Fact]
    public void PickActive_ReturnsFeatureInWindow()
    {
        var f = Feature(WeeklyFeatureTypes.WeeklyChallenge, WeekStart, WeekEnd, active: true, createdAt: Now);
        var picked = WeeklyRules.PickActive(new[] { f }, WeeklyFeatureTypes.WeeklyChallenge, Now);
        Assert.Same(f, picked);
    }

    [Fact]
    public void PickActive_ExcludesOutsideWindow()
    {
        var f = Feature(WeeklyFeatureTypes.WeeklyChallenge, WeekStart, WeekEnd, active: true, createdAt: Now);
        var afterEnd = WeekEnd.AddDays(1);
        Assert.Null(WeeklyRules.PickActive(new[] { f }, WeeklyFeatureTypes.WeeklyChallenge, afterEnd));
    }

    [Fact]
    public void PickActive_ExcludesInactiveAndWrongType()
    {
        var inactive = Feature(WeeklyFeatureTypes.WeeklyChallenge, WeekStart, WeekEnd, active: false, createdAt: Now);
        var otherType = Feature(WeeklyFeatureTypes.CaseOfWeek, WeekStart, WeekEnd, active: true, createdAt: Now);
        var picked = WeeklyRules.PickActive(new[] { inactive, otherType }, WeeklyFeatureTypes.WeeklyChallenge, Now);
        Assert.Null(picked);
    }

    [Fact]
    public void PickActive_PrefersNewestWhenMultiple()
    {
        var older = Feature(WeeklyFeatureTypes.CaseOfWeek, WeekStart, WeekEnd, active: true, createdAt: Now.AddDays(-2));
        var newer = Feature(WeeklyFeatureTypes.CaseOfWeek, WeekStart, WeekEnd, active: true, createdAt: Now.AddHours(-1));
        var picked = WeeklyRules.PickActive(new[] { older, newer }, WeeklyFeatureTypes.CaseOfWeek, Now);
        Assert.Same(newer, picked);
    }

    // --- weekly leaderboard window (reuses Phase 3 LeaderboardRules with after/before) ---

    [Fact]
    public void ChallengeLeaderboard_OnlyCountsPlaysInsideWindow()
    {
        var rooms = new Dictionary<string, GameRoom>
        {
            ["in"] = Room("in", 120),
            ["before"] = Room("before", 90),
            ["after"] = Room("after", 60),
        };
        var results = new[]
        {
            Result("in", new[] { "u1", "u2" }, WeekStart.AddDays(1)),       // inside
            Result("before", new[] { "u3", "u4" }, WeekStart.AddDays(-1)),  // before window
            Result("after", new[] { "u5", "u6" }, WeekEnd.AddDays(1)),      // after window
        };

        var board = LeaderboardRules.Build(results, rooms, LeaderboardMetrics.Fastest, 100, after: WeekStart, before: WeekEnd);

        Assert.Equal(1, board.TotalRanked);
        Assert.Single(board.Entries);
        Assert.Equal(120, board.Entries[0].SolveTimeSeconds);
    }

    /* --------------------------------- builders -------------------------------- */

    private static WeeklyFeature Feature(string type, DateTime start, DateTime end, bool active, DateTime createdAt) => new()
    {
        Type = type,
        CaseId = "case-1",
        WeekStart = start,
        WeekEnd = end,
        IsActive = active,
        CreatedAt = createdAt
    };

    private static GameResult Result(string roomId, string[] players, DateTime createdAt) => new()
    {
        RoomId = roomId,
        CaseId = "case-1",
        Success = true,
        Players = players.ToList(),
        ScoreSummary = new ScoreSummary { TotalScore = 50 },
        CreatedAt = createdAt
    };

    private static GameRoom Room(string id, int durationSec) => new()
    {
        Id = id,
        Players = new List<RoomPlayer> { new() { Username = "P1" }, new() { Username = "P2" } },
        GameplayState = new GameplayState { StartedAt = WeekStart, CompletedAt = WeekStart.AddSeconds(durationSec) }
    };
}
