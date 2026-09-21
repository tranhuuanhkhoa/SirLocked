using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

/// <summary>
/// A player's review of a case. Persisted in the <c>reviews</c> collection.
/// One review per (caseId, userId) is enforced by a unique index; updates replace the existing document.
/// </summary>
[BsonIgnoreExtraElements]
public class CaseReview
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string CaseId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    /// <summary>Display name denormalized at write time so the list does not need a users join.</summary>
    public string AuthorDisplay { get; set; } = string.Empty;

    /// <summary>Overall rating, 1-5, required.</summary>
    public int Rating { get; set; }

    // Detective-specific sub-ratings, each 1-5, optional.
    public int? Difficulty { get; set; }
    public int? Fairness { get; set; }
    public int? Story { get; set; }
    public int? Twist { get; set; }

    public string ReviewText { get; set; } = string.Empty;
    public bool ContainsSpoiler { get; set; }

    /// <summary>Snapshot of the player's best result at write time (see <see cref="ReviewResultLabels"/>).</summary>
    public string ResultLabel { get; set; } = ReviewResultLabels.WrongAccusation;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class ReviewResultLabels
{
    /// <summary>Player had at least one winning game result for the case.</summary>
    public const string Solved = "SOLVED";
    /// <summary>Player played but never won.</summary>
    public const string WrongAccusation = "WRONG_ACCUSATION";
}

public static class ReviewEligibilityReasons
{
    public const string Ok = "OK";
    public const string NotPlayed = "NOT_PLAYED";
    public const string OwnCase = "OWN_CASE";
    public const string AlreadyReviewed = "ALREADY_REVIEWED";
}
