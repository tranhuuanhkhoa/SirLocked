using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.Ai;

public class PresentationUpdateRequest
{
    public long ExpectedVersion { get; set; }
    public List<PresentationStoryboardClip> Clips { get; set; } = new();
}
public class PresentationRevisionRequest
{
    public long ExpectedVersion { get; set; }
}
public class PresentationGenerateRequest : PresentationRevisionRequest
{
    public decimal ApprovedBudgetUsd { get; set; }
}
public class PresentationEstimateDto
{
    public bool Configured { get; set; }
    public string Currency { get; set; } = "USD";
    public decimal? TotalUsd { get; set; }
    public string PricingVersion { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
}
public class PresentationClipAdminDto : PresentationStoryboardClip
{
    public decimal? EstimatedUsd { get; set; }
    public string? VideoUrl { get; set; }
    public string? PosterUrl { get; set; }
}
public class PresentationAdminResponse
{
    public string DraftId { get; set; } = string.Empty;
    public long Version { get; set; }
    public string Status { get; set; } = "DRAFT";
    public List<PresentationClipAdminDto> Clips { get; set; } = new();
    public PresentationEstimateDto Estimate { get; set; } = new();
    public bool GenerationEnabled { get; set; }
    public string? DisabledReason { get; set; }
}
