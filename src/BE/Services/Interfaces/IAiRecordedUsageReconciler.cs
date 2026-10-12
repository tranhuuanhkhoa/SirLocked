namespace SirLocked.Api.Services.Interfaces;

/// <summary>Settles known, durably recorded usage after a process interruption.</summary>
public interface IAiRecordedUsageReconciler
{
    Task<int> ReconcileRecordedAsync(string? draftId = null, CancellationToken cancellationToken = default);
}
