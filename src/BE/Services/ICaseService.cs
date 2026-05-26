using SirLocked.API.DTOs.Case;

namespace SirLocked.API.Services;

public interface ICaseService
{
    Task<IReadOnlyList<CaseListResponse>> GetPublishedAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<CaseListResponse>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<CaseDetailResponse?> GetByIdAsync(string id, CancellationToken cancellationToken = default);
    Task<CaseValidationResult> ValidateAsync(ImportCaseRequest request, CancellationToken cancellationToken = default);
    Task<CaseDetailResponse> ImportAsync(ImportCaseRequest request, CancellationToken cancellationToken = default);
    Task<CaseStatusResponse?> PublishAsync(string id, CancellationToken cancellationToken = default);
    Task<CaseStatusResponse?> UnpublishAsync(string id, CancellationToken cancellationToken = default);
    Task<CaseDetailResponse> SeedSampleAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<CaseDetailResponse>> SeedDemoCasesAsync(CancellationToken cancellationToken = default);
}
