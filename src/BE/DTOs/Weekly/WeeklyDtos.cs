using SirLocked.Api.DTOs.Market;

namespace SirLocked.Api.DTOs.Weekly;

/// <summary>An active weekly feature with the highlighted case's display info.</summary>
public class WeeklyFeatureDto
{
    public string Type { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string CoverImageUrl { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; }
    public DateTime WeekStart { get; set; }
    public DateTime WeekEnd { get; set; }

    /// <summary>The challenge week as yyyy-MM-dd of its Wednesday. Null for the case of the week.</summary>
    public string? WeekKey { get; set; }

    /// <summary>AUTO when the server picked the challenge, ADMIN when an admin chose it. Null for the case of the week.</summary>
    public string? Source { get; set; }

    /// <summary>The total score a solved challenge needs to earn the weekly chest. 0 for the case of the week.</summary>
    public int MinScore { get; set; }

    /// <summary>The chests the challenge can drop, heaviest first, with their share in percent. Empty for the case of the week.</summary>
    public List<WeeklyDropOddsDto> Drops { get; set; } = [];
}

/// <summary>One chest the weekly challenge can drop and its share of the drops, in percent rounded to two places.</summary>
public sealed record WeeklyDropOddsDto(string ChestId, string Name, string NameEn, string IconKey, ChestLookDto? Look, decimal Percent);

/// <summary>Admin payload to set a weekly feature.</summary>
public class SetWeeklyFeatureRequest
{
    public string Type { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;

    /// <summary>For the challenge, any moment of the chosen week: the server snaps it to that week.</summary>
    public DateTime WeekStart { get; set; }

    /// <summary>Not read for the challenge, whose window is always the whole week.</summary>
    public DateTime WeekEnd { get; set; }
}
