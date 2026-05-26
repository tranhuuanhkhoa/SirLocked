using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.API.Models;

public sealed class GameActionLog
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public string RoomId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string ActionType { get; set; } = string.Empty;
    public string PayloadJson { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class GameResult
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public string RoomId { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public bool Success { get; set; }
    public FinalAccusation Accusation { get; set; } = new();
    public DateTime CompletedAt { get; set; } = DateTime.UtcNow;
}

public sealed class FoundItem
{
    public string ItemId { get; set; } = string.Empty;
    public string FoundByUserId { get; set; } = string.Empty;
    public DateTime FoundAt { get; set; } = DateTime.UtcNow;
}

public sealed class FoundClue
{
    public string ClueId { get; set; } = string.Empty;
    public string UnlockedByUserId { get; set; } = string.Empty;
    public DateTime UnlockedAt { get; set; } = DateTime.UtcNow;
}

public sealed class DialogueState
{
    public string DialogueId { get; set; } = string.Empty;
    public bool IsUnlocked { get; set; }
    public bool IsAsked { get; set; }
}

public sealed class FinalAccusation
{
    public string CulpritId { get; set; } = string.Empty;
    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public List<string> EvidenceIds { get; set; } = [];
}
