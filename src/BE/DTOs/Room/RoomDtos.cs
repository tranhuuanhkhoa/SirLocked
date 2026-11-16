using System.ComponentModel.DataAnnotations;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.DTOs.Room;

public class CreateRoomRequest
{
    [Required]
    public string CaseId { get; set; } = string.Empty;

    /// <summary>PUBLIC or PRIVATE; omitted means PRIVATE so existing clients keep invite-only rooms.</summary>
    [MaxLength(16)]
    public string? Visibility { get; set; }
}

public class JoinRoomRequest
{
    [Required]
    public string RoomCode { get; set; } = string.Empty;

    /// <summary>The secret of a playtest invite link (<c>/join?code=…&amp;invite=…</c>); ignored by ordinary rooms.</summary>
    [MaxLength(128)]
    public string? InviteToken { get; set; }
}

/// <summary>What a member sees of a playtest room. The invite secret is shown only while nobody has claimed it.</summary>
public class RoomPlaytestDto
{
    public string DraftId { get; set; } = string.Empty;
    public bool InviteClaimed { get; set; }
    public string? InviteToken { get; set; }

    public static RoomPlaytestDto? From(RoomPlaytest? playtest) => playtest is null ? null : new()
    {
        DraftId = playtest.DraftId,
        InviteClaimed = !string.IsNullOrWhiteSpace(playtest.InvitedUserId),
        InviteToken = string.IsNullOrWhiteSpace(playtest.InvitedUserId) ? playtest.InviteToken : null
    };
}

public class SelectRoleRequest
{
    [Required]
    public string Role { get; set; } = string.Empty;
}

public class ReadyRequest
{
    public bool IsReady { get; set; } = true;
}

public class RoomPlayerDto
{
    public string UserId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string? Role { get; set; }
    public bool IsReady { get; set; }
    public bool IsConnected { get; set; }
    public DateTime? LastConnectedAt { get; set; }
    public DateTime? DisconnectedAt { get; set; }
    public DateTime? ReconnectGraceEndsAt { get; set; }
    // What others see of this detective. Filled in by RoomService from the server's own records.
    public int Level { get; set; } = 1;
    public string Avatar { get; set; } = CosmeticCatalog.DefaultAvatar;
    public string? AvatarUrl { get; set; }
    public string? FrameDefId { get; set; }
    public string TitleDefId { get; set; } = CosmeticCatalog.DefaultTitleDefId;
    public string EntranceDefId { get; set; } = CosmeticCatalog.DefaultEntranceDefId;

    public static RoomPlayerDto From(RoomPlayer p) => From(p, null);

    public static RoomPlayerDto From(RoomPlayer p, DateTime? matchStartedAt) => new()
    {
        UserId = p.UserId,
        Username = p.Username,
        Role = p.Role,
        IsReady = p.IsReady,
        IsConnected = p.IsConnected,
        LastConnectedAt = p.LastConnectedAt,
        DisconnectedAt = p.DisconnectedAt,
        ReconnectGraceEndsAt = RoomRecoveryRules.ReconnectDeadline(p, matchStartedAt)
    };
}

public class RoomResponse
{
    public string RoomId { get; set; } = string.Empty;
    public string RoomCode { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string HostUserId { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Visibility { get; set; } = RoomVisibility.Private;
    public List<RoomPlayerDto> Players { get; set; } = new();
    public DateTime CreatedAt { get; set; }
    /// <summary>Only on playtest rooms of unpublished AI drafts.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public RoomPlaytestDto? Playtest { get; set; }

    public static RoomResponse From(GameRoom room, string caseTitle) => new()
    {
        RoomId = room.Id,
        RoomCode = room.RoomCode,
        CaseId = room.CaseId,
        CaseTitle = caseTitle,
        HostUserId = room.HostUserId,
        Status = room.Status,
        Visibility = room.Visibility,
        Players = room.Players.Select(player => RoomPlayerDto.From(player,
            room.Status == RoomStatus.InProgress ? room.GameplayState?.StartedAt : null)).ToList(),
        CreatedAt = room.CreatedAt,
        Playtest = RoomPlaytestDto.From(room.Playtest)
    };
}

/// <summary>Query string of GET /api/rooms/public.</summary>
public class PublicRoomQuery
{
    /// <summary>vi, en, or empty/ALL for every language.</summary>
    [MaxLength(8)]
    public string? Language { get; set; }

    /// <summary>When true only rooms with a free seat are returned.</summary>
    public bool OpenOnly { get; set; }

    /// <summary>Matches the room code, the case title or the host name (case- and accent-insensitive).</summary>
    [MaxLength(64)]
    public string? Q { get; set; }

    [Range(1, 100)]
    public int Limit { get; set; } = 50;
}

/// <summary>One row of the public room table. Never carries gameplay state or other players' ids.</summary>
public class PublicRoomResponse
{
    public string RoomId { get; set; } = string.Empty;
    public string RoomCode { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; }
    public string Language { get; set; } = CaseLanguages.English;
    public string HostUsername { get; set; } = string.Empty;
    public int PlayerCount { get; set; }
    public int MaxPlayers { get; set; } = RoomService.MaxPlayers;
    /// <summary>WAITING (a seat is free) or IN_PROGRESS (shown as ĐANG CHƠI · ĐẦY).</summary>
    public string Status { get; set; } = string.Empty;
    public bool IsJoinable { get; set; }
    /// <summary>The caller already sits in this room; the client opens it instead of joining.</summary>
    public bool IsMember { get; set; }
    public DateTime CreatedAt { get; set; }
}
