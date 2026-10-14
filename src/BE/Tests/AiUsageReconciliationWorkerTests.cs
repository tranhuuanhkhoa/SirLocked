using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiUsageReconciliationWorkerTests
{
    [Fact]
    public async Task RetryPassGetsFreshScopeAndDoesNotStopAfterAnException()
    {
        var calls = new List<FakeReconciler>();
        await using var services = new ServiceCollection()
            .AddScoped<IAiRecordedUsageReconciler>(_ =>
            {
                var fake = new FakeReconciler { Fail = calls.Count == 0 };
                calls.Add(fake);
                return fake;
            }).BuildServiceProvider();
        var worker = new AiUsageReconciliationWorker(services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<AiUsageReconciliationWorker>.Instance);

        await worker.RunPassAsync(CancellationToken.None);
        await worker.RunPassAsync(CancellationToken.None);

        Assert.Equal(2, calls.Count);
        Assert.All(calls, item =>
        {
            Assert.Equal(1, item.Calls);
            Assert.Null(item.DraftId);
            Assert.True(item.Token.CanBeCanceled);
            Assert.True(item.Disposed);
        });
    }

    [Fact]
    public async Task HostCancellationStopsPassAndDisposesScope()
    {
        var fake = new FakeReconciler { WaitForCancellation = true };
        await using var services = new ServiceCollection()
            .AddScoped<IAiRecordedUsageReconciler>(_ => fake).BuildServiceProvider();
        var worker = new AiUsageReconciliationWorker(services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<AiUsageReconciliationWorker>.Instance);
        using var stop = new CancellationTokenSource();
        var pass = worker.RunPassAsync(stop.Token);
        await fake.Entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        stop.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pass);
        Assert.True(fake.Disposed);
    }

    private sealed class FakeReconciler : IAiRecordedUsageReconciler, IDisposable
    {
        public bool Fail { get; init; }
        public bool WaitForCancellation { get; init; }
        public int Calls { get; private set; }
        public string? DraftId { get; private set; }
        public CancellationToken Token { get; private set; }
        public bool Disposed { get; private set; }
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<int> ReconcileRecordedAsync(string? draftId = null, CancellationToken cancellationToken = default)
        {
            Calls++;
            DraftId = draftId;
            Token = cancellationToken;
            Entered.TrySetResult();
            if (WaitForCancellation) await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            if (Fail) throw new InvalidOperationException("Test database unavailable");
            return 0;
        }
        public void Dispose() => Disposed = true;
    }
}
