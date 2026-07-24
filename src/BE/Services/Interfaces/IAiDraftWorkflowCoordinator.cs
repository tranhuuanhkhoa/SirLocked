using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public sealed record AiGenerationClaim(AiCaseDraft Draft, bool Acquired);

public interface IAiDraftWorkflowCoordinator
{
    bool IsLeaseExpired(AiCaseDraft draft);

    Task<AiGenerationClaim> ClaimAsync(
        AiCaseDraft observedDraft,
        IReadOnlyCollection<string> expectedStatuses,
        string claimedStatus,
        string phase,
        CancellationToken cancellationToken = default);

    Task<AiGenerationClaim> EnqueueAsync(
        AiCaseDraft observedDraft,
        IReadOnlyCollection<string> expectedStatuses,
        string generatingStatus,
        string operation,
        string phase,
        CancellationToken cancellationToken = default);

    Task<AiCaseDraft?> ClaimNextQueuedAsync(CancellationToken cancellationToken = default);

    Task BackfillLegacyGeneratingDraftsAsync(CancellationToken cancellationToken = default);

    Task<bool> CompleteQueuedAsync(
        AiCaseDraft draft,
        string? errorCode = null,
        CancellationToken cancellationToken = default);

    Task<bool> ScheduleRetryAsync(
        AiCaseDraft draft,
        DateTime nextAttemptAt,
        string errorCode,
        CancellationToken cancellationToken = default);

    Task<bool> HeartbeatAsync(AiCaseDraft draft, CancellationToken cancellationToken = default);
}
