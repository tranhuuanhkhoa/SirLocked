using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using SirLocked.Api.Models.Enums;
using System.Text.Json.Serialization;

namespace SirLocked.Api.Models;

/// <summary>
/// Canonical case document. Shape mirrors ai-game-docs/samples/sample-case.json,
/// which is the contract shared by seed data, AI generation, validation, and the frontend renderer.
/// </summary>
[BsonIgnoreExtraElements]
public class GameCase
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string CaseId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string Language { get; set; } = CaseLanguages.English;
    [JsonPropertyName("art_style")]
    public string ArtStyle { get; set; } = AiVisualStyleDefaults.ArtStyle;
    [JsonPropertyName("sub_style")]
    public string SubStyle { get; set; } = AiVisualStyleDefaults.SubStyle;
    [JsonPropertyName("character_style")]
    public string CharacterStyle { get; set; } = AiVisualStyleDefaults.CharacterStyle;
    public string Status { get; set; } = CaseStatus.Draft;
    public int MechanicsVersion { get; set; } = CaseMechanicsVersions.Legacy;
    public string GenerationMode { get; set; } = CaseGenerationModes.LegacyItem;
    /// <summary>Server-owned generation profile. Empty for manually authored and legacy cases.</summary>
    public string GenerationPreset { get; set; } = string.Empty;
    /// <summary>Server-owned provenance for AI-generated cases.</summary>
    public string SourceAiDraftId { get; set; } = string.Empty;
    /// <summary>1 keeps legacy three-claim accusation; 2 requires the causal five-claim contract.</summary>
    public int LogicContractVersion { get; set; } = CaseLogicContractVersions.LegacyThreeClaim;
    public string LogicVerificationStatus { get; set; } = CaseLogicVerificationStatuses.LegacyUnverified;
    /// <summary>Server-owned reference to the approved spoiler truth. The truth itself is never stored here.</summary>
    public string TruthSchemaVersion { get; set; } = string.Empty;
    public string TruthHash { get; set; } = string.Empty;
    public string BlindReviewStatus { get; set; } = string.Empty;
    /// <summary>Server-owned audit reference for backend-compiled gameplay projections.</summary>
    public string ProjectionSchemaVersion { get; set; } = string.Empty;
    public string ProjectionPlanHash { get; set; } = string.Empty;
    public string ProjectionCompilerVersion { get; set; } = string.Empty;
    public string ProjectionBuildMode { get; set; } = string.Empty;
    /// <summary>Server-owned quality-gate result for AI-generated V3 cases.</summary>
    public string AiSemanticReviewStatus { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; }
    public string CoverImageUrl { get; set; } = string.Empty;

    public List<CaseStage> Stages { get; set; } = new();
    public List<CaseCharacter> Characters { get; set; } = new();
    public List<CaseItem> Items { get; set; } = new();
    public List<CaseClue> Clues { get; set; } = new();
    public List<CaseDialogue> Dialogues { get; set; } = new();
    public List<TestimonyFragment> TestimonyFragments { get; set; } = new();
    public List<ConversationNode> ConversationNodes { get; set; } = new();
    public List<EvidenceChallenge> EvidenceChallenges { get; set; } = new();
    public List<DeductionChallenge> Deductions { get; set; } = new();
    public List<RequiredTeamworkChain> RequiredTeamworkChains { get; set; } = new();
    public List<CaseHint> Hints { get; set; } = new();
    public List<CaseInteraction> Interactions { get; set; } = new();
    public List<CasePuzzle> Puzzles { get; set; } = new();
    public List<AlternateRewardPath> AlternateRewardPaths { get; set; } = new();
    public FinalLogic FinalLogic { get; set; } = new();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class CaseStage
{
    public string StageId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int Order { get; set; }
    public List<CaseScene> Scenes { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class CaseScene
{
    public string SceneId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string BackgroundUrl { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    /// <summary>English/ASCII art direction used only by the image pipeline.</summary>
    public string VisualDescription { get; set; } = string.Empty;
    public List<string> ItemIds { get; set; } = new();
    public List<string> CharacterIds { get; set; } = new();
    public List<SceneHotspot> Hotspots { get; set; } = new();
    public ScenePlacementPlan? PlacementPlan { get; set; }
    public SceneRuntime? Runtime { get; set; }
    public CompleteCondition CompleteCondition { get; set; } = new();
}

public static class CaseMechanicsVersions
{
    public const int Legacy = 1;
    public const int InvestigationV2 = 2;
    public const int InvestigationV3PairedConfrontation = 3;
}

public static class HintContextTypes
{
    public const string Scene = "SCENE";
    public const string Confrontation = "CONFRONTATION";
    public const string Deduction = "DEDUCTION";
}

public static class EvidenceClaimTypes
{
    public const string Motive = "MOTIVE";
    public const string Method = "METHOD";
    public const string Opportunity = "OPPORTUNITY";
    public const string Identity = "IDENTITY";
    public const string Timeline = "TIMELINE";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        Motive, Method, Opportunity
    };

    public static readonly IReadOnlySet<string> Causal = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        Motive, Method, Opportunity, Identity, Timeline
    };

    public static IReadOnlySet<string> ForContract(int logicContractVersion) =>
        logicContractVersion >= CaseLogicContractVersions.CausalFiveClaim ? Causal : All;

    public static IReadOnlyList<string> OrderedForContract(int logicContractVersion) =>
        logicContractVersion >= CaseLogicContractVersions.CausalFiveClaim
            ? new[] { Motive, Method, Opportunity, Identity, Timeline }
            : new[] { Motive, Method, Opportunity };
}

public static class CaseGenerationModes
{
    public const string LegacyItem = "LEGACY_ITEM";
    /// <summary>
    /// Empty room backgrounds are generated first; NPC and small evidence cutouts are placed by runtime afterwards.
    /// </summary>
    public const string PlacementFirst = "PLACEMENT_FIRST";
    public const string CameraEmbedded = "CAMERA_EMBEDDED";
}

/// <summary>
/// Canonical acquisition methods stored in CaseClue.SourceType/DiscoverMethod.
/// Values remain compatible with existing case JSON and runtime routing.
/// </summary>
public static class EvidenceAcquisitionMethods
{
    public const string CameraCapture = "CAMERA_CAPTURE";
    public const string ItemInspect = "ITEM_INSPECT";
    public const string PuzzleResult = "PUZZLE_RESULT";
    public const string EnvironmentInteraction = "ENVIRONMENT_INTERACTION";
    public const string ItemUse = "ITEM_USE";
    public const string ItemCombination = "ITEM_COMBINATION";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        CameraCapture,
        ItemInspect,
        PuzzleResult,
        EnvironmentInteraction,
        ItemUse,
        ItemCombination
    };

    public static string Normalize(string? value) =>
        All.FirstOrDefault(candidate => candidate.Equals(value?.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? string.Empty;
}

public static class EvidenceDiscoveryMethods
{
    public const string CameraCapture = "camera";
    public const string ItemInspect = "item";

    public static bool IsCamera(CaseClue clue) =>
        string.Equals(clue.SourceType, CameraCapture, StringComparison.OrdinalIgnoreCase)
        && string.Equals(clue.DiscoverMethod, CameraCapture, StringComparison.OrdinalIgnoreCase);

    public static bool IsItemInspect(CaseClue clue) =>
        string.Equals(clue.SourceType, ItemInspect, StringComparison.OrdinalIgnoreCase)
        && string.Equals(clue.DiscoverMethod, ItemInspect, StringComparison.OrdinalIgnoreCase);
}

public static class CaseLanguages
{
    public const string English = "en";
    public const string Vietnamese = "vi";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        English, Vietnamese
    };

    public static string Normalize(string? language) =>
        string.Equals(language?.Trim(), Vietnamese, StringComparison.OrdinalIgnoreCase)
            ? Vietnamese
            : English;
}

public static class CaseItemInteractionPurposes
{
    public const string UnlockDoor = "unlock-door";
    public const string CombineItem = "combine-item";
    public const string OperateMechanism = "operate-mechanism";
    public const string LegacyEvidence = "legacy-evidence";
    public const string Decorative = "decorative";
}

public static class CaseItemRenderModes
{
    public const string Cutout = "CUTOUT";
    public const string Embedded = "EMBEDDED";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        Cutout, Embedded
    };

    public static string Infer(CaseItem item) =>
        !item.IsCollectible && item.InteractionPurpose == CaseItemInteractionPurposes.OperateMechanism
            ? Embedded
            : Cutout;
}

