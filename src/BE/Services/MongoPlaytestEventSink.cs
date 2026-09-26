using Microsoft.Extensions.Logging;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>Narrow write seam so the sink can be exercised without a live MongoDB.</summary>
public interface IPlaytestEventStore
{
    Task InsertAsync(PlaytestEventRecord record, CancellationToken cancellationToken);
}

public sealed class MongoPlaytestEventStore : IPlaytestEventStore
{
    private readonly MongoDbContext _db;

    public MongoPlaytestEventStore(MongoDbContext db) => _db = db;

    public Task InsertAsync(PlaytestEventRecord record, CancellationToken cancellationToken) =>
        _db.PlaytestEvents.InsertOneAsync(record, cancellationToken: cancellationToken);
}

/// <summary>
/// Persists playtest events with hashed identifiers only. Telemetry is never allowed to fail a
/// gameplay command, so every write error is swallowed and logged at Warning.
/// </summary>
public sealed class MongoPlaytestEventSink : IPlaytestEventSink
{
    private readonly IPlaytestEventStore _store;
    private readonly PlaytestPseudonymizer _pseudonymizer;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<MongoPlaytestEventSink> _logger;

    public MongoPlaytestEventSink(
        IPlaytestEventStore store,
        PlaytestPseudonymizer pseudonymizer,
        TimeProvider timeProvider,
        ILogger<MongoPlaytestEventSink> logger)
    {
        _store = store;
        _pseudonymizer = pseudonymizer;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    public async Task RecordAsync(
        string roomId,
        string userId,
        string role,
        PlaytestEventType eventType,
        long stateVersion,
        string? attemptId = null,
        int? revision = null,
        long? durationMs = null,
        int? count = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var record = new PlaytestEventRecord
            {
                SessionPseudonym = _pseudonymizer.SessionPseudonym(roomId),
                UserHash = _pseudonymizer.UserHash(roomId, userId),
                Role = role,
                EventType = eventType,
                StateVersion = stateVersion,
                AttemptId = attemptId,
                Revision = revision,
                DurationMs = durationMs,
                Count = count,
                Timestamp = _timeProvider.GetUtcNow().UtcDateTime
            };
            await _store.InsertAsync(record, cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Playtest event {EventType} was not persisted; gameplay is unaffected.",
                eventType);
        }
    }
}
