using System.Collections.Concurrent;

namespace SirLocked.Api.Services.Observability;

public sealed class OnlineConnections
{
    private readonly ConcurrentDictionary<string, int> _users = new(StringComparer.Ordinal);
    private long _connectionCount;

    public long ConnectionCount => Interlocked.Read(ref _connectionCount);
    public long DistinctUserCount => _users.Count;

    public void Connected(string userId)
    {
        if (string.IsNullOrWhiteSpace(userId)) return;
        _users.AddOrUpdate(userId, 1, static (_, count) => count + 1);
        Interlocked.Increment(ref _connectionCount);
    }

    public void Disconnected(string userId)
    {
        if (string.IsNullOrWhiteSpace(userId)) return;
        while (_users.TryGetValue(userId, out var count))
        {
            var updated = count - 1;
            var changed = updated == 0
                ? ((ICollection<KeyValuePair<string, int>>)_users).Remove(new KeyValuePair<string, int>(userId, count))
                : _users.TryUpdate(userId, updated, count);
            if (!changed) continue;
            Interlocked.Decrement(ref _connectionCount);
            return;
        }
    }
}
