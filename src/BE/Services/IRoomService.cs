using SirLocked.API.DTOs.Room;

namespace SirLocked.API.Services;

public interface IRoomService
{
    Task<RoomResponse> CreateAsync(CreateRoomRequest request, string userId, string fullName, CancellationToken cancellationToken = default);
    Task<RoomResponse?> GetByIdAsync(string id, CancellationToken cancellationToken = default);
    Task<RoomResponse?> JoinAsync(JoinRoomRequest request, string userId, string fullName, CancellationToken cancellationToken = default);
    Task<RoomResponse?> SetReadyAsync(string roomId, string userId, ReadyRequest request, CancellationToken cancellationToken = default);
    Task<RoomResponse?> SelectRoleAsync(string roomId, string userId, SelectRoleRequest request, CancellationToken cancellationToken = default);
    Task<RoomResponse?> StartAsync(string roomId, string userId, CancellationToken cancellationToken = default);
    Task<RoomResponse?> LeaveAsync(string roomId, string userId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RoomResponse>> GetRecentAsync(CancellationToken cancellationToken = default);
}
