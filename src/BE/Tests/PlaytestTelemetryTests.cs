using Microsoft.Extensions.Logging.Abstractions;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class PlaytestTelemetryTests
{
    private const string Key = "playtest-pseudonym-key-0123456789";
    private static readonly DateTime Origin = new(2026, 7, 27, 9, 0, 0, DateTimeKind.Utc);

    // ----- Pseudonymizer -----

    [Fact]
    public void Pseudonymizer_IsStableForTheSameRoomAndUser()
    {
        var first = new PlaytestPseudonymizer(Key);
        var second = new PlaytestPseudonymizer(Key);

        Assert.Equal(first.SessionPseudonym("room-1"), second.SessionPseudonym("room-1"));
        Assert.Equal(first.UserHash("room-1", "user-1"), second.UserHash("room-1", "user-1"));
    }

    [Fact]
    public void Pseudonymizer_KeepsTheSameUserUnlinkableAcrossRooms()
    {
        var pseudonymizer = new PlaytestPseudonymizer(Key);

        Assert.NotEqual(pseudonymizer.UserHash("room-1", "user-1"), pseudonymizer.UserHash("room-2", "user-1"));
        Assert.NotEqual(pseudonymizer.SessionPseudonym("room-1"), pseudonymizer.SessionPseudonym("room-2"));
    }

    [Fact]
    public void Pseudonymizer_EmitsFixedWidthValuesThatAreNotTheRawIdentifiers()
    {
        var pseudonymizer = new PlaytestPseudonymizer(Key);
        var session = pseudonymizer.SessionPseudonym("room-1");
        var user = pseudonymizer.UserHash("room-1", "user-1");

        Assert.Equal(PlaytestPseudonymizer.PseudonymLength, session.Length);
        Assert.Equal(PlaytestPseudonymizer.PseudonymLength, user.Length);
        Assert.DoesNotContain("room-1", session, StringComparison.Ordinal);
        Assert.DoesNotContain("user-1", user, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("too-short-key-31-characters-abc")]
    public void Pseudonymizer_RejectsKeysShorterThanTheMinimum(string key)
    {
        Assert.Throws<ArgumentException>(() => new PlaytestPseudonymizer(key));
    }

    // ----- Sink -----

    [Fact]
    public async Task Sink_StoresHashesOnlyAndStampsTheProvidedClock()
    {
        var store = new RecordingStore();
        var sink = NewSink(store);

        await sink.RecordAsync(
            "room-1", "user-1", PlayerRole.Interrogator, PlaytestEventType.WaitingEnded, 7,
            attemptId: "attempt-1", revision: 2, durationMs: 1500, count: 3);

        var record = Assert.Single(store.Records);
        Assert.Equal(new PlaytestPseudonymizer(Key).SessionPseudonym("room-1"), record.SessionPseudonym);
        Assert.Equal(new PlaytestPseudonymizer(Key).UserHash("room-1", "user-1"), record.UserHash);
        Assert.Equal(PlayerRole.Interrogator, record.Role);
        Assert.Equal(PlaytestEventType.WaitingEnded, record.EventType);
        Assert.Equal(7, record.StateVersion);
        Assert.Equal("attempt-1", record.AttemptId);
        Assert.Equal(2, record.Revision);
        Assert.Equal(1500, record.DurationMs);
        Assert.Equal(3, record.Count);
        Assert.Equal(Origin, record.Timestamp);
    }

    [Fact]
    public async Task Sink_SwallowsWriteFailuresSoGameplayCommandsNeverFail()
    {
        var sink = NewSink(new ThrowingStore());

        await sink.RecordAsync("room-1", "user-1", PlayerRole.Investigator, PlaytestEventType.SceneCompleted, 1, count: 2);
    }

    // ----- Range -----

    [Fact]
    public void ResolveRange_DefaultsToTheLastSevenDays()
    {
        var (from, to) = PlaytestSummaryService.ResolveRange(null, null, Origin);

        Assert.Equal(Origin, to);
        Assert.Equal(Origin.AddDays(-PlaytestSummaryService.DefaultRangeDays), from);
    }

    [Fact]
    public void ResolveRange_RejectsWindowsWiderThanTheCap()
    {
        var exception = Assert.Throws<ApiException>(() => PlaytestSummaryService.ResolveRange(
            Origin.AddDays(-(PlaytestSummaryService.MaxRangeDays + 1)), Origin, Origin));

        Assert.Equal(400, exception.StatusCode);
    }

    [Fact]
    public void ResolveRange_RejectsInvertedWindows()
    {
        var exception = Assert.Throws<ApiException>(() =>
            PlaytestSummaryService.ResolveRange(Origin, Origin.AddDays(-1), Origin));

        Assert.Equal(400, exception.StatusCode);
    }

    // ----- Summary -----

    [Fact]
    public void Summarize_OnAnEmptyRange_ReturnsZeroesWithoutDividingByZero()
    {
        var summary = PlaytestSummaryService.Summarize(Array.Empty<PlaytestEventRecord>());

        Assert.Equal(0, summary.SessionCount);
        Assert.Equal(0, summary.WaitingMsByRole[PlayerRole.Investigator]);
        Assert.Equal(0, summary.WaitingMsByRole[PlayerRole.Interrogator]);
        Assert.Null(summary.WaitingImbalancePct);
        Assert.Null(summary.MedianRevisionsPerAttempt);
        Assert.Null(summary.MedianStageMs);
        Assert.Empty(summary.HintCountByTier);
        Assert.Equal(0, summary.OptimisticRetryCount);
        Assert.Equal(0, summary.ReconnectRestoredCount);
        Assert.Equal(0, summary.ConfrontationOutcomes[nameof(PlaytestEventType.ResolvedCorrect)]);
    }

    [Fact]
    public void Summarize_SumsWaitingTimeByRoleAndReportsTheImbalance()
    {
        var events = new[]
        {
            Waiting("s1", PlayerRole.Investigator, 1000),
            Waiting("s1", PlayerRole.Investigator, 1000),
            Waiting("s1", PlayerRole.Interrogator, 5000),
            Waiting("s2", PlayerRole.Interrogator, 3000)
        };

        var summary = PlaytestSummaryService.Summarize(events);

        Assert.Equal(2, summary.SessionCount);
        Assert.Equal(2000, summary.WaitingMsByRole[PlayerRole.Investigator]);
        Assert.Equal(8000, summary.WaitingMsByRole[PlayerRole.Interrogator]);
        Assert.Equal(75d, summary.WaitingImbalancePct!.Value, 6);
    }

    [Fact]
    public void Summarize_LeavesTheImbalanceNullWhenOneRoleNeverWaited()
    {
        var summary = PlaytestSummaryService.Summarize(new[]
        {
            Waiting("s1", PlayerRole.Investigator, 4000)
        });

        Assert.Null(summary.WaitingImbalancePct);
    }

    [Fact]
    public void Summarize_TakesTheMedianStageGapWithinEachSession()
    {
        // s1 gaps: 1000ms, 3000ms; s2 gap: 2000ms → odd count, median 2000.
        var events = new[]
        {
            StageCompleted("s1", 0, Origin),
            StageCompleted("s1", 1, Origin.AddMilliseconds(1000)),
            StageCompleted("s1", 2, Origin.AddMilliseconds(4000)),
            StageCompleted("s2", 0, Origin),
            StageCompleted("s2", 1, Origin.AddMilliseconds(2000))
        };

        var summary = PlaytestSummaryService.Summarize(events);

        Assert.Equal(2000d, summary.MedianStageMs!.Value, 6);
    }

    [Fact]
    public void Summarize_AveragesTheTwoMiddleStageGapsWhenTheCountIsEven()
    {
        // Gaps: 1000ms, 3000ms → median 2000.
        var events = new[]
        {
            StageCompleted("s1", 0, Origin),
            StageCompleted("s1", 1, Origin.AddMilliseconds(1000)),
            StageCompleted("s1", 2, Origin.AddMilliseconds(4000))
        };

        var summary = PlaytestSummaryService.Summarize(events);

        Assert.Equal(2000d, summary.MedianStageMs!.Value, 6);
    }

    [Fact]
    public void Summarize_DoesNotBridgeStageGapsAcrossSessions()
    {
        var events = new[]
        {
            StageCompleted("s1", 0, Origin),
            StageCompleted("s2", 0, Origin.AddMilliseconds(999999))
        };

        Assert.Null(PlaytestSummaryService.Summarize(events).MedianStageMs);
    }

    [Fact]
    public void Summarize_CountsHintsByTier()
    {
        var events = new[]
        {
            HintUsed("s1", 1),
            HintUsed("s1", 1),
            HintUsed("s2", 3)
        };

        var summary = PlaytestSummaryService.Summarize(events);

        Assert.Equal(2, summary.HintCountByTier[1]);
        Assert.Equal(1, summary.HintCountByTier[3]);
        Assert.False(summary.HintCountByTier.ContainsKey(2));
    }

    [Fact]
    public void Summarize_TakesTheMedianOfTheHighestRevisionPerAttempt()
    {
        // Attempt maxima: 3, 1, 5 → median 3.
        var events = new[]
        {
            Revised("attempt-a", 1),
            Revised("attempt-a", 3),
            Revised("attempt-b", 1),
            Revised("attempt-c", 5)
        };

        Assert.Equal(3d, PlaytestSummaryService.Summarize(events).MedianRevisionsPerAttempt!.Value, 6);
    }

    [Fact]
    public void Summarize_CountsConfrontationOutcomesAndResilienceSignals()
    {
        var events = new[]
        {
            Simple("s1", PlaytestEventType.ResolvedCorrect),
            Simple("s1", PlaytestEventType.ResolvedIncorrect),
            Simple("s1", PlaytestEventType.ResolvedIncorrect),
            Simple("s1", PlaytestEventType.Cancelled),
            Simple("s1", PlaytestEventType.OptimisticRetry),
            Simple("s2", PlaytestEventType.ReconnectRestored),
            Simple("s2", PlaytestEventType.ReconnectRestored)
        };

        var summary = PlaytestSummaryService.Summarize(events);

        Assert.Equal(1, summary.ConfrontationOutcomes[nameof(PlaytestEventType.ResolvedCorrect)]);
        Assert.Equal(2, summary.ConfrontationOutcomes[nameof(PlaytestEventType.ResolvedIncorrect)]);
        Assert.Equal(1, summary.ConfrontationOutcomes[nameof(PlaytestEventType.Cancelled)]);
        Assert.Equal(1, summary.OptimisticRetryCount);
        Assert.Equal(2, summary.ReconnectRestoredCount);
    }

    [Fact]
    public void Summarize_SumsNotebookOpenTimeByRole()
    {
        var events = new[]
        {
            new PlaytestEventRecord
            {
                SessionPseudonym = "s1",
                Role = PlayerRole.Investigator,
                EventType = PlaytestEventType.PrivateNotebookClosed,
                DurationMs = 2500,
                Timestamp = Origin
            }
        };

        var summary = PlaytestSummaryService.Summarize(events);

        Assert.Equal(2500, summary.NotebookOpenMsByRole[PlayerRole.Investigator]);
        Assert.Equal(0, summary.NotebookOpenMsByRole[PlayerRole.Interrogator]);
    }

    // ----- Helpers -----

    private static MongoPlaytestEventSink NewSink(IPlaytestEventStore store) => new(
        store,
        new PlaytestPseudonymizer(Key),
        new FixedTimeProvider(Origin),
        NullLogger<MongoPlaytestEventSink>.Instance);

    private static PlaytestEventRecord Waiting(string session, string role, long durationMs) => new()
    {
        SessionPseudonym = session,
        Role = role,
        EventType = PlaytestEventType.WaitingEnded,
        DurationMs = durationMs,
        Timestamp = Origin
    };

    private static PlaytestEventRecord StageCompleted(string session, int stageIndex, DateTime timestamp) => new()
    {
        SessionPseudonym = session,
        Role = PlayerRole.Investigator,
        EventType = PlaytestEventType.StageCompleted,
        Count = stageIndex,
        Timestamp = timestamp
    };

    private static PlaytestEventRecord HintUsed(string session, int tier) => new()
    {
        SessionPseudonym = session,
        Role = PlayerRole.Investigator,
        EventType = PlaytestEventType.HintUsed,
        Count = tier,
        Timestamp = Origin
    };

    private static PlaytestEventRecord Revised(string attemptId, int revision) => new()
    {
        SessionPseudonym = "s1",
        Role = PlayerRole.Interrogator,
        EventType = PlaytestEventType.ProposalEdited,
        AttemptId = attemptId,
        Revision = revision,
        Timestamp = Origin
    };

    private static PlaytestEventRecord Simple(string session, PlaytestEventType eventType) => new()
    {
        SessionPseudonym = session,
        Role = PlayerRole.Investigator,
        EventType = eventType,
        Timestamp = Origin
    };

    private sealed class RecordingStore : IPlaytestEventStore
    {
        public List<PlaytestEventRecord> Records { get; } = new();

        public Task InsertAsync(PlaytestEventRecord record, CancellationToken cancellationToken)
        {
            Records.Add(record);
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingStore : IPlaytestEventStore
    {
        public Task InsertAsync(PlaytestEventRecord record, CancellationToken cancellationToken) =>
            throw new TimeoutException("MongoDB is unreachable.");
    }

    private sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;
    }
}
