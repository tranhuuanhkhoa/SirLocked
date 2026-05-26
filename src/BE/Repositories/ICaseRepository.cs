using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public interface ICaseRepository
{
    Task<IReadOnlyList<GameCase>> GetPublishedAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<GameCase>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<GameCase?> GetByIdAsync(string id, CancellationToken cancellationToken = default);
    Task CreateAsync(GameCase gameCase, CancellationToken cancellationToken = default);
    Task UpdateAsync(GameCase gameCase, CancellationToken cancellationToken = default);
    Task<long> CountAsync(CancellationToken cancellationToken = default);
    Task<bool> ExistsByCaseIdAsync(string caseId, CancellationToken cancellationToken = default);
}
