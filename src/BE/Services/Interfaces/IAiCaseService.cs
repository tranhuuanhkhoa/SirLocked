using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.DTOs.Case;

namespace SirLocked.Api.Services.Interfaces;

public interface IAiCaseService
{
    Task<AiDraftResponse> GenerateAsync(GenerateAiCaseRequest request);
    Task<List<AiDraftResponse>> GetDraftsAsync();
    Task<AiDraftResponse> GetDraftAsync(string draftId);
    Task<CaseSummaryResponse> ImportDraftAsync(string draftId, bool overwrite, bool publish);
}
