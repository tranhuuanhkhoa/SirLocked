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
    /// <summary>Optimistic-concurrency version for lobby mutations before gameplay starts.</summary>
    public long LobbyVersion { get; set; } = 1;

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
    public List<string> CapturedClueIds { get; set; } = new();
    public List<string> UnlockedClueIds { get; set; } = new();
    public List<string> AskedDialogueIds { get; set; } = new();
    public List<string> VisitedConversationNodeIds { get; set; } = new();
    public List<string> CompletedSceneIds { get; set; } = new();
    public List<string> CompletedStageIds { get; set; } = new();
    public List<string> SelectedEvidenceIds { get; set; } = new();
    public List<ResolvedConfrontationRecord> ResolvedConfrontationRecords { get; set; } = new();
    public List<string> EvidenceAttemptKeys { get; set; } = new();
    public int WrongEvidencePresentationCount { get; set; }
    public int CameraMissCount { get; set; }
    public List<string> UsedHintIds { get; set; } = new();
    public List<SolvedDeductionRecord> SolvedDeductionRecords { get; set; } = new();
    public List<string> DeductionAttemptKeys { get; set; } = new();
    public int WrongDeductionCount { get; set; }
    /// <summary>First-discovery attribution per clue, used for teamwork scoring.</summary>
    public List<ClueDiscoveryRecord> ClueDiscoveries { get; set; } = new();
    public string GameStatus { get; set; } = Enums.GameStatus.InProgress;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}

[BsonIgnoreExtraElements]
public class ResolvedConfrontationRecord
{
    public string ChallengeId { get; set; } = string.Empty;
    public string EvidenceId { get; set; } = string.Empty;
    public string ResolvedByUserId { get; set; } = string.Empty;
    public string ResolvedByRole { get; set; } = string.Empty;
    public DateTime ResolvedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class SolvedDeductionRecord
{
    public string DeductionId { get; set; } = string.Empty;
    public string SelectedOptionId { get; set; } = string.Empty;
    public string SolvedByUserId { get; set; } = string.Empty;
    public string SolvedByRole { get; set; } = string.Empty;
    public DateTime SolvedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class ClueDiscoveryRecord
{
    public string ClueId { get; set; } = string.Empty;
    public string DiscoveredByUserId { get; set; } = string.Empty;
    public string DiscoveredByRole { get; set; } = string.Empty;
    /// <summary>inspect | camera | dialogue | challenge | deduction.</summary>
    public string SourceAction { get; set; } = string.Empty;
    public DateTime DiscoveredAt { get; set; } = DateTime.UtcNow;
}

public static class ClueDiscoverySources
{
    public const string Inspect = "inspect";
    public const string Camera = "camera";
    public const string Dialogue = "dialogue";
    public const string Conversation = "conversation";
    public const string Challenge = "challenge";
    public const string Deduction = "deduction";
}
