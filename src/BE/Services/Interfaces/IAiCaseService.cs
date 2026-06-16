using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.DTOs.Case;

namespace SirLocked.Api.Services.Interfaces;

public interface IAiCaseService
{
    Task<AiDraftResponse> CreatePreviewAsync(GenerateAiCaseRequest request);
    Task<AiDraftResponse> ApproveDraftAsync(string draftId);
    Task<AiDraftResponse> ContinueDraftAsync(string draftId);
    Task<AiDraftResponse> RegenerateAssetsAsync(string draftId);
    Task<List<AiDraftResponse>> GetDraftsAsync();
    Task<AiDraftResponse> GetDraftAsync(string draftId);
    Task<CaseSummaryResponse> ImportDraftAsync(string draftId, bool overwrite, bool publish);
}
