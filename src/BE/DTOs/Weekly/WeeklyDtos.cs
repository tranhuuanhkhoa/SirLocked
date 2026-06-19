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
}

/// <summary>Admin payload to set a weekly feature.</summary>
public class SetWeeklyFeatureRequest
{
    public string Type { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public DateTime WeekStart { get; set; }
    public DateTime WeekEnd { get; set; }
}
