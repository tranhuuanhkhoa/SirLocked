using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class AiGenerationSchemaVersions
{
    public const string StoryPreview = "story-preview-v2";
    public const string CaseLogic = "case-logic-v2";
    public const string Prompt = "ai-case-prompt-v2";
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

    public static readonly HashSet<string> All = new(StringComparer.OrdinalIgnoreCase)
    {
        NormalRandom,
        FullFeature,
        ShortDemo,
        PuzzleHeavy,
        DialogueHeavy
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
    public const string FullLogicJson = "FULL_LOGIC_JSON";
    public const string PreAssetValidation = "PRE_ASSET_VALIDATION";
    public const string SceneLayout = "SCENE_LAYOUT";
    public const string VisualQa = "VISUAL_QA";
    public const string FinalAssets = "FINAL_ASSETS";
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
    /// <summary>Set when the draft has been imported into gameCases.</summary>
    public string? ImportedCaseId { get; set; }
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
}

[BsonIgnoreExtraElements]
public class AiPlannedCall
{
    public string Step { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public bool WouldCallApi { get; set; }
    public string Reason { get; set; } = string.Empty;
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
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public string ResponseSha256 { get; set; } = string.Empty;
    public string RawResponsePath { get; set; } = string.Empty;
    public List<string> ValidationErrors { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
