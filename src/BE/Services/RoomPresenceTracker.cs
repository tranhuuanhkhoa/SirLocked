namespace SirLocked.Api.Services;

internal sealed record RoomPresenceTransition(bool IsConnected, DateTime ChangedAt);

/// <summary>
/// Serializes connection membership, persistence and notifications for one player in one room.
/// This registry is process-local: deploying several API processes requires shared presence leases.
/// </summary>
internal sealed class RoomPresenceTracker
{
    private sealed class Entry
    {
        internal readonly SemaphoreSlim Gate = new(1, 1);
        internal readonly HashSet<string> Connections = new(StringComparer.Ordinal);
        internal int References;
        internal bool OnlinePersisted;
    }

    private readonly object _entriesLock = new();
    private readonly Dictionary<(string RoomId, string UserId), Entry> _entries = new();
    private readonly Func<DateTime> _utcNow;

    internal RoomPresenceTracker(Func<DateTime>? utcNow = null) => _utcNow = utcNow ?? (() => DateTime.UtcNow);

    internal Task<bool> RegisterAsync(
        string roomId,
        string userId,
        string connectionId,
        Func<RoomPresenceTransition, Task> persistAndNotify,
        Func<DateTime, Task<bool>>? mayRegister = null,
        CancellationToken cancellationToken = default) =>
        TryRegisterAsync(roomId, userId, connectionId, async transition =>
        {
            await persistAndNotify(transition);
            return true;
        }, mayRegister, cancellationToken);

    internal Task<bool> TryRegisterAsync(
        string roomId,
        string userId,
        string connectionId,
        Func<RoomPresenceTransition, Task<bool>> persistAndNotify,
        Func<DateTime, Task<bool>>? mayRegister = null,
        CancellationToken cancellationToken = default) =>
        WithEntryAsync(roomId, userId, async entry =>
        {
            var now = _utcNow();
            // Run the timeout check even for idempotent joins, before clearing DisconnectedAt.
            if (mayRegister is not null && !await mayRegister(now)) return false;
            cancellationToken.ThrowIfCancellationRequested();
            entry.Connections.Add(connectionId);
            if (entry.OnlinePersisted) return false;
            if (!await persistAndNotify(new RoomPresenceTransition(true, now)))
            {
                entry.Connections.Remove(connectionId);
                return false;
            }
            // If persistence fails, an idempotent JoinRoom can retry it rather than staying invisible.
            entry.OnlinePersisted = true;
            return true;
        }, cancellationToken);

    internal Task<bool> UnregisterAsync(
        string roomId,
        string userId,
        string connectionId,
        Func<RoomPresenceTransition, Task> persistAndNotify) =>
        WithEntryAsync(roomId, userId, async entry =>
        {
            if (!entry.Connections.Remove(connectionId) || entry.Connections.Count != 0) return false;
            // Membership is already empty. Even if only the notification fails after Mongo was
            // updated, a queued reconnect must write online again instead of trusting this flag.
            entry.OnlinePersisted = false;
            await persistAndNotify(new RoomPresenceTransition(false, _utcNow()));
            return true;
        }, CancellationToken.None);

    private async Task<bool> WithEntryAsync(
        string roomId,
        string userId,
        Func<Entry, Task<bool>> action,
        CancellationToken cancellationToken)
    {
        var key = (roomId, userId);
        Entry entry;
        lock (_entriesLock)
        {
            if (!_entries.TryGetValue(key, out entry!)) _entries.Add(key, entry = new Entry());
            entry.References++;
        }

        var entered = false;
        try
        {
            await entry.Gate.WaitAsync(cancellationToken);
            entered = true;
            return await action(entry);
        }
        finally
        {
            if (entered) entry.Gate.Release();
            lock (_entriesLock)
            {
                entry.References--;
                // Waiters own a reference, so none can register into a removed/detached connection set.
                if (entry.References == 0 && entry.Connections.Count == 0)
                {
                    _entries.Remove(key);
                    entry.Gate.Dispose();
                }
            }
        }
    }
}
