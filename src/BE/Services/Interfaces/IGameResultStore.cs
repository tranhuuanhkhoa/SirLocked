using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface IGameResultStore
{
    Task<GameResult?> FindByRoomIdAsync(string roomId, CancellationToken cancellationToken = default);
    Task<GameResult> UpsertAsync(GameResult result, CancellationToken cancellationToken = default);
}
