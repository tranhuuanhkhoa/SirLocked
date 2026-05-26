using SirLocked.API.DTOs.Admin;
using SirLocked.API.DTOs.Room;

namespace SirLocked.API.Services;

public interface IAdminService
{
    Task<AdminDashboardResponse> GetDashboardAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RoomResponse>> GetRoomsAsync(CancellationToken cancellationToken = default);
}
