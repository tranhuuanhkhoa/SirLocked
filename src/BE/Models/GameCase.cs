using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.API.Models;

public sealed class GameCase
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public string CaseId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string Status { get; set; } = "DRAFT";
    public int EstimatedMinutes { get; set; }
    public List<Stage> Stages { get; set; } = [];
    public List<Character> Characters { get; set; } = [];
    public List<Item> Items { get; set; } = [];
    public List<Clue> Clues { get; set; } = [];
    public List<Dialogue> Dialogues { get; set; } = [];
    public FinalCaseLogic FinalLogic { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class Stage
{
    public string StageId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int Order { get; set; }
    public List<Scene> Scenes { get; set; } = [];
}

public sealed class Scene
{
    public string SceneId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string BackgroundUrl { get; set; } = string.Empty;
    public List<string> ItemIds { get; set; } = [];
    public List<string> CharacterIds { get; set; } = [];
}

public sealed class Character
{
    public string CharacterId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
}

public sealed class Item
{
    public string ItemId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public List<string> UnlockClueIds { get; set; } = [];
}

public sealed class Clue
{
    public string ClueId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public bool IsCritical { get; set; }
}

public sealed class Dialogue
{
    public string DialogueId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public string Question { get; set; } = string.Empty;
    public string Answer { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = [];
    public List<string> UnlockClueIds { get; set; } = [];
}

public sealed class FinalCaseLogic
{
    public string CulpritId { get; set; } = string.Empty;
    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public List<string> RequiredEvidenceIds { get; set; } = [];
}
