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
    public CompleteCondition CompleteCondition { get; set; } = new();
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
    /// <summary>"item" or "dialogue".</summary>
    public string SourceType { get; set; } = "item";
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
