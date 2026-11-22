using SirLocked.Api.Services.Observability;
using Xunit;

namespace SirLocked.Tests;

public sealed class RequestHealthWindowTests
{
    [Fact]
    public void RollsOutBucketsOlderThanFiveMinutes()
    {
        var time = new FixedTimeProvider(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
        var window = new RequestHealthWindow(time);
        window.Record(200);
        window.Record(503);
        Assert.Equal(new RequestHealthSnapshot(2, 0.5), window.Snapshot());

        time.Advance(TimeSpan.FromMinutes(5));
        Assert.Equal(new RequestHealthSnapshot(0, 0), window.Snapshot());
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan amount) => _now += amount;
    }
}
