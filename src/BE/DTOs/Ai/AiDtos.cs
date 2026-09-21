using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.DTOs.Ai;

public class GenerateAiCaseRequest
{
    [MaxLength(2000)]
    public string? Prompt { get; set; }

    [Range(1, 6)]
    public int StageCount { get; set; } = 4;

    public string Difficulty { get; set; } = "medium";

    /// <summary>
    /// Controls case structure density. Unknown values fall back to NORMAL_RANDOM.
    /// </summary>
    [MaxLength(40)]
    public string GenerationPreset { get; set; } = AiGenerationPresets.NormalRandom;

    /// <summary>Adds the paired Crack-the-Lie loop on top of the selected V2 preset.</summary>
    public bool IncludeCrackTheLie { get; set; }

    [MaxLength(5)]
    [RegularExpression("^(?i:en|vi)$", ErrorMessage = "language must be 'en' or 'vi'.")]
    public string Language { get; set; } = CaseLanguages.English;

    [MaxLength(32)]
    [RegularExpression("^(?i:RANDOM|MURDER|MISSING_PERSON|THEFT|SABOTAGE|FRAUD|KIDNAPPING)$",
        ErrorMessage = "caseType is not supported.")]
    public string CaseType { get; set; } = AiCaseTypes.Random;

    /// <summary>
    /// Kept for backward-compatible clients. The server always applies the fixed SirLocked visual contract.
    /// </summary>
    public string VisualStyle { get; set; } = AiVisualStyleDefaults.PixelDetectiveTheme;
}

