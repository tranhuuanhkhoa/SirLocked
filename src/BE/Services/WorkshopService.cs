using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Workshop;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Read-only aggregation of community play statistics for the Workshop hub.
/// Everything is derived from existing collections; this service never writes.
///
/// Known data gaps surfaced during the Phase 1 audit (all reported, none fabricated):
///  - Author: GameCase has no author/creator field, so summaries use a placeholder
///    (<see cref="WorkshopAuthors"/>) and search covers title/caseId/summary only.
///  - Solve time: GameResult stores no duration; start/end live only on the embedded
///    GameRoom.GameplayState (StartedAt/CompletedAt). We join best-effort via RoomId and
///    drop plays whose room was cleaned up (both players left). A durationSeconds field on
///    GameResult would make this robust and is recommended for a future model change.
///  - "Obvious suspect / twist": no such field exists, so the "missed twist" stat is omitted;
///    only WrongCulpritRate is reported.
/// </summary>
public class WorkshopService : IWorkshopService
{
    public const int RecentWindowDays = 14;
    public const int MinPlaysForHardest = 5;
    public const int DefaultPageSize = 12;
    public const int MaxPageSize = 48;

    private static readonly IReadOnlyCollection<GameResult> EmptyResults = Array.Empty<GameResult>();

    private readonly MongoDbContext _db;

    public WorkshopService(MongoDbContext db) => _db = db;

    public async Task<WorkshopCaseListDto> GetWorkshopCasesAsync(
        string? search, string? sort, int page, int pageSize, CancellationToken ct = default)
    {
        var mode = WorkshopSortModes.Normalize(sort);
        var safePage = page < 1 ? 1 : page;
        var safeSize = pageSize <= 0 ? DefaultPageSize : Math.Min(pageSize, MaxPageSize);

        var cases = await _db.Cases
            .Find(c => c.Status == CaseStatus.Published)
            .ToListAsync(ct);

        // The published set is demo-scale, so search/sort run in memory for consistent,
        // case-insensitive matching with the UI.
        var filtered = cases.Where(c => MatchesSearch(c, search)).ToList();
        if (filtered.Count == 0)
        {
            return new WorkshopCaseListDto
            {
                Items = new(),
                Total = 0,
                Page = safePage,
                PageSize = safeSize,
                Sort = mode
            };
        }

        // One grouped query for ALL results across the matched cases — never one query per case.
        var caseIds = filtered.Select(c => c.CaseId).ToList();
        var results = await _db.GameResults
            .Find(r => caseIds.Contains(r.CaseId))
            .ToListAsync(ct);
        var resultsByCase = results
            .GroupBy(r => r.CaseId)
            .ToDictionary(g => g.Key, g => (IReadOnlyCollection<GameResult>)g.ToList());

        var now = DateTime.UtcNow;
        var stats = filtered.Select(c =>
            BuildStat(c, resultsByCase.TryGetValue(c.CaseId, out var rs) ? rs : EmptyResults, now));

        var ranked = Rank(stats, mode);
        var pageItems = ranked
            .Skip((safePage - 1) * safeSize)
            .Take(safeSize)
            .ToList();

        return new WorkshopCaseListDto
        {
            Items = pageItems,
            Total = ranked.Count,
            Page = safePage,
            PageSize = safeSize,
            Sort = mode
        };
    }

    public async Task<CaseStatsDto> GetCaseStatsAsync(string caseId, CancellationToken ct = default)
    {
        var gameCase = await _db.Cases.Find(c => c.CaseId == caseId).FirstOrDefaultAsync(ct);
        if (gameCase is null || gameCase.Status != CaseStatus.Published)
        {
            throw ApiException.NotFound("Case not found.");
        }

        var results = await _db.GameResults.Find(r => r.CaseId == caseId).ToListAsync(ct);

        // Batch-load the rooms still backing these results so solve time can be derived from
        // the embedded GameplayState. Missing rooms drop out of the timing sample (see class note).
        var roomIds = results
            .Select(r => r.RoomId)
            .Where(id => !string.IsNullOrEmpty(id))
            .Distinct()
            .ToList();
        var roomsById = new Dictionary<string, GameRoom>();
        if (roomIds.Count > 0)
        {
            var rooms = await _db.Rooms.Find(r => roomIds.Contains(r.Id)).ToListAsync(ct);
            foreach (var room in rooms)
            {
                roomsById[room.Id] = room;
            }
        }

        return ComputeCaseStats(gameCase, results, roomsById, DateTime.UtcNow);
    }

