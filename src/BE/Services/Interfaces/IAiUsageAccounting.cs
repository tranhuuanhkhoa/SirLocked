using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface IAiUsageAccounting
{
    Task<AiCallLease> BeforeCallAsync(string draftId, string step, string kind, string model,
        CancellationToken cancellationToken = default, decimal? reservationUsd = null, string? priceVersion = null);
    Task RecordAsync(AiCallLease lease, string? responseBody, int? statusCode,
        CancellationToken cancellationToken = default);
}
