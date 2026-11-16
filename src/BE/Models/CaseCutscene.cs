using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class CutsceneStatus
{
    public const string Draft = "DRAFT";
    public const string Approved = "APPROVED";
    public const string Disabled = "DISABLED";
    /// <summary>An older approved version replaced by a newer approval; kept for rolling back.</summary>
    public const string Superseded = "SUPERSEDED";
}

public static class CutsceneTriggers
{
    public const string Intro = "INTRO";
}

/// <summary>
/// One version of a case cutscene, stored in its own collection so the case document and its seeder are never touched.
/// At most one version per case and trigger is APPROVED; only that one reaches players.
/// </summary>
[BsonIgnoreExtraElements]
public class CaseCutscene
{
    /// <summary>"{caseId}:{trigger}:v{version}".</summary>
    [BsonId]
    public string Id { get; set; } = string.Empty;

    public string CaseId { get; set; } = string.Empty;
    public string Trigger { get; set; } = CutsceneTriggers.Intro;
    public int Version { get; set; }
    public string Status { get; set; } = CutsceneStatus.Draft;
    /// <summary>AI, SEED (from a file in the repo) or MANUAL (an admin edit).</summary>
    public string Source { get; set; } = "AI";
    public string Model { get; set; } = string.Empty;
    /// <summary>The Claude bridge run that wrote this version; empty for seed files and manual edits.</summary>
    public string GenerationRunId { get; set; } = string.Empty;
    /// <summary>The motion-comic script as JSON text.</summary>
    public string ScriptJson { get; set; } = string.Empty;
    public double EstimatedSeconds { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public string ApprovedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ApprovedAt { get; set; }

    public static string MakeId(string caseId, string trigger, int version) => $"{caseId}:{trigger}:v{version}";
}
