namespace SirLocked.API.DTOs.Room;

public sealed class CreateRoomRequest
{
    public string CaseId { get; init; } = string.Empty;
}

public sealed class JoinRoomRequest
{
    public string RoomCode { get; init; } = string.Empty;
}

public sealed class SelectRoleRequest
{
    public string GameRole { get; init; } = string.Empty;
}

public sealed class ReadyRequest
{
    public bool IsReady { get; init; }
}

public sealed class RoomResponse
{
    public string Id { get; init; } = string.Empty;
    public string RoomCode { get; init; } = string.Empty;
    public string CaseId { get; init; } = string.Empty;
    public string HostUserId { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public IReadOnlyList<RoomPlayerResponse> Players { get; init; } = [];
}

public sealed class RoomPlayerResponse
{
    public string UserId { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string? GameRole { get; init; }
    public bool IsReady { get; init; }
    public bool IsHost { get; init; }
}
