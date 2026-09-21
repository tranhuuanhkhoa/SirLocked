using System.ComponentModel.DataAnnotations;
using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.Submission;

public class AccuseRequest
{
    [Required]
    public string CulpritId { get; set; } = string.Empty;

    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public string MotiveId { get; set; } = string.Empty;
    public string MethodId { get; set; } = string.Empty;
    public List<EvidenceLinkRequest> EvidenceLinks { get; set; } = new();

    [Required]
    public List<string>? EvidenceIds { get; set; } = new();
}

public class EvidenceLinkRequest
{
    [Required]
    public string ClaimType { get; set; } = string.Empty;

    [Required]
    public string EvidenceId { get; set; } = string.Empty;
}

public class AccusationComponentResult
{
    public string SelectedId { get; set; } = string.Empty;
    public string SelectedLabel { get; set; } = string.Empty;
    public string CorrectId { get; set; } = string.Empty;
    public string CorrectLabel { get; set; } = string.Empty;
    public bool IsCorrect { get; set; }
}

public class EvidenceClaimResult
{
    public string ClaimType { get; set; } = string.Empty;
    public string SelectedEvidenceId { get; set; } = string.Empty;
    public string SelectedEvidenceTitle { get; set; } = string.Empty;
    public string CorrectEvidenceId { get; set; } = string.Empty;
    public string CorrectEvidenceTitle { get; set; } = string.Empty;
    public bool IsCorrect { get; set; }
}

public class GameResultResponse
{
    public string RoomId { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string SelectedCulpritId { get; set; } = string.Empty;
    public string SelectedCulpritName { get; set; } = string.Empty;
    public List<string> SelectedEvidenceIds { get; set; } = new();
    public bool Success { get; set; }
    public string Ending { get; set; } = string.Empty;
    public string CorrectCulpritId { get; set; } = string.Empty;
    public string CorrectCulpritName { get; set; } = string.Empty;
    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public List<string> RequiredEvidenceIds { get; set; } = new();
    public AccusationComponentResult? CulpritResult { get; set; }
    public AccusationComponentResult? MotiveResult { get; set; }
    public AccusationComponentResult? MethodResult { get; set; }
    public List<EvidenceClaimResult> EvidenceResults { get; set; } = new();
    public ScoreSummary? ScoreSummary { get; set; }
    public DateTime CompletedAt { get; set; }
}
