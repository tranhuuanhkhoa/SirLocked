using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public sealed record GameplayContext(GameRoom Room, GameCase Case, RoomPlayer Player);

public interface IGameplayContextLoader
{
    Task<GameplayContext> LoadAsync(
        string userId,
        string roomId,
        bool requireInProgress,
        CancellationToken cancellationToken = default);
}
