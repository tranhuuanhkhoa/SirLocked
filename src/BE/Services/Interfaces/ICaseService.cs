using System.Text.Json;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface ICaseService
{
    Task<List<CaseSummaryResponse>> GetPublishedAsync();
    Task<CasePublicDetailResponse> GetPublicDetailAsync(string caseId);
    Task<List<CaseSummaryResponse>> GetAllForAdminAsync();
    Task<GameCase> GetCaseAsync(string caseId);
    Task<GameCase?> FindCaseAsync(string caseId);
    CaseValidationResponse ValidateJson(JsonElement caseJson);
    Task<CaseSummaryResponse> ImportJsonAsync(JsonElement caseJson, bool overwrite, bool preserveServerMetadata = false);
    Task<CaseSummaryResponse> PublishAsync(string caseId);
    Task<CaseSummaryResponse> UnpublishAsync(string caseId);
    Task<CaseSummaryResponse> SeedSampleAsync(bool publish);
    Task<List<CaseSummaryResponse>> SeedDemoAsync();
    Task<List<CaseSummaryResponse>> SeedCrackDemoAsync();

    GameCase ParseCase(JsonElement caseJson);
    GameCase ParseCase(string caseJson);
}
