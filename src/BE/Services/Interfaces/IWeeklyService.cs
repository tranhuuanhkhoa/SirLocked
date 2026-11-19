using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.DTOs.Weekly;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Weekly;

namespace SirLocked.Api.Services.Interfaces;

public interface IWeeklyService
{
    Task<WeeklyFeatureDto?> GetActiveCaseOfWeekAsync(CancellationToken ct = default);
    Task<WeeklyFeatureDto?> GetActiveChallengeAsync(CancellationToken ct = default);
    Task<LeaderboardDto> GetChallengeLeaderboardAsync(int limit = 100, CancellationToken ct = default);
    Task<WeeklyFeatureDto> SetWeeklyFeatureAsync(CurrentUser user, SetWeeklyFeatureRequest request, CancellationToken ct = default);
    Task<bool> ClearWeeklyFeatureAsync(CurrentUser user, string type, CancellationToken ct = default);

    /// <summary>
    /// The challenge of this week, picking and storing one when the week has none yet (and auto-pick is on).
    /// Safe to call from many requests at once: the week ends up with exactly one document. Null when an admin
    /// stopped the week or no case can be picked.
    /// </summary>
    Task<WeeklyFeature?> EnsureChallengeAsync(ChallengeWeek week, CancellationToken ct = default);

    /// <summary>The active challenge stored for this week, or null. Only reads; never picks.</summary>
    Task<WeeklyFeature?> FindChallengeAsync(ChallengeWeek week, CancellationToken ct = default);
}
