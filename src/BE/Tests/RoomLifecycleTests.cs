using System.Reflection;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class RoomLifecycleTests
{
    private static readonly string[] AllStatuses =
    {
        RoomStatus.Waiting,
        RoomStatus.Ready,
        RoomStatus.InProgress,
        RoomStatus.Completed,
        RoomStatus.Abandoned
    };

    // Full 5x5 cartesian product, spelled out rather than derived: the table is the contract,
    // so a rule that quietly changes has to fail a row here.
    [Theory]
    [InlineData(RoomStatus.Waiting, RoomStatus.Waiting, true)]
    [InlineData(RoomStatus.Waiting, RoomStatus.Ready, true)]
    [InlineData(RoomStatus.Waiting, RoomStatus.InProgress, false)]
    [InlineData(RoomStatus.Waiting, RoomStatus.Completed, false)]
    [InlineData(RoomStatus.Waiting, RoomStatus.Abandoned, false)]
    [InlineData(RoomStatus.Ready, RoomStatus.Waiting, true)]
    [InlineData(RoomStatus.Ready, RoomStatus.Ready, true)]
    [InlineData(RoomStatus.Ready, RoomStatus.InProgress, true)]
    [InlineData(RoomStatus.Ready, RoomStatus.Completed, false)]
    [InlineData(RoomStatus.Ready, RoomStatus.Abandoned, false)]
    [InlineData(RoomStatus.InProgress, RoomStatus.Waiting, false)]
    [InlineData(RoomStatus.InProgress, RoomStatus.Ready, false)]
    [InlineData(RoomStatus.InProgress, RoomStatus.InProgress, false)]
    [InlineData(RoomStatus.InProgress, RoomStatus.Completed, true)]
    [InlineData(RoomStatus.InProgress, RoomStatus.Abandoned, true)]
    [InlineData(RoomStatus.Completed, RoomStatus.Waiting, false)]
    [InlineData(RoomStatus.Completed, RoomStatus.Ready, false)]
    [InlineData(RoomStatus.Completed, RoomStatus.InProgress, false)]
    [InlineData(RoomStatus.Completed, RoomStatus.Completed, false)]
    [InlineData(RoomStatus.Completed, RoomStatus.Abandoned, false)]
    [InlineData(RoomStatus.Abandoned, RoomStatus.Waiting, false)]
    [InlineData(RoomStatus.Abandoned, RoomStatus.Ready, false)]
    [InlineData(RoomStatus.Abandoned, RoomStatus.InProgress, false)]
    [InlineData(RoomStatus.Abandoned, RoomStatus.Completed, false)]
    [InlineData(RoomStatus.Abandoned, RoomStatus.Abandoned, false)]
    public void CanTransition_MatchesTheTable(string from, string to, bool expected) =>
        Assert.Equal(expected, RoomLifecycle.CanTransition(from, to));

    [Fact]
    public void TransitionTheory_CoversEveryOrderedPairExactlyOnce()
    {
        var pairs = TheoryPairs(nameof(CanTransition_MatchesTheTable));

        Assert.Equal(AllStatuses.Length * AllStatuses.Length, pairs.Count);
        Assert.Equal(pairs.Count, pairs.Distinct().Count());
        foreach (var from in AllStatuses)
        {
            foreach (var to in AllStatuses)
            {
                Assert.Contains((from, to), pairs);
            }
        }
    }

    [Fact]
    public void TerminalStatuses_AreCompletedAndAbandonedOnly()
    {
        Assert.True(RoomLifecycle.IsTerminal(RoomStatus.Completed));
        Assert.True(RoomLifecycle.IsTerminal(RoomStatus.Abandoned));
        Assert.False(RoomLifecycle.IsTerminal(RoomStatus.Waiting));
        Assert.False(RoomLifecycle.IsTerminal(RoomStatus.Ready));
        Assert.False(RoomLifecycle.IsTerminal(RoomStatus.InProgress));
    }

    [Fact]
    public void TerminalStatuses_HaveNoOutgoingTransition()
    {
        foreach (var from in AllStatuses.Where(RoomLifecycle.IsTerminal))
        {
            foreach (var to in AllStatuses)
            {
                Assert.False(RoomLifecycle.CanTransition(from, to), $"{from} -> {to} must stay refused.");
            }
        }
    }

    [Theory]
    [InlineData(RoomStatus.Waiting, true)]
    [InlineData(RoomStatus.Ready, true)]
    [InlineData(RoomStatus.InProgress, false)]
    [InlineData(RoomStatus.Completed, false)]
    [InlineData(RoomStatus.Abandoned, false)]
    public void AllowsLobbyMutation_MatchesTheTable(string status, bool expected) =>
        Assert.Equal(expected, RoomLifecycle.AllowsLobbyMutation(status));

    [Theory]
    [InlineData(RoomStatus.Waiting, false)]
    [InlineData(RoomStatus.Ready, true)]
    [InlineData(RoomStatus.InProgress, false)]
    [InlineData(RoomStatus.Completed, false)]
    [InlineData(RoomStatus.Abandoned, false)]
    public void AllowsStart_MatchesTheTable(string status, bool expected) =>
        Assert.Equal(expected, RoomLifecycle.AllowsStart(status));

    [Fact]
    public void StartableAndLobbyStatusSets_AgreeWithTheTransitionTable()
    {
        Assert.Equal(
            AllStatuses.Where(status => RoomLifecycle.CanTransition(status, RoomStatus.InProgress)).ToArray(),
            RoomLifecycle.StartableStatuses.ToArray());
        Assert.Equal(
            AllStatuses.Where(status => RoomLifecycle.CanTransition(status, RoomStatus.Waiting)).ToArray(),
            RoomLifecycle.LobbyStatuses.ToArray());
    }

    private static List<(string From, string To)> TheoryPairs(string methodName)
    {
        var method = typeof(RoomLifecycleTests).GetMethod(methodName)
            ?? throw new MissingMethodException(nameof(RoomLifecycleTests), methodName);
        return method.GetCustomAttributes<InlineDataAttribute>(inherit: false)
            .SelectMany(data => data.GetData(method))
            .Select(row => ((string)row[0]!, (string)row[1]!))
            .ToList();
    }
}
