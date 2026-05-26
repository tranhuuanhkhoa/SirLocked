using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.API.Models;

public sealed class AiCaseDraft
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public string Prompt { get; set; } = string.Empty;
    public string Status { get; set; } = "DRAFT";
    public string GeneratedJson { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class AiGenerationLog
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public string DraftId { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class GeneratedAsset
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public string DraftId { get; set; } = string.Empty;
    public string AssetType { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class AdminDashboardStats
{
    public long TotalUsers { get; set; }
    public long TotalCases { get; set; }
    public long TotalRooms { get; set; }
    public long TotalResults { get; set; }
}
