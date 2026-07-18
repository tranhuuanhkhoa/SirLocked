using System.Security.Cryptography;
using System.Text;
using MongoDB.Bson;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Local-audit-only sink. It never stores room IDs, user IDs, semantic clue IDs or content.
/// The per-process salt intentionally prevents correlation with another audit run.
/// </summary>
public sealed class MongoLocalPlaytestEventSink : IPlaytestEventSink
{
    private readonly MongoDbContext _db;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<MongoLocalPlaytestEventSink> _logger;
    private readonly byte[] _salt = RandomNumberGenerator.GetBytes(32);

    public MongoLocalPlaytestEventSink(
        MongoDbContext db,
        TimeProvider timeProvider,
        ILogger<MongoLocalPlaytestEventSink> logger)
    {
        V3LocalMongoSafetyGuard.EnsureSafe(db.Settings);
        _db = db;
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
        if (attemptId is not null && !Guid.TryParse(attemptId, out _))
        {
            throw new ArgumentException("Playtest attemptId must be a UUID.", nameof(attemptId));
        }
        if (durationMs is < 0 or > 3_600_000) throw new ArgumentOutOfRangeException(nameof(durationMs));
        if (count is < 0 or > 10_000) throw new ArgumentOutOfRangeException(nameof(count));

        var record = new PlaytestEventRecord
        {
            Id = ObjectId.GenerateNewId().ToString(),
            SessionPseudonym = Hash($"session:{roomId}"),
            UserHash = Hash($"user:{userId}"),
            Role = role,
            EventType = eventType,
            StateVersion = stateVersion,
            AttemptId = attemptId,
            Revision = revision,
            DurationMs = durationMs,
            Count = count,
            Timestamp = _timeProvider.GetUtcNow().UtcDateTime
        };

        try
        {
            await _db.PlaytestEvents.InsertOneAsync(record, cancellationToken: cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // Telemetry must never change an already-committed gameplay outcome.
            _logger.LogWarning(exception, "Local V3 playtest event could not be recorded.");
        }
    }

    private string Hash(string value)
    {
        using var hmac = new HMACSHA256(_salt);
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    }
}
