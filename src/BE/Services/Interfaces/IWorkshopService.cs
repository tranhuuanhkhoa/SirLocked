using SirLocked.Api.DTOs.Workshop;

namespace SirLocked.Api.Services.Interfaces;

public interface IWorkshopService
{
    /// <summary>
    /// Lists published cases for the Workshop hub with search, sort and paging.
    /// Aggregates play statistics from gameResults in a single grouped pass (no N+1).
    /// </summary>
    Task<WorkshopCaseListDto> GetWorkshopCasesAsync(
        string? search, string? sort, int page, int pageSize, CancellationToken ct = default);

    /// <summary>Computes the full statistics panel for one published case.</summary>
    Task<CaseStatsDto> GetCaseStatsAsync(string caseId, CancellationToken ct = default);
}
