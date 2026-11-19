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

    /// <summary>Parks a running operation until Claude answers <paramref name="requestId"/>. Not a failure.</summary>
    Task<bool> ParkAwaitingClaudeAsync(AiCaseDraft draft, string requestId, string step,
        CancellationToken cancellationToken = default);

    /// <summary>Puts the parked operation back in the queue with the same run id.</summary>
    Task<bool> ResumeAfterClaudeAsync(string draftId, string? requestId = null,
        CancellationToken cancellationToken = default);

    /// <summary>Safety net: resumes parked drafts whose request was answered while no resume happened.</summary>
    Task<int> ResumeAnsweredAsync(CancellationToken cancellationToken = default);

    /// <summary>Recomputes the order status from the workflow and records a change with its time.</summary>
    Task SyncOrderStatusAsync(string draftId, CancellationToken cancellationToken = default);
}
