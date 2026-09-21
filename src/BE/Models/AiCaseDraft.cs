using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Models;

public static class AiGenerationSchemaVersions
{
    public const string StoryPreview = "story-preview-v3";
    public const string CaseLogic = "case-logic-v2";
    public const string Prompt = "ai-case-prompt-v2";
    public const string CaseLogicV3Crack = "case-logic-v3-crack-v2";
    public const string PromptV3Crack = "ai-case-prompt-v3-crack-v2";
    public const string V3SemanticReview = "v3-pair-review-v2";
    public const string CaseBlueprintV3Crack = "case-blueprint-v3-crack-v1";
    public const string CaseTruth = CaseTruthSchemaVersions.V2;
    public const string CaseSeed = "case-seed-v2";
    public const string CoreTruth = "core-truth-v3";
    public const string TrueTimeline = "true-timeline-v1";
    public const string OpportunityMatrix = "opportunity-matrix-v1";
    public const string TraceLedger = "trace-ledger-v2";
    public const string StatementLedger = "statement-ledger-v2";
    public const string ProofGraph = "proof-graph-v2";
    public const string CaseTruthReview = CaseTruthSchemaVersions.FeasibilityReviewV2;
    public const string BlindSolvabilityReview = CaseTruthSchemaVersions.BlindReviewV2;
}

public static class AiCaseTypes
{
    public const string Random = "RANDOM";
    public const string Murder = "MURDER";
    public const string MissingPerson = "MISSING_PERSON";
    public const string Theft = "THEFT";
    public const string Sabotage = "SABOTAGE";
    public const string Fraud = "FRAUD";
    public const string Kidnapping = "KIDNAPPING";

    public static readonly HashSet<string> All = new(StringComparer.OrdinalIgnoreCase)
    {
        Random,
        Murder,
        MissingPerson,
        Theft,
        Sabotage,
        Fraud,
        Kidnapping
    };

    public static string Normalize(string? caseType) =>
        string.IsNullOrWhiteSpace(caseType) || !All.Contains(caseType.Trim())
            ? Random
            : caseType.Trim().ToUpperInvariant();
}

public static class AiVisualStyleDefaults
{
    public const string ArtStyle = "pixel_art";
    public const string SubStyle = "high_detail_pixel";
    public const string CharacterStyle = "chibi";
    public const string PixelDetectiveTheme = "SirLocked Victorian gaslight pixel-art detective game";

    public const string PixelArtContract =
        "2D cozy detective adventure game in chibi pixel-art style; fixed side-view camera at standing eye level; " +
        "crisp nearest-neighbor pixel edges with no anti-aliasing, no blur, no brush textures and no photorealism; " +
        "clean dark outlines; flat cel shading with two-tone value steps; consistent sprite scale and pixel density; " +
        "characters use oversized expressive heads around 40 percent of total height, compact bodies and readable silhouettes; " +
        "muted Victorian palette using deep teal, warm sepia, brass gold and oxblood red; warm upper-left key light with restrained shadows.";

    public const string CharacterIllustrationContract =
        "high-detail pixel-art chibi character sprite for a 2D detective adventure game; " +
        "intentional crisp pixel clusters, no anti-aliasing, clean dark pixel outlines and two-tone cel shading; " +
        "oversized expressive head around 40 percent of total height, compact full body and a strong readable silhouette; " +
        "distinct age, face, hair, body shape, costume layers and role-specific accessories; " +
        "muted Victorian palette using deep teal, warm sepia, brass gold and oxblood red; " +
        "never smooth anime/vector rendering, photorealism, brush textures, blur or a generic repeated face.";
}

public static class AiGenerationPresets
{
    public const string NormalRandom = "NORMAL_RANDOM";
    public const string FullFeature = "FULL_FEATURE";
    public const string ShortDemo = "SHORT_DEMO";
    public const string PuzzleHeavy = "PUZZLE_HEAVY";
    public const string DialogueHeavy = "DIALOGUE_HEAVY";
    public const string CrackTheLieV3 = "CRACK_THE_LIE_V3";

    public static readonly HashSet<string> All = new(StringComparer.OrdinalIgnoreCase)
    {
        NormalRandom,
        FullFeature,
        ShortDemo,
        PuzzleHeavy,
        DialogueHeavy,
        CrackTheLieV3
    };