public class AiDraftResponse
{
    public string DraftId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public AiDraftSettings Settings { get; set; } = new();
    public string Status { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string CreatedByUserId { get; set; } = string.Empty;
    public string CreatedByRole { get; set; } = string.Empty;
    public AiStoryPreview? StoryPreview { get; set; }
    public AiStoryDiversityProfile StoryDiversity { get; set; } = new();
    public string StoryFingerprint { get; set; } = string.Empty;
    public int LogicContractVersion { get; set; }
    public string ProjectionPlanSchemaVersion { get; set; } = string.Empty;
    public string ProjectionPlanHash { get; set; } = string.Empty;
    public string ProjectionCompilerVersion { get; set; } = string.Empty;
    public string ProjectionBuildMode { get; set; } = string.Empty;
    public bool HasProjectionPlan { get; set; }
    public AiCaseTruthSummaryResponse? TruthSummary { get; set; }
    /// <summary>Spoiler payload; returned only by the single-draft admin/VIP detail endpoint.</summary>
    public CaseTruthPackage? CaseTruth { get; set; }
    public CaseTruthFeasibilityReview? TruthReviewerResult { get; set; }
    public bool TruthReviewIsAdvisory { get; set; } = true;
    public List<string> TruthValidationReport { get; set; } = new();
    public CaseTruthPackage? TruthRepairCandidate { get; set; }
    public string TruthRepairStatus { get; set; } = string.Empty;
    public List<string> TruthRepairValidationReport { get; set; } = new();
    public CaseTruthFeasibilityReview? TruthRepairReviewerResult { get; set; }
    public AiTruthRepairPlanResponse? TruthRepairPlan { get; set; }
    public BlindSolvabilityReview? BlindSolvabilityReview { get; set; }
    public bool BlindReviewIsAdvisory { get; set; } = true;
    /// <summary>Dependency hashes for the single-draft review screen; omitted from list responses.</summary>
    public List<AiArtifactProvenance> ArtifactProvenance { get; set; } = new();
    public AiBlueprintSummaryResponse? BlueprintSummary { get; set; }
    public AiV3SemanticReview? V3SemanticReview { get; set; }
    public AiAssetManifest? AssetManifest { get; set; }
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string GeneratedJson { get; set; } = string.Empty;
    public bool HasGeneratedJson { get; set; }
    public bool CanContinue { get; set; }
    public string JsonFilePath { get; set; } = string.Empty;
    public string JsonFolderPath { get; set; } = string.Empty;
    public List<string> ValidationErrors { get; set; } = new();
    public string OriginalGeneratedJson { get; set; } = string.Empty;
    public string RepairedCandidateJson { get; set; } = string.Empty;
    public List<string> RepairValidationReport { get; set; } = new();
    public string RepairStatus { get; set; } = string.Empty;
    public string RepairInstructions { get; set; } = string.Empty;
    public List<AiPlannedCall> PlannedCalls { get; set; } = new();
    public string PromptVersion { get; set; } = string.Empty;
    public string SchemaVersion { get; set; } = string.Empty;
    public string FailurePhase { get; set; } = AiFailurePhases.None;
    public List<string> FailedAssetIds { get; set; } = new();
    public List<AiGenerationAttemptSummary> GenerationAttempts { get; set; } = new();
    public string GenerationRunId { get; set; } = string.Empty;
    public string GenerationPhase { get; set; } = string.Empty;
    public int GenerationProgress { get; set; }
    public DateTime? GenerationClaimedAt { get; set; }
    public long WorkflowVersion { get; set; }
    public string QueuedOperation { get; set; } = AiQueuedOperations.None;
    public string QueueState { get; set; } = AiQueueStates.None;
    public string GenerationInputHash { get; set; } = string.Empty;
    public DateTime? NextAttemptAt { get; set; }
    public string LastGenerationErrorCode { get; set; } = string.Empty;
    public string? IdempotencyKey { get; set; }
    public decimal ReservedBudgetUsd { get; set; }
    public DateTime? CancelledAt { get; set; }
    public bool CanCancel { get; set; }
    public AiCostReport CostReport { get; set; } = new();
    public string? ImportedCaseId { get; set; }
    public CaseSummaryResponse? PublishedCase { get; set; }
    public DateTime CreatedAt { get; set; }

    public static AiDraftResponse From(AiCaseDraft d, bool includeJson = true, CaseSummaryResponse? publishedCase = null) => new()
    {
        DraftId = d.Id,
        Prompt = d.Prompt,
        Settings = d.Settings,
        Status = d.Status,
        Provider = d.Provider,
        CreatedByUserId = d.CreatedByUserId,
        CreatedByRole = d.CreatedByRole,
        StoryPreview = HasStoryPreview(d.StoryPreview) ? d.StoryPreview : null,
        StoryDiversity = includeJson
            ? d.StoryDiversity
            : new AiStoryDiversityProfile
            {
                Seed = d.StoryDiversity.Seed,
                RequestedCaseType = d.StoryDiversity.RequestedCaseType,
                CaseType = d.StoryDiversity.CaseType,
                CoreFingerprint = d.StoryDiversity.CoreFingerprint
            },
        StoryFingerprint = d.StoryFingerprint,
        LogicContractVersion = d.LogicContractVersion,
        ProjectionPlanSchemaVersion = d.ProjectionPlanSchemaVersion,
        ProjectionPlanHash = d.ProjectionPlanHash,
        ProjectionCompilerVersion = d.ProjectionCompilerVersion,
        ProjectionBuildMode = d.ProjectionBuildMode,
        HasProjectionPlan = d.ProjectionPlan is not null
                            && !string.IsNullOrWhiteSpace(d.ProjectionPlanHash),
        TruthSummary = d.CaseTruth is null ? null : new AiCaseTruthSummaryResponse
        {
            SchemaVersion = d.TruthSchemaVersion,
            TruthHash = d.TruthHash,
            TimelineEventCount = d.CaseTruth.TrueTimeline.Count,
            MaxTimelineEvents = TruthBudget(d).MaxTimelineEvents,
            TraceCount = d.CaseTruth.TraceLedger.Count,
            MaxTraces = TruthBudget(d).MaxTraces,
            StatementCount = d.CaseTruth.StatementLedger.Count,
            MaxStatements = TruthBudget(d).MaxStatements,
            MaxSuspects = TruthBudget(d).MaxSuspects,
            MaxLocations = TruthBudget(d).MaxLocations,
            ProofConclusionCount = d.CaseTruth.ProofGraph.Conclusions.Count,
            ReviewerStatus = d.TruthReviewerResult.Status,
            ReviewerConfidence = d.TruthReviewerResult.Confidence,
            ValidationErrorCount = d.TruthValidationReport.Count
        },
        CaseTruth = includeJson ? d.CaseTruth : null,
        TruthReviewerResult = includeJson && d.CaseTruth is not null ? d.TruthReviewerResult : null,
        TruthReviewIsAdvisory = true,
        TruthValidationReport = includeJson ? d.TruthValidationReport : new List<string>(),
        TruthRepairCandidate = includeJson ? d.TruthRepairCandidate : null,
        TruthRepairStatus = d.TruthRepairStatus,
        TruthRepairValidationReport = includeJson ? d.TruthRepairValidationReport : new List<string>(),
        TruthRepairReviewerResult = includeJson && d.TruthRepairCandidate is not null ? d.TruthRepairReviewerResult : null,
        TruthRepairPlan = includeJson && d.CaseTruth is not null
            ? AiTruthRepairPlanResponse.From(d)
            : null,
        BlindSolvabilityReview = includeJson && d.BlindSolvabilityReview.Status != CaseTruthReviewStatuses.NotRun
            ? d.BlindSolvabilityReview : null,
        BlindReviewIsAdvisory = true,
        ArtifactProvenance = includeJson ? d.ArtifactProvenance : new List<AiArtifactProvenance>(),
        BlueprintSummary = d.CaseBlueprint is null ? null : new AiBlueprintSummaryResponse
        {
            SchemaVersion = d.BlueprintSchemaVersion,
            BlueprintHash = d.BlueprintHash,
            CrackContractHash = d.CrackContractHash,
            CrackCount = d.CaseBlueprint.Cracks.Count,
            SemanticPairCount = d.CaseBlueprint.Cracks.Sum(crack => crack.Testimonies.Count * crack.Evidences.Count),
            ValidationErrors = d.BlueprintValidationErrors
        },
        V3SemanticReview = d.Settings.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation
            ? d.V3SemanticReview
            : null,
        AssetManifest = HasAssetManifest(d.AssetManifest) ? d.AssetManifest : null,
        CaseId = d.CaseId,
        CaseTitle = d.CaseTitle,
        GeneratedJson = includeJson ? d.GeneratedJson : string.Empty,
        HasGeneratedJson = !string.IsNullOrWhiteSpace(d.GeneratedJson),
        CanContinue = CanContinueDraft(d),
        JsonFilePath = RelativeArtifactReference(d.JsonFolderPath, d.JsonFilePath),
        JsonFolderPath = string.IsNullOrWhiteSpace(d.JsonFolderPath) ? string.Empty : Path.GetFileName(d.JsonFolderPath),
        ValidationErrors = includeJson || d.FailurePhase != AiFailurePhases.CaseTruth
            ? d.ValidationErrors : new List<string>(),
        OriginalGeneratedJson = includeJson ? d.OriginalGeneratedJson : string.Empty,
        RepairedCandidateJson = includeJson ? d.RepairedCandidateJson : string.Empty,
        RepairValidationReport = d.RepairValidationReport,
        RepairStatus = d.RepairStatus,
        RepairInstructions = d.RepairInstructions,
        PlannedCalls = d.PlannedCalls,
        PromptVersion = d.PromptVersion,
        SchemaVersion = d.SchemaVersion,
        FailurePhase = d.FailurePhase,
        FailedAssetIds = d.FailedAssetIds,
        GenerationAttempts = d.GenerationAttempts.Select(AiGenerationAttemptSummary.From).ToList(),
        GenerationRunId = d.GenerationRunId,
        GenerationPhase = d.GenerationPhase,
        GenerationProgress = d.GenerationProgress,
        GenerationClaimedAt = d.GenerationClaimedAt,
        WorkflowVersion = d.WorkflowVersion,
        QueuedOperation = d.QueuedOperation,
        QueueState = d.QueueState,
        GenerationInputHash = d.GenerationInputHash,
        NextAttemptAt = d.NextAttemptAt,
        LastGenerationErrorCode = d.LastGenerationErrorCode,
        IdempotencyKey = d.IdempotencyKey,
        ReservedBudgetUsd = d.ReservedBudgetUsd,
        CancelledAt = d.CancelledAt,
        CanCancel = d.Status is not (AiDraftStatus.Published or AiDraftStatus.Imported or AiDraftStatus.Cancelled),
        CostReport = new AiCostReport
        {
            DryRun = d.PlannedCalls.Any(call => !call.WouldCallApi),
            PlannedCalls = d.PlannedCalls
        },
        ImportedCaseId = d.ImportedCaseId,
        PublishedCase = publishedCase,
        CreatedAt = d.CreatedAt
    };

    private static AiTruthGenerationBudget TruthBudget(AiCaseDraft draft) =>
        CaseTargetKinds.All.Contains(draft.PlannedTargetKind)
            ? AiTruthGenerationBudget.ForProjection(draft.Settings)
            : AiTruthGenerationBudget.For(draft.Settings);

    private static bool HasStoryPreview(AiStoryPreview? preview) =>
        preview is not null
        && (!string.IsNullOrWhiteSpace(preview.Title)
            || !string.IsNullOrWhiteSpace(preview.Summary)
            || !string.IsNullOrWhiteSpace(preview.OpeningIncident));

    private static string RelativeArtifactReference(string folderPath, string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath)) return string.Empty;
        var folder = string.IsNullOrWhiteSpace(folderPath) ? string.Empty : Path.GetFileName(folderPath);
        return string.IsNullOrWhiteSpace(folder) ? Path.GetFileName(filePath) : $"{folder}/{Path.GetFileName(filePath)}";
    }

    private static bool CanContinueDraft(AiCaseDraft d)
    {
        if (d.Status == AiDraftStatus.Published || !string.IsNullOrWhiteSpace(d.ImportedCaseId))
        {
            return false;
        }

        if (d.Status == AiDraftStatus.StoryAwaitingApproval)
        {
            return HasStoryPreview(d.StoryPreview);
        }

        if (d.Status == AiDraftStatus.CaseTruthAwaitingApproval)
        {
            return d.CaseTruth is not null
                && d.TruthValidationReport.Count == 0;
        }

        if (d.Status == AiDraftStatus.CaseTruthInvalid)
        {
            return d.CaseTruth is not null;
        }

        if (d.Status == AiDraftStatus.GeneratedInvalid
            && d.FailurePhase is AiFailurePhases.BlueprintJson or AiFailurePhases.V3SemanticReview
            && !string.IsNullOrWhiteSpace(d.BlueprintJson))
        {
            return true;
        }

        if (d.Status == AiDraftStatus.GeneratedInvalid
            && d.FailurePhase == AiFailurePhases.ProjectionConformance
            && d.CaseTruth is not null)
        {
            return true;
        }

        if (d.Status == AiDraftStatus.GeneratedInvalid
            && d.FailurePhase is AiFailurePhases.ProjectionContentJson
                or AiFailurePhases.ProjectionCompile
            && d.ProjectionPlan is not null
            && !string.IsNullOrWhiteSpace(d.ProjectionPlanHash))
        {
            return true;
        }

        return !string.IsNullOrWhiteSpace(d.GeneratedJson)
               && d.Status is AiDraftStatus.GeneratedInvalid
                   or AiDraftStatus.OpenAiGeneratedValid
                   or AiDraftStatus.FullLogicAwaitingApproval
                  or AiDraftStatus.SceneLayoutAwaitingApproval
                  or AiDraftStatus.GeneratingSceneLayout
                  or AiDraftStatus.GeneratingFinalAssets
                  or AiDraftStatus.ReadyToPublish
                  or AiDraftStatus.GeneratingAssets
                   or AiDraftStatus.AssetsGenerated
                   or AiDraftStatus.Imported;
    }

    private static bool HasAssetManifest(AiAssetManifest? manifest) =>
        manifest is not null
        && (!string.IsNullOrWhiteSpace(manifest.AssetRootUrl) || manifest.Assets.Count > 0);
}

