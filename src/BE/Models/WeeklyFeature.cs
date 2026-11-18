using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

/// <summary>
/// A weekly highlight: the "Case of the Week" banner (admin-curated, at most one active at a time) or the
/// "Weekly Challenge". A challenge has one document per challenge week, keyed by <see cref="WeekKey"/>
/// (unique with <see cref="Type"/>); challenge documents from before weeks had keys have no key.
/// </summary>
[BsonIgnoreExtraElements]
public class WeeklyFeature
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    /// <summary>One of <see cref="WeeklyFeatureTypes"/>.</summary>
    public string Type { get; set; } = WeeklyFeatureTypes.CaseOfWeek;

    /// <summary>
    /// The challenge week this document speaks for, as yyyy-MM-dd of its Wednesday (see ChallengeWeek).
    /// Null for the case of the week and for challenge documents written before weeks had keys.
    /// </summary>
    [BsonIgnoreIfNull]
    public string? WeekKey { get; set; }

    /// <summary>Who chose the case: one of <see cref="WeeklyFeatureSources"/>. Documents without one were all set by an admin.</summary>
    public string Source { get; set; } = WeeklyFeatureSources.Admin;

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

public static class WeeklyFeatureSources
{
    /// <summary>Picked by the server on its own among the good cases.</summary>
    public const string Auto = "AUTO";

    /// <summary>Chosen (or stopped) by an admin.</summary>
    public const string Admin = "ADMIN";
}
