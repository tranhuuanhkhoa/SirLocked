using System.ComponentModel.DataAnnotations;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.Investigation;

public class InspectItemRequest
{
    [Required]
    public string ItemId { get; set; } = string.Empty;
}

public class AskDialogueRequest
{
    [Required]
    public string DialogueId { get; set; } = string.Empty;
}

public class PresentEvidenceRequest
{
    [Required]
    public string DialogueId { get; set; } = string.Empty;

    [Required]
    public string EvidenceId { get; set; } = string.Empty;
}

public class GoToSceneRequest
{
    [Required]
    public string SceneId { get; set; } = string.Empty;
}

public class HotspotDto
{
    public string HotspotId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
    public int ZIndex { get; set; }
    public string Label { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
    public bool IsLocked { get; set; }
    public List<string> MissingClueIds { get; set; } = new();

    public static HotspotDto From(SceneHotspot h, IReadOnlySet<string> unlockedClues)
    {
        var missing = h.RequiredClueIds.Where(id => !unlockedClues.Contains(id)).ToList();
        return new HotspotDto
        {
            HotspotId = h.HotspotId,
            Type = h.Type,
            TargetId = h.TargetId,
            X = h.X,
            Y = h.Y,
            Width = h.Width,
            Height = h.Height,
            ZIndex = h.ZIndex,
            Label = h.Label,
            RequiredClueIds = h.RequiredClueIds,
            IsLocked = missing.Count > 0,
            MissingClueIds = missing
        };
    }
}

public class SceneItemDto
{
    public string ItemId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public bool IsInspected { get; set; }
    /// <summary>InspectText is only revealed after the item has been inspected.</summary>
    public string? InspectText { get; set; }

    public static SceneItemDto From(CaseItem item, bool inspected) => new()
    {
        ItemId = item.ItemId,
        Name = item.Name,
        Description = item.Description,
        ImageUrl = item.ImageUrl,
        IsInspected = inspected,
        InspectText = inspected ? item.InspectText : null
    };
}

public class SceneDialogueDto
{
    public string DialogueId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public string Question { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
    public bool IsLocked { get; set; }
    public List<string> MissingClueIds { get; set; } = new();
    public bool IsAsked { get; set; }
    /// <summary>The answer is only revealed once the dialogue has been asked.</summary>
    public string? Answer { get; set; }

    public static SceneDialogueDto From(CaseDialogue d, IReadOnlySet<string> unlockedClues, bool asked)
    {
        var missing = d.RequiredClueIds.Where(id => !unlockedClues.Contains(id)).ToList();
        return new SceneDialogueDto
        {
            DialogueId = d.DialogueId,
            CharacterId = d.CharacterId,
            Question = d.Question,
            RequiredClueIds = d.RequiredClueIds,
            IsLocked = missing.Count > 0,
            MissingClueIds = missing,
            IsAsked = asked,
            Answer = asked ? d.Answer : null
        };
    }
}

public class ClueDto
{
    public string ClueId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public bool IsCritical { get; set; }
    public bool IsEvidence { get; set; }
    public string Source { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;

    // isRedHerring is intentionally NOT exposed to players: spotting red herrings is gameplay.
    public static ClueDto From(CaseClue c) => new()
    {
        ClueId = c.ClueId,
        Title = c.Title,
        Content = c.Content,
        IsCritical = c.IsCritical,
        IsEvidence = c.IsEvidence,
        Source = c.Source,
        SourceType = c.SourceType
    };
}

public class VisibleSceneDto
{
    public string SceneId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string BackgroundUrl { get; set; } = string.Empty;
    public List<HotspotDto> Hotspots { get; set; } = new();
    public List<SceneItemDto> Items { get; set; } = new();
    public List<CaseCharacterDto> Characters { get; set; } = new();
    public List<SceneDialogueDto> AvailableDialogues { get; set; } = new();
}

public class SceneMapEntryDto
{
    public string SceneId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public bool IsCurrent { get; set; }
    public bool IsVisited { get; set; }
    public bool IsCompleted { get; set; }
}

public class ActionLogEntryDto
{
    public string ActionType { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public class GameStateResponse
{
    public string RoomId { get; set; } = string.Empty;
    public string RoomCode { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string CaseSummary { get; set; } = string.Empty;
    public string RoomStatus { get; set; } = string.Empty;
    public string CurrentStageId { get; set; } = string.Empty;
    public string CurrentSceneId { get; set; } = string.Empty;
    public long Version { get; set; }
    public List<RoomPlayerDto> Players { get; set; } = new();
    public List<string> VisitedSceneIds { get; set; } = new();
    public List<string> InspectedItemIds { get; set; } = new();
    public List<string> CollectedItemIds { get; set; } = new();
    public List<string> UnlockedClueIds { get; set; } = new();
    public List<string> AskedDialogueIds { get; set; } = new();
    public List<string> CompletedSceneIds { get; set; } = new();
    public List<string> CompletedStageIds { get; set; } = new();
    public List<string> SelectedEvidenceIds { get; set; } = new();
    public string GameStatus { get; set; } = string.Empty;
    public bool AvailableForAccusation { get; set; }
    public bool CurrentSceneCanComplete { get; set; }
    public MissingRequirementsDto CurrentSceneMissingRequirements { get; set; } = new();
    public string CurrentObjective { get; set; } = string.Empty;
    public VisibleSceneDto VisibleScene { get; set; } = new();
    /// <summary>Full metadata for collected items, including items picked up in other scenes.</summary>
    public List<SceneItemDto> CollectedItems { get; set; } = new();
    public List<SceneMapEntryDto> SceneMap { get; set; } = new();
    public List<ClueDto> UnlockedClues { get; set; } = new();
    public List<ClueDto> EvidenceClues { get; set; } = new();
    /// <summary>All case characters: used by the final accusation suspect picker.</summary>
    public List<CaseCharacterDto> Suspects { get; set; } = new();
    public List<ActionLogEntryDto> ActionLog { get; set; } = new();
}

public class GameActionResponse
{
    public GameStateResponse State { get; set; } = new();
    public bool Changed { get; set; }
    public List<string> UnlockedClueIds { get; set; } = new();
    public string Message { get; set; } = string.Empty;
    /// <summary>Inspect text / dialogue answer for the action just performed.</summary>
    public string? Detail { get; set; }
}

public class MissingRequirementsDto
{
    public List<string> RequiredItemIds { get; set; } = new();
    public List<string> RequiredClueIds { get; set; } = new();
    public List<string> RequiredDialogueIds { get; set; } = new();
}
