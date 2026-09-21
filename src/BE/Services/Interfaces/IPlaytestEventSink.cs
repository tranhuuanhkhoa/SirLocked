using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface IPlaytestEventSink
{
    Task RecordAsync(
        string roomId,
        string userId,
        string role,
        PlaytestEventType eventType,
        long stateVersion,
        string? attemptId = null,
        int? revision = null,
        long? durationMs = null,
        int? count = null,
        CancellationToken cancellationToken = default);
}
