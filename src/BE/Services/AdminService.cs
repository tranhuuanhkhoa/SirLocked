using SirLocked.API.DTOs.Admin;
using SirLocked.API.DTOs.Investigation;
using SirLocked.API.DTOs.Room;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class AdminService : IAdminService
{
    private readonly IRoomService _roomService;
    private readonly IUserRepository _users;
    private readonly ICaseRepository _cases;
    private readonly IRoomRepository _rooms;
    private readonly IGameplayRepository _gameplay;

    public AdminService(
        IRoomService roomService,
        IUserRepository users,
        ICaseRepository cases,
        IRoomRepository rooms,
        IGameplayRepository gameplay)
    {
        _roomService = roomService;
        _users = users;
        _cases = cases;
        _rooms = rooms;
        _gameplay = gameplay;
    }

    public async Task<AdminDashboardResponse> GetDashboardAsync(CancellationToken cancellationToken = default)
    {
        return new AdminDashboardResponse
        {
            TotalUsers = await _users.CountAsync(cancellationToken),
            TotalCases = await _cases.CountAsync(cancellationToken),
            TotalRooms = await _rooms.CountAsync(cancellationToken),
            TotalResults = await _gameplay.CountResultsAsync(cancellationToken)
        };
    }

    public async Task<IReadOnlyList<RoomResponse>> GetRoomsAsync(CancellationToken cancellationToken = default)
    {
        return await _roomService.GetRecentAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<AdminActionLogResponse>> GetActionLogsAsync(CancellationToken cancellationToken = default)
    {
        var logs = await _gameplay.GetRecentActionLogsAsync(50, cancellationToken);
        return logs.Select(log => new AdminActionLogResponse
        {
            Id = log.Id ?? string.Empty,
            RoomId = log.RoomId,
            UserId = log.UserId,
            ActionType = log.ActionType,
            PayloadJson = log.PayloadJson,
            CreatedAt = log.CreatedAt
        }).ToList();
    }

    public async Task<IReadOnlyList<GameResultResponse>> GetResultsAsync(CancellationToken cancellationToken = default)
    {
        var results = await _gameplay.GetRecentResultsAsync(50, cancellationToken);
        return results.Select(MapResult).ToList();
    }

    public static GameResultResponse MapResult(SirLocked.API.Models.GameResult result)
    {
        return new GameResultResponse
        {
            ResultId = result.Id ?? string.Empty,
            RoomId = result.RoomId,
            CaseId = result.CaseId,
            SubmittedByUserId = result.SubmittedByUserId,
            Success = result.Success,
            Message = result.Success ? "Solved" : "Not solved",
            CorrectCulpritId = string.Empty,
            CorrectMotive = string.Empty,
            CorrectMethod = string.Empty,
            CompletedAt = result.CompletedAt
        };
    }
}
