using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// Covers leaderboard grouping/sorting/ranking through <see cref="LeaderboardRules"/>, the pure core
/// that <c>LeaderboardService</c> delegates to (only the Mongo reads are not exercised here).
/// </summary>
public class LeaderboardServiceTests
{
    private static readonly DateTime Base = new(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Build_OnlyRanksSuccessfulSolves()
    {
        var rooms = new Dictionary<string, GameRoom>
        {
            ["room-win"] = Room("room-win", durationSec: 300, "Alice", "Bob"),
            ["room-loss"] = Room("room-loss", durationSec: 120, "Cara", "Dan"),
        };
        var results = new[]
        {
            Result("room-win", success: true, score: 80, createdAt: Base, players: new[] { "u1", "u2" }),
            Result("room-loss", success: false, score: 10, createdAt: Base, players: new[] { "u3", "u4" }),
        };

        var board = LeaderboardRules.Build(results, rooms, LeaderboardMetrics.Fastest, 100);

        Assert.Equal(1, board.TotalRanked);
        Assert.Single(board.Entries);
        Assert.Equal("Alice & Bob", board.Entries[0].TeamDisplay);
    }

    [Fact]
    public void Build_KeepsOnlyFirstSuccessPerTeam()
    {
        var rooms = new Dictionary<string, GameRoom>
        {
            ["room-1"] = Room("room-1", durationSec: 600, "Alice", "Bob"),
            ["room-2"] = Room("room-2", durationSec: 200, "Alice", "Bob"),
        };
        // Same team (u1,u2) wins twice; the replay is faster but must NOT replace the first solve.
        var results = new[]
        {
            Result("room-1", success: true, score: 70, createdAt: Base, players: new[] { "u1", "u2" }),
            Result("room-2", success: true, score: 95, createdAt: Base.AddDays(1), players: new[] { "u2", "u1" }),
        };

        var board = LeaderboardRules.Build(results, rooms, LeaderboardMetrics.TopScore, 100);

        Assert.Single(board.Entries);
        Assert.Equal(70, board.Entries[0].Score);          // first success kept, not the higher replay
        Assert.Equal(600, board.Entries[0].SolveTimeSeconds);
    }

    [Fact]
    public void Build_Fastest_SortsAscendingAndRanks()
    {
        var rooms = new Dictionary<string, GameRoom>
        {
            ["a"] = Room("a", durationSec: 500, "A1", "A2"),
            ["b"] = Room("b", durationSec: 120, "B1", "B2"),
            ["c"] = Room("c", durationSec: 300, "C1", "C2"),
        };
        var results = new[]
        {
            Result("a", true, 50, Base, new[] { "a1", "a2" }),
            Result("b", true, 50, Base, new[] { "b1", "b2" }),
            Result("c", true, 50, Base, new[] { "c1", "c2" }),
        };

        var board = LeaderboardRules.Build(results, rooms, LeaderboardMetrics.Fastest, 100);

        Assert.Equal(new int?[] { 120, 300, 500 }, board.Entries.Select(e => e.SolveTimeSeconds));
        Assert.Equal(new[] { 1, 2, 3 }, board.Entries.Select(e => e.Rank));
        Assert.Equal("B1 & B2", board.Entries[0].TeamDisplay);
    }

    [Fact]
    public void Build_Fastest_ExcludesEntriesWithoutTime_ButTopScoreKeepsThem()
    {
        // Team with a timed room and a team whose room was cleaned up (no room => no time).
        var rooms = new Dictionary<string, GameRoom>
        {
            ["timed"] = Room("timed", durationSec: 240, "Alice", "Bob"),
        };
        var results = new[]
        {
            Result("timed", true, 60, Base, new[] { "u1", "u2" }),
            Result("gone", true, 99, Base, new[] { "u3", "u4" }),   // room "gone" not in dict
        };

        var fastest = LeaderboardRules.Build(results, rooms, LeaderboardMetrics.Fastest, 100);
        Assert.Single(fastest.Entries);
        Assert.Equal(240, fastest.Entries[0].SolveTimeSeconds);

        var top = LeaderboardRules.Build(results, rooms, LeaderboardMetrics.TopScore, 100);
        Assert.Equal(2, top.Entries.Count);
        Assert.Equal(99, top.Entries[0].Score);                      // highest score first
        Assert.Null(top.Entries[0].SolveTimeSeconds);                // time unknown but still ranked
    }

    [Fact]
    public void Build_TopScore_SortsDescending()
    {
        var rooms = new Dictionary<string, GameRoom>
        {
            ["a"] = Room("a", durationSec: 100, "A1", "A2"),
            ["b"] = Room("b", durationSec: 100, "B1", "B2"),
        };
        var results = new[]
        {
            Result("a", true, 40, Base, new[] { "a1", "a2" }),
            Result("b", true, 90, Base, new[] { "b1", "b2" }),
        };

        var board = LeaderboardRules.Build(results, rooms, LeaderboardMetrics.TopScore, 100);

        Assert.Equal(new[] { 90, 40 }, board.Entries.Select(e => e.Score));
    }

    [Fact]
    public void Build_RespectsLimit_ButReportsTotalRanked()
    {
        var rooms = new Dictionary<string, GameRoom>();
        var results = Enumerable.Range(0, 5)
            .Select(i => { rooms[$"r{i}"] = Room($"r{i}", durationSec: 100 + i, $"P{i}a", $"P{i}b"); return Result($"r{i}", true, 10, Base, new[] { $"u{i}a", $"u{i}b" }); })
            .ToArray();

        var board = LeaderboardRules.Build(results, rooms, LeaderboardMetrics.Fastest, 2);

        Assert.Equal(2, board.Entries.Count);
        Assert.Equal(5, board.TotalRanked);
        Assert.Equal(new[] { 1, 2 }, board.Entries.Select(e => e.Rank));
    }

    [Fact]
    public void Build_ZeroTeams_NoError()
    {
        var board = LeaderboardRules.Build(Array.Empty<GameResult>(), new Dictionary<string, GameRoom>(), LeaderboardMetrics.Fastest, 100);

        Assert.Empty(board.Entries);
        Assert.Equal(0, board.TotalRanked);
        Assert.Equal(LeaderboardMetrics.Fastest, board.Metric);
    }

    [Fact]
    public void Build_FallsBackToCreatedAt_WhenRoomMissing_ForCompletedAt()
    {
        var board = LeaderboardRules.Build(
            new[] { Result("gone", true, 30, Base, new[] { "u1", "u2" }) },
            new Dictionary<string, GameRoom>(),
            LeaderboardMetrics.TopScore,
            100);

        Assert.Single(board.Entries);
        Assert.Equal(Base, board.Entries[0].CompletedAt);   // no room => completedAt falls back to createdAt
        Assert.Equal("Đội ẩn danh", board.Entries[0].TeamDisplay);
    }

    /* --------------------------------- builders -------------------------------- */

    private static GameResult Result(string roomId, bool success, int score, DateTime createdAt, string[] players) => new()
    {
        RoomId = roomId,
        CaseId = "case-x",
        Success = success,
        Players = players.ToList(),
        ScoreSummary = new ScoreSummary { TotalScore = score },
        CreatedAt = createdAt
    };

    private static GameRoom Room(string id, int durationSec, params string[] usernames) => new()
    {
        Id = id,
        Players = usernames.Select(n => new RoomPlayer { Username = n }).ToList(),
        GameplayState = new GameplayState
        {
            StartedAt = Base,
            CompletedAt = Base.AddSeconds(durationSec)
        }
    };
}