    // ----- Pure helpers (unit-tested directly, mirroring CaseValidationService.IsConditionSatisfied) -----

    /// <summary>Builds the card summary plus the metrics needed for ranking, from a case and its plays.</summary>
    public static WorkshopCaseStat BuildStat(
        GameCase gameCase, IReadOnlyCollection<GameResult> results, DateTime utcNow)
    {
        var final = gameCase.FinalLogic ?? new FinalLogic();
        var total = results.Count;
        var cutoff = utcNow.AddDays(-RecentWindowDays);

        var wins = 0;
        var wrongCulprit = 0;
        var recentPlays = 0;
        var scoreSum = 0;
        var scoreCount = 0;

        foreach (var r in results)
        {
            if (r.Success) wins++;
            if (!IsCulpritCorrect(r, final)) wrongCulprit++;
            if (r.CreatedAt >= cutoff) recentPlays++;
            if (r.ScoreSummary is not null)
            {
                scoreSum += r.ScoreSummary.TotalScore;
                scoreCount++;
            }
        }

        var summary = new WorkshopCaseSummaryDto
        {
            CaseId = gameCase.CaseId,
            Title = gameCase.Title,
            Summary = gameCase.Summary,
            Author = WorkshopAuthors.Unknown,
            MechanicsVersion = gameCase.MechanicsVersion,
            EstimatedMinutes = gameCase.EstimatedMinutes,
            CoverImageUrl = gameCase.CoverImageUrl,
            TotalPlays = total,
            SuccessRate = Fraction(wins, total),
            WrongCulpritRate = Fraction(wrongCulprit, total),
            UpdatedAt = gameCase.UpdatedAt
        };

        return new WorkshopCaseStat
        {
            Summary = summary,
            RecentPlays = recentPlays,
            HasScore = scoreCount > 0,
            AverageScore = scoreCount > 0 ? (double)scoreSum / scoreCount : 0,
            SuccessRate = summary.SuccessRate,
            TotalPlays = total,
            UpdatedAt = gameCase.UpdatedAt
        };
    }

    /// <summary>Orders case stats by the requested sort mode, then projects to card summaries.</summary>
    public static List<WorkshopCaseSummaryDto> Rank(
        IEnumerable<WorkshopCaseStat> stats, string sort, int minPlaysForHardest = MinPlaysForHardest)
    {
        var mode = WorkshopSortModes.Normalize(sort);
        var list = stats.ToList();

        IEnumerable<WorkshopCaseStat> ordered = mode switch
        {
            WorkshopSortModes.New => list
                .OrderByDescending(s => s.UpdatedAt)
                .ThenByDescending(s => s.TotalPlays),
            WorkshopSortModes.TopScore => list
                .OrderByDescending(s => s.HasScore)
                .ThenByDescending(s => s.AverageScore)
                .ThenByDescending(s => s.TotalPlays)
                .ThenByDescending(s => s.UpdatedAt),
            WorkshopSortModes.Hardest => list
                .OrderByDescending(s => s.TotalPlays >= minPlaysForHardest) // qualified cases first
                .ThenBy(s => s.SuccessRate)                                 // lower success = harder
                .ThenByDescending(s => s.TotalPlays)
                .ThenByDescending(s => s.UpdatedAt),
            _ => list // Hot
                .OrderByDescending(s => s.RecentPlays)
                .ThenByDescending(s => s.TotalPlays)
                .ThenByDescending(s => s.UpdatedAt)
        };

        return ordered.Select(s => s.Summary).ToList();
    }

