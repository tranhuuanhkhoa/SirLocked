using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

/// <summary>
/// Admin-curated weekly highlight: the "Case of the Week" banner or the "Weekly Challenge".
/// At most one row per type is active at a time (older ones are flipped isActive=false).
/// </summary>
[BsonIgnoreExtraElements]
public class WeeklyFeature
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    /// <summary>One of <see cref="WeeklyFeatureTypes"/>.</summary>
    public string Type { get; set; } = WeeklyFeatureTypes.CaseOfWeek;
    public string CaseId { get; set; } = string.Empty;
    public DateTime WeekStart { get; set; }
    public DateTime WeekEnd { get; set; }
    public bool IsActive { get; set; } = true;
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class WeeklyFeatureTypes
{
    public const string CaseOfWeek = "CASE_OF_WEEK";
    public const string WeeklyChallenge = "WEEKLY_CHALLENGE";

    public static bool IsValid(string? type) => type is CaseOfWeek or WeeklyChallenge;
}
