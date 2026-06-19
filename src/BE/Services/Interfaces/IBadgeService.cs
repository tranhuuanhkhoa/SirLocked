using SirLocked.Api.DTOs.Badge;

namespace SirLocked.Api.Services.Interfaces;

public interface IBadgeService
{
    Task<List<BadgeDto>> GetUserBadgesAsync(string userId, CancellationToken ct = default);
}
