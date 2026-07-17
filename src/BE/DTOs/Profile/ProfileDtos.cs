namespace SirLocked.Api.DTOs.Profile;

/// <summary>
/// Detective rank tiers, keyed off distinct cases solved. Single source of truth —
/// adjust the thresholds here and both the API and tests follow.
/// </summary>
public static class DetectiveRanks
{
    public const string ApprenticeKey = "APPRENTICE";
    public const string DetectiveKey = "DETECTIVE";
    public const string InspectorKey = "INSPECTOR";
    public const string MasterKey = "MASTER";

    /// <summary>Ordered ascending by Min: (stable key, Vietnamese label, minimum cases solved to enter).</summary>
    public static readonly (string Key, string Label, int Min)[] Tiers =
    {
        (ApprenticeKey, "Tập sự", 0),
        (DetectiveKey, "Thám tử", 3),
        (InspectorKey, "Thanh tra", 10),
        (MasterKey, "Bậc thầy", 25),
    };
}

public class RankDto
{
    /// <summary>Stable tier key (e.g. DETECTIVE) so the frontend can pick an icon.</summary>
    public string Tier { get; set; } = DetectiveRanks.ApprenticeKey;
    /// <summary>Vietnamese display label (e.g. "Thám tử").</summary>
    public string TierLabel { get; set; } = "Tập sự";
    public int Solved { get; set; }
    /// <summary>Cases-solved count needed to reach the next tier; null at the max tier.</summary>
    public int? NextThreshold { get; set; }
    /// <summary>Vietnamese label of the next tier; null at the max tier.</summary>
    public string? NextTierLabel { get; set; }
    /// <summary>Progress within the current tier toward the next, 0..100 (100 at max tier).</summary>
    public double ProgressPercent { get; set; }
}

/// <summary>
/// Stats for cases a user authored. Null overall when the case model has no author
/// field (current state — see ProfileService audit note); the frontend then hides the section.
/// </summary>
public class CreatorStatsDto
{
    public int CasesCreated { get; set; }
    public int TotalPlays { get; set; }
}

public class DetectiveProfileDto
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public bool IsEmailVerified { get; set; }
    public bool HasPassword { get; set; }

    /// <summary>Distinct cases the user has won at least once.</summary>
    public int CasesSolved { get; set; }
    /// <summary>Distinct cases the user has played.</summary>
    public int CasesPlayed { get; set; }
    /// <summary>Per-play win rate 0..1 (winning plays / total plays).</summary>
    public double SuccessRate { get; set; }

    public RankDto Rank { get; set; } = new();

    /// <summary>
    /// Fastest winning solve in seconds; null when no winning play still has its room
    /// (with embedded StartedAt/CompletedAt). Best-effort — see ProfileService audit note.
    /// </summary>
    public double? FastestSolveSeconds { get; set; }

    /// <summary>Null when cases cannot be attributed to an author (no author field today).</summary>
    public CreatorStatsDto? CreatorStats { get; set; }
}
