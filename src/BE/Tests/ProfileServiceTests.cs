using SirLocked.Api.DTOs.Profile;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class ProfileServiceTests
{
    private static GameResult Play(string caseId, bool success) => new()
    {
        CaseId = caseId,
        Players = new() { "user-1", "user-2" },
        Success = success
    };

    private static IReadOnlyDictionary<string, GameRoom> NoRooms() => new Dictionary<string, GameRoom>();

    // ----- ComputeRank: thresholds + progress -----

    [Theory]
    [InlineData(0, DetectiveRanks.ApprenticeKey, 3)]
    [InlineData(2, DetectiveRanks.ApprenticeKey, 3)]
    [InlineData(3, DetectiveRanks.DetectiveKey, 10)]
    [InlineData(9, DetectiveRanks.DetectiveKey, 10)]
    [InlineData(10, DetectiveRanks.InspectorKey, 25)]
    [InlineData(24, DetectiveRanks.InspectorKey, 25)]
    public void ComputeRank_AssignsTier_AndNextThreshold(int solved, string expectedTier, int? expectedNext)
    {
        var rank = ProfileService.ComputeRank(solved);

        Assert.Equal(expectedTier, rank.Tier);
        Assert.Equal(expectedNext, rank.NextThreshold);
        Assert.Equal(solved, rank.Solved);
    }

    [Fact]
    public void ComputeRank_AtMaxTier_HasNoNextThreshold_AndFullProgress()
    {
        var rank = ProfileService.ComputeRank(25);

        Assert.Equal(DetectiveRanks.MasterKey, rank.Tier);
        Assert.Null(rank.NextThreshold);
        Assert.Equal(100, rank.ProgressPercent);

        // Still master well beyond the threshold.
        Assert.Equal(DetectiveRanks.MasterKey, ProfileService.ComputeRank(120).Tier);
    }

    [Fact]
    public void ComputeRank_ProgressPercent_IsWithinCurrentTier()
    {
        // Apprentice spans 0..3; 2 solved => 2/3 of the way.
        Assert.Equal(66.7, ProfileService.ComputeRank(2).ProgressPercent, 1);
        // Detective spans 3..10; entering at 3 => 0%.
        Assert.Equal(0, ProfileService.ComputeRank(3).ProgressPercent);
        // Detective at 9 => (9-3)/(10-3) = 85.7%.
        Assert.Equal(85.7, ProfileService.ComputeRank(9).ProgressPercent, 1);
    }

    // ----- BuildProfile: distinct counting + win rate -----

    [Fact]
    public void BuildProfile_CountsDistinctCases_AndPerPlayWinRate()
    {
        var results = new[]
        {
            Play("case-a", success: true),   // solved a
            Play("case-a", success: true),   // a again (same distinct case)
            Play("case-b", success: false),  // played b, not solved
            Play("case-c", success: true)    // solved c
        };

        var profile = ProfileService.BuildProfile("user-1", "Holmes", "PLAYER", results, NoRooms());

        Assert.Equal(3, profile.CasesPlayed);   // a, b, c
        Assert.Equal(2, profile.CasesSolved);   // a, c (distinct wins)
        Assert.Equal(0.75, profile.SuccessRate, 4); // 3 wins / 4 plays
        Assert.Equal(DetectiveRanks.ApprenticeKey, profile.Rank.Tier); // 2 solved -> Apprentice
        Assert.Null(profile.FastestSolveSeconds);   // no rooms supplied
        Assert.Null(profile.CreatorStats);          // no author field
    }

    [Fact]
    public void BuildProfile_WithNoPlays_IsApprentice_AndDoesNotDivideByZero()
    {
        var profile = ProfileService.BuildProfile("user-1", "Newbie", "PLAYER", Array.Empty<GameResult>(), NoRooms());

        Assert.Equal(0, profile.CasesPlayed);
        Assert.Equal(0, profile.CasesSolved);
        Assert.Equal(0, profile.SuccessRate);
        Assert.Equal(DetectiveRanks.ApprenticeKey, profile.Rank.Tier);
        Assert.Equal(0, profile.Rank.ProgressPercent);
        Assert.Equal(3, profile.Rank.NextThreshold);
    }

    [Fact]
    public void BuildProfile_FastestSolve_UsesWinningPlaysWithRooms()
    {
        var fast = Play("case-a", success: true);
        fast.RoomId = "room-fast";
        var slow = Play("case-b", success: true);
        slow.RoomId = "room-slow";
        var lost = Play("case-c", success: false); // ignored even though its room would be faster
        lost.RoomId = "room-lost";

        var baseTime = new DateTime(2026, 6, 19, 12, 0, 0, DateTimeKind.Utc);
        foreach (var r in new[] { fast, slow, lost }) r.CreatedAt = baseTime;

        var rooms = new Dictionary<string, GameRoom>
        {
            ["room-fast"] = new GameRoom { Id = "room-fast", GameplayState = new GameplayState { StartedAt = baseTime.AddSeconds(-90), CompletedAt = baseTime } },
            ["room-slow"] = new GameRoom { Id = "room-slow", GameplayState = new GameplayState { StartedAt = baseTime.AddSeconds(-300), CompletedAt = baseTime } },
            ["room-lost"] = new GameRoom { Id = "room-lost", GameplayState = new GameplayState { StartedAt = baseTime.AddSeconds(-5), CompletedAt = baseTime } }
        };

        var profile = ProfileService.BuildProfile("user-1", "Holmes", "PLAYER", new[] { fast, slow, lost }, rooms);

        Assert.Equal(90, profile.FastestSolveSeconds); // fastest *winning* solve, lost play ignored
    }
}