public static class CaseInteractionTypes
{
    public const string UseItemOnTarget = "USE_ITEM_ON_TARGET";
    public const string CombineItems = "COMBINE_ITEMS";
    public const string InspectEnvironment = "INSPECT_ENVIRONMENT";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        UseItemOnTarget, CombineItems, InspectEnvironment
    };
}

public static class CasePuzzleTypes
{
    public const string CodePuzzle = "CODE_PUZZLE";
    public const string SequencePuzzle = "SEQUENCE_PUZZLE";
    public const string SymbolMatchPuzzle = "SYMBOL_MATCH_PUZZLE";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        CodePuzzle, SequencePuzzle, SymbolMatchPuzzle
    };
}

public static class PuzzleProgressionRoles
{
    public const string Required = "REQUIRED";
    public const string Optional = "OPTIONAL";
    public const string Alternate = "ALTERNATE";
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        Required, Optional, Alternate
    };
}

public static class ClueVisualTextPolicies
{
    public const string NoText = "NO_TEXT";
    public const string AbstractSymbols = "ABSTRACT_SYMBOLS";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        NoText, AbstractSymbols
    };

    public static string Normalize(string? value) =>
        string.Equals(value?.Trim(), AbstractSymbols, StringComparison.OrdinalIgnoreCase)
            ? AbstractSymbols
            : NoText;
}

