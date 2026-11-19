using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models.Market;

public static class ChestOpeningStates
{
    public const string Pending = "PENDING";
    public const string RollingBack = "ROLLING_BACK";
    public const string Done = "DONE";
    public const string Failed = "FAILED";   // nothing was spent
}

/// <summary>
/// One opening (_id = "&lt;userId&gt;:&lt;idempotencyKey&gt;"), and its journal: the reward is rolled and stored here
/// before anything is spent, so a retry always returns the same item and the recovery sweep can finish a
/// crashed opening. Before <see cref="Committed"/> it can still fail and free its locks; after, it only rolls forward.
/// </summary>
[BsonIgnoreExtraElements]
public class ChestOpening
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string ChestDefId { get; set; } = string.Empty;
    public string KeyDefId { get; set; } = string.Empty;
    public string RewardDefId { get; set; } = string.Empty;
    /// <summary>Chosen up front, so creating the reward twice is a duplicate key and not a second item.</summary>
    public string RewardItemId { get; set; } = string.Empty;
    public string State { get; set; } = ChestOpeningStates.Pending;
    public string? Error { get; set; }
    public bool Committed { get; set; }
    public string? ChestItemId { get; set; }
    public string? KeyItemId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>One shop purchase of a chest or key (_id = "&lt;userId&gt;:&lt;idempotencyKey&gt;"). Every step is idempotent and only rolls forward.</summary>
[BsonIgnoreExtraElements]
public class ChestPurchase
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string ChestDefId { get; set; } = string.Empty;
    /// <summary>The item bought: the chest itself or its key.</summary>
    public string DefId { get; set; } = string.Empty;
    public long Price { get; set; }
    public string ItemId { get; set; } = string.Empty;
    public string State { get; set; } = ChestOpeningStates.Pending;
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
