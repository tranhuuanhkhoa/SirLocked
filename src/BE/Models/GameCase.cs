using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using SirLocked.Api.Models.Enums;

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
    public string Status { get; set; } = CaseStatus.Draft;
    public string GenerationMode { get; set; } = CaseGenerationModes.LegacyItem;
    public int EstimatedMinutes { get; set; }
    public string CoverImageUrl { get; set; } = string.Empty;

    public List<CaseStage> Stages { get; set; } = new();
    public List<CaseCharacter> Characters { get; set; } = new();
    public List<CaseItem> Items { get; set; } = new();
    public List<CaseClue> Clues { get; set; } = new();
    public List<CaseDialogue> Dialogues { get; set; } = new();
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
    public List<string> ItemIds { get; set; } = new();
    public List<string> CharacterIds { get; set; } = new();
    public List<SceneHotspot> Hotspots { get; set; } = new();
    public ScenePlacementPlan? PlacementPlan { get; set; }
    public SceneRuntime? Runtime { get; set; }
    public CompleteCondition CompleteCondition { get; set; } = new();
}

public static class CaseGenerationModes
{
    public const string LegacyItem = "LEGACY_ITEM";
    public const string CameraEmbedded = "CAMERA_EMBEDDED";
}

public static class CaseItemInteractionPurposes
{
    public const string UnlockDoor = "unlock-door";
    public const string CombineItem = "combine-item";
    public const string OperateMechanism = "operate-mechanism";
    public const string LegacyEvidence = "legacy-evidence";
    public const string Decorative = "decorative";
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
    /// <summary>ITEM or CHARACTER.</summary>
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
}

[BsonIgnoreExtraElements]
public class CaseItem
{
    public string ItemId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string InspectText { get; set; } = string.Empty;
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
    public string VisualDescription { get; set; } = string.Empty;
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
}

[BsonIgnoreExtraElements]
public class FinalLogic
{
    public string CulpritId { get; set; } = string.Empty;
    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public List<string> RequiredEvidenceIds { get; set; } = new();
    public string WinEnding { get; set; } = string.Empty;
    public string FailEnding { get; set; } = string.Empty;
}
