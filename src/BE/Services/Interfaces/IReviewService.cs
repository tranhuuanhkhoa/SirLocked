using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Review;

namespace SirLocked.Api.Services.Interfaces;

public interface IReviewService
{
    Task<ReviewEligibilityDto> CheckEligibilityAsync(CurrentUser user, string caseId, CancellationToken ct = default);
    Task<ReviewDto> SubmitReviewAsync(CurrentUser user, string caseId, SubmitReviewDto dto, CancellationToken ct = default);
    Task<ReviewPageDto> GetReviewsAsync(string caseId, int page, int pageSize, CancellationToken ct = default);
    Task<ReviewSummaryDto> GetSummaryAsync(string caseId, CancellationToken ct = default);
    Task<bool> DeleteOwnReviewAsync(string userId, string caseId, CancellationToken ct = default);
}