[BsonIgnoreExtraElements]
public class ScenePlacementPlan
{
    public string SceneId { get; set; } = string.Empty;
    public int Width { get; set; } = 1600;
    public int Height { get; set; } = 900;
    public double FloorY { get; set; } = 720;
    public RuntimeBox WalkableArea { get; set; } = new();
    public Dictionary<string, SpawnPoint> SpawnPoints { get; set; } = new();
    public List<PlannedPlacement> Placements { get; set; } = new();
    public List<ClueZone> ClueZones { get; set; } = new();
    public List<TransitionZone> Transitions { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class PlannedPlacement
{
    public string Type { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
    public string Anchor { get; set; } = "center";
    public string Facing { get; set; } = "left";
    public string Surface { get; set; } = string.Empty;
    public string Lighting { get; set; } = string.Empty;
    public string Perspective { get; set; } = string.Empty;
    public int Depth { get; set; } = 5;
    public string Reason { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class SceneHotspot
{
    public string HotspotId { get; set; } = string.Empty;
    /// <summary>ITEM, CHARACTER, or ENVIRONMENT.</summary>
    public string Type { get; set; } = "ITEM";
    public string TargetId { get; set; } = string.Empty;
    /// <summary>Percent coordinates relative to the scene background.</summary>
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
    public int ZIndex { get; set; } = 1;
    public string Label { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class CompleteCondition
{
    /// <summary>AND (default) or OR.</summary>
    public string Logic { get; set; } = "AND";
    public List<string> RequiredItemIds { get; set; } = new();
    public List<string> RequiredClueIds { get; set; } = new();
    public List<string> RequiredDialogueIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class SceneRuntime
{
    public int Width { get; set; } = 1600;
    public int Height { get; set; } = 900;
    public double? FloorY { get; set; }
    public RuntimeBox? WalkableArea { get; set; }
    public Dictionary<string, SpawnPoint> SpawnPoints { get; set; } = new();
    public List<ItemPlacement> ItemPlacements { get; set; } = new();
    public List<CharacterPlacement> CharacterPlacements { get; set; } = new();
    public List<ClueZone> ClueZones { get; set; } = new();
    public CameraRules CameraRules { get; set; } = new();
    public List<TransitionZone> Transitions { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class RuntimePoint
{
    public double X { get; set; }
    public double Y { get; set; }
    public string Anchor { get; set; } = "bottom-center";
}

[BsonIgnoreExtraElements]
public class RuntimeSize
{
    public double Width { get; set; }
    public double Height { get; set; }
}

[BsonIgnoreExtraElements]
public class RuntimeBox
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
}

[BsonIgnoreExtraElements]
public class ClueZone
{
    public string ClueId { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public RuntimeBox Bounds { get; set; } = new();
    public string Shape { get; set; } = "rect";
    public string Surface { get; set; } = string.Empty;
    public string Visibility { get; set; } = "medium";
    public string DetectionDifficulty { get; set; } = "medium";
    public string DetectionStatus { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public string Source { get; set; } = string.Empty;
    public bool IsFallback { get; set; }
    public List<string> RequiredClueIds { get; set; } = new();
    public string Reason { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class CameraRules
{
    public double CaptureRectWidth { get; set; } = 180;
    public double CaptureRectHeight { get; set; } = 140;
    public double MinClueCoverage { get; set; } = 0.45;
    public double NearMissCoverage { get; set; } = 0.22;
    public bool RequireCaptureCenterInside { get; set; } = true;
}

[BsonIgnoreExtraElements]
public class SpawnPoint : RuntimePoint
{
    public string Direction { get; set; } = "right";
}

[BsonIgnoreExtraElements]
public class ItemPlacement
{
    public string ItemId { get; set; } = string.Empty;
    public string Asset { get; set; } = string.Empty;
    public RuntimePoint Position { get; set; } = new();
    public RuntimeSize Size { get; set; } = new();
    public RuntimeBox Hotspot { get; set; } = new();
    public RuntimeBox? ReservedSlot { get; set; }
    public string Anchor { get; set; } = "bottom-center";
    public int Depth { get; set; } = 5;
}

[BsonIgnoreExtraElements]
public class CharacterPlacement
{
    public string CharacterId { get; set; } = string.Empty;
    public string Asset { get; set; } = string.Empty;
    public RuntimePoint Position { get; set; } = new();
    public RuntimeSize Size { get; set; } = new();
    public RuntimeBox Hotspot { get; set; } = new();
    public RuntimeBox? ReservedSlot { get; set; }
    public string Anchor { get; set; } = "bottom-center";
    public string Direction { get; set; } = "left";
    public int? Depth { get; set; }
}

[BsonIgnoreExtraElements]
public class TransitionZone
{
    public string TransitionId { get; set; } = string.Empty;
    public string TargetSceneId { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public RuntimeBox Hotspot { get; set; } = new();
    public int Depth { get; set; } = 22;
}

[BsonIgnoreExtraElements]
public class CaseCharacter
{
    public string CharacterId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string VisualDescription { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class CaseItem
{
    public string ItemId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string InspectText { get; set; } = string.Empty;
    public string VisualDescription { get; set; } = string.Empty;
    public string RenderMode { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public List<string> UnlockClueIds { get; set; } = new();
    public bool IsCollectible { get; set; } = true;
    public bool IsInteractivePuzzleObject { get; set; }
    public string InteractionPurpose { get; set; } = string.Empty;
    public string InteractionReason { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class CaseClue
{
    public string ClueId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public bool IsCritical { get; set; }
    public bool IsEvidence { get; set; }
    public bool IsRedHerring { get; set; }
    /// <summary>itemId or dialogueId the clue primarily comes from.</summary>
    public string Source { get; set; } = string.Empty;
    /// <summary>"item", "dialogue", or "camera".</summary>
    public string SourceType { get; set; } = "item";
    public string SceneId { get; set; } = string.Empty;
    public string DiscoverMethod { get; set; } = string.Empty;
    /// <summary>
    /// Canonical V3 acquisition method. Empty on legacy documents; validators derive it
    /// from SourceType/DiscoverMethod and the authored unlock graph when needed.
    /// </summary>
    public string AcquisitionMethod { get; set; } = string.Empty;
    /// <summary>Approved true-timeline action that caused this clue; distinct from how players discover it.</summary>
    public string SourceActionId { get; set; } = string.Empty;
    public List<string> SupportsConclusionIds { get; set; } = new();
    public string IndependentSourceGroup { get; set; } = string.Empty;
    public string VisualDescription { get; set; } = string.Empty;
    public string VisualTextPolicy { get; set; } = ClueVisualTextPolicies.NoText;
    public string InventoryDescription { get; set; } = string.Empty;
    public string NarrativeMeaning { get; set; } = string.Empty;
    public int HintLevel { get; set; }
    public List<string> Tags { get; set; } = new();
    public List<string> RelatedCharacterIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class CaseDialogue
{
    public string DialogueId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public string Question { get; set; } = string.Empty;
    public string Answer { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
    public List<string> UnlockClueIds { get; set; } = new();
    public List<string> StatementIds { get; set; } = new();
    public List<string> AvailableSceneIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class TestimonyFragment
{
    public string Id { get; set; } = string.Empty;
    public string DialogueId { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class ConversationNode
{
    public string NodeId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public bool IsRoot { get; set; }
    public List<string> RequiredClueIds { get; set; } = new();
    public List<ConversationLine> Lines { get; set; } = new();
    public List<string> UnlockClueIds { get; set; } = new();
    public string? ChallengeId { get; set; }
    public List<ConversationChoice> Choices { get; set; } = new();
    public List<string> StatementIds { get; set; } = new();
    public List<string> AvailableSceneIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class ConversationLine
{
    public string Speaker { get; set; } = ConversationSpeakers.Npc;
    public string Text { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class ConversationChoice
{
    public string ChoiceId { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
    public string? NextNodeId { get; set; }
}

public static class ConversationSpeakers
{
    public const string Npc = "NPC";
    public const string Detective = "DETECTIVE";
}

[BsonIgnoreExtraElements]
public class EvidenceChallenge
{
    public int Order { get; set; }
    public bool IsSignature { get; set; }
    public string ChallengeId { get; set; } = string.Empty;
    public string DialogueId { get; set; } = string.Empty;
    public string TestimonyFragmentId { get; set; } = string.Empty;
    public List<string> CandidateTestimonyFragmentIds { get; set; } = new();
    /// <summary>
    /// V3-only testimony candidates that must be discovered before this Crack can start.
    /// Empty keeps backward compatibility by requiring every declared candidate.
    /// </summary>
    public List<string> StartRequiredTestimonyFragmentIds { get; set; } = new();
    public string Prompt { get; set; } = string.Empty;
    public string CorrectEvidenceId { get; set; } = string.Empty;
    public List<string> CandidateEvidenceIds { get; set; } = new();
    /// <summary>
    /// V3-only evidence candidates that must be discovered before this Crack can start.
    /// Empty keeps backward compatibility by requiring every declared candidate.
    /// </summary>
    public List<string> StartRequiredEvidenceIds { get; set; } = new();
    public string SuccessResponse { get; set; } = string.Empty;
    public string FailureResponse { get; set; } = string.Empty;
    /// <summary>V3-only shared headline shown after a correct paired confrontation.</summary>
    public string RevealTitle { get; set; } = string.Empty;
    public List<string> UnlockClueIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class CaseInteraction
{
    public string InteractionId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public List<string> RequiredItemIds { get; set; } = new();
    public List<string> RequiredClueIds { get; set; } = new();
    public List<string> UnlockItemIds { get; set; } = new();
    public List<string> UnlockClueIds { get; set; } = new();
    public List<string> UnlockSceneIds { get; set; } = new();
    public List<string> ConsumeItemIds { get; set; } = new();
    public string SuccessMessage { get; set; } = string.Empty;
    public string FailureMessage { get; set; } = string.Empty;
    public bool SingleUse { get; set; } = true;
}

[BsonIgnoreExtraElements]
public class CasePuzzle
{
    public string PuzzleId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public List<string> Options { get; set; } = new();
    public string CorrectCode { get; set; } = string.Empty;
    public List<string> CorrectSequence { get; set; } = new();
    public List<string> RequiredItemIds { get; set; } = new();
    public List<string> RequiredClueIds { get; set; } = new();
    public List<string> UnlockItemIds { get; set; } = new();
    public List<string> UnlockClueIds { get; set; } = new();
    public List<string> UnlockSceneIds { get; set; } = new();
    public string SuccessMessage { get; set; } = string.Empty;
    public string FailureMessage { get; set; } = string.Empty;
    public List<string> BasedOnTruthIds { get; set; } = new();
    public string InvestigationPurpose { get; set; } = string.Empty;
    public List<string> RevealsConclusionIds { get; set; } = new();
    public string ProgressionRole { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class AlternateRewardPath
{
    public string RewardId { get; set; } = string.Empty;
    public List<string> ProducerIds { get; set; } = new();
    public string Reason { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class CaseHint
{
    public string HintId { get; set; } = string.Empty;
    public string ContextType { get; set; } = HintContextTypes.Scene;
    public string TargetId { get; set; } = string.Empty;
    public int Order { get; set; }
    public string Text { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class DeductionChallenge
{
    public string DeductionId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
    public List<string> RequiredChallengeIds { get; set; } = new();
    public List<AccusationOption> Options { get; set; } = new();
    public string CorrectOptionId { get; set; } = string.Empty;
    public string SuccessResponse { get; set; } = string.Empty;
    public string FailureResponse { get; set; } = string.Empty;
    public List<string> UnlockClueIds { get; set; } = new();
    public string ConclusionId { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class RequiredTeamworkChain
{
    public string ChainId { get; set; } = string.Empty;
    public string InvestigatorClueId { get; set; } = string.Empty;
    public string InterrogatorChallengeId { get; set; } = string.Empty;
    public string DeductionId { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class AccusationOption
{
    public string Id { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class RequiredEvidenceLink
{
    public string ClaimType { get; set; } = string.Empty;
    /// <summary>Required for causal contract-v2 cases; empty on legacy three-claim cases.</summary>
    public string ConclusionId { get; set; } = string.Empty;
    public string EvidenceId { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class FinalLogic
{
    public string CulpritId { get; set; } = string.Empty;
    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public List<string> RequiredEvidenceIds { get; set; } = new();
    public List<AccusationOption> MotiveOptions { get; set; } = new();
    public List<AccusationOption> MethodOptions { get; set; } = new();
    public string CorrectMotiveId { get; set; } = string.Empty;
    public string CorrectMethodId { get; set; } = string.Empty;
    public List<RequiredEvidenceLink> RequiredEvidenceLinks { get; set; } = new();
    public List<string> RequiredDeductionIds { get; set; } = new();
    public List<string> RequiredTeamworkChainIds { get; set; } = new();
    public string WinEnding { get; set; } = string.Empty;
    public string FailEnding { get; set; } = string.Empty;
}
