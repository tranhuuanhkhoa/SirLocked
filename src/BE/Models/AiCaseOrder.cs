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
    /// <summary>
    /// Every new (OPEN_COOP_1) order: the server passes all four gates itself, truth included, and the bot never asks
    /// the creator; people edit the finished case in the editor. Set by the server only, never chosen by a client.
    /// </summary>
    public const string Auto = "AUTO";
    public static readonly IReadOnlyList<string> All = [Full, Fast];
}

public static class AiOrderStatuses
{
    public const string AwaitingOwnerApproval = "AWAITING_OWNER_APPROVAL";
    public const string QueuedForClaude = "QUEUED_FOR_CLAUDE";
    public const string ClaudeWorking = "CLAUDE_WORKING";
    public const string AwaitingGate = "AWAITING_GATE";
    /// <summary>The bot asked a question (draft_ask) that the creator answers in the browser.</summary>
    public const string AwaitingDecision = "AWAITING_DECISION";
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
    /// <summary>Library NPCs an order may name beyond its suspects (witnesses, the victim, returning faces).</summary>
    public const int ExtraNpcPicks = 3;
    public static readonly IReadOnlyList<int> PlayMinuteOptions = [20, 30, 45, 60];
    /// <summary>No fixed cap: the bot plans the cheapest set first and asks the creator before a costly one.</summary>
    public const int UnlimitedPixelLabCap = -1;
    public static readonly IReadOnlyList<int> PixelLabCapOptions = [UnlimitedPixelLabCap, 0, 30, 60, 100];
    /// <summary>PixelLab generations included in a paid VIP order (VUAN-7); more are bought in packs of 30.</summary>
    public const int VipPixelLabCap = 30;
    /// <summary>With no fixed cap, a picture plan above this many generations is put to the creator first.</summary>
    public const int AskAboveGenerations = 60;

    /// <summary>True when <paramref name="generations"/> fits the order's cap (any amount fits an unlimited cap).</summary>
    public static bool FitsCap(int generations, int cap) => cap < 0 || generations <= cap;

    public string World { get; set; } = AiCaseWorlds.HangDuongVictorian;
    public List<string> LocationIds { get; set; } = new();
    public List<string> NpcIds { get; set; } = new();
    public int SuspectCount { get; set; } = 4;
    public string CharacterNotes { get; set; } = string.Empty;
    public string Weather { get; set; } = AiCaseWeathers.Auto;
    public string TimeOfDay { get; set; } = AiCaseTimesOfDay.Auto;
    public int PlayMinutes { get; set; } = 30;
    public string ContentLevel { get; set; } = AiCaseContentLevels.Standard;
    /// <summary>0 means library pictures only; -1 means no fixed cap.</summary>
    public int PixelLabCap { get; set; } = UnlimitedPixelLabCap;
    public string ReviewMode { get; set; } = AiCaseReviewModes.Full;
    /// <summary>VIP orders (VUAN-7): "FAST" (Claude Messages API) or "SAVER" (Message Batches, about half the price).</summary>
    public string Speed { get; set; } = "FAST";
    /// <summary>
    /// Paid VIP orders (VUAN-7): PixelLab generations bought on top of the included 30 (0 or 30, paid per generation).
    /// The paid VIP's cap is 30 + this; <see cref="PixelLabCap"/> sent by a paid VIP is ignored, so leaving it out never
    /// costs extra. Free orders on the bridge lane ignore this field.
    /// </summary>
    public int VipExtraPixelLab { get; set; }
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
    /// <summary>
    /// Pixel drafts, NPC idle sheets only: the feet line of frame 0 as a fraction of the 128px frame
    /// ((lowest opaque row + 1) / 128, as the two bundled pixel cases), measured when the sheet is uploaded.
    /// </summary>
    [BsonIgnoreIfNull]
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public double? FeetAnchorY { get; set; }
}

/// <summary>How the pictures of an AI draft are made and laid out.</summary>
public static class AiVisualPipelines
{
    /// <summary>Drafts made before VUAN-6B (empty field): classic 1600x900 scenes, 1024px sprites. Kept as is.</summary>
    public const string Classic = "";
    /// <summary>
    /// VUAN-6B: PixelLab pictures in the shape of "Tram hong ngoc mat tich": 512x512 native scenes at x4 (2048x2048
    /// runtime, topdown outside, isometric rooms), walk grid, foreground layers, 128px idle sheets, 288px portraits,
    /// 64px inventory icons; investigation items are painted into the backgrounds.
    /// </summary>
    public const string PixelV1 = "pixel-v1";
}

public static class AiAssetSources
{
    /// <summary>A library picture used as it is (0 PixelLab generations).</summary>
    public const string Library = "LIBRARY";
    /// <summary>A local variant of a library picture: night, dusk, snow, mirror... (0 generations).</summary>
    public const string Variant = "VARIANT";
    /// <summary>A new PixelLab picture, planned from ai-game-docs/visual-style-templates/pixellab/templates.json.</summary>
    public const string PixelLab = "PIXELLAB";
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Library, Variant, PixelLab };
}

/// <summary>Where the bot takes the pictures of one subject (a scene, an NPC or an inventory icon) from.</summary>
[BsonIgnoreExtraElements]
public class AiAssetChoice
{
    /// <summary><c>scene:&lt;sceneId&gt;</c>, <c>character:&lt;characterId&gt;</c> or <c>item:&lt;itemId&gt;</c>.</summary>
    public string Subject { get; set; } = string.Empty;
    public string Source { get; set; } = AiAssetSources.PixelLab;
    /// <summary>LIBRARY: the library key used. VARIANT: the key of the new variant (optional).</summary>
    public string LibraryKey { get; set; } = string.Empty;
    /// <summary>VARIANT: the library picture the variant is made from.</summary>
    public string ParentKey { get; set; } = string.Empty;
    /// <summary>VARIANT: night, dusk, snow, after_rain, mirror, recolor or compose (compose only removes).</summary>
    public string Variant { get; set; } = string.Empty;
    /// <summary>
    /// LIBRARY or VARIANT scene: items of this scene that the picture does not show yet. Each is painted into the scene
    /// with PixelLab inpaint (template item-inpaint); an item picture is never pasted onto a scene. A new PIXELLAB scene
    /// paints its items from visualDescription instead.
    /// </summary>
    public List<string> InpaintItems { get; set; } = new();
    public string Note { get; set; } = string.Empty;
}

/// <summary>The accepted picture plan of a pixel draft: library first, PixelLab only for what is really new.</summary>
[BsonIgnoreExtraElements]
public class AiAssetPlan
{
    public List<AiAssetChoice> Choices { get; set; } = new();
    /// <summary>Planned PixelLab generations (sum of the requests' estimates); at most the order's pixelLabCap.</summary>
    public int EstimatedGenerations { get; set; }
    public int PixelLabCap { get; set; }
    public int Requests { get; set; }
    /// <summary>The full plan as returned to the bot (requests with prompts, dependencies, targets).</summary>
    public string PlanJson { get; set; } = string.Empty;
    public string PlanSha256 { get; set; } = string.Empty;
    public DateTime AcceptedAt { get; set; } = DateTime.UtcNow;
}
