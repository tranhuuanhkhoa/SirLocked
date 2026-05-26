using SirLocked.API.DTOs.Admin;

namespace SirLocked.API.Services;

public interface IAiCaseService
{
    Task<AiCaseDraftResponse> CreateDraftAsync(CreateAiCaseRequest request, CancellationToken cancellationToken = default);
}
