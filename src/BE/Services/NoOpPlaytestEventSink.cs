using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class NoOpPlaytestEventSink : IPlaytestEventSink
{
    public Task RecordAsync(
        string roomId,
        string userId,
        string role,
        PlaytestEventType eventType,
        long stateVersion,
        string? attemptId = null,
        int? revision = null,
        long? durationMs = null,
        int? count = null,
        CancellationToken cancellationToken = default) => Task.CompletedTask;
}
