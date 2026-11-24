using Microsoft.Extensions.Logging.Abstractions;
using SirLocked.Api.Services.Activity;
using Xunit;

namespace SirLocked.Tests;

public sealed class UserActivityRecorderTests
{
    [Fact]
    public async Task WritesAtMostOncePerUserAndDayAndContinuesAfterPersistenceFailure()
    {
        var time = new FixedTimeProvider(new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero));
        var store = new CountingStore();
        var recorder = new UserActivityRecorder(store, time, NullLogger<UserActivityRecorder>.Instance);

        await recorder.TouchAsync("u1");
        await recorder.TouchAsync("u1");
        Assert.Single(store.Writes);

        store.FailNext = true;
        await recorder.TouchAsync("u2");
        await recorder.TouchAsync("u2");
        Assert.Equal(3, store.Writes.Count);

        time.Advance(TimeSpan.FromDays(1));
        await recorder.TouchAsync("u1");
        Assert.Equal(4, store.Writes.Count);
    }

    private sealed class CountingStore : IUserActivityStore
    {
        public List<(string UserId, string Day)> Writes { get; } = [];
        public bool FailNext { get; set; }

        public Task TouchAsync(string userId, string day, DateTime firstSeenAt, CancellationToken cancellationToken)
        {
            Writes.Add((userId, day));
            if (FailNext)
            {
                FailNext = false;
                throw new InvalidOperationException("test failure");
            }
            return Task.CompletedTask;
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan amount) => _now += amount;
    }
}
