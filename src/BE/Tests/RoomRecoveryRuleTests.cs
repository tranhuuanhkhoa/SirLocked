using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class RoomRecoveryRuleTests
{
    private static readonly DateTime Now = new(2026, 7, 18, 12, 0, 0, DateTimeKind.Utc);
    private static readonly GameRoom RunningRoom = new()
    {
        Status = RoomStatus.InProgress,
        GameplayState = new GameplayState { StartedAt = Now.AddHours(-1) }
    };

    [Fact]
    public void ConnectedTeammate_CannotBeAbandoned() =>
        Assert.False(RoomRecoveryRules.CanAbandon(RunningRoom, new RoomPlayer
        {
            IsConnected = true,
            DisconnectedAt = Now.AddMinutes(-5)
        }, Now));

    [Fact]
    public void DisconnectInsideGracePeriod_CannotBeAbandoned() =>
        Assert.False(RoomRecoveryRules.CanAbandon(RunningRoom, new RoomPlayer
        {
            IsConnected = false,
            DisconnectedAt = Now.AddSeconds(-299)
        }, Now));

    [Fact]
    public void DisconnectAfterGracePeriod_CanBeAbandoned() =>
        Assert.True(RoomRecoveryRules.CanAbandon(RunningRoom, new RoomPlayer
        {
            IsConnected = false,
            DisconnectedAt = Now.AddSeconds(-300)
        }, Now));

    [Fact]
    public void LobbyDisconnectStartsItsGraceAtMatchStart()
    {
        var player = new RoomPlayer { DisconnectedAt = Now.AddHours(-1) };
        Assert.Equal(Now.AddMinutes(5), RoomRecoveryRules.ReconnectDeadline(player, Now));
    }

    [Fact]
    public void MissingDisconnectTimestampUsesMatchStart()
    {
        Assert.Equal(Now.AddMinutes(5), RoomRecoveryRules.ReconnectDeadline(new RoomPlayer(), Now));
        Assert.Null(RoomRecoveryRules.ReconnectDeadline(new RoomPlayer(), null));
    }

    [Fact]
    public void PlayerProjectionExposesOnlyRunningOfflineDeadline()
    {
        var player = new RoomPlayer { DisconnectedAt = Now.AddMinutes(-2) };
        Assert.Equal(Now.AddMinutes(3), RoomPlayerDto.From(player, Now.AddHours(-1)).ReconnectGraceEndsAt);
        player.IsConnected = true;
        Assert.Null(RoomPlayerDto.From(player, Now.AddHours(-1)).ReconnectGraceEndsAt);
    }
}
