using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using SirLocked.Api.Models.Enums;
using System.Text.Json.Serialization;

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
    /// <summary>Transient marker used by the lobby writer to remove one player without replacing presence fields.</summary>
    [BsonIgnore]
    [JsonIgnore]
    public string? PendingRemovedPlayerId { get; set; }
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
    public bool IsConnected { get; set; }
    public DateTime? LastConnectedAt { get; set; }
    public DateTime? DisconnectedAt { get; set; }
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
    public List<string> UnlockedSceneIds { get; set; } = new();
    public List<string> InspectedItemIds { get; set; } = new();
    public List<string> CollectedItemIds { get; set; } = new();
    public List<string> CapturedClueIds { get; set; } = new();
    public List<string> UnlockedClueIds { get; set; } = new();
    public List<string> UsedInteractionIds { get; set; } = new();
    public List<string> SolvedPuzzleIds { get; set; } = new();
    public List<string> AskedDialogueIds { get; set; } = new();
    public List<string> VisitedConversationNodeIds { get; set; } = new();
    public List<string> CompletedSceneIds { get; set; } = new();
    public List<string> CompletedStageIds { get; set; } = new();
    public List<string> SelectedEvidenceIds { get; set; } = new();
    public List<ResolvedConfrontationRecord> ResolvedConfrontationRecords { get; set; } = new();
    public List<string> EvidenceAttemptKeys { get; set; } = new();
    public int WrongEvidencePresentationCount { get; set; }
    public int CameraMissCount { get; set; }
    public int WrongPuzzleCount { get; set; }
    public List<string> UsedHintIds { get; set; } = new();
    public List<SolvedDeductionRecord> SolvedDeductionRecords { get; set; } = new();
    public List<string> DeductionAttemptKeys { get; set; } = new();
    public int WrongDeductionCount { get; set; }
    /// <summary>First-discovery attribution per clue, used for teamwork scoring.</summary>
    public List<ClueDiscoveryRecord> ClueDiscoveries { get; set; } = new();
    /// <summary>Caller ownership of V3 testimony fragments.</summary>
    public List<TestimonyDiscoveryRecord> TestimonyDiscoveries { get; set; } = new();
    /// <summary>The single mutable V3 joint-review attempt, or null when none is active.</summary>
    public PairedConfrontationState? ActiveConfrontation { get; set; }
    /// <summary>Terminal V3 attempts retained for disclosure, retries and exactly-once outcomes.</summary>
    public List<PairedConfrontationAttemptRecord> PairedConfrontationAttempts { get; set; } = new();
    /// <summary>The single mutable final-accusation proposal awaiting consensus, or null when none is open.</summary>
    public AccusationProposalState? ActiveAccusation { get; set; }
    /// <summary>Terminal accusation proposals retained for history, retries and exactly-once outcomes.</summary>
    public List<AccusationProposalState> AccusationAttempts { get; set; } = new();
    public string GameStatus { get; set; } = Enums.GameStatus.InProgress;
    /// <summary>
    /// Authoritative completion data used to recreate the denormalized game result when its write fails.
    /// Null for games that have not completed and for legacy room documents.
    /// </summary>
    public FinalAccusationSnapshot? FinalAccusationSnapshot { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}