public sealed class AiCaseTruthSummaryResponse
{
    public string SchemaVersion { get; set; } = string.Empty;
    public string TruthHash { get; set; } = string.Empty;
    public int TimelineEventCount { get; set; }
    public int MaxTimelineEvents { get; set; }
    public int TraceCount { get; set; }
    public int MaxTraces { get; set; }
    public int StatementCount { get; set; }
    public int MaxStatements { get; set; }
    public int MaxSuspects { get; set; }
    public int MaxLocations { get; set; }
    public int ProofConclusionCount { get; set; }
    public string ReviewerStatus { get; set; } = string.Empty;
    public double ReviewerConfidence { get; set; }
    public int ValidationErrorCount { get; set; }
}

public sealed class AiBlueprintSummaryResponse
{
    public string SchemaVersion { get; set; } = string.Empty;
    public string BlueprintHash { get; set; } = string.Empty;
    public string CrackContractHash { get; set; } = string.Empty;
    public int CrackCount { get; set; }
    public int SemanticPairCount { get; set; }
    public List<string> ValidationErrors { get; set; } = new();
}

public sealed class AiCaseCapabilitiesResponse
{
    public bool AiCaseV3PresetEnabled { get; set; }
    public bool GameplayV3Enabled { get; set; }
    public Dictionary<string, CrackGenerationBudgetResponse> CrackBudgets { get; set; } = new(StringComparer.Ordinal);
    public bool CanCreateV3Draft => AiCaseV3PresetEnabled;
    public bool CanPublishV3 => AiCaseV3PresetEnabled && GameplayV3Enabled;
}

