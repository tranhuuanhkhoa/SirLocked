using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

[BsonIgnoreExtraElements]
public class GameResult
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string RoomId { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public List<string> Players { get; set; } = new();
    public string SelectedCulpritId { get; set; } = string.Empty;
    public List<string> SelectedEvidenceIds { get; set; } = new();
    public bool Success { get; set; }
    public string Ending { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
