using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

[BsonIgnoreExtraElements]
public sealed class AiBudgetLedger
{
    public const string GlobalId = "global";

    [BsonId]
    public string Id { get; set; } = GlobalId;

    public decimal ReservedUsd { get; set; }
    public decimal SpentUsd { get; set; }
    public decimal LimitUsd { get; set; }
    // Only unsettled calls stay here. Atomic removal and $inc make duplicate settlement harmless.
    public Dictionary<string, decimal> CallReservations { get; set; } = new();
    public Dictionary<string, AiDraftUsageTotal> DraftUsage { get; set; } = new();
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
