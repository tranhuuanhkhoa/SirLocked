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
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
