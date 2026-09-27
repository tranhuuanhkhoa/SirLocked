using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class RoomRecoveryRuleTests
{
    private static readonly DateTime Now = new(2026, 7, 18, 12, 0, 0, DateTimeKind.Utc);
    private static readonly TimeSpan Grace = TimeSpan.FromSeconds(30);

    [Fact]
    public void ConnectedTeammate_CannotBeAbandoned() =>
        Assert.False(RoomRecoveryRules.CanAbandon(new RoomPlayer
        {
            IsConnected = true,
            DisconnectedAt = Now.AddMinutes(-5)
        }, Now, Grace));

    [Fact]
    public void DisconnectInsideGracePeriod_CannotBeAbandoned() =>
        Assert.False(RoomRecoveryRules.CanAbandon(new RoomPlayer
        {
            IsConnected = false,
            DisconnectedAt = Now.AddSeconds(-29)
        }, Now, Grace));

    [Fact]
    public void DisconnectAfterGracePeriod_CanBeAbandoned() =>
        Assert.True(RoomRecoveryRules.CanAbandon(new RoomPlayer
        {
            IsConnected = false,
            DisconnectedAt = Now.AddSeconds(-30)
        }, Now, Grace));
}
