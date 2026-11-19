using System.ComponentModel.DataAnnotations;

namespace SirLocked.Api.DTOs.Matchmaking;

public class EnqueueMatchRequest
{
    /// <summary>QUICK or RANKED.</summary>
    [MaxLength(16)]
    public string? Mode { get; set; }

    /// <summary>INVESTIGATOR, INTERROGATOR or ANY.</summary>
    [MaxLength(16)]
    public string? PreferredRole { get; set; }

    /// <summary>SHORT (≤ 20 min), MEDIUM (~35 min) or LONG (60+ min).</summary>
    [MaxLength(16)]
    public string? CaseLength { get; set; }

    /// <summary>vi or en.</summary>
    [MaxLength(8)]
    public string? Language { get; set; }
}

/// <summary>
/// The caller's matchmaking state, personalised: "you" and "partner" are relative to the caller.
/// Phase is IDLE, SEARCHING, FOUND (accept or decline before ExpiresAt), ACCEPTED (waiting for the
/// partner or for the room), READY (go to RoomId) or ENDED (see EndReason).
/// </summary>
public class MatchmakingStatusResponse
{
    public string Phase { get; set; } = MatchmakingPhases.Idle;
    public string? TicketId { get; set; }
    public string? Mode { get; set; }
    public string? PreferredRole { get; set; }
    public string? CaseLength { get; set; }
    public string? Language { get; set; }
    public DateTime? SearchStartedAt { get; set; }
    public MatchSummaryDto? Match { get; set; }
    public string? RoomId { get; set; }
    /// <summary>DECLINED_BY_YOU, DECLINED_BY_PARTNER, TIMEOUT, PARTNER_TIMEOUT, CANCELLED, STALE, ROOM_FAILED.</summary>
    public string? EndReason { get; set; }
    /// <summary>Lets the client derive countdowns without trusting its own clock.</summary>
    public DateTime ServerTime { get; set; }
}

public class MatchSummaryDto
{
    public string MatchId { get; set; } = string.Empty;
    public string Mode { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; }
    public string Language { get; set; } = string.Empty;
    public string YourRole { get; set; } = string.Empty;
    public bool YouAccepted { get; set; }
    public string PartnerUsername { get; set; } = string.Empty;
    public string PartnerRole { get; set; } = string.Empty;
    public bool PartnerAccepted { get; set; }
    public DateTime ExpiresAt { get; set; }
    public string Status { get; set; } = string.Empty;
}

public static class MatchmakingPhases
{
    public const string Idle = "IDLE";
    public const string Searching = "SEARCHING";
    public const string Found = "FOUND";
    public const string Accepted = "ACCEPTED";
    public const string Ready = "READY";
    public const string Ended = "ENDED";
}

public static class MatchEndReasons
{
    public const string DeclinedByYou = "DECLINED_BY_YOU";
    public const string DeclinedByPartner = "DECLINED_BY_PARTNER";
    public const string Timeout = "TIMEOUT";
    public const string PartnerTimeout = "PARTNER_TIMEOUT";
    public const string Cancelled = "CANCELLED";
    public const string Stale = "STALE";
    public const string RoomFailed = "ROOM_FAILED";
}
