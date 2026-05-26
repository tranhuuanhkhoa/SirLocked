namespace SirLocked.API.DTOs.Investigation;

using SirLocked.API.Models;

public sealed class GameStateResponse
{
    public string RoomId { get; init; } = string.Empty;
    public string RoomCode { get; init; } = string.Empty;
    public string CaseId { get; init; } = string.Empty;
    public string CaseTitle { get; init; } = string.Empty;
    public string CaseSummary { get; init; } = string.Empty;
    public string Status { get; init; } = "WAITING";
    public string CurrentStageId { get; init; } = string.Empty;
    public string CurrentSceneId { get; init; } = string.Empty;
    public Stage? CurrentStage { get; init; }
    public Scene? CurrentScene { get; init; }
    public IReadOnlyList<Character> Characters { get; init; } = [];
    public IReadOnlyList<Item> SceneItems { get; init; } = [];
    public IReadOnlyList<Dialogue> AvailableDialogues { get; init; } = [];
    public IReadOnlyList<Clue> FoundClues { get; init; } = [];
    public IReadOnlyList<string> FoundItemIds { get; init; } = [];
    public IReadOnlyList<string> FoundClueIds { get; init; } = [];
    public IReadOnlyList<string> AskedDialogueIds { get; init; } = [];
    public IReadOnlyList<string> PresentedEvidenceIds { get; init; } = [];
    public IReadOnlyList<string> CompletedSceneIds { get; init; } = [];
    public IReadOnlyList<string> CompletedStageIds { get; init; } = [];
    public bool CanCompleteScene { get; init; }
    public bool CanCompleteStage { get; init; }
    public bool HasNextScene { get; init; }
    public bool HasNextStage { get; init; }
}

public sealed class InspectItemRequest
{
    public string ItemId { get; init; } = string.Empty;
}

public sealed class AskDialogueRequest
{
    public string DialogueId { get; init; } = string.Empty;
}

public sealed class PresentEvidenceRequest
{
    public string DialogueId { get; init; } = string.Empty;
    public string EvidenceId { get; init; } = string.Empty;
}

public sealed class AccuseRequest
{
    public string CulpritId { get; init; } = string.Empty;
    public string Motive { get; init; } = string.Empty;
    public string Method { get; init; } = string.Empty;
    public List<string> EvidenceIds { get; init; } = [];
}

public sealed class GameResultResponse
{
    public string ResultId { get; init; } = string.Empty;
    public string RoomId { get; init; } = string.Empty;
    public string CaseId { get; init; } = string.Empty;
    public string SubmittedByUserId { get; init; } = string.Empty;
    public bool Success { get; init; }
    public string Message { get; init; } = string.Empty;
    public IReadOnlyList<string> MissingEvidenceIds { get; init; } = [];
    public string CorrectCulpritId { get; init; } = string.Empty;
    public string CorrectMotive { get; init; } = string.Empty;
    public string CorrectMethod { get; init; } = string.Empty;
    public DateTime CompletedAt { get; init; }
}
