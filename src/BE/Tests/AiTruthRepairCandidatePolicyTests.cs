using System.Text.Json;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiTruthRepairCandidatePolicyTests
{
    private readonly CaseTruthService _truth = new();

    [Fact]
    public void SavedCandidate_RequiresInvalidStatusAndMatchingSerializedSnapshot()
    {
        var draft = Draft();
        AiTruthRepairCandidatePolicy.ValidateSavedCandidate(draft, _truth);
        draft.TruthRepairStatus = AiRepairStatus.CandidateReady;
        Assert.Equal(409, Assert.Throws<ApiException>(() => AiTruthRepairCandidatePolicy.ValidateSavedCandidate(draft, _truth)).StatusCode);
        draft.TruthRepairStatus = AiRepairStatus.CandidateInvalid;
        draft.TruthRepairCandidateJson = "{}";
        Assert.Equal(409, Assert.Throws<ApiException>(() => AiTruthRepairCandidatePolicy.ValidateSavedCandidate(draft, _truth)).StatusCode);
    }

    [Theory]
    [InlineData("locked-core")]
    [InlineData("locked-seed")]
    [InlineData("snapshot-hash")]
    public void SavedCandidate_RejectsChangedUpstreamOrSnapshot(string mutation)
    {
        var draft = Draft();
        if (mutation == "locked-core") draft.TruthRepairCandidate!.CoreTruth.Motive += " Changed.";
        if (mutation == "locked-seed") draft.TruthRepairCandidate!.CaseSeed.Era = "Changed era";
        if (mutation == "snapshot-hash") draft.TruthRepairCandidateHash = "wrong-hash";
        draft.TruthRepairCandidateJson = _truth.Canonicalize(draft.TruthRepairCandidate!);
        var ex = Assert.Throws<ApiException>(() => AiTruthRepairCandidatePolicy.ValidateSavedCandidate(draft, _truth));
        Assert.Equal(409, ex.StatusCode);
    }

    [Fact]
    public void Reuse_RejectsIncompleteOrInvalidStagesBeforeSelectedScope()
    {
        var candidate = Draft().TruthRepairCandidate!;
        candidate.TrueTimeline.Clear();
        var result = _truth.Validate(candidate);
        Assert.Equal(422, Assert.Throws<ApiException>(() => AiTruthRepairCandidatePolicy.ValidateReusedUpstream(
            candidate, CaseTruthArtifacts.Evidence, _truth, result)).StatusCode);
    }

    [Fact]
    public void SavedCandidate_RejectsChangedActiveTimelineEvenWhenLockedCoreStillMatches()
    {
        var draft = Draft();
        draft.TruthRepairCandidateHash = _truth.ComputeHash(draft.TruthRepairCandidate!);
        draft.TruthRepairBaseHash = _truth.ComputeHash(draft.CaseTruth!);
        draft.CaseTruth!.TrueTimeline[0].Action += " A newer truth replaced this timeline.";
        draft.CaseTruthJson = _truth.Canonicalize(draft.CaseTruth);
        draft.TruthHash = _truth.ComputeHash(draft.CaseTruth);
        Assert.Equal(409, Assert.Throws<ApiException>(() =>
            AiTruthRepairCandidatePolicy.ValidateSavedCandidate(draft, _truth)).StatusCode);
    }

    [Fact]
    public void SavedCandidate_DoesNotTreatLostModernHashAsALegacyCandidate()
    {
        var draft = Draft();
        draft.TruthRepairBaseHash = _truth.ComputeHash(draft.CaseTruth!);
        Assert.Equal(409, Assert.Throws<ApiException>(() =>
            AiTruthRepairCandidatePolicy.ValidateSavedCandidate(draft, _truth)).StatusCode);
    }

    [Fact]
    public void SavedCandidate_RequiresSavedBaseJsonBeforeLegacyContinuation()
    {
        var draft = Draft();
        draft.CaseTruthJson = string.Empty;
        Assert.Equal(409, Assert.Throws<ApiException>(() =>
            AiTruthRepairCandidatePolicy.ValidateSavedCandidate(draft, _truth)).StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void CurrentPlan_DoesNotInheritCandidateScopeOrReasons(bool candidateDiscarded)
    {
        var draft = Draft();
        draft.TruthCheckpointArtifact = CaseTruthArtifacts.ProofGraph;
        draft.TruthReviewerResult = new CaseTruthFeasibilityReview
        {
            Status = CaseTruthReviewStatuses.Failed,
            Findings = [new CaseTruthReviewFinding { Code = CaseTruthReviewFindingCodes.TimelineFeasibility }]
        };
        draft.TruthRepairRecommendedArtifact = CaseTruthArtifacts.ProofGraph;
        draft.TruthRepairFromArtifact = CaseTruthArtifacts.ProofGraph;
        draft.TruthRepairReasonCodes = ["candidate-only-graph-error"];
        if (candidateDiscarded)
        {
            draft.TruthRepairCandidate = null;
            draft.TruthRepairStatus = AiRepairStatus.Rejected;
        }
        var plan = AiTruthRepairPlanResponse.From(draft);
        Assert.Equal(CaseTruthArtifacts.Timeline, plan.RecommendedStartArtifact);
        Assert.Equal(CaseTruthArtifacts.Timeline, plan.SelectedStartArtifact);
        Assert.Contains(CaseTruthReviewFindingCodes.TimelineFeasibility, plan.ReasonCodes);
        Assert.DoesNotContain("candidate-only-graph-error", plan.ReasonCodes);
    }

    [Fact]
    public void CandidatePlan_UsesCandidateValidationInsteadOfOldTruthReview()
    {
        var draft = Draft();
        draft.TruthReviewerResult = new CaseTruthFeasibilityReview
        {
            Status = CaseTruthReviewStatuses.Failed,
            Findings = [new CaseTruthReviewFinding { Code = CaseTruthReviewFindingCodes.TimelineFeasibility }]
        };
        draft.TruthRepairCandidate!.ProofGraph.Conclusions[0].Proposition = "";
        var candidatePlan = AiTruthRepairPlanResponse.FromCandidate(draft);
        Assert.Equal(CaseTruthArtifacts.ProofGraph, candidatePlan.RecommendedStartArtifact);
        Assert.Equal(CaseTruthArtifacts.Timeline, AiTruthRepairPlanResponse.From(draft).RecommendedStartArtifact);
        AiTruthRepairCandidatePolicy.ValidateReusedUpstream(draft.TruthRepairCandidate,
            CaseTruthArtifacts.ProofGraph, _truth, _truth.Validate(draft.TruthRepairCandidate));
    }

    [Fact]
    public void CandidatePlan_AlsoRespectsCandidateReviewFindings()
    {
        var draft = Draft();
        draft.TruthRepairReviewerResult = new CaseTruthFeasibilityReview
        {
            Status = CaseTruthReviewStatuses.Failed,
            Findings = [new CaseTruthReviewFinding { Code = CaseTruthReviewFindingCodes.ProofScope }]
        };
        Assert.Equal(CaseTruthArtifacts.Evidence,
            AiTruthRepairPlanResponse.FromCandidate(draft).RecommendedStartArtifact);
    }

    [Theory]
    [InlineData(CaseTruthArtifacts.Timeline)]
    [InlineData(CaseTruthArtifacts.Evidence)]
    [InlineData(CaseTruthArtifacts.Statements)]
    [InlineData(CaseTruthArtifacts.ProofGraph)]
    public void ScopedGeneration_DropsStaleDownstreamArtifactsBeforeGenerating(string artifact)
    {
        var draft = Draft();
        var sourceHash = _truth.ComputeHash(draft.CaseTruth!);
        var candidate = draft.TruthRepairCandidate!;
        var timelineAction = candidate.TrueTimeline[0].Action;
        var start = Array.IndexOf(CaseTruthRepairPolicy.OrderedArtifacts, artifact);
        AiCaseService.ClearInvalidatedTruthArtifacts(candidate, start);
        Assert.Equal(sourceHash, _truth.ComputeHash(draft.CaseTruth!));
        Assert.Equal(draft.CaseTruth!.CoreTruth.Motive, candidate.CoreTruth.Motive);
        if (start <= 2) Assert.Empty(candidate.TrueTimeline);
        else Assert.Equal(timelineAction, candidate.TrueTimeline[0].Action);
        if (start <= 4) Assert.Empty(candidate.TraceLedger);
        else Assert.NotEmpty(candidate.TraceLedger);
        if (start <= 5) Assert.Empty(candidate.StatementLedger);
        else Assert.NotEmpty(candidate.StatementLedger);
        Assert.Empty(candidate.ProofGraph.Conclusions);
        Assert.Empty(candidate.RedHerringLedger);
    }

    [Fact]
    public void CandidatePlan_AdvancesPastValidatedPartialStageWithoutCascadingMissingGraphErrors()
    {
        var draft = Draft();
        draft.TruthRepairFailedArtifact = CaseTruthArtifacts.Statements;
        draft.TruthRepairCandidate!.ProofGraph.Conclusions.Clear();
        draft.TruthRepairCandidate.RedHerringLedger.Clear();
        var plan = AiTruthRepairPlanResponse.FromCandidate(draft);
        Assert.Equal(CaseTruthArtifacts.ProofGraph, plan.RecommendedStartArtifact);
        Assert.Contains("IncompleteTruthArtifact", plan.ReasonCodes);
    }

    private AiCaseDraft Draft()
    {
        var draft = new AiCaseDraft
        {
            PlannedTargetKind = CaseTargetKinds.Asset,
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            Settings = new AiDraftSettings { Difficulty = "medium", GenerationPreset = AiGenerationPresets.ShortDemo,
                StageCount = 2, Language = "en", IncludeCrackTheLie = true,
                MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation }
        };
        var json = AiCaseMockFactory.BuildMockTruthPackageJson(draft);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        draft.CaseTruth = JsonSerializer.Deserialize<CaseTruthPackage>(json, options)!;
        draft.CaseTruthJson = _truth.Canonicalize(draft.CaseTruth);
        draft.TruthHash = _truth.ComputeHash(draft.CaseTruth);
        draft.TruthRepairCandidate = JsonSerializer.Deserialize<CaseTruthPackage>(json, options)!;
        draft.TruthRepairCandidate.TrueTimeline[0].Action += " Repaired observable detail.";
        draft.TruthRepairCandidateJson = _truth.Canonicalize(draft.TruthRepairCandidate);
        draft.TruthRepairStatus = AiRepairStatus.CandidateInvalid;
        draft.TruthRepairFromArtifact = CaseTruthArtifacts.Timeline;
        return draft;
    }
}
