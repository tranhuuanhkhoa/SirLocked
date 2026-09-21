using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs;

namespace SirLocked.Api.Services.Interfaces;

public interface IAiCaseService
{
    AiCaseCapabilitiesResponse GetCapabilities();
    Task<AiDraftResponse> CreatePreviewAsync(CurrentUser user, GenerateAiCaseRequest request, string? idempotencyKey = null);
    Task<AiDraftResponse> CancelDraftAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> ApproveDraftAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> ApproveTruthAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> RepairTruthAsync(CurrentUser user, string draftId, RepairCaseTruthRequest request);
    Task<AiDraftResponse> AcceptTruthRepairAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> RejectTruthRepairAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> ApproveFullLogicAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> ApproveSceneLayoutAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> ContinueDraftAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> RepairFullLogicAsync(CurrentUser user, string draftId, RepairFullLogicRequest request);
    Task<AiDraftResponse> AcceptFullLogicRepairAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> RejectFullLogicRepairAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> RegenerateAssetsAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> RetryJsonAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> RegenerateFailedAssetsAsync(CurrentUser user, string draftId);
    Task<AiDraftResponse> ReplaceDraftJsonAsync(CurrentUser user, string draftId, ReplaceAiDraftJsonRequest request);
    Task<List<AiDraftResponse>> GetDraftsAsync(CurrentUser user);
    Task<AiDraftResponse> GetDraftAsync(CurrentUser user, string draftId);
    Task<CaseSummaryResponse> ImportDraftAsync(CurrentUser user, string draftId, bool overwrite, bool publish);
}