[BsonIgnoreExtraElements]
public class FinalAccusationSnapshot
{
    public string CaseId { get; set; } = string.Empty;
    public List<string> PlayerIds { get; set; } = new();
    public string SelectedCulpritId { get; set; } = string.Empty;
    public List<string> SelectedEvidenceIds { get; set; } = new();
    public string SelectedMotiveId { get; set; } = string.Empty;
    public string SelectedMethodId { get; set; } = string.Empty;
    public List<SelectedEvidenceLink> SelectedEvidenceLinks { get; set; } = new();
    public ScoreSummary? ScoreSummary { get; set; }
    public bool Success { get; set; }
    public string Ending { get; set; } = string.Empty;
    public DateTime CompletedAt { get; set; }
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
    /// <summary>inspect | camera | dialogue | challenge | deduction | interaction | puzzle.</summary>
    public string SourceAction { get; set; } = string.Empty;
    public DateTime DiscoveredAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class TestimonyDiscoveryRecord
{
    public string TestimonyFragmentId { get; set; } = string.Empty;
    public string DialogueId { get; set; } = string.Empty;
    public string DiscoveredByUserId { get; set; } = string.Empty;
    public string DiscoveredByRole { get; set; } = string.Empty;
    public DateTime DiscoveredAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class PairedConfrontationState
{
    public string AttemptId { get; set; } = string.Empty;
    public string ChallengeId { get; set; } = string.Empty;
    [BsonRepresentation(BsonType.String)]
    public PairedConfrontationStatus Status { get; set; } = PairedConfrontationStatus.CollectingProposals;
    public int Revision { get; set; } = 1;
    public string TestimonyFragmentId { get; set; } = string.Empty;
    public string TestimonyProposedByUserId { get; set; } = string.Empty;
    public string? EvidenceId { get; set; }
    public string? EvidenceProposedByUserId { get; set; }
    public List<PlayerConfrontationConfirmation> Confirmations { get; set; } = new();
    public List<PairedConfrontationDisclosureRecord> Disclosures { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class PlayerConfrontationConfirmation
{
    public string UserId { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public int Revision { get; set; }
    public DateTime ConfirmedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// One final-accusation proposal. Unlike a paired confrontation the whole proposal belongs to a
/// single author; the partner reviews it as a block, so there is no collecting phase.
/// </summary>
[BsonIgnoreExtraElements]
public class AccusationProposalState
{
    public string AttemptId { get; set; } = string.Empty;
    [BsonRepresentation(BsonType.String)]
    public AccusationProposalStatus Status { get; set; } = AccusationProposalStatus.AwaitingConfirmation;
    public int Revision { get; set; } = 1;
    public string ProposedByUserId { get; set; } = string.Empty;
    public string ProposedByRole { get; set; } = string.Empty;
    public string CulpritId { get; set; } = string.Empty;
    public string? MotiveId { get; set; }
    public string? MethodId { get; set; }
    public List<string> EvidenceIds { get; set; } = new();
    public List<SelectedEvidenceLink> EvidenceLinks { get; set; } = new();
    /// <summary>Confirmations are bound to <see cref="Revision"/>; an amend clears every earlier one.</summary>
    public List<PlayerConfrontationConfirmation> Confirmations { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class PairedConfrontationDisclosureRecord
{
    public int Revision { get; set; }
    public string EvidenceId { get; set; } = string.Empty;
    public string TestimonyFragmentId { get; set; } = string.Empty;
    public DateTime DisclosedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class PairedConfrontationAttemptRecord
{
    public string AttemptId { get; set; } = string.Empty;
    public string ChallengeId { get; set; } = string.Empty;
    [BsonRepresentation(BsonType.String)]
    public PairedConfrontationStatus Status { get; set; }
    public int FinalRevision { get; set; }
    public string TestimonyFragmentId { get; set; } = string.Empty;
    public string? EvidenceId { get; set; }
    public List<PlayerConfrontationConfirmation> Confirmations { get; set; } = new();
    public List<PairedConfrontationDisclosureRecord> Disclosures { get; set; } = new();
    public string? CancelledByUserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ResolvedAt { get; set; } = DateTime.UtcNow;
}

public static class ClueDiscoverySources
{
    public const string Inspect = "inspect";
    public const string Camera = "camera";
    public const string Dialogue = "dialogue";
    public const string Conversation = "conversation";
    public const string Challenge = "challenge";
    public const string Deduction = "deduction";
    public const string Interaction = "interaction";
    public const string Puzzle = "puzzle";
}
