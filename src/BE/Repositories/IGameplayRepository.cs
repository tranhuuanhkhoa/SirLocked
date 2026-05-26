using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public interface IGameplayRepository
{
    Task AddActionLogAsync(GameActionLog log, CancellationToken cancellationToken = default);
    Task AddResultAsync(GameResult result, CancellationToken cancellationToken = default);
}