    public static string Normalize(string? preset) =>
        string.IsNullOrWhiteSpace(preset) || !All.Contains(preset.Trim())
            ? NormalRandom
            : preset.Trim().ToUpperInvariant();
}

public static class AiDraftStatus
{
    public const string GeneratingStory = "GENERATING_STORY";
    public const string StoryAwaitingApproval = "STORY_AWAITING_APPROVAL";
    public const string GeneratingCaseTruth = "GENERATING_CASE_TRUTH";
    public const string CaseTruthAwaitingApproval = "CASE_TRUTH_AWAITING_APPROVAL";
    public const string CaseTruthInvalid = "CASE_TRUTH_INVALID";
    public const string GeneratingFullCase = "GENERATING_FULL_CASE";
    public const string FullLogicAwaitingApproval = "FULL_LOGIC_AWAITING_APPROVAL";
    public const string OpenAiGeneratedValid = "OPENAI_GENERATED_VALID";
    public const string GeneratingSceneLayout = "GENERATING_SCENE_LAYOUT";
    public const string SceneLayoutAwaitingApproval = "SCENE_LAYOUT_AWAITING_APPROVAL";
    public const string GeneratingFinalAssets = "GENERATING_FINAL_ASSETS";
    public const string ReadyToPublish = "READY_TO_PUBLISH";
    public const string GeneratingAssets = "GENERATING_ASSETS";
    public const string AssetsGenerated = "ASSETS_GENERATED";
    public const string GeneratedInvalid = "GENERATED_INVALID";
    public const string Imported = "IMPORTED";
    public const string Published = "PUBLISHED";
    public const string Cancelled = "CANCELLED";
}

public static class AiRepairStatus
{
    public const string None = "NONE";
    public const string CandidateReady = "CANDIDATE_READY";
    public const string CandidateInvalid = "CANDIDATE_INVALID";
    public const string Accepted = "ACCEPTED";
    public const string Rejected = "REJECTED";
}

public static class AiFailurePhases
{
    public const string None = "NONE";
    public const string StoryJson = "STORY_JSON";
    public const string CaseTruth = "CASE_TRUTH";
    public const string BlindSolvabilityReview = "BLIND_SOLVABILITY_REVIEW";
    public const string BlueprintJson = "BLUEPRINT_JSON";
    public const string FullLogicJson = "FULL_LOGIC_JSON";
    public const string ProjectionContentJson = "PROJECTION_CONTENT_JSON";
    public const string ProjectionCompile = "PROJECTION_COMPILE";
    public const string ProjectionConformance = "PROJECTION_CONFORMANCE";
    public const string PreAssetValidation = "PRE_ASSET_VALIDATION";
    public const string SceneLayout = "SCENE_LAYOUT";
    public const string VisualQa = "VISUAL_QA";
    public const string FinalAssets = "FINAL_ASSETS";
    public const string V3SemanticReview = "V3_SEMANTIC_REVIEW";
}

public static class AiV3SemanticReviewStatuses
{
    public const string NotRun = "NOT_RUN";
    public const string Passed = "PASSED";
    public const string Failed = "FAILED";
    public const string Ambiguous = "AMBIGUOUS";
}

public static class AiV3SemanticReasonCodes
{
    public const string DirectNegation = "DIRECT_NEGATION";
    public const string RelatedOnly = "RELATED_ONLY";
    public const string ActorNotIdentified = "ACTOR_NOT_IDENTIFIED";
    public const string ScopeMismatch = "SCOPE_MISMATCH";
    public const string InferenceRequired = "INFERENCE_REQUIRED";
    public const string Ambiguous = "AMBIGUOUS";

    public static readonly HashSet<string> All = new(StringComparer.Ordinal)
    {
        DirectNegation,
        RelatedOnly,
        ActorNotIdentified,
        ScopeMismatch,
        InferenceRequired,
        Ambiguous
    };
}

public static class AiFailureCategories
{
    public const string HttpError = "HTTP_ERROR";
    public const string Refusal = "REFUSAL";
    public const string Incomplete = "INCOMPLETE";
    public const string SchemaError = "SCHEMA_ERROR";
    public const string SemanticError = "SEMANTIC_ERROR";
    public const string VisualSafetyError = "VISUAL_SAFETY_ERROR";
}

