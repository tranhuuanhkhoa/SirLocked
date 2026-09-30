using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class MongoPresentationStoreTests
{
    [Fact]
    public async Task GlobalLeaseHasOneOwnerAndOnlyThatOwnerCanReleaseIt()
    {
        if (!Enabled()) return;
        await WithDatabase(async store =>
        {
            var attempts = await Task.WhenAll(Enumerable.Range(0, 12).Select(async index =>
                (Owner: $"worker-{index}", Acquired: await store.AcquireLeaseAsync($"worker-{index}", DateTime.UtcNow))));
            var winner = Assert.Single(attempts, result => result.Acquired);
            await store.ReleaseLeaseAsync("not-the-owner");
            Assert.False(await store.AcquireLeaseAsync("next-worker", DateTime.UtcNow));
            Assert.True(await store.AcquireLeaseAsync(winner.Owner, DateTime.UtcNow));
            await store.ReleaseLeaseAsync(winner.Owner);
            Assert.True(await store.AcquireLeaseAsync("next-worker", DateTime.UtcNow));
        });
    }

    [Fact]
    public async Task ConcurrentSubmissionIntentHasExactlyOneWinningClaim()
    {
        if (!Enabled()) return;
        await WithDatabase(async store =>
        {
            await store.InsertJobAsync(new PresentationVideoJob { Id = "job", DraftId = "draft", Status = "QUEUED" });
            var snapshots = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => store.GetJobAsync("job")));
            var outcomes = await Task.WhenAll(snapshots.Select(async job =>
            {
                job!.Status = "PREPARING";
                job.SubmissionClaim = Guid.NewGuid().ToString("N");
                return await store.TryTransitionJobAsync(job, "QUEUED", null);
            }));
            Assert.Single(outcomes, acquired => acquired);
            var claimed = await store.GetJobAsync("job");
            Assert.Equal(1, claimed!.Revision);
            var stale = await store.GetJobAsync("job");
            claimed.Status = "SUBMITTING";
            Assert.True(await store.TryTransitionJobAsync(claimed, "PREPARING", claimed.SubmissionClaim));
            stale!.Status = "SUBMITTING";
            Assert.False(await store.TryTransitionJobAsync(stale, "PREPARING", stale.SubmissionClaim));
            Assert.Equal(2, (await store.GetJobAsync("job"))!.Revision);
        });
    }

    [Fact]
    public async Task StaleWorkerCannotEraseACommittedProviderRequestId()
    {
        if (!Enabled()) return;
        await WithDatabase(async store =>
        {
            await store.InsertJobAsync(new PresentationVideoJob { Id = "job", DraftId = "draft", Status = "SUBMITTING" });
            var stale = await store.GetJobAsync("job");
            var current = await store.GetJobAsync("job");
            current!.Status = "PENDING";
            current.ProviderRequestId = "durable-provider-id";
            await store.SaveJobAsync(current);
            stale!.Status = "FAILED";
            await Assert.ThrowsAsync<PresentationJobConflictException>(() => store.SaveJobAsync(stale));
            var stored = await store.GetJobAsync("job");
            Assert.Equal("PENDING", stored!.Status);
            Assert.Equal("durable-provider-id", stored.ProviderRequestId);
            Assert.Equal(1, stored.Revision);
        });
    }

    private static bool Enabled() => string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static async Task WithDatabase(Func<MongoPresentationStore, Task> test)
    {
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_presentation_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        await db.PingAsync();
        try { await test(new MongoPresentationStore(db)); }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await new MongoClient(settings.ConnectionString).DropDatabaseAsync(settings.DatabaseName);
        }
    }
}
