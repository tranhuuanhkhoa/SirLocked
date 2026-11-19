using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models.Market;

/// <summary>
/// One per user (_id = userId): level, experience and the chosen avatar. Kept apart from the wallet, so a
/// progress write can never disturb a market operation and old accounts need no migration.
/// </summary>
[BsonIgnoreExtraElements]
public class PlayerProgress
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public int Level { get; set; } = 1;
    /// <summary>Experience toward the next level; always 0 at the level cap.</summary>
    public int Xp { get; set; }
    /// <summary>A preset avatar id, or "upload" for <see cref="AvatarUrl"/>.</summary>
    public string Avatar { get; set; } = "nonla";
    public string? AvatarUrl { get; set; }
    /// <summary>When <see cref="AvatarUrl"/> was uploaded, so the admin can list new pictures first. Null on pictures older than this field.</summary>
    public DateTime? AvatarUploadedAt { get; set; }
    /// <summary>Recently applied exchanges (bounded window) so a replayed step pays once.</summary>
    public List<string> Ops { get; set; } = new();
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// One exchange of items for XP (_id = "&lt;userId&gt;:&lt;idempotencyKey&gt;"), and its journal. Before
/// <see cref="Committed"/> it can still fail and free its locks; after, it only rolls forward. States follow <see cref="ChestOpeningStates"/>.
/// </summary>
[BsonIgnoreExtraElements]
public class XpExchange
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public List<string> ItemIds { get; set; } = new();
    public long Xp { get; set; }
    public string State { get; set; } = ChestOpeningStates.Pending;
    public string? Error { get; set; }
    public bool Committed { get; set; }
    /// <summary>What the exchange ended at, so a retried request gets the same answer.</summary>
    public int? ResultLevel { get; set; }
    public int? ResultXp { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
