using SirLocked.API.DTOs.Room;
using SirLocked.API.Helpers;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class RoomService : IRoomService
{
    private readonly IRoomRepository _rooms;
    private readonly ICaseRepository _cases;

    public RoomService(IRoomRepository rooms, ICaseRepository cases)
    {
        _rooms = rooms;
        _cases = cases;
    }

    public async Task<RoomResponse> CreateAsync(CreateRoomRequest request, string userId, string fullName, CancellationToken cancellationToken = default)
    {
        var gameCase = await _cases.GetByIdAsync(request.CaseId, cancellationToken)
            ?? throw new InvalidOperationException("Case not found.");

        if (!string.Equals(gameCase.Status, "PUBLISHED", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Only published cases can be used to create rooms.");
        }

        var firstStage = gameCase.Stages.OrderBy(stage => stage.Order).FirstOrDefault();
        var firstScene = firstStage?.Scenes.FirstOrDefault();

        var room = new GameRoom
        {
            CaseId = gameCase.CaseId,
            HostUserId = userId,
            RoomCode = GenerateRoomCode(),
            Status = RoomStatuses.Waiting,
            Progress = new RoomProgress
            {
                CurrentStageId = firstStage?.StageId ?? string.Empty,
                CurrentSceneId = firstScene?.SceneId ?? string.Empty
            },
            Players =
            [
                new RoomPlayer
                {
                    UserId = userId,
                    FullName = fullName,
                    GameRole = GameRoles.Investigator,
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
        if (room is null || room.Status != RoomStatuses.Waiting || room.Players.Count >= 2)
        {
            return null;
        }

        if (room.Players.All(player => player.UserId != userId))
        {
            room.Players.Add(new RoomPlayer
            {
                UserId = userId,
                FullName = fullName,
                GameRole = GameRoles.Interrogator
            });
            await _rooms.UpdateAsync(room, cancellationToken);
        }

        return Map(room);
    }

    public async Task<RoomResponse?> SetReadyAsync(string roomId, string userId, ReadyRequest request, CancellationToken cancellationToken = default)
    {
        var room = await _rooms.GetByIdAsync(roomId, cancellationToken);
        if (room is null || room.Status != RoomStatuses.Waiting)
        {
            return null;
        }

        var player = room.Players.FirstOrDefault(existing => existing.UserId == userId);
        if (player is null)
        {
            return null;
        }

        player.IsReady = request.IsReady;
        await _rooms.UpdateAsync(room, cancellationToken);
        return Map(room);
    }

    public async Task<RoomResponse?> SelectRoleAsync(string roomId, string userId, SelectRoleRequest request, CancellationToken cancellationToken = default)
    {
        var role = request.GameRole.Trim().ToUpperInvariant();
        if (role is not GameRoles.Investigator and not GameRoles.Interrogator)
        {
            throw new InvalidOperationException("Invalid game role.");
        }

        var room = await _rooms.GetByIdAsync(roomId, cancellationToken);
        if (room is null || room.Status != RoomStatuses.Waiting)
        {
            return null;
        }

        var player = room.Players.FirstOrDefault(existing => existing.UserId == userId);
        if (player is null || room.Players.Any(existing => existing.UserId != userId && existing.GameRole == role))
        {
            return null;
        }

        player.GameRole = role;
        await _rooms.UpdateAsync(room, cancellationToken);
        return Map(room);
    }

    public async Task<RoomResponse?> StartAsync(string roomId, string userId, CancellationToken cancellationToken = default)
    {
        var room = await _rooms.GetByIdAsync(roomId, cancellationToken);
        if (room is null || room.Status != RoomStatuses.Waiting)
        {
            return null;
        }

        if (room.HostUserId != userId)
        {
            throw new UnauthorizedAccessException("Only the host can start the room.");
        }

        if (!CanStart(room))
        {
            throw new InvalidOperationException("Room needs two ready players with different roles.");
        }

        room.Status = RoomStatuses.Playing;
        await _rooms.UpdateAsync(room, cancellationToken);
        return Map(room);
    }

    public async Task<RoomResponse?> LeaveAsync(string roomId, string userId, CancellationToken cancellationToken = default)
    {
        var room = await _rooms.GetByIdAsync(roomId, cancellationToken);
        if (room is null)
        {
            return null;
        }

        var player = room.Players.FirstOrDefault(existing => existing.UserId == userId);
        if (player is null)
        {
            return null;
        }

        room.Players.Remove(player);
        if (room.Players.Count == 0)
        {
            room.Status = RoomStatuses.Cancelled;
        }
        else if (room.HostUserId == userId)
        {
            var newHost = room.Players[0];
            newHost.IsHost = true;
            room.HostUserId = newHost.UserId;
        }

        await _rooms.UpdateAsync(room, cancellationToken);
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
            CurrentStageId = room.Progress.CurrentStageId,
            CurrentSceneId = room.Progress.CurrentSceneId,
            HostUserId = room.HostUserId,
            Status = room.Status,
            CanStart = CanStart(room),
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

    private static bool CanStart(GameRoom room)
    {
        return room.Status == RoomStatuses.Waiting
            && room.Players.Count == 2
            && room.Players.All(player => player.IsReady && !string.IsNullOrWhiteSpace(player.GameRole))
            && room.Players.Select(player => player.GameRole).Distinct(StringComparer.OrdinalIgnoreCase).Count() == 2;
    }
}
