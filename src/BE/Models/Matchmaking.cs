using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class MatchModes
{
    public const string Quick = "QUICK";
    /// <summary>Ranked pairs like Quick for now; the mode is still kept on the ticket and must match.</summary>
    public const string Ranked = "RANKED";
    public static readonly IReadOnlyList<string> All = [Quick, Ranked];
}

public static class MatchRolePreferences
{
    public const string Investigator = Enums.PlayerRole.Investigator;
    public const string Interrogator = Enums.PlayerRole.Interrogator;
    public const string Any = "ANY";
    public static readonly IReadOnlyList<string> All = [Investigator, Interrogator, Any];
}

public static class MatchCaseLengths
{
    /// <summary>≤ 20 minutes.</summary>
    public const string Short = "SHORT";
    /// <summary>About 35 minutes (21–45).</summary>
    public const string Medium = "MEDIUM";
    /// <summary>60+ minutes (anything above 45).</summary>
    public const string Long = "LONG";
    public static readonly IReadOnlyList<string> All = [Short, Medium, Long];
}

public static class MatchTicketStatuses
{
    /// <summary>In the queue, waiting for a partner.</summary>
    public const string Searching = "SEARCHING";
    /// <summary>Claimed by a match (forming, pending acceptance or creating the room).</summary>
    public const string Matched = "MATCHED";
    /// <summary>Terminal: the match produced a room.</summary>
    public const string RoomReady = "ROOM_READY";
    /// <summary>Terminal: the player cancelled the search or declined a match.</summary>
    public const string Cancelled = "CANCELLED";
    /// <summary>Terminal: the player stopped polling, or let a match time out without accepting.</summary>
    public const string Expired = "EXPIRED";

    public static bool IsActive(string status) => status is Searching or Matched;
}

public static class MatchStatuses
{
    /// <summary>Tickets are being claimed; invisible to players until it becomes PENDING.</summary>
    public const string Forming = "FORMING";
    /// <summary>Both tickets claimed; players have until ExpiresAt to accept.</summary>
    public const string Pending = "PENDING";
    /// <summary>Everyone accepted; exactly one caller won this transition and creates the room.</summary>
    public const string Confirmed = "CONFIRMED";
    public const string RoomReady = "ROOM_READY";
    public const string Declined = "DECLINED";
    public const string Expired = "EXPIRED";
    /// <summary>Forming failed (a ticket was taken or cancelled meanwhile); nobody was told.</summary>
    public const string Aborted = "ABORTED";
    /// <summary>The room could not be created (for example the case was unpublished); both requeued.</summary>
    public const string Failed = "FAILED";
}

/// <summary>One player's place in the matchmaking queue. A user has at most one active ticket.</summary>
[BsonIgnoreExtraElements]
public class MatchTicket
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Mode { get; set; } = MatchModes.Quick;
    public string PreferredRole { get; set; } = MatchRolePreferences.Any;
    public string CaseLength { get; set; } = MatchCaseLengths.Medium;
    public string Language { get; set; } = CaseLanguages.Vietnamese;
    public string Status { get; set; } = MatchTicketStatuses.Searching;
    /// <summary>True while SEARCHING or MATCHED; backs the one-active-ticket-per-user unique index.</summary>
    public bool IsActive { get; set; } = true;
    [BsonIgnoreIfNull]
    public string? MatchId { get; set; }
    [BsonIgnoreIfNull]
    public string? RoomId { get; set; }
    /// <summary>Queue position and elapsed-time origin; kept when a partner declines and the ticket is requeued.</summary>
    public DateTime SearchStartedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Refreshed by status polling; a SEARCHING ticket nobody polls any more is expired.</summary>
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    [BsonIgnoreIfNull]
    public string? EndReason { get; set; }
}

/// <summary>A proposed pairing of two tickets, accepted or declined by both players.</summary>
[BsonIgnoreExtraElements]
public class MatchProposal
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;
    public string Mode { get; set; } = MatchModes.Quick;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; }
    public string Language { get; set; } = CaseLanguages.Vietnamese;
    public string CaseLength { get; set; } = MatchCaseLengths.Medium;
    public string Status { get; set; } = MatchStatuses.Forming;
    public List<MatchPlayer> Players { get; set; } = new();
    public DateTime ExpiresAt { get; set; }
    [BsonIgnoreIfNull]
    public string? RoomId { get; set; }
    [BsonIgnoreIfNull]
    public string? RoomCode { get; set; }
    [BsonIgnoreIfNull]
    public string? DeclinedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class MatchPlayer
{
    public string UserId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string TicketId { get; set; } = string.Empty;
    public string PreferredRole { get; set; } = MatchRolePreferences.Any;
    /// <summary>INVESTIGATOR or INTERROGATOR, assigned when the match forms.</summary>
    public string Role { get; set; } = string.Empty;
    public bool Accepted { get; set; }
    public DateTime? AcceptedAt { get; set; }
}
