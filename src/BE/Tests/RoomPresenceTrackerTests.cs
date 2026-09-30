using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class RoomPresenceTrackerTests
{
    private static readonly DateTime Now = new(2026, 9, 28, 0, 0, 0, DateTimeKind.Utc);
    private static TaskCompletionSource Barrier() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    [Fact]
    public async Task RapidReconnect_WaitsForOlderDisconnectPersistenceAndNotification()
    {
        var tracker = new RoomPresenceTracker();
        var writes = new List<bool>();
        Task Persist(RoomPresenceTransition transition) { writes.Add(transition.IsConnected); return Task.CompletedTask; }
        await tracker.RegisterAsync("room", "player", "old", Persist);
        var disconnectEntered = Barrier();
        var releaseDisconnect = Barrier();
        var disconnect = tracker.UnregisterAsync("room", "player", "old", async transition =>
        {
            disconnectEntered.SetResult();
            await releaseDisconnect.Task;
            await Persist(transition);
        });
        await disconnectEntered.Task;

        var reconnect = tracker.RegisterAsync("room", "player", "new", Persist);
        Assert.False(reconnect.IsCompleted);
        Assert.Equal(new[] { true }, writes);
        releaseDisconnect.SetResult();
        await Task.WhenAll(disconnect, reconnect);
        Assert.Equal(new[] { true, false, true }, writes);
    }

    [Fact]
    public async Task ClosingOneTab_LeavesOtherTabOnlineAndIgnoresStaleDuplicateDisconnect()
    {
        var tracker = new RoomPresenceTracker();
        var writes = new List<bool>();
        Task Persist(RoomPresenceTransition transition) { writes.Add(transition.IsConnected); return Task.CompletedTask; }
        Assert.True(await tracker.RegisterAsync("room", "player", "tab-a", Persist));
        Assert.False(await tracker.RegisterAsync("room", "player", "tab-b", Persist));
        Assert.False(await tracker.UnregisterAsync("room", "player", "tab-a", Persist));
        Assert.False(await tracker.UnregisterAsync("room", "player", "tab-a", Persist));
        Assert.Equal(new[] { true }, writes);
        Assert.True(await tracker.UnregisterAsync("room", "player", "tab-b", Persist));
        Assert.Equal(new[] { true, false }, writes);
    }

    [Fact]
    public async Task OfflineNotificationFailure_DoesNotSkipQueuedReconnectPersistence()
    {
        var tracker = new RoomPresenceTracker();
        var databaseOnline = false;
        Task Persist(RoomPresenceTransition transition) { databaseOnline = transition.IsConnected; return Task.CompletedTask; }
        await tracker.RegisterAsync("room", "player", "old", Persist);
        var release = Barrier();
        var disconnect = tracker.UnregisterAsync("room", "player", "old", async transition =>
        {
            await Persist(transition);
            await release.Task;
            throw new IOException("Notification failed after the database write");
        });
        var reconnect = tracker.RegisterAsync("room", "player", "new", Persist);
        Assert.False(databaseOnline);
        release.SetResult();
        await Assert.ThrowsAsync<IOException>(() => disconnect);
        Assert.True(await reconnect);
        Assert.True(databaseOnline);
    }

    [Fact]
    public async Task WaitingRegistrations_DoNotJoinAnOldDetachedConnectionSet()
    {
        var tracker = new RoomPresenceTracker();
        var writes = new List<bool>();
        Task Persist(RoomPresenceTransition transition) { writes.Add(transition.IsConnected); return Task.CompletedTask; }
        await tracker.RegisterAsync("room", "player", "old", Persist);
        var release = Barrier();
        var disconnect = tracker.UnregisterAsync("room", "player", "old", async transition =>
        {
            await release.Task;
            await Persist(transition);
        });
        var first = tracker.RegisterAsync("room", "player", "new-a", Persist);
        var second = tracker.RegisterAsync("room", "player", "new-b", Persist);
        release.SetResult();
        await Task.WhenAll(disconnect, first, second);
        Assert.Equal(new[] { true, false, true }, writes);
        Assert.False(await tracker.UnregisterAsync("room", "player", "new-a", Persist));
        Assert.True(await tracker.UnregisterAsync("room", "player", "new-b", Persist));
        Assert.Equal(new[] { true, false, true, false }, writes);
    }

    [Fact]
    public async Task IdempotentJoin_RechecksDeadlineWithoutDuplicatingOnlineWrites()
    {
        var tracker = new RoomPresenceTracker(() => Now);
        var writes = 0;
        var deadlineChecks = 0;
        Task Persist(RoomPresenceTransition _) { writes++; return Task.CompletedTask; }
        Task<bool> Check(DateTime now) { Assert.Equal(Now, now); deadlineChecks++; return Task.FromResult(true); }
        Assert.True(await tracker.RegisterAsync("room", "player", "tab", Persist, Check));
        Assert.False(await tracker.RegisterAsync("room", "player", "tab", Persist, Check));
        Assert.Equal(1, writes);
        Assert.Equal(2, deadlineChecks);
    }

    [Fact]
    public async Task ExpiredRoom_IsCheckedBeforeOnlinePersistenceAndDoesNotRegisterReturningSocket()
    {
        var tracker = new RoomPresenceTracker(() => Now);
        var writes = 0;
        Task Persist(RoomPresenceTransition _) { writes++; return Task.CompletedTask; }
        Assert.False(await tracker.RegisterAsync("room", "player", "late", Persist, _ => Task.FromResult(false)));
        Assert.False(await tracker.UnregisterAsync("room", "player", "late", Persist));
        Assert.Equal(0, writes);
        Assert.True(await tracker.RegisterAsync("room", "player", "valid", Persist, _ => Task.FromResult(true)));
        Assert.Equal(1, writes);
    }

    [Fact]
    public async Task FailedOnlinePersistence_CanBeRetriedByTheSameConnection()
    {
        var tracker = new RoomPresenceTracker();
        await Assert.ThrowsAsync<IOException>(() => tracker.RegisterAsync("room", "player", "tab",
            _ => throw new IOException("Database unavailable")));
        var writes = 0;
        Assert.True(await tracker.RegisterAsync("room", "player", "tab", _ => { writes++; return Task.CompletedTask; }));
        Assert.Equal(1, writes);
    }

    [Fact]
    public async Task DeadlineCrossedAtOnlineWrite_DoesNotRetainTheRejectedConnection()
    {
        var tracker = new RoomPresenceTracker();
        Assert.False(await tracker.TryRegisterAsync("room", "player", "late", _ => Task.FromResult(false),
            _ => Task.FromResult(true)));
        var offlineWrites = 0;
        Assert.False(await tracker.UnregisterAsync("room", "player", "late", _ =>
        {
            offlineWrites++;
            return Task.CompletedTask;
        }));
        Assert.Equal(0, offlineWrites);
    }

    [Fact]
    public async Task CancelledPendingJoin_DoesNotLeaveAGhostConnectionOrBreakTheNextJoin()
    {
        var tracker = new RoomPresenceTracker();
        var writes = new List<bool>();
        Task Persist(RoomPresenceTransition transition) { writes.Add(transition.IsConnected); return Task.CompletedTask; }
        await tracker.RegisterAsync("room", "player", "old", Persist);
        var release = Barrier();
        var disconnect = tracker.UnregisterAsync("room", "player", "old", async transition =>
        {
            await release.Task;
            await Persist(transition);
        });
        using var cancellation = new CancellationTokenSource();
        var cancelledJoin = tracker.RegisterAsync("room", "player", "cancelled", Persist,
            cancellationToken: cancellation.Token);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelledJoin);
        release.SetResult();
        await disconnect;
        Assert.True(await tracker.RegisterAsync("room", "player", "new", Persist));
        Assert.True(await tracker.UnregisterAsync("room", "player", "new", Persist));
        Assert.Equal(new[] { true, false, true, false }, writes);
    }

    [Fact]
    public async Task AnotherPlayersPresence_IsNotBlockedBySlowPersistence()
    {
        var tracker = new RoomPresenceTracker();
        var release = Barrier();
        var slow = tracker.RegisterAsync("room", "slow-player", "slow", _ => release.Task);
        Assert.True(await tracker.RegisterAsync("room", "other-player", "other", _ => Task.CompletedTask));
        Assert.True(await tracker.RegisterAsync("other-room", "slow-player", "other-room", _ => Task.CompletedTask));
        Assert.False(slow.IsCompleted);
        release.SetResult();
        await slow;
    }

    [Fact]
    public async Task DisconnectTimestamp_IsCapturedWhenItsSerializedTransitionBegins()
    {
        var now = Now;
        var tracker = new RoomPresenceTracker(() => now);
        var release = Barrier();
        var join = tracker.RegisterAsync("room", "player", "tab", _ => release.Task);
        DateTime? disconnectedAt = null;
        var disconnect = tracker.UnregisterAsync("room", "player", "tab", transition =>
        {
            disconnectedAt = transition.ChangedAt;
            return Task.CompletedTask;
        });
        now = Now.AddSeconds(2);
        release.SetResult();
        await Task.WhenAll(join, disconnect);
        Assert.Equal(now, disconnectedAt);
    }
}
