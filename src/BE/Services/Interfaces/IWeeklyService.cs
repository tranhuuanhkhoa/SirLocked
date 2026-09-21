using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.DTOs.Weekly;

namespace SirLocked.Api.Services.Interfaces;

public interface IWeeklyService
{
    Task<WeeklyFeatureDto?> GetActiveCaseOfWeekAsync(CancellationToken ct = default);
    Task<WeeklyFeatureDto?> GetActiveChallengeAsync(CancellationToken ct = default);
    Task<LeaderboardDto> GetChallengeLeaderboardAsync(int limit = 100, CancellationToken ct = default);
    Task<WeeklyFeatureDto> SetWeeklyFeatureAsync(CurrentUser user, SetWeeklyFeatureRequest request, CancellationToken ct = default);
    Task<bool> ClearWeeklyFeatureAsync(CurrentUser user, string type, CancellationToken ct = default);
}
