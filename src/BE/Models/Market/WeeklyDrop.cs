using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models.Market;

public static class WeeklyDropStates
{
    /// <summary>Rolled and recorded; the chest is not in the bag yet. The recovery sweep finishes it.</summary>
    public const string Pending = "PENDING";
    /// <summary>The bag was full: the chest waits, without expiring, until the player makes room and claims it.</summary>
    public const string Waiting = "WAITING";
    /// <summary>The chest is in the bag.</summary>
    public const string Done = "DONE";
}

/// <summary>
/// The weekly challenge chest of one account for one week (_id = "&lt;weekKey&gt;:&lt;userId&gt;"), so a second chest in the
/// same week is a duplicate key. The chest and the item id are rolled and stored here before the item is created, so
/// finishing it again (hook, sweep or claim) always gives the same chest, once.
/// </summary>
[BsonIgnoreExtraElements]
public class WeeklyDrop
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    /// <summary>The challenge week of the game, as yyyy-MM-dd of its Wednesday (see ChallengeWeek).</summary>
    public string WeekKey { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    /// <summary>The game that earned the chest.</summary>
    public string RoomId { get; set; } = string.Empty;
    public string ChestDefId { get; set; } = string.Empty;
    /// <summary>Chosen up front, so creating the chest twice is a duplicate key and not a second item.</summary>
    public string ItemId { get; set; } = string.Empty;
    public string State { get; set; } = WeeklyDropStates.Pending;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeliveredAt { get; set; }

    public static string IdOf(string weekKey, string userId) => $"{weekKey}:{userId}";
}
