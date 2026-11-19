using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>The bridge refuses a truth-stage answer that breaks the stage's rules and keeps the request open for a fix.</summary>
public sealed class MongoBridgeTruthStageCheckTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const string Run = "run-bridge-truth";

    private static (AiCaseDraft Draft, CaseTruthPackage Truth) PausedAtStatements()
    {
        var draft = new AiCaseDraft
        {
            Id = ObjectId.GenerateNewId().ToString(),
            Status = AiDraftStatus.GeneratingCaseTruth,
            QueueState = AiQueueStates.AwaitingClaude,
            QueuedOperation = AiQueuedOperations.CaseTruth,
            GenerationRunId = Run,
            OrderStatus = AiOrderStatuses.ClaudeWorking,
            Order = new AiCaseOrder { ReviewMode = AiCaseReviewModes.Auto },
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            Settings = new AiDraftSettings
            {
                PipelineVersion = AiPipelineVersions.OpenCoop1, Difficulty = "easy", Leaning = AiCaseLeanings.Balanced,
                StageCount = 1, IncludeCrackTheLie = true, MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
            },
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), Json)!;
        draft.CaseTruth = JsonSerializer.Deserialize<CaseTruthPackage>(JsonSerializer.Serialize(truth, Json), Json);
        draft.TruthCheckpointArtifact = CaseTruthArtifacts.Evidence;
        return (draft, truth);
    }

    private static AiBridgeService Bridge(MongoDbContext db, AiBridgeRequestStore store)
    {
        var truthService = new CaseTruthService();
        return new AiBridgeService(db, store, new AiDraftWorkflowCoordinator(db, TimeProvider.System),
            cases: null!, caseService: null!, new TruthStageRules(truthService, new GameplayProjectionPlanner(truthService)),
            cutscenes: null!, assetStorage: null!,
            Options.Create(new BridgeSettings { Key = "integration-bridge-key-0123456789abcdef" }),
            Options.Create(new AiGenerationSettings()), environment: null!, NullLogger<AiBridgeService>.Instance);
    }

    [Fact]
    public async Task AStatementWithoutAnEvent_IsRefusedAtSubmit_AndTheRequestStaysOpen()
    {
        await WithDatabase(async db =>
        {
            var (draft, truth) = PausedAtStatements();
            await db.AiCaseDrafts.InsertOneAsync(draft);
            var store = new AiBridgeRequestStore(db, TimeProvider.System);
            var request = await store.InsertPendingAsync(new AiBridgeRequest
            {
                OwnerType = AiBridgeOwnerTypes.CaseDraft, OwnerId = draft.Id, RequestKey = ObjectId.GenerateNewId().ToString(),
                GenerationRunId = Run, Step = "BuildStatements", SchemaVersion = AiGenerationSchemaVersions.StatementLedger,
                Kind = AiBridgeKinds.Json, Prompt = "p", SchemaJson = """{"type":"object"}"""
            });
            var required = truth.StatementLedger.First(item => item.ContradictedByTraceIds.Count > 0);
            required.EventIds.Clear();
            var answer = JsonSerializer.SerializeToElement(new { statementLedger = truth.StatementLedger }, Json);

            var result = await Bridge(db, store).SubmitAsync(request.Id, answer, CancellationToken.None);

            Assert.False(result.Accepted);
            Assert.Contains(result.Errors, error => error.Contains($"[ref: {required.StatementId}]"));
            var stored = await store.GetAsync(request.Id);
            Assert.Contains(stored!.Status, AiBridgeStatuses.Open);
            Assert.True(string.IsNullOrEmpty(stored.ResultJson));
        });
    }

    /// <summary>
    /// Run 8: the locked opportunity step holds a verified alibi that only the suspect's own unseen visit backs, an error
    /// only the whole-truth check at the proof graph finds. The proof graph cannot fix it, so the bridge takes the answer
    /// and leaves the error to the run and its repair instead of refusing it until the bot gives up.
    /// </summary>
    [Fact]
    public async Task AnErrorOfALockedEarlierStep_DoesNotMakeTheBridgeRefuseTheProofGraph()
    {
        await WithDatabase(async db =>
        {
            var (draft, truth) = PausedAtStatements();
            draft.TruthCheckpointArtifact = CaseTruthArtifacts.Statements;
            var saved = draft.CaseTruth!;
            var row = saved.OpportunityMatrix.First(item => item.CharacterId != saved.CoreTruth.CulpritId);
            var visit = saved.TrueTimeline.First(item => item.ActorId == row.CharacterId
                && item.WitnessIds.All(id => id == row.CharacterId)
                && saved.TraceLedger.All(trace => trace.SourceActionId != item.EventId));
            row.AlibiVerified = true;
            row.AlibiEventIds = [visit.EventId];
            await db.AiCaseDrafts.InsertOneAsync(draft);
            var store = new AiBridgeRequestStore(db, TimeProvider.System);
            var request = await store.InsertPendingAsync(new AiBridgeRequest
            {
                OwnerType = AiBridgeOwnerTypes.CaseDraft, OwnerId = draft.Id, RequestKey = ObjectId.GenerateNewId().ToString(),
                GenerationRunId = Run, Step = "BuildProofGraph", SchemaVersion = AiGenerationSchemaVersions.ProofGraph,
                Kind = AiBridgeKinds.Json, Prompt = "p", SchemaJson = """{"type":"object"}"""
            });
            var answer = JsonSerializer.SerializeToElement(
                new { proofGraph = truth.ProofGraph, redHerringLedger = truth.RedHerringLedger }, Json);

            var result = await Bridge(db, store).SubmitAsync(request.Id, answer, CancellationToken.None);

            Assert.True(result.Accepted, string.Join("\n", result.Errors));
            var stored = await store.GetAsync(request.Id);
            Assert.False(string.IsNullOrEmpty(stored!.ResultJson));
        });
    }

    private static async Task WithDatabase(Func<MongoDbContext, Task> check)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase)) return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_bridgetruth_{Guid.NewGuid():N}"
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
