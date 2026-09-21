using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Room;

namespace SirLocked.Api.Services.Interfaces;

public interface IRoomService
{
    Task<RoomResponse> CreateAsync(CurrentUser user, string caseId);
    Task<RoomResponse> JoinAsync(CurrentUser user, string roomCode);
    Task<RoomResponse> GetAsync(string userId, string roomId);
    Task<RoomResponse?> LeaveAsync(CurrentUser user, string roomId);
    Task<RoomResponse> SelectRoleAsync(CurrentUser user, string roomId, string role);
    Task<RoomResponse> SetReadyAsync(CurrentUser user, string roomId, bool isReady);
    Task<RoomResponse> StartAsync(CurrentUser user, string roomId);
    Task<RoomResponse> AbandonAsync(CurrentUser user, string roomId);
}
