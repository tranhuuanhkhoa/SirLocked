using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Room;

namespace SirLocked.Api.Services.Interfaces;

public interface IRoomService
{
    Task<RoomResponse> CreateAsync(CurrentUser user, string caseId, string? visibility = null);
    Task<List<PublicRoomResponse>> ListPublicAsync(string userId, PublicRoomQuery query, CancellationToken cancellationToken = default);
    /// <summary><paramref name="inviteToken"/> is the secret of a playtest invite link; ordinary rooms ignore it.</summary>
    Task<RoomResponse> JoinAsync(CurrentUser user, string roomCode, string? inviteToken = null);
    Task<RoomResponse> GetAsync(string userId, string roomId);
    Task<List<RoomResponse>> GetMineAsync(string userId, CancellationToken cancellationToken = default);
    Task<RoomResponse?> LeaveAsync(CurrentUser user, string roomId);
    Task<RoomResponse> SelectRoleAsync(CurrentUser user, string roomId, string role);
    Task<RoomResponse> SetReadyAsync(CurrentUser user, string roomId, bool isReady);
    Task<RoomResponse> StartAsync(CurrentUser user, string roomId);
    Task<RoomResponse> AbandonAsync(CurrentUser user, string roomId);
    /// <summary>"Chơi thử": the caller's private playtest room of an imported, unpublished AI draft.</summary>
    Task<RoomResponse> CreatePlaytestAsync(CurrentUser user, string draftId);
    /// <summary>Case Studio "Chơi thử cảnh này": the same room, starting both detectives in <paramref name="startSceneId"/>.</summary>
    Task<RoomResponse> CreatePlaytestAsync(CurrentUser user, string draftId, string? startSceneId) =>
        CreatePlaytestAsync(user, draftId);
    Task<bool> IsPlaytestMemberAsync(string userId, string roomId, string caseId);
}
