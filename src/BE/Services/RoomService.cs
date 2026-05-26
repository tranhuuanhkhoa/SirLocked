using SirLocked.API.DTOs.Room;
using SirLocked.API.Helpers;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class RoomService : IRoomService
{
    private readonly IRoomRepository _rooms;

    public RoomService(IRoomRepository rooms)
    {
        _rooms = rooms;
    }

    public async Task<RoomResponse> CreateAsync(CreateRoomRequest request, string userId, string fullName, CancellationToken cancellationToken = default)
    {
        var room = new GameRoom
        {
            CaseId = request.CaseId,
            HostUserId = userId,
            RoomCode = GenerateRoomCode(),
            Status = RoomStatuses.Waiting,
            Players =
            [
                new RoomPlayer
                {
                    UserId = userId,
                    FullName = fullName,
                    IsHost = true
                }
            ]
        };

        await _rooms.CreateAsync(room, cancellationToken);
        return Map(room);
    }

    public async Task<RoomResponse?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        var room = await _rooms.GetByIdAsync(id, cancellationToken);
        return room is null ? null : Map(room);
    }

    public async Task<RoomResponse?> JoinAsync(JoinRoomRequest request, string userId, string fullName, CancellationToken cancellationToken = default)
    {
        var room = await _rooms.GetByCodeAsync(request.RoomCode, cancellationToken);
        if (room is null || room.Players.Count >= 2)
        {
            return null;
        }

        if (room.Players.All(player => player.UserId != userId))
        {
            room.Players.Add(new RoomPlayer { UserId = userId, FullName = fullName });
            await _rooms.UpdateAsync(room, cancellationToken);
        }

        return Map(room);
    }

    public async Task<IReadOnlyList<RoomResponse>> GetRecentAsync(CancellationToken cancellationToken = default)
    {
        var rooms = await _rooms.GetRecentAsync(cancellationToken);
        return rooms.Select(Map).ToList();
    }

    private static string GenerateRoomCode()
    {
        return Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
    }

    private static RoomResponse Map(GameRoom room)
    {
        return new RoomResponse
        {
            Id = room.Id ?? string.Empty,
            RoomCode = room.RoomCode,
            CaseId = room.CaseId,
            HostUserId = room.HostUserId,
            Status = room.Status,
            Players = room.Players.Select(player => new RoomPlayerResponse
            {
                UserId = player.UserId,
                FullName = player.FullName,
                GameRole = player.GameRole,
                IsReady = player.IsReady,
                IsHost = player.IsHost
            }).ToList()
        };
    }
}