public sealed class CrackGenerationBudgetResponse
{
    public int MinCracks { get; set; }
    public int MaxCracks { get; set; }
    public int MinTestimonies { get; set; }
    public int MaxTestimonies { get; set; }
    public int MinEvidence { get; set; }
    public int MaxEvidence { get; set; }
    public int TargetTestimonies { get; set; }
    public int TargetEvidence { get; set; }
    public int MaxPairsPerCrack { get; set; }
    public int MaxPairsPerCase { get; set; }
}

public class RepairFullLogicRequest
{
    [MaxLength(2000)]
    public string? RepairInstructions { get; set; }
}

public class RepairCaseTruthRequest
{
    [MaxLength(2000)]
    public string? RepairInstructions { get; set; }

    [MaxLength(40)]
    public string? RepairFromArtifact { get; set; }
}

public sealed class AiTruthRepairPlanResponse
{
    public string RecommendedStartArtifact { get; set; } = string.Empty;
    public string SelectedStartArtifact { get; set; } = string.Empty;
    public List<string> ReasonCodes { get; set; } = new();
    public List<string> InvalidArtifacts { get; set; } = new();
    public List<string> StaleArtifacts { get; set; } = new();

    public static AiTruthRepairPlanResponse From(AiCaseDraft draft)
    {
        var plan = draft.TruthReviewerResult.Status is CaseTruthReviewStatuses.Failed
            or CaseTruthReviewStatuses.Ambiguous
            ? CaseTruthRepairPolicy.PlanReview(draft.TruthReviewerResult)
            : draft.TruthReviewerResult.Status == CaseTruthReviewStatuses.Passed
                ? CaseTruthRepairPolicy.BuildPlan(CaseTruthArtifacts.CoreTruth)
                : CaseTruthRepairPolicy.BuildPlan(CaseTruthArtifacts.Timeline);
        var recommended = CaseTruthRepairPolicy.IsTruthArtifact(draft.TruthRepairRecommendedArtifact)
            ? draft.TruthRepairRecommendedArtifact
            : plan.RegenerateFromArtifact;
        if (recommended != plan.RegenerateFromArtifact)
            plan = CaseTruthRepairPolicy.BuildPlan(recommended);
        if (draft.TruthRepairReasonCodes.Count > 0)
            plan.ReasonCodes = draft.TruthRepairReasonCodes.ToList();
        return new AiTruthRepairPlanResponse
        {
            RecommendedStartArtifact = recommended,
            SelectedStartArtifact = draft.TruthRepairFromArtifact,
            ReasonCodes = plan.ReasonCodes,
            InvalidArtifacts = plan.InvalidArtifacts,
            StaleArtifacts = plan.StaleArtifacts
        };
    }
}

public class ReplaceAiDraftJsonRequest
{
    public JsonElement CaseJson { get; set; }
    public AiStoryPreview? StoryPreview { get; set; }
}

public class AiCostReport
{
    public bool DryRun { get; set; }
    public List<AiPlannedCall> PlannedCalls { get; set; } = new();
}

public class AiGenerationAttemptSummary
{
    public string Step { get; set; } = string.Empty;
    public int AttemptNumber { get; set; }
    public string ResponseId { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string SchemaVersion { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string FailureCategory { get; set; } = string.Empty;
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public List<string> ValidationErrors { get; set; } = new();
    public DateTime CreatedAt { get; set; }

    public static AiGenerationAttemptSummary From(AiGenerationAttempt attempt) => new()
    {
        Step = attempt.Step,
        AttemptNumber = attempt.AttemptNumber,
        ResponseId = attempt.ResponseId,
        Model = attempt.Model,
        SchemaVersion = attempt.SchemaVersion,
        Status = attempt.Status,
        FailureCategory = attempt.FailureCategory,
        InputTokens = attempt.InputTokens,
        OutputTokens = attempt.OutputTokens,
        ValidationErrors = attempt.ValidationErrors,
        CreatedAt = attempt.CreatedAt
    };
}
