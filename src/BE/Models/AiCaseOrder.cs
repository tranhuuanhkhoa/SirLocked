using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class AiCaseWorlds
{
    public const string HangDuongVictorian = "HANG_DUONG_VICTORIAN";
    public const string TaishoJapan = "TAISHO_JAPAN";
    public const string Shanghai1930 = "SHANGHAI_1930";
    public const string NewWorld = "NEW_WORLD";
    /// <summary>Library entries usable in every world.</summary>
    public const string All = "ALL";

    public static readonly IReadOnlyList<string> Orderable = [HangDuongVictorian, TaishoJapan, Shanghai1930, NewWorld];
    public static readonly IReadOnlySet<string> LibraryWorlds =
        new HashSet<string>(StringComparer.Ordinal) { HangDuongVictorian, TaishoJapan, Shanghai1930, NewWorld, All };
}

public static class AiCaseWeathers
{
    public const string Clear = "CLEAR";
    public const string Rain = "RAIN";
    public const string Wind = "WIND";
    public const string Snow = "SNOW";
    public const string Storm = "STORM";
    public const string Auto = "AUTO";
    public static readonly IReadOnlyList<string> All = [Clear, Rain, Wind, Snow, Storm, Auto];
}

public static class AiCaseTimesOfDay
{
    public const string Day = "DAY";
    public const string Dusk = "DUSK";
    public const string Night = "NIGHT";
    public const string Auto = "AUTO";
    public static readonly IReadOnlyList<string> All = [Day, Dusk, Night, Auto];
}

public static class AiCaseContentLevels
{
    public const string Light = "LIGHT";
    public const string Standard = "STANDARD";
    public static readonly IReadOnlyList<string> All = [Light, Standard];
}

public static class AiCaseReviewModes
{
    /// <summary>Default: every gate (story, truth, logic, layout) waits for a human.</summary>
    public const string Full = "FULL";
    /// <summary>ADMIN only: the bot may pass the story, logic and layout gates itself. Never the truth gate.</summary>
    public const string Fast = "FAST";
    public static readonly IReadOnlyList<string> All = [Full, Fast];
}

public static class AiOrderStatuses
{
    public const string AwaitingOwnerApproval = "AWAITING_OWNER_APPROVAL";
    public const string QueuedForClaude = "QUEUED_FOR_CLAUDE";
    public const string ClaudeWorking = "CLAUDE_WORKING";
    public const string AwaitingGate = "AWAITING_GATE";
    public const string Submitted = "SUBMITTED";
    public const string Rejected = "REJECTED";
    public const string Cancelled = "CANCELLED";
}

/// <summary>What the creator asked for. Every field has a default; the server normalizes before storing.</summary>
[BsonIgnoreExtraElements]
public class AiCaseOrder
{
    public const int MinSuspects = 3;
    public const int MaxSuspects = 6;
    public const int MaxCharacterNotes = 600;
    public static readonly IReadOnlyList<int> PlayMinuteOptions = [20, 30, 45, 60];
    public static readonly IReadOnlyList<int> PixelLabCapOptions = [0, 30, 60, 100];
    public const int VipPixelLabCap = 30;

    public string World { get; set; } = AiCaseWorlds.HangDuongVictorian;
    public List<string> LocationIds { get; set; } = new();
    public List<string> NpcIds { get; set; } = new();
    public int SuspectCount { get; set; } = 4;
    public string CharacterNotes { get; set; } = string.Empty;
    public string Weather { get; set; } = AiCaseWeathers.Auto;
    public string TimeOfDay { get; set; } = AiCaseTimesOfDay.Auto;
    public int PlayMinutes { get; set; } = 30;
    public string ContentLevel { get; set; } = AiCaseContentLevels.Standard;
    /// <summary>0 means library pictures only.</summary>
    public int PixelLabCap { get; set; } = 60;
    public string ReviewMode { get; set; } = AiCaseReviewModes.Full;
}

[BsonIgnoreExtraElements]
public class AiOrderStatusChange
{
    public string Status { get; set; } = string.Empty;
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string ByUserId { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
}

/// <summary>Which Claude request a parked draft is waiting for.</summary>
[BsonIgnoreExtraElements]
public class AiClaudeWait
{
    public string RequestId { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    public DateTime Since { get; set; } = DateTime.UtcNow;
}

/// <summary>One picture the bot uploaded for an image slot of a draft.</summary>
[BsonIgnoreExtraElements]
public class AiBridgeAssetUpload
{
    public string SlotId { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public int Width { get; set; }
    public int Height { get; set; }
    public bool HasAlpha { get; set; }
    public long Bytes { get; set; }
    public string Sha256 { get; set; } = string.Empty;
    public string StorageId { get; set; } = string.Empty;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}