    /// <summary>Computes the full stats panel for one case from its plays and (optional) backing rooms.</summary>
    public static CaseStatsDto ComputeCaseStats(
        GameCase gameCase,
        IReadOnlyCollection<GameResult> results,
        IReadOnlyDictionary<string, GameRoom> roomsById,
        DateTime utcNow)
    {
        var final = gameCase.FinalLogic ?? new FinalLogic();
        var total = results.Count;
        var dto = new CaseStatsDto
        {
            CaseId = gameCase.CaseId,
            Title = gameCase.Title,
            TotalPlays = total
        };

        if (total == 0)
        {
            return dto; // rates default to 0 / null — no division by zero, nothing fabricated
        }

        var hasMotive = !string.IsNullOrWhiteSpace(final.CorrectMotiveId);
        var hasMethod = !string.IsNullOrWhiteSpace(final.CorrectMethodId);

        var wins = 0;
        var wrongCulprit = 0;
        var evidenceRight = 0;
        var motiveRight = 0;
        var methodRight = 0;
        var scoreSum = 0;
        var scoreCount = 0;
        var solveMinutes = 0.0;
        var solveCount = 0;

        foreach (var r in results)
        {
            if (r.Success) wins++;
            if (!IsCulpritCorrect(r, final)) wrongCulprit++;
            if (IsEvidenceCorrect(r, final)) evidenceRight++;
            if (hasMotive && r.SelectedMotiveId == final.CorrectMotiveId) motiveRight++;
            if (hasMethod && r.SelectedMethodId == final.CorrectMethodId) methodRight++;
            if (r.ScoreSummary is not null)
            {
                scoreSum += r.ScoreSummary.TotalScore;
                scoreCount++;
            }

            var minutes = TrySolveMinutes(r, roomsById);
            if (minutes is not null)
            {
                solveMinutes += minutes.Value;
                solveCount++;
            }
        }

        dto.SuccessRate = Fraction(wins, total);
        dto.WrongCulpritRate = Fraction(wrongCulprit, total);
        dto.CorrectEvidenceRate = Fraction(evidenceRight, total);
        dto.CorrectMotiveRate = hasMotive ? Fraction(motiveRight, total) : null;
        dto.CorrectWeaponRate = hasMethod ? Fraction(methodRight, total) : null;
        dto.AverageScore = scoreCount > 0 ? Round((double)scoreSum / scoreCount, 1) : null;
        dto.SolveTimeSampleSize = solveCount;
        dto.AvgSolveTimeMinutes = solveCount > 0 ? Round(solveMinutes / solveCount, 1) : null;
        return dto;
    }

    private static bool IsCulpritCorrect(GameResult r, FinalLogic final) =>
        !string.IsNullOrEmpty(final.CulpritId) && r.SelectedCulpritId == final.CulpritId;

    private static bool IsEvidenceCorrect(GameResult r, FinalLogic final)
    {
        if (final.RequiredEvidenceIds.Count == 0 || r.SelectedEvidenceIds.Count == 0)
        {
            return false;
        }
        var selected = new HashSet<string>(r.SelectedEvidenceIds);
        return final.RequiredEvidenceIds.All(selected.Contains);
    }

    private static double? TrySolveMinutes(GameResult r, IReadOnlyDictionary<string, GameRoom> roomsById)
    {
        if (string.IsNullOrEmpty(r.RoomId) || !roomsById.TryGetValue(r.RoomId, out var room))
        {
            return null;
        }
        var state = room.GameplayState;
        if (state is null)
        {
            return null;
        }
        var end = state.CompletedAt ?? r.CreatedAt;
        var span = end - state.StartedAt;
        return span > TimeSpan.Zero ? span.TotalMinutes : null;
    }

    private static bool MatchesSearch(GameCase c, string? search)
    {
        if (string.IsNullOrWhiteSpace(search))
        {
            return true;
        }
        var q = search.Trim();
        return c.Title.Contains(q, StringComparison.OrdinalIgnoreCase)
            || c.CaseId.Contains(q, StringComparison.OrdinalIgnoreCase)
            || c.Summary.Contains(q, StringComparison.OrdinalIgnoreCase);
    }

    private static double Fraction(int numerator, int denominator) =>
        denominator <= 0 ? 0 : Round((double)numerator / denominator, 4);

    private static double Round(double value, int digits) =>
        Math.Round(value, digits, MidpointRounding.AwayFromZero);
}

/// <summary>Carrier for a case summary plus the extra metrics ranking needs. Public for unit tests.</summary>
public class WorkshopCaseStat
{
    public WorkshopCaseSummaryDto Summary { get; set; } = new();
    public int RecentPlays { get; set; }
    public bool HasScore { get; set; }
    public double AverageScore { get; set; }
    public double SuccessRate { get; set; }
    public int TotalPlays { get; set; }
    public DateTime UpdatedAt { get; set; }
}
