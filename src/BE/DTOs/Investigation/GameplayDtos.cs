namespace SirLocked.API.DTOs.Investigation;

public sealed class GameStateResponse
{
    public string RoomId { get; init; } = string.Empty;
    public string Status { get; init; } = "SCAFFOLD";
    public string CurrentStageId { get; init; } = string.Empty;
    public string CurrentSceneId { get; init; } = string.Empty;
    public IReadOnlyList<string> FoundItemIds { get; init; } = [];
    public IReadOnlyList<string> FoundClueIds { get; init; } = [];
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
    public bool Success { get; init; }
    public string Message { get; init; } = string.Empty;
}
