using MongoDB.Bson.Serialization.Attributes;
using SirLocked.Api.Configurations;

namespace SirLocked.Api.Models;

[BsonIgnoreExtraElements]
public sealed class AiCallLease
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string DraftId { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public decimal ReservedUsd { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public string PriceVersion { get; set; } = string.Empty;
    public AiModelPrice? Price { get; set; }
}

[BsonIgnoreExtraElements]
public sealed class AiUsageEvent
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public AiCallLease Lease { get; set; } = new();
    public string State { get; set; } = "PENDING";
    public string ResponseId { get; set; } = string.Empty;
    public int? StatusCode { get; set; }
    public long? InputTokens { get; set; }
    public long? OutputTokens { get; set; }
    public long? CachedInputTokens { get; set; }
    public long? CacheWriteTokens { get; set; }
    public long? ReasoningTokens { get; set; }
    public long? ImageInputTokens { get; set; }
    public long? ImageOutputTokens { get; set; }
    public decimal? CostUsd { get; set; }
    public string CostSource { get; set; } = "UNKNOWN";
    public long LatencyMs { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class AiDraftUsageTotal
{
    public decimal ReservedUsd { get; set; }
    public decimal SpentUsd { get; set; }
}
