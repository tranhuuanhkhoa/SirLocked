using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>The autopilot's repair budget against a real MongoDB (a new draft has no autopilotRepairs field yet).</summary>
public sealed class MongoAiDraftAutopilotTests
{
    private static AiCaseDraft FailedTruth() => new()
    {
        Id = ObjectId.GenerateNewId().ToString(),
        Status = AiDraftStatus.CaseTruthInvalid,
        QueueState = AiQueueStates.None,
        OrderStatus = AiOrderStatuses.AwaitingGate,
        Order = new AiCaseOrder { ReviewMode = AiCaseReviewModes.Auto },
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow
    };

    [Fact]
    public async Task AFreshFailedDraft_IsSentForRepair_AndTheBudgetIsCounted()
    {
        await WithDatabase(async db =>
        {
            var draft = FailedTruth();
            await db.AiCaseDrafts.InsertOneAsync(draft);
            var raw = await db.Database.GetCollection<BsonDocument>(db.AiCaseDrafts.CollectionNamespace.CollectionName)
                .Find(new BsonDocument("_id", ObjectId.Parse(draft.Id))).SingleAsync();
            Assert.False(raw.Contains("autopilotRepairs")); // the state every new draft starts in

            var cases = Recorder.Create();
            var autopilot = new AiDraftAutopilot(db, cases, new AiDraftWorkflowCoordinator(db, TimeProvider.System),
                NullLogger<AiDraftAutopilot>.Instance);
            await autopilot.AdvanceAsync(draft.Id, CancellationToken.None);

            Assert.Equal([nameof(IAiCaseService.RepairTruthAsync)], ((Recorder)(object)cases).Calls);
            var stored = await db.AiCaseDrafts.Find(item => item.Id == draft.Id).SingleAsync();
            Assert.Equal(1, stored.AutopilotRepairs);
        });
    }

    [Fact]
    public async Task ASpentBudget_StopsTheRepairs()
    {
        await WithDatabase(async db =>
        {
            var draft = FailedTruth();
            draft.AutopilotRepairs = AiDraftAutopilot.MaxRepairs;
            await db.AiCaseDrafts.InsertOneAsync(draft);
            var cases = Recorder.Create();
            await new AiDraftAutopilot(db, cases, new AiDraftWorkflowCoordinator(db, TimeProvider.System),
                NullLogger<AiDraftAutopilot>.Instance).AdvanceAsync(draft.Id, CancellationToken.None);
            Assert.Empty(((Recorder)(object)cases).Calls);
        });
    }

    public class Recorder : DispatchProxy
    {
        public List<string> Calls { get; } = [];
        public static IAiCaseService Create() => Create<IAiCaseService, Recorder>();

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            Calls.Add(targetMethod!.Name);
            return Task.FromResult(new AiDraftResponse());
        }
    }

    private static async Task WithDatabase(Func<MongoDbContext, Task> check)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase)) return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_autopilot_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var client = new MongoClient(settings.ConnectionString);
        var db = new MongoDbContext(Options.Create(settings));
        try
        {
            await check(db);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }
}
