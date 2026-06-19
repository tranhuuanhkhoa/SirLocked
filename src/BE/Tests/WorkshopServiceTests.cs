using SirLocked.Api.DTOs.Workshop;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class WorkshopServiceTests
{
    private static readonly DateTime Now = new(2026, 6, 19, 12, 0, 0, DateTimeKind.Utc);

    private static GameCase CaseWithAnswers() => new()
    {
        CaseId = "case-x",
        Title = "The Test Affair",
        FinalLogic = new FinalLogic
        {
            CulpritId = "char-killer",
            CorrectMotiveId = "motive-1",
            CorrectMethodId = "method-1",
            RequiredEvidenceIds = new() { "clue-a", "clue-b" }
        }
    };

    private static GameResult Result(
        bool culpritRight, bool motiveRight, bool methodRight, bool evidenceRight,
        bool success, int score, string roomId = "", DateTime? createdAt = null) => new()
    {
        CaseId = "case-x",
        RoomId = roomId,
        SelectedCulpritId = culpritRight ? "char-killer" : "char-decoy",
        SelectedMotiveId = motiveRight ? "motive-1" : "motive-9",
        SelectedMethodId = methodRight ? "method-1" : "method-9",
        SelectedEvidenceIds = evidenceRight ? new() { "clue-a", "clue-b" } : new() { "clue-a" },
        Success = success,
        ScoreSummary = new ScoreSummary { TotalScore = score },
        CreatedAt = createdAt ?? Now
    };

    // ----- ComputeCaseStats: rates -----

    [Fact]
    public void ComputeCaseStats_ComputesEveryRate()
    {
        var results = new[]
        {
            Result(culpritRight: true,  motiveRight: true,  methodRight: true,  evidenceRight: true,  success: true,  score: 80),
            Result(culpritRight: false, motiveRight: false, methodRight: true,  evidenceRight: true,  success: false, score: 40),
            Result(culpritRight: true,  motiveRight: true,  methodRight: false, evidenceRight: false, success: false, score: 50),
            Result(culpritRight: false, motiveRight: true,  methodRight: true,  evidenceRight: true,  success: false, score: 60)
        };

        var dto = WorkshopService.ComputeCaseStats(CaseWithAnswers(), results, EmptyRooms(), Now);

        Assert.Equal(4, dto.TotalPlays);
        Assert.Equal(0.25, dto.SuccessRate, 4);          // 1/4 win
        Assert.Equal(0.5, dto.WrongCulpritRate, 4);      // 2/4 wrong culprit
        Assert.Equal(0.75, dto.CorrectEvidenceRate, 4);  // 3/4 covered required evidence
        Assert.NotNull(dto.CorrectMotiveRate);
        Assert.Equal(0.75, dto.CorrectMotiveRate!.Value, 4); // 3/4 right motive
        Assert.NotNull(dto.CorrectWeaponRate);
        Assert.Equal(0.75, dto.CorrectWeaponRate!.Value, 4); // 3/4 right method
        Assert.NotNull(dto.AverageScore);
        Assert.Equal(57.5, dto.AverageScore!.Value, 3);  // (80+40+50+60)/4
    }

    [Fact]
    public void ComputeCaseStats_WithZeroPlays_DoesNotDivideByZero()
    {
        var dto = WorkshopService.ComputeCaseStats(CaseWithAnswers(), Array.Empty<GameResult>(), EmptyRooms(), Now);

        Assert.Equal(0, dto.TotalPlays);
        Assert.Equal(0, dto.SuccessRate);
        Assert.Equal(0, dto.WrongCulpritRate);
        Assert.Equal(0, dto.CorrectEvidenceRate);
        Assert.Null(dto.CorrectMotiveRate);
        Assert.Null(dto.CorrectWeaponRate);
        Assert.Null(dto.AvgSolveTimeMinutes);
        Assert.Null(dto.AverageScore);
        Assert.Equal(0, dto.SolveTimeSampleSize);
    }

    [Fact]
    public void ComputeCaseStats_WhenCaseHasNoMotiveOrMethod_LeavesThoseRatesNull()
    {
        var gameCase = CaseWithAnswers();
        gameCase.FinalLogic.CorrectMotiveId = string.Empty;
        gameCase.FinalLogic.CorrectMethodId = string.Empty;

        var results = new[] { Result(true, false, false, true, true, 70) };
        var dto = WorkshopService.ComputeCaseStats(gameCase, results, EmptyRooms(), Now);

        Assert.Null(dto.CorrectMotiveRate);
        Assert.Null(dto.CorrectWeaponRate);
        Assert.Equal(1, dto.TotalPlays);
        Assert.Equal(1.0, dto.CorrectEvidenceRate, 4);   // evidence dimension still computed
    }

    // ----- ComputeCaseStats: solve time from rooms -----

    [Fact]
    public void ComputeCaseStats_AveragesSolveTime_FromBackingRooms()
    {
        var r1 = Result(true, true, true, true, true, 80, roomId: "room1", createdAt: Now);
        var r2 = Result(true, true, true, true, true, 80, roomId: "room2", createdAt: Now);

        var rooms = new Dictionary<string, GameRoom>
        {
            // 10 minutes via explicit CompletedAt.
            ["room1"] = new GameRoom
            {
                Id = "room1",
                GameplayState = new GameplayState { StartedAt = Now.AddMinutes(-10), CompletedAt = Now }
            },
            // 20 minutes via CompletedAt == null fallback to result.CreatedAt.
            ["room2"] = new GameRoom
            {
                Id = "room2",
                GameplayState = new GameplayState { StartedAt = Now.AddMinutes(-20), CompletedAt = null }
            }
        };

        var dto = WorkshopService.ComputeCaseStats(CaseWithAnswers(), new[] { r1, r2 }, rooms, Now);

        Assert.Equal(2, dto.SolveTimeSampleSize);
        Assert.NotNull(dto.AvgSolveTimeMinutes);
        Assert.Equal(15.0, dto.AvgSolveTimeMinutes!.Value, 3); // (10 + 20) / 2
    }

    [Fact]
    public void ComputeCaseStats_DropsPlaysWhoseRoomIsGone()
    {
        var present = Result(true, true, true, true, true, 80, roomId: "room1", createdAt: Now);
        var orphan = Result(true, true, true, true, true, 80, roomId: "room-deleted", createdAt: Now);

        var rooms = new Dictionary<string, GameRoom>
        {
            ["room1"] = new GameRoom
            {
                Id = "room1",
                GameplayState = new GameplayState { StartedAt = Now.AddMinutes(-12), CompletedAt = Now }
            }
        };

        var dto = WorkshopService.ComputeCaseStats(CaseWithAnswers(), new[] { present, orphan }, rooms, Now);

        Assert.Equal(2, dto.TotalPlays);            // both plays still count for outcome rates
        Assert.Equal(1, dto.SolveTimeSampleSize);   // only the play with a surviving room times
        Assert.Equal(12.0, dto.AvgSolveTimeMinutes!.Value, 3);
    }

    // ----- Rank: sort ordering -----

    private static WorkshopCaseStat Stat(
        string caseId, int recentPlays, int totalPlays, double successRate,
        double averageScore, bool hasScore, DateTime updatedAt) => new()
    {
        Summary = new WorkshopCaseSummaryDto { CaseId = caseId },
        RecentPlays = recentPlays,
        TotalPlays = totalPlays,
        SuccessRate = successRate,
        AverageScore = averageScore,
        HasScore = hasScore,
        UpdatedAt = updatedAt
    };

    [Fact]
    public void Rank_Hot_OrdersByRecentPlays()
    {
        var stats = new[]
        {
            Stat("a", recentPlays: 1, totalPlays: 50, successRate: 0.5, averageScore: 50, hasScore: true, updatedAt: Now),
            Stat("b", recentPlays: 5, totalPlays: 10, successRate: 0.5, averageScore: 50, hasScore: true, updatedAt: Now),
            Stat("c", recentPlays: 3, totalPlays: 20, successRate: 0.5, averageScore: 50, hasScore: true, updatedAt: Now)
        };

        var order = WorkshopService.Rank(stats, WorkshopSortModes.Hot).Select(s => s.CaseId).ToList();

        Assert.Equal(new[] { "b", "c", "a" }, order);
    }

    [Fact]
    public void Rank_New_OrdersByUpdatedAt()
    {
        var stats = new[]
        {
            Stat("a", 0, 0, 0, 0, false, Now.AddDays(-3)),
            Stat("b", 0, 0, 0, 0, false, Now.AddDays(-1)),
            Stat("c", 0, 0, 0, 0, false, Now.AddDays(-2))
        };

        var order = WorkshopService.Rank(stats, WorkshopSortModes.New).Select(s => s.CaseId).ToList();

        Assert.Equal(new[] { "b", "c", "a" }, order);
    }

    [Fact]
    public void Rank_TopScore_OrdersByAverageScore_ScorelessLast()
    {
        var stats = new[]
        {
            Stat("a", 0, 10, 0.5, averageScore: 90, hasScore: true, Now),
            Stat("b", 0, 10, 0.5, averageScore: 50, hasScore: true, Now),
            Stat("c", 0, 10, 0.5, averageScore: 0, hasScore: false, Now)
        };

        var order = WorkshopService.Rank(stats, WorkshopSortModes.TopScore).Select(s => s.CaseId).ToList();

        Assert.Equal(new[] { "a", "b", "c" }, order);
    }

    [Fact]
    public void Rank_Hardest_PrioritizesLowSuccess_AmongCasesWithEnoughPlays()
    {
        var stats = new[]
        {
            Stat("hard", 0, totalPlays: 10, successRate: 0.2, 0, false, Now),  // qualified, hard
            Stat("easy", 0, totalPlays: 10, successRate: 0.8, 0, false, Now),  // qualified, easy
            Stat("rare", 0, totalPlays: 2,  successRate: 0.0, 0, false, Now)   // too few plays -> last
        };

        var order = WorkshopService.Rank(stats, WorkshopSortModes.Hardest, minPlaysForHardest: 5)
            .Select(s => s.CaseId).ToList();

        Assert.Equal(new[] { "hard", "easy", "rare" }, order);
    }

    [Fact]
    public void Rank_UnknownSort_FallsBackToHot()
    {
        var stats = new[]
        {
            Stat("a", recentPlays: 2, 0, 0, 0, false, Now),
            Stat("b", recentPlays: 9, 0, 0, 0, false, Now)
        };

        var order = WorkshopService.Rank(stats, "definitely-not-a-mode").Select(s => s.CaseId).ToList();

        Assert.Equal(new[] { "b", "a" }, order);
    }

    private static IReadOnlyDictionary<string, GameRoom> EmptyRooms() => new Dictionary<string, GameRoom>();
}
