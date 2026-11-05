using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models.Catalog;

/// <summary>How one item type is drawn. See docs/admin-contracts.md for who sets which field.</summary>
[BsonIgnoreExtraElements]
public class CatalogVisual
{
    /// <summary>A sprite drawn in code (cosmetics/icons.js, chest/chestSprites.js).</summary>
    public string? IconKey { get; set; }
    /// <summary>A picture an admin uploaded: an item icon, or the hand-drawn art of a frame or an entrance.</summary>
    public string? ImageUrl { get; set; }
    /// <summary>Drawing code that ships in src/FE/Client/js/cosmetics (for example "kimlong").</summary>
    public string? BuiltinId { get; set; }
    /// <summary>The template of a cosmetic made by an admin. ADMIN-2 defines the values.</summary>
    public string? Template { get; set; }
    /// <summary>The template's parameters, stored as a free-form document.</summary>
    public BsonDocument Params { get; set; } = new();
}

/// <summary>One item type (collection catalogItems). _id is the defId that inventories point at and never changes.</summary>
[BsonIgnoreExtraElements]
public class CatalogItem
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Rarity { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string NameEn { get; set; } = string.Empty;
    /// <summary>Empty on a cosmetic means "write it from the chest pools"; see CatalogSnapshot.</summary>
    public string Description { get; set; } = string.Empty;
    public string DescriptionEn { get; set; } = string.Empty;
    public long ReferencePrice { get; set; }
    public bool Tradable { get; set; } = true;
    /// <summary>Hidden from drop tables and the shop. Copies already owned keep working.</summary>
    public bool Retired { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
    public int Version { get; set; } = 1;
    public CatalogVisual Visual { get; set; } = new();
}

/// <summary>Which chest drawing to use and the three colours of its light, as "r,g,b".</summary>
[BsonIgnoreExtraElements]
public class CatalogChestLook
{
    /// <summary>seal, bank or lacquer.</summary>
    public string Template { get; set; } = string.Empty;
    public string Light { get; set; } = string.Empty;
    public string Hi { get; set; } = string.Empty;
    public string Core { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class CatalogChestPrices
{
    public long Chest { get; set; }
    public long Key { get; set; }
}

/// <summary>One chest type (collection chests). _id is the defId of the chest item.</summary>
[BsonIgnoreExtraElements]
public class CatalogChest
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string KeyDefId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string NameEn { get; set; } = string.Empty;
    public string Subtitle { get; set; } = string.Empty;
    public string SubtitleEn { get; set; } = string.Empty;
    public string KeyName { get; set; } = string.Empty;
    public string KeyNameEn { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public string KeyIconKey { get; set; } = string.Empty;
    public CatalogChestLook Look { get; set; } = new();
    public CatalogChestPrices Prices { get; set; } = new();
    /// <summary>Weight of each rarity out of 10,000. Each chest has its own table.</summary>
    public Dictionary<string, int> DropWeights { get; set; } = new(StringComparer.Ordinal);
    /// <summary>The defIds this chest can pay out, in display order.</summary>
    public List<string> Pool { get; set; } = new();
    public bool Active { get; set; } = true;
    public int SortOrder { get; set; }
    public int Version { get; set; } = 1;
    public string? UpdatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>A cosmetic granted on reaching a level (collection levelRewards). _id is "level:defId".</summary>
[BsonIgnoreExtraElements]
public class CatalogLevelReward
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public int Level { get; set; }
    public string DefId { get; set; } = string.Empty;

    public static string IdOf(int level, string defId) => $"{level}:{defId}";
}

/// <summary>A title granted for play (collection achievements). _id is the title's defId.</summary>
[BsonIgnoreExtraElements]
public class CatalogAchievement
{
    [BsonId] public string TitleDefId { get; set; } = string.Empty;
    /// <summary>A name from AchievementMetrics, or null when the record cannot count it yet.</summary>
    public string? Metric { get; set; }
    public int Target { get; set; }
    public int SortOrder { get; set; }
}

/// <summary>gameSettings/progress: what an exchanged item pays. The level curve and the cap stay in code.</summary>
[BsonIgnoreExtraElements]
public class ProgressSettingsDocument
{
    public const string DocumentId = "progress";

    [BsonId] public string Id { get; set; } = DocumentId;
    public long RareXp { get; set; }
    public long EpicXp { get; set; }
}

/// <summary>gameSettings/catalogSeed: how many seed batches this database has already taken.</summary>
[BsonIgnoreExtraElements]
public class CatalogSeedState
{
    public const string DocumentId = "catalogSeed";

    [BsonId] public string Id { get; set; } = DocumentId;
    public int SeedVersion { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>One admin action (collection adminAudit). <see cref="Before"/> and <see cref="After"/> are JSON text.</summary>
[BsonIgnoreExtraElements]
public class AdminAuditEntry
{
    [BsonId, BsonRepresentation(BsonType.ObjectId)] public string Id { get; set; } = ObjectId.GenerateNewId().ToString();
    public DateTime At { get; set; }
    public string AdminId { get; set; } = string.Empty;
    public string AdminName { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string TargetType { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public string? Before { get; set; }
    public string? After { get; set; }
    public string? Reason { get; set; }
}
