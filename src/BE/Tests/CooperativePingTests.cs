using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class CooperativePingTests
{
    [Fact]
    public void ConcurrentConnectionsShareTheSameCooldown()
    {
        var policy = new CooperativePingPolicy();
        var accepted = 0;
        var now = DateTime.UtcNow;
        Parallel.For(0, 20, _ => { if (policy.TryAcquire("room", "user", now)) Interlocked.Increment(ref accepted); });
        Assert.Equal(1, accepted);
        Assert.False(policy.TryAcquire("room", "user", now.AddMilliseconds(2999)));
        Assert.True(policy.TryAcquire("room", "user", now.AddSeconds(3)));
        Assert.True(policy.TryAcquire("room", "partner", now));
    }

    [Fact]
    public void OnlyMembersOfLiveRoomsCanSendAnAllowlistedPing()
    {
        var room = new GameRoom { Status = RoomStatus.InProgress, Players = [new RoomPlayer { UserId = "member" }] };
        Assert.True(CooperativePingPolicy.CanSend(room, "member", "COMPARE"));
        Assert.False(CooperativePingPolicy.CanSend(room, "outsider", "COMPARE"));
        Assert.False(CooperativePingPolicy.CanSend(room, "member", "private-clue-id"));
        room.Status = RoomStatus.Completed;
        Assert.False(CooperativePingPolicy.CanSend(room, "member", "WAITING"));
        Assert.Equal(TimeSpan.FromSeconds(8), CooperativePingPolicy.Lifetime);
    }
}
