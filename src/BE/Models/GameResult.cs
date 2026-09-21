using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

[BsonIgnoreExtraElements]
public class GameResult
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string RoomId { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public List<string> Players { get; set; } = new();
    public string SelectedCulpritId { get; set; } = string.Empty;
    public List<string> SelectedEvidenceIds { get; set; } = new();
    public string SelectedMotiveId { get; set; } = string.Empty;
    public string SelectedMethodId { get; set; } = string.Empty;
    public List<SelectedEvidenceLink> SelectedEvidenceLinks { get; set; } = new();
    public ScoreSummary? ScoreSummary { get; set; }
    public bool Success { get; set; }
    public string Ending { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class SelectedEvidenceLink
{
    public string ClaimType { get; set; } = string.Empty;
    public string EvidenceId { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class ScoreSummary
{
    // Coverage components (max: 40 + 25 + 20 + 15 = 100).
    public int EvidenceCoverageScore { get; set; }
    public int ContradictionCoverageScore { get; set; }
    public int DeductionCoverageScore { get; set; }
    public int TeamworkScore { get; set; }

    // Teamwork breakdown (each condition worth 5 points, counted once).
    public bool InvestigatorContribution { get; set; }
    public bool InterrogatorContribution { get; set; }
    public bool CrossRoleHandoff { get; set; }

    // Penalties.
    public int WrongEvidencePenalty { get; set; }
    public int WrongDeductionPenalty { get; set; }
    public int CameraMissPenalty { get; set; }

    public int TotalScore { get; set; }
    public string Rank { get; set; } = string.Empty;
}