public static class AiQueueStates
{
    public const string None = "NONE";
    public const string Pending = "PENDING";
    public const string Running = "RUNNING";
    public const string RetryScheduled = "RETRY_SCHEDULED";
    public const string Cancelled = "CANCELLED";
}

public static class AiQueuedOperations
{
    public const string None = "NONE";
    public const string StoryPreview = "STORY_PREVIEW";
    public const string CaseTruth = "CASE_TRUTH";
    public const string TruthRepair = "TRUTH_REPAIR";
    public const string FullLogic = "FULL_LOGIC";
    public const string SceneLayout = "SCENE_LAYOUT";
    public const string FinalAssets = "FINAL_ASSETS";
    public const string RetryJson = "RETRY_JSON";
    public const string RegenerateAssets = "REGENERATE_ASSETS";
    public const string RegenerateFailedAssets = "REGENERATE_FAILED_ASSETS";
    public const string ImportPublish = "IMPORT_PUBLISH";
}

[BsonIgnoreExtraElements]
public class AiCaseDraft
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string Prompt { get; set; } = string.Empty;
    public AiDraftSettings Settings { get; set; } = new();
    public string Status { get; set; } = string.Empty;
    public string Provider { get; set; } = "OpenAI";
    public string CreatedByUserId { get; set; } = string.Empty;
    public string CreatedByRole { get; set; } = string.Empty;
    public AiStoryPreview StoryPreview { get; set; } = new();
    /// <summary>Server-owned non-spoiler diversity contract used before story generation.</summary>
    public AiStoryDiversityProfile StoryDiversity { get; set; } = new();
    /// <summary>SHA-256 of the normalized preview premise, used for duplicate diagnostics.</summary>
    public string StoryFingerprint { get; set; } = string.Empty;
    /// <summary>Missing/1 marks drafts created before the causal truth pipeline.</summary>
    public int LogicContractVersion { get; set; } = CaseLogicContractVersions.LegacyThreeClaim;
    public CaseTruthPackage? CaseTruth { get; set; }
    public string CaseTruthJson { get; set; } = string.Empty;
    public string TruthSchemaVersion { get; set; } = string.Empty;
    public string TruthHash { get; set; } = string.Empty;
    /// <summary>Server-owned target semantics allocated before truth generation.</summary>
    public string PlannedTargetKind { get; set; } = string.Empty;
    /// <summary>The last fully generated truth artifact saved before validation/review.</summary>
    public string TruthCheckpointArtifact { get; set; } = string.Empty;
    public CaseTruthFeasibilityReview TruthReviewerResult { get; set; } = new();
    public List<string> TruthValidationReport { get; set; } = new();
    public CaseTruthPackage? TruthRepairCandidate { get; set; }
    public string TruthRepairCandidateJson { get; set; } = string.Empty;
    public string TruthRepairStatus { get; set; } = AiRepairStatus.None;
    public List<string> TruthRepairValidationReport { get; set; } = new();
    public string TruthRepairInstructions { get; set; } = string.Empty;
    public string TruthRepairRecommendedArtifact { get; set; } = string.Empty;
    public string TruthRepairFromArtifact { get; set; } = string.Empty;
    public List<string> TruthRepairReasonCodes { get; set; } = new();
    public CaseTruthFeasibilityReview TruthRepairReviewerResult { get; set; } = new();
    public BlindSolvabilityReview BlindSolvabilityReview { get; set; } = new();
    public List<AiArtifactProvenance> ArtifactProvenance { get; set; } = new();
    public GameplayProjectionPlan? ProjectionPlan { get; set; }
    public string ProjectionPlanJson { get; set; } = string.Empty;
    public string ProjectionPlanSchemaVersion { get; set; } = string.Empty;
    public string ProjectionPlanHash { get; set; } = string.Empty;
    public string ProjectionContentJson { get; set; } = string.Empty;
    public string ProjectionContentHash { get; set; } = string.Empty;
    public string ProjectionBuildMode { get; set; } = string.Empty;
    public string ProjectionCompilerVersion { get; set; } = string.Empty;
    public string V3CrackContentJson { get; set; } = string.Empty;
    public string V3CrackContentHash { get; set; } = string.Empty;
    public AiCaseBlueprint? CaseBlueprint { get; set; }
    public string BlueprintJson { get; set; } = string.Empty;
    public string BlueprintSchemaVersion { get; set; } = string.Empty;
    public string BlueprintHash { get; set; } = string.Empty;
    public string CrackContractHash { get; set; } = string.Empty;
    public List<string> BlueprintValidationErrors { get; set; } = new();
    public AiV3SemanticReview V3SemanticReview { get; set; } = new();
    public AiAssetManifest AssetManifest { get; set; } = new();
    public string GeneratedJson { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string JsonFilePath { get; set; } = string.Empty;
    public string JsonFolderPath { get; set; } = string.Empty;
    public List<string> ValidationErrors { get; set; } = new();
    public string OriginalGeneratedJson { get; set; } = string.Empty;
    public string RepairedCandidateJson { get; set; } = string.Empty;
    public List<string> RepairValidationReport { get; set; } = new();
    public string RepairStatus { get; set; } = AiRepairStatus.None;
    public string RepairInstructions { get; set; } = string.Empty;
    public List<AiPlannedCall> PlannedCalls { get; set; } = new();
    public string PromptVersion { get; set; } = AiGenerationSchemaVersions.Prompt;
    public string SchemaVersion { get; set; } = AiGenerationSchemaVersions.CaseLogic;
    public string FailurePhase { get; set; } = AiFailurePhases.None;
    public List<string> FailedAssetIds { get; set; } = new();
    public List<AiGenerationAttempt> GenerationAttempts { get; set; } = new();
    /// <summary>CAS token for every authoritative workflow transition.</summary>
    public long WorkflowVersion { get; set; }
    public string QueuedOperation { get; set; } = AiQueuedOperations.None;
    public string QueueState { get; set; } = AiQueueStates.None;
    public string GenerationInputHash { get; set; } = string.Empty;
    public DateTime? NextAttemptAt { get; set; }
    public string LastGenerationErrorCode { get; set; } = string.Empty;
    public int QueueAttemptCount { get; set; }
    /// <summary>Identifies the single generation run that atomically claimed this draft.</summary>
    public string GenerationRunId { get; set; } = string.Empty;
    public string GenerationPhase { get; set; } = string.Empty;
    public int GenerationProgress { get; set; }
    public DateTime? GenerationClaimedAt { get; set; }
    /// <summary>Set when the draft has been imported into gameCases.</summary>
    public string? ImportedCaseId { get; set; }
    [BsonIgnoreIfNull]
    public string? IdempotencyKey { get; set; }
    public string QuotaDay { get; set; } = string.Empty;
    /// <summary>Unique while a paid draft is active; cleared on cancellation/import.</summary>
    [BsonIgnoreIfNull]
    public string? ActiveQuotaKey { get; set; }
    /// <summary>Unique per creator/day; retained after completion so cancellation does not refund the daily create.</summary>
    [BsonIgnoreIfNull]
    public string? DailyQuotaKey { get; set; }
    public decimal ReservedBudgetUsd { get; set; }
    public DateTime? CancelledAt { get; set; }
    public string CancelledByUserId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class AiDraftSettings
{
    public int StageCount { get; set; } = 4;
    public string Difficulty { get; set; } = "medium";
    public string VisualStyle { get; set; } = AiVisualStyleDefaults.PixelDetectiveTheme;
    public string GenerationMode { get; set; } = CaseGenerationModes.CameraEmbedded;
    public string GenerationPreset { get; set; } = AiGenerationPresets.NormalRandom;
    public string Language { get; set; } = CaseLanguages.English;
    public int MechanicsVersion { get; set; } = CaseMechanicsVersions.InvestigationV2;
    public bool IncludeCrackTheLie { get; set; }
    /// <summary>Requested crime archetype. RANDOM lets the server select a concrete type per draft.</summary>
    public string CaseType { get; set; } = AiCaseTypes.Random;
}

[BsonIgnoreExtraElements]
public class AiStoryDiversityProfile
{
    public string Seed { get; set; } = string.Empty;
    public string RequestedCaseType { get; set; } = AiCaseTypes.Random;
    public string CaseType { get; set; } = string.Empty;
    public string SettingArchetype { get; set; } = string.Empty;
    public string EraFlavor { get; set; } = string.Empty;
    public string IncidentPattern { get; set; } = string.Empty;
    public string EvidenceMotif { get; set; } = string.Empty;
    public string CulpritRelationship { get; set; } = string.Empty;
    public string MotiveArchetype { get; set; } = string.Empty;
    public string MethodArchetype { get; set; } = string.Empty;
    public string TwistArchetype { get; set; } = string.Empty;
    public string InvestigationMechanic { get; set; } = string.Empty;
    public string CoreFingerprint { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class AiV3SemanticReview
{
    public string Status { get; set; } = AiV3SemanticReviewStatuses.NotRun;
    public string SchemaVersion { get; set; } = AiGenerationSchemaVersions.V3SemanticReview;
    public List<AiV3PairEvaluation> PairEvaluations { get; set; } = new();
    public List<AiV3CrackReview> Cracks { get; set; } = new();
    public DateTime? ReviewedAt { get; set; }
}

[BsonIgnoreExtraElements]
public class AiV3CrackReview
{
    public string ChallengeId { get; set; } = string.Empty;
    public int ExpectedPairCount { get; set; }
    public List<AiV3PairEvaluation> PairEvaluations { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class AiV3PairEvaluation
{
    public string EvidenceId { get; set; } = string.Empty;
    public string TestimonyFragmentId { get; set; } = string.Empty;
    public bool IsValidContradiction { get; set; }
    public string ReasonCode { get; set; } = AiV3SemanticReasonCodes.Ambiguous;
    public string Reason { get; set; } = string.Empty;
    public double Confidence { get; set; }
}

[BsonIgnoreExtraElements]
public class AiStoryPreview
{
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string Setting { get; set; } = string.Empty;
    public string OpeningIncident { get; set; } = string.Empty;
    public string Tone { get; set; } = string.Empty;
    public string PlayerPromise { get; set; } = string.Empty;
    public int EstimatedScenes { get; set; }
    public List<string> KeyLocations { get; set; } = new();
    public List<string> SuspectTeasers { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class AiAssetManifest
{
    public string AssetRootUrl { get; set; } = string.Empty;
    public string AssetRootPath { get; set; } = string.Empty;
    public string AssetPipelineVersion { get; set; } = string.Empty;
    public string LogicModel { get; set; } = string.Empty;
    public string ImageModel { get; set; } = string.Empty;
    public List<AiGeneratedAsset> Assets { get; set; } = new();
    public DateTime? GeneratedAt { get; set; }
}

[BsonIgnoreExtraElements]
public class AiGeneratedAsset
{
    public string AssetType { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public string PromptSha256 { get; set; } = string.Empty;
    public bool QaPassed { get; set; }
    public string Model { get; set; } = string.Empty;
    public string PipelineVersion { get; set; } = string.Empty;
    public int? SourceWidth { get; set; }
    public int? SourceHeight { get; set; }
    public int? NormalizedWidth { get; set; }
    public int? NormalizedHeight { get; set; }
    public bool? HasAlpha { get; set; }
    public string ProcessingStatus { get; set; } = string.Empty;
    public string CloudinaryAssetId { get; set; } = string.Empty;
    public string CloudinaryPublicId { get; set; } = string.Empty;
    public int? CloudinaryVersion { get; set; }
    public string SecureUrl { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class AiPlannedCall
{
    public string Step { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public bool WouldCallApi { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string GenerationRunId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class AiGenerationLog
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string DraftId { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public string Response { get; set; } = string.Empty;
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class AiGenerationAttempt
{
    public string Step { get; set; } = string.Empty;
    public int AttemptNumber { get; set; }
    public string ResponseId { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string PromptVersion { get; set; } = string.Empty;
    public string SchemaVersion { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string FailureCategory { get; set; } = string.Empty;
    public string GenerationRunId { get; set; } = string.Empty;
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public string ResponseSha256 { get; set; } = string.Empty;
    public string RawResponsePath { get; set; } = string.Empty;
    public List<string> ValidationErrors { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
