using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

/// <summary>
/// One line of the in-match chat between the two detectives. Kept for <see cref="DataAccess.MongoDbContext.TeamChatRetention"/>
/// (a TTL index removes it afterwards), so a reload or a reconnect still shows the conversation.
/// </summary>
[BsonIgnoreExtraElements]
public class TeamChatMessage
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string RoomId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    /// <summary>INVESTIGATOR or INTERROGATOR at the time of sending.</summary>
    public string? Role { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTime SentAt { get; set; }
}
