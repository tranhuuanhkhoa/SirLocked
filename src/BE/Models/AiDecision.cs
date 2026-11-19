using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class AiDecisionStatuses
{
    public const string Open = "OPEN";
    public const string Answered = "ANSWERED";
    public const string Cancelled = "CANCELLED";
}

/// <summary>
/// A question the bot puts to the creator with draft_ask (for example: draw 180 PixelLab generations, or reuse the
/// library). Its bridge request waits in AWAITING_DECISION until someone with access to the draft picks an option.
/// </summary>
[BsonIgnoreExtraElements]
public class AiDecision
{
    public string Id { get; set; } = string.Empty;
    /// <summary>The bot's own name for the question ("asset-budget"); one open question per key and draft.</summary>
    public string Key { get; set; } = string.Empty;
    public string RequestId { get; set; } = string.Empty;
    public string Question { get; set; } = string.Empty;
    public List<AiDecisionOption> Options { get; set; } = new();
    public string Status { get; set; } = AiDecisionStatuses.Open;
    public DateTime AskedAt { get; set; }
    public DateTime? AnsweredAt { get; set; }
    public string? AnsweredByUserId { get; set; }
    public string? ChosenOptionId { get; set; }
}

[BsonIgnoreExtraElements]
public class AiDecisionOption
{
    public string Id { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Detail { get; set; } = string.Empty;
    /// <summary>PixelLab generations this option would spend, when it spends any.</summary>
    public int? Generations { get; set; }
}

/// <summary>Body of POST /api/bridge/requests/{id}/ask.</summary>
public class AiDecisionAskRequest
{
    public string Key { get; set; } = string.Empty;
    public string Question { get; set; } = string.Empty;
    public List<AiDecisionOption> Options { get; set; } = new();
}
