using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

/// <summary>How a hint level was paid for (VUAN-7 part G).</summary>
public static class HintPaidWith
{
    /// <summary>Level 1, the tutorial and playtest rooms: always free.</summary>
    public const string Free = "FREE";
    public const string Coins = "XU";
    /// <summary>A finished rewarded ad (level 2 only, when ads are on).</summary>
    public const string Ad = "AD";
    /// <summary>Level 2 is a perk of the VIP plan when the setting is on.</summary>
    public const string VipFree = "VIP_FREE";
}

/// <summary>One hint level opened in a game, with what it cost and how much of the case score it takes.</summary>
public class HintUsageRecord
{
    /// <summary>The hint id, or <c>puzzle:&lt;puzzleId&gt;:&lt;level&gt;</c> for a puzzle hint.</summary>
    public string HintKey { get; set; } = string.Empty;
    public int Tier { get; set; }
    public string PaidWith { get; set; } = HintPaidWith.Free;
    public long PriceXu { get; set; }
    /// <summary>Share of the case score this hint takes (fixed when it was opened).</summary>
    public int PenaltyPercent { get; set; }
    public string UserId { get; set; } = string.Empty;
    public DateTime At { get; set; }
}

/// <summary>
/// One paid hint of a room (<c>hintPurchases</c>, id = room + hint): the first detective to open a paid level pays, the
/// partner then sees it for free, and opening it again never charges twice.
/// </summary>
[BsonIgnoreExtraElements]
public class HintPurchase
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string RoomId { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string HintKey { get; set; } = string.Empty;
    public int Tier { get; set; }
    public string PaidWith { get; set; } = HintPaidWith.Coins;
    public long PriceXu { get; set; }
    public int PenaltyPercent { get; set; }
    public string State { get; set; } = HintPurchaseStates.Pending;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public static class HintPurchaseStates
{
    public const string Pending = "PENDING";
    public const string Done = "DONE";
}

/// <summary>
/// A rewarded-ad ticket (<c>adTickets</c>): issued before the ad is shown, marked VIEWED when the ad SDK reports it was
/// watched to the end, spent once on a level-2 hint. An ad that fails or is skipped leaves the ticket unused.
/// </summary>
[BsonIgnoreExtraElements]
public class AdTicket
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string RoomId { get; set; } = string.Empty;
    public string State { get; set; } = AdTicketStates.Issued;
    public DateTime IssuedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ViewedAt { get; set; }
    public DateTime? UsedAt { get; set; }
    public string UsedForHintKey { get; set; } = string.Empty;
}

public static class AdTicketStates
{
    public const string Issued = "ISSUED";
    public const string Viewed = "VIEWED";
    public const string Used = "USED";
}

public static class CaseRevenueKinds
{
    /// <summary>Coins a player paid for a hint of the case.</summary>
    public const string HintCoins = "HINT_XU";
    /// <summary>A rewarded ad watched for a hint of the case.</summary>
    public const string AdView = "AD_VIEW";
}

/// <summary>
/// Money a case earned (<c>caseRevenue</c>): hint coins and rewarded-ad views, by case, for the admin report and the
/// author's revenue share. One event per paid hint (id = the purchase id).
/// </summary>
[BsonIgnoreExtraElements]
public class CaseRevenueEvent
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string RoomId { get; set; } = string.Empty;
    /// <summary>The player who paid or watched.</summary>
    public string UserId { get; set; } = string.Empty;
    public string Kind { get; set; } = CaseRevenueKinds.HintCoins;
    public long Xu { get; set; }
    /// <summary>Ad views: what the view is worth in VND (settings at the time).</summary>
    public long Vnd { get; set; }
    public DateTime At { get; set; }
    /// <summary>Set once the author share worker has counted this event (eligible or not).</summary>
    public string? ShareBatchId { get; set; }
    /// <summary>Whether the event counted toward the author's share (anti-fraud rules), once decided.</summary>
    public bool? ShareEligible { get; set; }
    public string ShareReason { get; set; } = string.Empty;
    public string? PayoutId { get; set; }
}
