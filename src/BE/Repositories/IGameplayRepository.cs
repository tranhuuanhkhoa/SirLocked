using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public interface IGameplayRepository
{
    Task AddActionLogAsync(GameActionLog log, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<GameActionLog>> GetRecentActionLogsAsync(int limit = 50, CancellationToken cancellationToken = default);
    Task AddResultAsync(GameResult result, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<GameResult>> GetRecentResultsAsync(int limit = 50, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<GameResult>> GetResultsByUserAsync(string userId, int limit = 50, CancellationToken cancellationToken = default);
    Task<long> CountResultsAsync(CancellationToken cancellationToken = default);
}
