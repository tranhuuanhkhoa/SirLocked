using System.Collections.Concurrent;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Activity;

public interface IUserActivityRecorder
{
    Task TouchAsync(string userId, CancellationToken cancellationToken = default);
}

public interface IUserActivityStore
{
    Task TouchAsync(string userId, string day, DateTime firstSeenAt, CancellationToken cancellationToken);
}

public sealed class MongoUserActivityStore(MongoDbContext db) : IUserActivityStore
{
    public Task TouchAsync(string userId, string day, DateTime firstSeenAt, CancellationToken cancellationToken) =>
        db.UserActivityDays.UpdateOneAsync(
            activity => activity.UserId == userId && activity.Day == day,
            Builders<UserActivityDay>.Update
                .SetOnInsert(activity => activity.UserId, userId)
                .SetOnInsert(activity => activity.Day, day)
                .SetOnInsert(activity => activity.FirstSeenAt, firstSeenAt),
            new UpdateOptions { IsUpsert = true },
            cancellationToken);
}

public sealed class UserActivityRecorder(
    IUserActivityStore store,
    TimeProvider timeProvider,
    ILogger<UserActivityRecorder> logger) : IUserActivityRecorder
{
    private readonly ConcurrentDictionary<(string UserId, string Day), byte> _recorded = new();
    private readonly object _dayGate = new();
    private string _currentDay = string.Empty;

    public async Task TouchAsync(string userId, CancellationToken cancellationToken = default)
    {
        string day;
        DateTime now;
        lock (_dayGate)
        {
            now = timeProvider.GetUtcNow().UtcDateTime;
            day = now.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
            if (_currentDay != day)
            {
                _recorded.Clear();
                _currentDay = day;
            }
            if (!_recorded.TryAdd((userId, day), 0)) return;
        }
        try
        {
            await store.TouchAsync(userId, day, now, cancellationToken);
        }
        catch (Exception exception)
        {
            _recorded.TryRemove((userId, day), out _);
            logger.LogWarning(exception, "Could not record user activity.");
        }
    }
}
