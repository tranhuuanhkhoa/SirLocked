using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed partial class AiCaseWorkflowHostTests
{
    private static bool RunTruthRepairMongoTests => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    [Theory]
    [InlineData(AiDraftStatus.CaseTruthAwaitingApproval)]
    [InlineData(AiDraftStatus.CaseTruthInvalid)]
    [InlineData(AiDraftStatus.FullLogicAwaitingApproval)]
    public async Task TruthRepair_QueuesAtSupportedGatesWithoutDiscardingGameplay(string status)
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = TruthRepairDraft();
        draft.Status = status;
        draft.TruthRepairStatus = AiRepairStatus.None;
        draft.TruthRepairCandidate = null;
        await db.AiCaseDrafts.InsertOneAsync(draft);

        var response = await client.PostAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/repair-truth",
            new RepairCaseTruthRequest { RepairFromArtifact = CaseTruthArtifacts.Timeline, RepairInstructions = "Ground motive in observable evidence." });

        Assert.True(response.StatusCode == HttpStatusCode.Accepted, await response.Content.ReadAsStringAsync());
        var stored = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(status, stored.Status);
        Assert.Equal(AiQueuedOperations.TruthRepair, stored.QueuedOperation);
        Assert.Equal(AiQueueStates.Pending, stored.QueueState);
        Assert.Equal(draft.GeneratedJson, stored.GeneratedJson);
        Assert.Equal(draft.TruthHash, stored.TruthHash);
        Assert.Equal(draft.ProjectionContentHash, stored.ProjectionContentHash);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    [Fact]
    public async Task TruthRepair_AcceptFromGameplayInvalidatesAllDownstreamButKeepsAccounting()
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = TruthRepairDraft();
        await db.AiCaseDrafts.InsertOneAsync(draft);

        var response = await client.PostAsync($"/api/admin/ai-cases/{draft.Id}/accept-truth-repair", null);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var stored = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(AiDraftStatus.CaseTruthAwaitingApproval, stored.Status);
        Assert.Equal(AiRepairStatus.Accepted, stored.TruthRepairStatus);
        Assert.Null(stored.TruthRepairCandidate);
        Assert.Empty(stored.TruthRepairCandidateJson);
        Assert.Equal(CaseTruthReviewStatuses.Failed, stored.TruthReviewerResult.Status); // Advisory stays visible.
        Assert.Equal(new CaseTruthService().ComputeHash(stored.CaseTruth!), stored.TruthHash);
        Assert.Equal(CaseTruthArtifacts.ProofGraph, stored.TruthCheckpointArtifact);
        Assert.Null(stored.ProjectionPlan);
        Assert.Null(stored.CaseBlueprint);
        foreach (var value in new[] { stored.GeneratedJson, stored.OriginalGeneratedJson,
            stored.RepairedCandidateJson, stored.BlueprintJson, stored.BlueprintHash, stored.BlueprintSchemaVersion,
            stored.CrackContractHash, stored.ProjectionPlanJson, stored.ProjectionPlanHash, stored.ProjectionPlanSchemaVersion,
            stored.ProjectionContentSchemaVersion, stored.ProjectionContentJson, stored.ProjectionContentHash,
            stored.ProjectionBuildMode, stored.ProjectionCompilerVersion, stored.V3CrackContentJson, stored.V3CrackContentHash,
            stored.CaseId, stored.CaseTitle, stored.JsonFilePath, stored.JsonFolderPath, stored.LastGenerationErrorCode })
            Assert.Empty(value);
        Assert.Empty(stored.ValidationErrors);
        Assert.Empty(stored.RepairValidationReport);
        Assert.Empty(stored.BlueprintValidationErrors);
        Assert.Empty(stored.FailedAssetIds);
        Assert.Equal(AiRepairStatus.None, stored.RepairStatus);
        Assert.Equal(AiV3SemanticReviewStatuses.NotRun, stored.V3SemanticReview.Status);
        Assert.Empty(stored.V3SemanticReview.BatchCheckpoints);
        Assert.Equal(CaseTruthReviewStatuses.NotRun, stored.BlindSolvabilityReview.Status);
        Assert.Equal(AiFailurePhases.None, stored.FailurePhase);
        Assert.All(stored.ArtifactProvenance.Where(item => item.Artifact is
            CaseTruthArtifacts.Projection or CaseTruthArtifacts.Layout or CaseTruthArtifacts.Assets), item => Assert.True(item.IsStale));
        Assert.Equal(draft.ReservedBudgetUsd, stored.ReservedBudgetUsd);
        Assert.Equal(draft.ActiveQuotaKey, stored.ActiveQuotaKey);
        Assert.Equal(draft.DailyQuotaKey, stored.DailyQuotaKey);
        Assert.Equal(draft.PlannedCalls.Count, stored.PlannedCalls.Count);
        Assert.Equal(draft.GenerationAttempts.Count, stored.GenerationAttempts.Count);
        Assert.Equal(draft.WorkflowVersion + 1, stored.WorkflowVersion);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    [Fact]
    public async Task TruthRepair_RejectAtGameplayKeepsApprovedJsonAndReviews()
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = TruthRepairDraft();
        await db.AiCaseDrafts.InsertOneAsync(draft);

        var response = await client.PostAsync($"/api/admin/ai-cases/{draft.Id}/reject-truth-repair", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var stored = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(AiDraftStatus.FullLogicAwaitingApproval, stored.Status);
        Assert.Equal(AiRepairStatus.Rejected, stored.TruthRepairStatus);
        Assert.Null(stored.TruthRepairCandidate);
        Assert.Equal(draft.GeneratedJson, stored.GeneratedJson);
        Assert.Equal(draft.ProjectionPlanHash, stored.ProjectionPlanHash);
        Assert.Equal(draft.ProjectionContentHash, stored.ProjectionContentHash);
        Assert.Equal(draft.V3SemanticReview.Status, stored.V3SemanticReview.Status);
        Assert.Equal(draft.TruthHash, stored.TruthHash);
        Assert.Equal(draft.ReservedBudgetUsd, stored.ReservedBudgetUsd);
        // A replacement already validating the old JSON must lose even though reject
        // leaves the visible approval status unchanged.
        var staleWrite = await db.AiCaseDrafts.UpdateOneAsync(AiCaseService.DraftReplacementFilter(draft),
            Builders<AiCaseDraft>.Update.Set(item => item.GeneratedJson, "stale replacement"));
        Assert.Equal(0, staleWrite.MatchedCount);
        var currentWrite = await db.AiCaseDrafts.UpdateOneAsync(AiCaseService.DraftReplacementFilter(stored),
            Builders<AiCaseDraft>.Update.Set(item => item.GeneratedJson, stored.GeneratedJson));
        Assert.Equal(1, currentWrite.MatchedCount);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    [Fact]
    public async Task TruthRepair_ProviderFailureKeepsGameplayCheckpointAndCanBeRejected()
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = TruthRepairDraft();
        draft.TruthRepairStatus = AiRepairStatus.None;
        draft.TruthRepairCandidate = null;
        draft.QueueState = AiQueueStates.Pending;
        draft.QueuedOperation = AiQueuedOperations.TruthRepair;
        await db.AiCaseDrafts.InsertOneAsync(draft);
        var workflow = scope.ServiceProvider.GetRequiredService<IAiDraftWorkflowCoordinator>();
        var claimed = await workflow.ClaimNextQueuedAsync();
        Assert.NotNull(claimed);
        Assert.True(await workflow.CompleteQueuedAsync(claimed!, "AI_PROVIDER_ERROR"));
        var failed = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(AiDraftStatus.FullLogicAwaitingApproval, failed.Status);
        Assert.Equal(draft.GeneratedJson, failed.GeneratedJson);
        Assert.Equal(AiRepairStatus.CandidateInvalid, failed.TruthRepairStatus);
        Assert.Contains("AI_PROVIDER_ERROR", failed.TruthRepairValidationReport);
        var response = await client.PostAsync($"/api/admin/ai-cases/{draft.Id}/reject-truth-repair", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rejected = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(AiDraftStatus.FullLogicAwaitingApproval, rejected.Status);
        Assert.Equal(draft.GeneratedJson, rejected.GeneratedJson);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    [Theory]
    [InlineData(AiQueueStates.Pending)]
    [InlineData(AiQueueStates.Running)]
    [InlineData(AiQueueStates.RetryScheduled)]
    public async Task TruthRepair_ActiveQueueBlocksEditingAndCandidateResolution(string queueState)
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = TruthRepairDraft();
        draft.QueueState = queueState;
        draft.QueuedOperation = AiQueuedOperations.TruthRepair;
        await db.AiCaseDrafts.InsertOneAsync(draft);
        foreach (var route in new[] { "repair-truth", "accept-truth-repair", "reject-truth-repair", "approve-full-logic" })
        {
            var response = await client.PostAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/{route}", new { });
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        }
        var stored = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(draft.WorkflowVersion, stored.WorkflowVersion);
        Assert.Equal(draft.GeneratedJson, stored.GeneratedJson);
        Assert.Equal(queueState, stored.QueueState);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    [Theory]
    [InlineData(AiDraftStatus.Published, false)]
    [InlineData(AiDraftStatus.Imported, true)]
    [InlineData(AiDraftStatus.FullLogicAwaitingApproval, true)]
    public async Task TruthRepair_ImportedAndPublishedDraftsCannotBeRewritten(string status, bool imported)
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = TruthRepairDraft();
        draft.Status = status;
        draft.ImportedCaseId = imported ? "case-imported-test" : null;
        await db.AiCaseDrafts.InsertOneAsync(draft);
        foreach (var route in new[] { "repair-truth", "accept-truth-repair", "reject-truth-repair" })
        {
            var response = await client.PostAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/{route}", new { });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        Assert.Equal(draft.WorkflowVersion, (await ReadTruthRepairDraft(db, draft.Id)).WorkflowVersion);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    [Fact]
    public async Task TruthRepair_PendingCandidateBlocksDownstreamAndOtherOwner()
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        await InsertActiveUserAsync(db, VipOwnerId, UserRole.Vip);
        var draft = TruthRepairDraft();
        await db.AiCaseDrafts.InsertOneAsync(draft);
        var approve = await client.PostAsync($"/api/admin/ai-cases/{draft.Id}/approve-full-logic", null);
        Assert.Equal(HttpStatusCode.Conflict, approve.StatusCode);
        Assert.Contains("AI_TRUTH_REPAIR_PENDING", await approve.Content.ReadAsStringAsync());
        var replace = await client.PutAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/case-json", new { caseJson = new { } });
        Assert.Equal(HttpStatusCode.Conflict, replace.StatusCode);
        Assert.Contains("AI_TRUTH_REPAIR_PENDING", await replace.Content.ReadAsStringAsync());
        var retryAssets = await client.PostAsync($"/api/admin/ai-cases/{draft.Id}/regenerate-failed-assets", null);
        Assert.Equal(HttpStatusCode.Conflict, retryAssets.StatusCode);
        client.DefaultRequestHeaders.Add("X-Test-UserId", VipOwnerId);
        client.DefaultRequestHeaders.Add("X-Test-Role", UserRole.Vip);
        foreach (var route in new[] { "repair-truth", "accept-truth-repair", "reject-truth-repair" })
        {
            var response = await client.PostAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/{route}", new { });
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
        Assert.Equal(draft.WorkflowVersion, (await ReadTruthRepairDraft(db, draft.Id)).WorkflowVersion);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    private static Task<AiCaseDraft> ReadTruthRepairDraft(MongoDbContext db, string id) =>
        db.AiCaseDrafts.Find(item => item.Id == id).FirstAsync();

    private static AiCaseDraft TruthRepairDraft()
    {
        var draft = new AiCaseDraft
        {
            Id = ObjectId.GenerateNewId().ToString(), CreatedByUserId = DefaultAdminId, CreatedByRole = UserRole.Admin,
            Status = AiDraftStatus.FullLogicAwaitingApproval, LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset, WorkflowVersion = 4, TruthCheckpointArtifact = CaseTruthArtifacts.ProofGraph,
            Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.ShortDemo, StageCount = 2,
                Language = "en", IncludeCrackTheLie = true, MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation },
            GeneratedJson = "{\"oldGameplay\":true}", OriginalGeneratedJson = "old-original", RepairedCandidateJson = "old-repair",
            RepairStatus = AiRepairStatus.CandidateReady, RepairValidationReport = ["old-error"], ValidationErrors = ["old-validation"],
            BlueprintJson = "old-blueprint", BlueprintHash = "old-blueprint-hash", BlueprintSchemaVersion = "old-schema",
            CaseBlueprint = new AiCaseBlueprint(), BlueprintValidationErrors = ["old-blueprint-error"], CrackContractHash = "old-crack-contract",
            ProjectionPlan = new GameplayProjectionPlan { Skeleton = new GameCase { Id = ObjectId.GenerateNewId().ToString() } },
            ProjectionPlanJson = "old-plan", ProjectionPlanHash = "old-plan-hash",
            ProjectionPlanSchemaVersion = "old-plan-schema", ProjectionContentSchemaVersion = "old-wire", ProjectionContentJson = "old-content",
            ProjectionContentHash = "old-content-hash", ProjectionBuildMode = "old-mode", ProjectionCompilerVersion = "old-compiler",
            V3CrackContentJson = "old-crack", V3CrackContentHash = "old-crack-hash",
            V3SemanticReview = new AiV3SemanticReview { Status = AiV3SemanticReviewStatuses.Passed },
            BlindSolvabilityReview = new BlindSolvabilityReview { Status = CaseTruthReviewStatuses.Passed },
            CaseId = "old-case", CaseTitle = "Old case", JsonFilePath = "old-case.json", JsonFolderPath = "old-folder",
            FailedAssetIds = ["old-asset"], FailurePhase = AiFailurePhases.FullLogicJson, LastGenerationErrorCode = "OLD_ERROR",
            ReservedBudgetUsd = .25m, ActiveQuotaKey = "test-active", DailyQuotaKey = "test-day",
            ArtifactProvenance = [new AiArtifactProvenance { Artifact = CaseTruthArtifacts.Projection, OutputHash = "old" }]
        };
        var json = AiCaseMockFactory.BuildMockTruthPackageJson(draft);
        draft.CaseTruth = JsonSerializer.Deserialize<CaseTruthPackage>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        draft.CaseTruthJson = json;
        draft.TruthHash = new CaseTruthService().ComputeHash(draft.CaseTruth);
        draft.TruthReviewerResult = AiCaseMockFactory.BuildMockTruthReview();
        draft.TruthReviewerResult.Status = CaseTruthReviewStatuses.Failed;
        draft.TruthRepairCandidate = JsonSerializer.Deserialize<CaseTruthPackage>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        draft.TruthRepairCandidateJson = json;
        draft.TruthRepairStatus = AiRepairStatus.CandidateReady;
        draft.TruthRepairReviewerResult = new CaseTruthFeasibilityReview { Status = CaseTruthReviewStatuses.Failed };
        return draft;
    }
}
