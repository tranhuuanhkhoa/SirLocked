using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed partial class AiCaseWorkflowHostTests
{
    [Fact]
    public async Task TruthContinuation_QueuesImmutableCandidateAndRegeneratesOnlySelectedStage()
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = InvalidCandidateDraft();
        await db.AiCaseDrafts.InsertOneAsync(draft);

        var response = await client.PostAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/repair-truth",
            new RepairCaseTruthRequest { UseRepairCandidate = true, RepairFromArtifact = CaseTruthArtifacts.ProofGraph });
        Assert.True(response.StatusCode == HttpStatusCode.Accepted, await response.Content.ReadAsStringAsync());
        var queued = await ReadTruthRepairDraft(db, draft.Id);
        Assert.True(queued.TruthRepairUseCandidate);
        Assert.NotNull(queued.TruthRepairInput);
        Assert.Equal(new CaseTruthService().ComputeHash(queued.TruthRepairInput!), queued.TruthRepairInputHash);
        Assert.Equal(draft.GeneratedJson, queued.GeneratedJson);
        Assert.Equal(draft.TruthHash, queued.TruthHash);
        var workflow = scope.ServiceProvider.GetRequiredService<IAiDraftWorkflowCoordinator>();
        var claimed = await workflow.ClaimNextQueuedAsync();
        Assert.NotNull(claimed);
        await scope.ServiceProvider.GetRequiredService<IAiGenerationExecutor>().ExecuteAsync(claimed!, CancellationToken.None);
        Assert.True(await workflow.CompleteQueuedAsync(claimed!));
        var completed = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(AiRepairStatus.CandidateReady, completed.TruthRepairStatus);
        Assert.Equal(draft.TruthRepairCandidate!.TrueTimeline[0].Action, completed.TruthRepairCandidate!.TrueTimeline[0].Action);
        Assert.NotEqual(draft.CaseTruth!.TrueTimeline[0].Action, completed.TruthRepairCandidate.TrueTimeline[0].Action);
        Assert.Equal(draft.CaseTruthJson, completed.CaseTruthJson);
        Assert.Equal(draft.GeneratedJson, completed.GeneratedJson);
        Assert.Null(completed.TruthRepairInput);
        Assert.Empty(completed.TruthRepairInputHash);
        Assert.False(completed.TruthRepairUseCandidate);
        Assert.DoesNotContain(completed.GenerationAttempts, attempt => attempt.Step == "BuildTrueTimeline");

        var accepted = await client.PostAsync($"/api/admin/ai-cases/{draft.Id}/accept-truth-repair", null);
        Assert.True(accepted.IsSuccessStatusCode, await accepted.Content.ReadAsStringAsync());
        var saved = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(AiDraftStatus.CaseTruthAwaitingApproval, saved.Status);
        Assert.Equal(completed.TruthRepairCandidate.TrueTimeline[0].Action, saved.CaseTruth!.TrueTimeline[0].Action);
        Assert.Empty(saved.TruthRepairCandidateHash);
        Assert.Empty(saved.TruthRepairOriginalFromArtifact);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    [Theory]
    [InlineData("locked-upstream", HttpStatusCode.Conflict)]
    [InlineData("missing-stage", HttpStatusCode.UnprocessableEntity)]
    [InlineData("snapshot-hash", HttpStatusCode.Conflict)]
    [InlineData("no-candidate", HttpStatusCode.Conflict)]
    [InlineData("missing-base-json", HttpStatusCode.Conflict)]
    public async Task TruthContinuation_RejectsUnsafeCandidateBeforeQueue(string mutation, HttpStatusCode expected)
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = InvalidCandidateDraft();
        if (mutation == "locked-upstream") draft.TruthRepairCandidate!.CoreTruth.Motive += " Changed locked truth.";
        if (mutation == "missing-stage") draft.TruthRepairCandidate!.TrueTimeline.Clear();
        if (mutation == "no-candidate") draft.TruthRepairCandidate = null;
        if (mutation == "missing-base-json")
        {
            draft.CaseTruthJson = string.Empty;
            draft.Status = AiDraftStatus.CaseTruthInvalid;
        }
        if (draft.TruthRepairCandidate is not null)
            draft.TruthRepairCandidateJson = new CaseTruthService().Canonicalize(draft.TruthRepairCandidate);
        if (mutation == "snapshot-hash") draft.TruthRepairCandidateHash = "stale-hash";
        await db.AiCaseDrafts.InsertOneAsync(draft);
        var response = await client.PostAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/repair-truth",
            new RepairCaseTruthRequest { UseRepairCandidate = true, RepairFromArtifact = CaseTruthArtifacts.ProofGraph });
        Assert.Equal(expected, response.StatusCode);
        var saved = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(AiQueueStates.None, saved.QueueState);
        Assert.Equal(draft.WorkflowVersion, saved.WorkflowVersion);
        Assert.Equal(draft.GeneratedJson, saved.GeneratedJson);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    [Fact]
    public async Task TruthContinuation_ProviderFailurePreservesCandidateAndRejectPreventsStaleRequeue()
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = InvalidCandidateDraft();
        await db.AiCaseDrafts.InsertOneAsync(draft);
        var response = await client.PostAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/repair-truth",
            new RepairCaseTruthRequest { UseRepairCandidate = true });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var workflow = scope.ServiceProvider.GetRequiredService<IAiDraftWorkflowCoordinator>();
        var claimed = await workflow.ClaimNextQueuedAsync();
        Assert.True(await workflow.CompleteQueuedAsync(claimed!, "AI_PROVIDER_ERROR"));
        var failed = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(draft.TruthRepairCandidateJson, failed.TruthRepairCandidateJson);
        Assert.Equal(AiRepairStatus.CandidateInvalid, failed.TruthRepairStatus);
        Assert.Contains("AI_PROVIDER_ERROR", failed.TruthRepairValidationReport);
        Assert.Equal(draft.GeneratedJson, failed.GeneratedJson);
        Assert.Null(failed.TruthRepairInput);
        AiTruthRepairCandidatePolicy.ValidateSavedCandidate(failed, new CaseTruthService());

        var rejected = await client.PostAsync($"/api/admin/ai-cases/{draft.Id}/reject-truth-repair", null);
        Assert.Equal(HttpStatusCode.OK, rejected.StatusCode);
        var stale = await Assert.ThrowsAsync<ApiException>(() => workflow.EnqueueAsync(failed, [failed.Status],
            failed.Status, AiQueuedOperations.TruthRepair, "CASE_TRUTH_REPAIR"));
        Assert.Equal(409, stale.StatusCode);
        var saved = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Null(saved.TruthRepairCandidate);
        Assert.Null(saved.TruthRepairInput);
        Assert.Empty(saved.TruthRepairCandidateHash);
        Assert.Equal(draft.GeneratedJson, saved.GeneratedJson);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    [Fact]
    public async Task TruthContinuation_CancelInvalidatesRunningSnapshotAndCompletion()
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = InvalidCandidateDraft();
        draft.ReservedBudgetUsd = 0m;
        await db.AiCaseDrafts.InsertOneAsync(draft);
        var response = await client.PostAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/repair-truth",
            new RepairCaseTruthRequest { UseRepairCandidate = true });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var workflow = scope.ServiceProvider.GetRequiredService<IAiDraftWorkflowCoordinator>();
        var claimed = await workflow.ClaimNextQueuedAsync();
        Assert.NotNull(claimed);
        var cancelled = await client.PostAsync($"/api/admin/ai-cases/{draft.Id}/cancel", null);
        Assert.True(cancelled.IsSuccessStatusCode, await cancelled.Content.ReadAsStringAsync());
        Assert.False(await workflow.CompleteQueuedAsync(claimed!, "AI_PROVIDER_ERROR"));
        var stale = await Assert.ThrowsAsync<ApiException>(() => scope.ServiceProvider.GetRequiredService<IAiGenerationExecutor>()
            .ExecuteAsync(claimed!, CancellationToken.None));
        Assert.Equal(409, stale.StatusCode);
        var saved = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(AiDraftStatus.Cancelled, saved.Status);
        Assert.Equal(draft.GeneratedJson, saved.GeneratedJson);
        Assert.Equal(draft.TruthRepairCandidateJson, saved.TruthRepairCandidateJson);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    private static AiCaseDraft InvalidCandidateDraft()
    {
        var draft = TruthRepairDraft();
        draft.TruthRepairStatus = AiRepairStatus.CandidateInvalid;
        draft.TruthRepairFromArtifact = CaseTruthArtifacts.Timeline;
        draft.TruthRepairCandidate!.TrueTimeline[0].Action += " Saved candidate observation.";
        draft.TruthRepairCandidate.ProofGraph.Conclusions[0].Proposition = string.Empty;
        draft.TruthRepairCandidateJson = new CaseTruthService().Canonicalize(draft.TruthRepairCandidate);
        draft.TruthRepairReviewerResult = new CaseTruthFeasibilityReview();
        return draft;
    }

    [Fact]
    public async Task TruthContinuation_EarlyStageFailureKeepsPreciseReportAndClearsStaleDownstream()
    {
        if (!RunTruthRepairMongoTests) return;
        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await InsertActiveUserAsync(db, DefaultAdminId, UserRole.Admin);
        var draft = InvalidCandidateDraft();
        var candidate = draft.TruthRepairCandidate!;
        var oldTraceId = candidate.TraceLedger[0].TraceId;
        candidate.TraceLedger[0].TraceId += "-candidate";
        foreach (var item in candidate.TrueTimeline)
            item.TraceIds = item.TraceIds.Select(id => id == oldTraceId ? candidate.TraceLedger[0].TraceId : id).ToList();
        candidate.StatementLedger.Clear();
        candidate.ProofGraph.Conclusions.Clear();
        candidate.RedHerringLedger.Clear();
        draft.TruthRepairFailedArtifact = CaseTruthArtifacts.Statements;
        draft.TruthRepairCandidateJson = new CaseTruthService().Canonicalize(candidate);
        await db.AiCaseDrafts.InsertOneAsync(draft);
        var response = await client.PostAsJsonAsync($"/api/admin/ai-cases/{draft.Id}/repair-truth",
            new RepairCaseTruthRequest { UseRepairCandidate = true, RepairFromArtifact = CaseTruthArtifacts.Statements });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var workflow = scope.ServiceProvider.GetRequiredService<IAiDraftWorkflowCoordinator>();
        var claimed = await workflow.ClaimNextQueuedAsync();
        await scope.ServiceProvider.GetRequiredService<IAiGenerationExecutor>().ExecuteAsync(claimed!, CancellationToken.None);
        Assert.True(await workflow.CompleteQueuedAsync(claimed!));
        var failed = await ReadTruthRepairDraft(db, draft.Id);
        Assert.Equal(AiRepairStatus.CandidateInvalid, failed.TruthRepairStatus);
        Assert.Equal(CaseTruthArtifacts.Statements, failed.TruthRepairFailedArtifact);
        Assert.Contains(failed.TruthRepairValidationReport, error => error.Contains("MissingReference statementLedger", StringComparison.Ordinal));
        Assert.DoesNotContain(failed.TruthRepairValidationReport, error => error.Contains("InvalidProofShape", StringComparison.Ordinal));
        Assert.Empty(failed.TruthRepairCandidate!.ProofGraph.Conclusions);
        Assert.Empty(failed.TruthRepairCandidate.RedHerringLedger);
        Assert.Equal(CaseTruthArtifacts.Statements, AiTruthRepairPlanResponse.FromCandidate(failed).RecommendedStartArtifact);
        Assert.Equal(draft.GeneratedJson, failed.GeneratedJson);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }
}
