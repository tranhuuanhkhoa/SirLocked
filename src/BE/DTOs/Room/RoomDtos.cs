using System.ComponentModel.DataAnnotations;
using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.Room;

public class CreateRoomRequest
{
    [Required]
    public string CaseId { get; set; } = string.Empty;
}

public class JoinRoomRequest
{
    [Required]
    public string RoomCode { get; set; } = string.Empty;
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

    public static RoomPlayerDto From(RoomPlayer p) => new()
    {
        UserId = p.UserId,
        Username = p.Username,
        Role = p.Role,
        IsReady = p.IsReady,
        IsConnected = p.IsConnected,
        LastConnectedAt = p.LastConnectedAt,
        DisconnectedAt = p.DisconnectedAt
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
    public List<RoomPlayerDto> Players { get; set; } = new();
    public DateTime CreatedAt { get; set; }

    public static RoomResponse From(GameRoom room, string caseTitle) => new()
    {
        RoomId = room.Id,
        RoomCode = room.RoomCode,
        CaseId = room.CaseId,
        CaseTitle = caseTitle,
        HostUserId = room.HostUserId,
        Status = room.Status,
        Players = room.Players.Select(RoomPlayerDto.From).ToList(),
        CreatedAt = room.CreatedAt
    };
}
