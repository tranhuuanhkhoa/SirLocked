using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public interface IAiCaseRepository
{
    Task CreateDraftAsync(AiCaseDraft draft, CancellationToken cancellationToken = default);
    Task<AiCaseDraft?> GetDraftAsync(string draftId, CancellationToken cancellationToken = default);
}
