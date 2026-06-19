namespace SirLocked.Api.DTOs.Workshop;

/// <summary>
/// Sort modes for the Workshop case list. String constants keep the API
/// surface camelCase and tolerant of unknown values (falls back to Hot).
/// </summary>
public static class WorkshopSortModes
{
    public const string Hot = "hot";
    public const string New = "new";
    public const string TopScore = "top";
    public const string Hardest = "hard";

    /// <summary>Normalizes a raw query value (accepting a few friendly aliases) to a known mode.</summary>
    public static string Normalize(string? raw)
    {
        var value = (raw ?? string.Empty).Trim().ToLowerInvariant();
        return value switch
        {
            "hot" or "popular" or "trending" => Hot,
            "new" or "newest" or "recent" => New,
            "top" or "topscore" or "top-score" or "score" => TopScore,
            "hard" or "hardest" or "difficulty" => Hardest,
            _ => Hot
        };
    }
}

/// <summary>
/// Author attribution placeholder. GameCase has no author/creator field today
/// (see audit note in the Workshop service); summaries surface this constant until
/// a CreatedByUserId / AuthorName field is added for the Phase 4 creator leaderboard.
/// </summary>
public static class WorkshopAuthors
{
    public const string Unknown = "Unknown";
}

/// <summary>Card-level case summary for the Workshop hub grid (no spoilers).</summary>
public class WorkshopCaseSummaryDto
{
    public string CaseId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    /// <summary>Display author. Placeholder until GameCase stores authorship (see WorkshopAuthors).</summary>
    public string Author { get; set; } = WorkshopAuthors.Unknown;
    public int MechanicsVersion { get; set; }
    public int EstimatedMinutes { get; set; }
    /// <summary>May be empty; the frontend falls back to a deterministic placeholder seeded by CaseId.</summary>
    public string CoverImageUrl { get; set; } = string.Empty;

    public int TotalPlays { get; set; }
    /// <summary>Fraction 0..1 of plays that ended in a win.</summary>
    public double SuccessRate { get; set; }
    /// <summary>Teaser stat for the card: fraction 0..1 of plays that accused the wrong culprit.</summary>
    public double WrongCulpritRate { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>Paged Workshop list envelope so the frontend can render pagination controls.</summary>
public class WorkshopCaseListDto
{
    public List<WorkshopCaseSummaryDto> Items { get; set; } = new();
    public int Total { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public string Sort { get; set; } = WorkshopSortModes.Hot;
}

/// <summary>
/// Full "ooh" statistics panel for a single case detail page. Every figure is
/// aggregated from existing gameResults (+ embedded room timing); nothing is stored.
/// Nullable fields mean "not enough data / dimension not defined for this case" so the
/// frontend can hide them instead of showing a misleading zero.
/// </summary>
public class CaseStatsDto
{
    public string CaseId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;

    public int TotalPlays { get; set; }
    /// <summary>Fraction 0..1.</summary>
    public double SuccessRate { get; set; }
    /// <summary>Fraction 0..1 of plays that accused the wrong culprit.</summary>
    public double WrongCulpritRate { get; set; }
    /// <summary>Fraction 0..1 of plays whose selected evidence covered every required evidence clue.</summary>
    public double CorrectEvidenceRate { get; set; }

    /// <summary>Fraction 0..1; null when the case defines no correct method/weapon option.</summary>
    public double? CorrectWeaponRate { get; set; }
    /// <summary>Fraction 0..1; null when the case defines no correct motive option.</summary>
    public double? CorrectMotiveRate { get; set; }

    /// <summary>
    /// Average solve time in minutes; null when no completed play still has its room
    /// (with embedded StartedAt/CompletedAt) available. See the audit note in WorkshopService.
    /// </summary>
    public double? AvgSolveTimeMinutes { get; set; }
    /// <summary>How many plays contributed a usable solve-time sample (transparency for AvgSolveTimeMinutes).</summary>
    public int SolveTimeSampleSize { get; set; }

    /// <summary>Average final score (ScoreSummary.TotalScore, 0..100); null when no play recorded a score.</summary>
    public double? AverageScore { get; set; }
}
