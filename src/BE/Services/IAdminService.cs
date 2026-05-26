using SirLocked.API.DTOs.Admin;
using SirLocked.API.DTOs.Investigation;
using SirLocked.API.DTOs.Room;

namespace SirLocked.API.Services;

public interface IAdminService
{
    Task<AdminDashboardResponse> GetDashboardAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RoomResponse>> GetRoomsAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<AdminActionLogResponse>> GetActionLogsAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<GameResultResponse>> GetResultsAsync(CancellationToken cancellationToken = default);
}
