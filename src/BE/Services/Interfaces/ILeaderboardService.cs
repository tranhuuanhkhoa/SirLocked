using SirLocked.Api.DTOs.Leaderboard;

namespace SirLocked.Api.Services.Interfaces;

public interface ILeaderboardService
{
    Task<LeaderboardDto> GetCaseLeaderboardAsync(
        string caseId, string? metric, int limit = 100, CancellationToken ct = default);
}
