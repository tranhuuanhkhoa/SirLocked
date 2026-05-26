using SirLocked.API.DTOs.Admin;
using SirLocked.API.DTOs.Room;

namespace SirLocked.API.Services;

public sealed class AdminService : IAdminService
{
    private readonly IRoomService _roomService;

    public AdminService(IRoomService roomService)
    {
        _roomService = roomService;
    }

    public Task<AdminDashboardResponse> GetDashboardAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new AdminDashboardResponse());
    }

    public async Task<IReadOnlyList<RoomResponse>> GetRoomsAsync(CancellationToken cancellationToken = default)
    {
        return await _roomService.GetRecentAsync(cancellationToken);
    }
}
