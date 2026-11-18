using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The order status must change in the same write that ends a queued run, so a reader never sees a finished
/// draft whose order still says Claude is working.
/// </summary>
public sealed class AiOrderStatusCompletionTests
{
    [Fact]
    public async Task CompleteQueued_ReadyDraft_WritesSubmittedInTheSameUpdate()
    {
        await WithRunningDraftAsync(async (db, coordinator, running) =>
        {
            await db.AiCaseDrafts.UpdateOneAsync(item => item.Id == running.Id,
                Builders<AiCaseDraft>.Update.Set(item => item.Status, AiDraftStatus.ReadyToPublish));

            Assert.True(await coordinator.CompleteQueuedAsync(running));

            var saved = await db.AiCaseDrafts.Find(item => item.Id == running.Id).FirstAsync();
            Assert.Equal(AiQueueStates.None, saved.QueueState);
            Assert.Equal(AiOrderStatuses.Submitted, saved.OrderStatus);
            Assert.Equal(AiOrderStatuses.Submitted, saved.OrderStatusHistory.Last().Status);
        });
    }

    [Fact]
    public async Task CompleteQueued_FailedRun_WritesAwaitingGateInTheSameUpdate()
    {
        await WithRunningDraftAsync(async (db, coordinator, running) =>
        {
            Assert.True(await coordinator.CompleteQueuedAsync(running, "AI_GENERATION_FAILED"));

            var saved = await db.AiCaseDrafts.Find(item => item.Id == running.Id).FirstAsync();
            Assert.Equal(AiDraftStatus.CaseTruthInvalid, saved.Status);
            Assert.Equal(AiOrderStatuses.AwaitingGate, saved.OrderStatus);
            Assert.Equal(AiOrderStatuses.AwaitingGate, saved.OrderStatusHistory.Last().Status);
        });
    }

    private static async Task WithRunningDraftAsync(
        Func<MongoDbContext, AiDraftWorkflowCoordinator, AiCaseDraft, Task> body)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true",
                StringComparison.OrdinalIgnoreCase))
            return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);
        try
        {
            await db.PingAsync();
            var draft = new AiCaseDraft
            {
                Id = ObjectId.GenerateNewId().ToString(),
                Status = AiDraftStatus.StoryAwaitingApproval,
                OrderStatus = AiOrderStatuses.ClaudeWorking,
                WorkflowVersion = 1
            };
            await db.AiCaseDrafts.InsertOneAsync(draft);
            var coordinator = new AiDraftWorkflowCoordinator(db, TimeProvider.System);
            var queued = await coordinator.EnqueueAsync(
                draft,
                [AiDraftStatus.StoryAwaitingApproval],
                AiDraftStatus.GeneratingCaseTruth,
                AiQueuedOperations.CaseTruth,
                "CASE_TRUTH");
            Assert.True(queued.Acquired);
            var running = await coordinator.ClaimNextQueuedAsync();
            Assert.NotNull(running);
            await body(db, coordinator, running!);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }
}
