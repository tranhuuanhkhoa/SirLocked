using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Models;

[BsonIgnoreExtraElements]
public class GameRoom
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string RoomCode { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string HostUserId { get; set; } = string.Empty;
    public List<RoomPlayer> Players { get; set; } = new();
    public string Status { get; set; } = RoomStatus.Waiting;

    /// <summary>Embedded authoritative runtime state; null until the game starts.</summary>
    public GameplayState? GameplayState { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class RoomPlayer
{
    public string UserId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    /// <summary>INVESTIGATOR or INTERROGATOR; null until selected.</summary>
    public string? Role { get; set; }
    public bool IsReady { get; set; }
}

[BsonIgnoreExtraElements]
public class GameplayState
{
    public string CurrentStageId { get; set; } = string.Empty;
    public string CurrentSceneId { get; set; } = string.Empty;
    public Dictionary<string, string> PlayerSceneIds { get; set; } = new();
    /// <summary>Optimistic-concurrency version, incremented on every successful mutation.</summary>
    public long Version { get; set; }
    public List<string> VisitedSceneIds { get; set; } = new();
    public List<string> InspectedItemIds { get; set; } = new();
    public List<string> CollectedItemIds { get; set; } = new();
    public List<string> UnlockedClueIds { get; set; } = new();
    public List<string> AskedDialogueIds { get; set; } = new();
    public List<string> CompletedSceneIds { get; set; } = new();
    public List<string> CompletedStageIds { get; set; } = new();
    public List<string> SelectedEvidenceIds { get; set; } = new();
    public string GameStatus { get; set; } = Enums.GameStatus.InProgress;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}
