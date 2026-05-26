using SirLocked.API.DTOs.Case;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class CaseService : ICaseService
{
    private readonly ICaseRepository _cases;

    public CaseService(ICaseRepository cases)
    {
        _cases = cases;
    }

    public async Task<IReadOnlyList<CaseListResponse>> GetPublishedAsync(CancellationToken cancellationToken = default)
    {
        var cases = await _cases.GetPublishedAsync(cancellationToken);
        return cases.Select(MapToListResponse).ToList();
    }

    public async Task<IReadOnlyList<CaseListResponse>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var cases = await _cases.GetAllAsync(cancellationToken);
        return cases.Select(MapToListResponse).ToList();
    }

    public async Task<CaseDetailResponse?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        var gameCase = await _cases.GetByIdAsync(id, cancellationToken);
        return gameCase is null ? null : new CaseDetailResponse { Case = gameCase };
    }

    public Task<CaseValidationResult> ValidateAsync(ImportCaseRequest request, CancellationToken cancellationToken = default)
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(request.Case.Title)) errors.Add("Case title is required.");
        if (request.Case.Stages.Count == 0) errors.Add("At least one stage is required.");
        return Task.FromResult(new CaseValidationResult { Errors = errors });
    }

    public async Task<CaseDetailResponse> ImportAsync(ImportCaseRequest request, CancellationToken cancellationToken = default)
    {
        var gameCase = request.Case;
        gameCase.CaseId = string.IsNullOrWhiteSpace(gameCase.CaseId) ? $"case-{Guid.NewGuid():N}" : gameCase.CaseId;
        gameCase.Status = string.IsNullOrWhiteSpace(gameCase.Status) ? "DRAFT" : gameCase.Status;
        await _cases.CreateAsync(gameCase, cancellationToken);
        return new CaseDetailResponse { Case = gameCase };
    }

    private static CaseListResponse MapToListResponse(GameCase gameCase)
    {
        return new CaseListResponse
        {
            Id = gameCase.Id ?? string.Empty,
            CaseId = gameCase.CaseId,
            Title = gameCase.Title,
            Summary = gameCase.Summary,
            Status = gameCase.Status,
            EstimatedMinutes = gameCase.EstimatedMinutes
        };
    }
}
