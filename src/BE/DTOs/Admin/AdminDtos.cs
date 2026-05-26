namespace SirLocked.API.DTOs.Admin;

public sealed class AdminDashboardResponse
{
    public long TotalUsers { get; init; }
    public long TotalCases { get; init; }
    public long TotalRooms { get; init; }
    public long TotalResults { get; init; }
}

public sealed class AdminActionLogResponse
{
    public string Id { get; init; } = string.Empty;
    public string RoomId { get; init; } = string.Empty;
    public string UserId { get; init; } = string.Empty;
    public string ActionType { get; init; } = string.Empty;
    public string PayloadJson { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
}

public sealed class CreateAiCaseRequest
{
    public string Prompt { get; init; } = string.Empty;
    public int StageCount { get; init; } = 3;
    public string VisualStyle { get; init; } = "cinematic detective";
}

public sealed class AiCaseDraftResponse
{
    public string DraftId { get; init; } = string.Empty;
    public string Prompt { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public string GeneratedJson { get; init; } = string.Empty;
}

public sealed class UploadImageResponse
{
    public string Url { get; init; } = string.Empty;
    public string Status { get; init; } = "MOCK_PENDING";
}
