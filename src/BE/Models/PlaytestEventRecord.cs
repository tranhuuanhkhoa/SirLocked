using System.Text.Json.Serialization;
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PlaytestEventType
{
    PrivateDiscoveryCount,
    ConfrontationStarted,
    ProposalSubmitted,
    ProposalEdited,
    JointReviewDisclosed,
    ConfirmationFirst,
    ConfirmationSecond,
    Cancelled,
    ResolvedCorrect,
    ResolvedIncorrect,
    OptimisticRetry,
    ReconnectRestored,
    PrivateNotebookOpened,
    PrivateNotebookClosed,
    ConfrontationOverlayOpened,
    ProposalSelectionDwell,
    WaitingStarted,
    WaitingEnded,
    RevealDisplayed,
    RevealDismissed,
    // Appended, never inserted: stored documents keep the string name, and the numeric order
    // stays stable for anything that still reads the enum positionally.
    SceneCompleted,
    StageCompleted,
    HintUsed,
    AccusationProposed,
    AccusationAmended,
    AccusationConfirmed,
    AccusationCancelled
}

[BsonIgnoreExtraElements]
public sealed class PlaytestEventRecord
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string SessionPseudonym { get; set; } = string.Empty;
    public string UserHash { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;

    [BsonRepresentation(BsonType.String)]
    public PlaytestEventType EventType { get; set; }

    public long StateVersion { get; set; }
    public string? AttemptId { get; set; }
    public int? Revision { get; set; }
    public long? DurationMs { get; set; }
    public int? Count { get; set; }
    public DateTime Timestamp { get; set; }
}
