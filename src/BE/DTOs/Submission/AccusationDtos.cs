using System.ComponentModel.DataAnnotations;

namespace SirLocked.Api.DTOs.Submission;

public class AccuseRequest
{
    [Required]
    public string CulpritId { get; set; } = string.Empty;

    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;

    public List<string> EvidenceIds { get; set; } = new();
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
    public DateTime CompletedAt { get; set; }
}
