using SirLocked.API.Models;

namespace SirLocked.API.DTOs.Case;

public sealed class ImportCaseRequest
{
    public GameCase Case { get; init; } = new();
}

public sealed class CaseListResponse
{
    public string Id { get; init; } = string.Empty;
    public string CaseId { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Summary { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public int EstimatedMinutes { get; init; }
}

public sealed class CaseDetailResponse
{
    public GameCase Case { get; init; } = new();
}

public sealed class CaseValidationResult
{
    public bool IsValid => Errors.Count == 0;
    public List<string> Errors { get; init; } = [];
}
