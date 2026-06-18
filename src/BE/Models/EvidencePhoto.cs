using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

[BsonIgnoreExtraElements]
public class EvidencePhoto
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string RoomId { get; set; } = string.Empty;
    public string ClueId { get; set; } = string.Empty;
    public string SceneId { get; set; } = string.Empty;
    public string CapturedByUserId { get; set; } = string.Empty;
    public string ContentType { get; set; } = "image/webp";
    public byte[] ImageData { get; set; } = Array.Empty<byte>();
    public int Width { get; set; }
    public int Height { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
