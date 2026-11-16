using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class AiBridgeOwnerTypes
{
    public const string CaseDraft = "CASE_DRAFT";
    public const string Cutscene = "CUTSCENE";
}

public static class AiBridgeKinds
{
    public const string Json = "JSON";
    public const string Assets = "ASSETS";
}

public static class AiBridgeStatuses
{
    public const string Pending = "PENDING";
    public const string Taken = "TAKEN";
    public const string Submitted = "SUBMITTED";
    public const string Accepted = "ACCEPTED";
    public const string Rejected = "REJECTED";
    public const string Stale = "STALE";
    public const string Cancelled = "CANCELLED";

    /// <summary>Statuses the bot can still answer.</summary>
    public static readonly IReadOnlySet<string> Open = new HashSet<string>(StringComparer.Ordinal) { Pending, Taken, Rejected };
    /// <summary>Statuses that carry a schema-valid answer for the pipeline.</summary>
    public static readonly IReadOnlySet<string> Answered = new HashSet<string>(StringComparer.Ordinal) { Submitted, Accepted };
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        Pending, Taken, Submitted, Accepted, Rejected, Stale, Cancelled
    };
}

/// <summary>
/// One question the server asks the Claude bot. The pipeline re-runs from its checkpoint after every answer, so a
/// request is identified by a deterministic <see cref="RequestKey"/>: the same call in a re-run finds the stored answer.
/// </summary>
[BsonIgnoreExtraElements]
public class AiBridgeRequest
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string OwnerType { get; set; } = AiBridgeOwnerTypes.CaseDraft;
    public string OwnerId { get; set; } = string.Empty;
    /// <summary>Unique. A stale request is renamed so the key can be reused by its replacement.</summary>
    public string RequestKey { get; set; } = string.Empty;
    public string OriginalRequestKey { get; set; } = string.Empty;
    public string GenerationRunId { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    public int AttemptNumber { get; set; }
    public int CallOrdinal { get; set; }
    public string SchemaVersion { get; set; } = string.Empty;
    public string Kind { get; set; } = AiBridgeKinds.Json;

    public string Prompt { get; set; } = string.Empty;
    public string Instructions { get; set; } = string.Empty;
    /// <summary>JSON Schema of the expected answer, stored as JSON text.</summary>
    public string SchemaJson { get; set; } = string.Empty;
    public string PromptSha256 { get; set; } = string.Empty;
    public int MaxOutputTokens { get; set; }
    /// <summary>For ASSETS requests: the asset phase (SCENE_LAYOUT or FINAL_ASSETS) and the slot ids the bot must fill.</summary>
    public string AssetPhase { get; set; } = string.Empty;
    public List<string> AssetSlotIds { get; set; } = new();
    /// <summary>Slots that need a new picture uploaded after this request was created.</summary>
    public List<string> AssetRegenerateSlotIds { get; set; } = new();
    /// <summary>Development/Testing only: the deterministic mock answer, never stored in Production.</summary>
    [BsonIgnoreIfNull]
    public string? MockResponseJson { get; set; }

    public string Status { get; set; } = AiBridgeStatuses.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? TakenAt { get; set; }
    public DateTime? LeaseExpiresAt { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    public int TakeCount { get; set; }
    public int SubmitCount { get; set; }

    public string ResultJson { get; set; } = string.Empty;
    public string ResultSha256 { get; set; } = string.Empty;
    public List<string> Errors { get; set; } = new();
    /// <summary>Set once the pipeline has recorded the answer as a generation attempt.</summary>
    public bool AttemptRecorded { get; set; }
}
