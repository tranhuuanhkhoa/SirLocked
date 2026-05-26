using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using SirLocked.API.Helpers;

namespace SirLocked.API.Models;

public sealed class GameRoom
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public string RoomCode { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string HostUserId { get; set; } = string.Empty;
    public string Status { get; set; } = RoomStatuses.Waiting;
    public List<RoomPlayer> Players { get; set; } = [];
    public RoomProgress Progress { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class RoomPlayer
{
    public string UserId { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string? GameRole { get; set; }
    public bool IsReady { get; set; }
    public bool IsHost { get; set; }
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
}

public sealed class RoomProgress
{
    public string CurrentStageId { get; set; } = string.Empty;
    public string CurrentSceneId { get; set; } = string.Empty;
    public List<string> FoundItemIds { get; set; } = [];
    public List<string> FoundClueIds { get; set; } = [];
    public List<string> AskedDialogueIds { get; set; } = [];
    public List<string> PresentedEvidenceIds { get; set; } = [];
    public List<string> CompletedSceneIds { get; set; } = [];
    public List<string> CompletedStageIds { get; set; } = [];
}

public sealed class RoomChatMessage
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public string RoomId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
}
