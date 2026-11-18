using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class AiDraftLanes
{
    /// <summary>The ADMIN bot (Claude Code on Yen's plan) through the bridge queue. Stored as an empty string.</summary>
    public const string Bridge = "";
    /// <summary>A paid VIP order, written through the Claude API (VUAN-7).</summary>
    public const string VipApi = "VIP_API";
}

public static class AiVipBillingStates
{
    /// <summary>The draft exists and the hold is being written.</summary>
    public const string Holding = "HOLDING";
    /// <summary>The price is held in the VIP's wallet.</summary>
    public const string Held = "HELD";
    /// <summary>The case was delivered: the held coins are spent.</summary>
    public const string Charged = "CHARGED";
    /// <summary>Everything went back (rejected, failed, cost cap, cancelled before work started).</summary>
    public const string Refunded = "REFUNDED";
    /// <summary>Cancelled after work started: the unused part went back.</summary>
    public const string PartiallyRefunded = "PARTIALLY_REFUNDED";
    /// <summary>The hold never happened (not enough coins); nothing to settle.</summary>
    public const string NotHeld = "NOT_HELD";

    public static bool IsOpen(string state) => state is Holding or Held;
}

/// <summary>What a VIP order costs and the coins held for it. Only the server writes it.</summary>
public class AiVipBilling
{
    /// <summary>"FAST" (Messages API) or "SAVER" (Message Batches).</summary>
    public string Speed { get; set; } = "FAST";
    public string Preset { get; set; } = string.Empty;
    public int PixelLabCap { get; set; }
    /// <summary>The price in coins at order time (fixed for this order whatever the settings become).</summary>
    public long PriceXu { get; set; }
    /// <summary>Of the price, ordinary coins held.</summary>
    public long HeldFromBalance { get; set; }
    /// <summary>Of the price, bonus coins held (only when the settings allow bonus coins to pay a share).</summary>
    public long HeldFromBonus { get; set; }
    public string State { get; set; } = AiVipBillingStates.Holding;
    /// <summary>Estimated cost of the order in VND (Claude API + PixelLab), from the settings at order time.</summary>
    public long EstimatedCostVnd { get; set; }
    /// <summary>The run stops (and the order is refunded) once the Claude spend reaches this many VND.</summary>
    public long CostCapVnd { get; set; }
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal UsdToVnd { get; set; }
    public int VndPerXu { get; set; }
    /// <summary>What one PixelLab generation costs, VND, at order time (for the used part of a cancelled order).</summary>
    public long PixelLabVndPerGeneration { get; set; } = 130;
    /// <summary>Claude API spend so far, USD (kept in step with <c>aiVipUsage</c>).</summary>
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal SpentUsd { get; set; }
    public long SpentVnd { get; set; }
    public int Calls { get; set; }
    /// <summary>Coins that went back to the VIP when the order was settled.</summary>
    public long RefundedXu { get; set; }
    /// <summary>Coins kept when the order was settled.</summary>
    public long ChargedXu { get; set; }
    public string SettleReason { get; set; } = string.Empty;
    public DateTime HeldAt { get; set; }
    public DateTime? SettledAt { get; set; }
    /// <summary>True once the pipeline started real work (the first API call); a cancel after that keeps the used part.</summary>
    public bool WorkStarted { get; set; }
    /// <summary>When the order is expected to be ready, for the progress line of the VIP.</summary>
    public DateTime? EstimatedReadyAt { get; set; }
}

/// <summary>The light model's brief of a VIP order and its content check (VUAN-7 part A).</summary>
public class AiVipBrief
{
    public string Summary { get; set; } = string.Empty;
    public string Victim { get; set; } = string.Empty;
    public string Setting { get; set; } = string.Empty;
    public List<string> Suspects { get; set; } = new();
    public List<string> MustInclude { get; set; } = new();
    public List<string> Avoid { get; set; } = new();
    public string Tone { get; set; } = string.Empty;
    public bool ContentOk { get; set; }
    public List<string> ContentIssues { get; set; } = new();
    public string Model { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// One Claude API question of the VIP lane (<c>aiVipCalls</c>), keyed like a bridge request so a replayed run finds
/// the answer it already paid for instead of asking (and paying) again.
/// </summary>
[BsonIgnoreExtraElements]
public class AiVipCall
{
    [BsonId] public string Id { get; set; } = string.Empty;
    /// <summary>Deterministic: owner, run, step, attempt, ordinal (same as the bridge key).</summary>
    public string RequestKey { get; set; } = string.Empty;
    public string OwnerType { get; set; } = string.Empty;
    public string OwnerId { get; set; } = string.Empty;
    /// <summary>The draft the spend belongs to (the owner for drafts; the case's source draft for cutscenes).</summary>
    public string DraftId { get; set; } = string.Empty;
    public string GenerationRunId { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    public int AttemptNumber { get; set; }
    public string Model { get; set; } = string.Empty;
    public bool Batch { get; set; }
    public string State { get; set; } = AiVipCallStates.Pending;
    public string PromptSha256 { get; set; } = string.Empty;
    /// <summary>The step's JSON Schema, so a batch answer can be checked when it arrives.</summary>
    public string SchemaJson { get; set; } = string.Empty;
    /// <summary>The batch of a "Tiết kiệm" call (one request per batch, custom id = <see cref="Id"/>).</summary>
    public string BatchId { get; set; } = string.Empty;
    public string ResultJson { get; set; } = string.Empty;
    public string Error { get; set; } = string.Empty;
    public int BatchAttempts { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? AnsweredAt { get; set; }
}

public static class AiVipCallStates
{
    public const string Pending = "PENDING";
    /// <summary>Sent as a Message Batch; the run is parked until the batch ends.</summary>
    public const string BatchPending = "BATCH_PENDING";
    public const string Done = "DONE";
    public const string Failed = "FAILED";
    /// <summary>The replayed prompt changed; the old answer is not used.</summary>
    public const string Stale = "STALE";
}

/// <summary>One Claude API call's usage and cost (<c>aiVipUsage</c>), for the admin cost report.</summary>
[BsonIgnoreExtraElements]
public class AiVipUsageRecord
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string DraftId { get; set; } = string.Empty;
    public string CallId { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string Speed { get; set; } = string.Empty;
    public string Preset { get; set; } = string.Empty;
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long CacheReadTokens { get; set; }
    public long CacheWriteTokens { get; set; }
    public bool Batch { get; set; }
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal CostUsd { get; set; }
    public long CostVnd { get; set; }
    public string StopReason { get; set; } = string.Empty;
    public DateTime At { get; set; }
}
