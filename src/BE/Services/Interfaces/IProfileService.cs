using SirLocked.Api.DTOs.Profile;

namespace SirLocked.Api.Services.Interfaces;

public interface IProfileService
{
    /// <summary>Builds the detective profile (solved/played, win rate, rank, optional fastest solve) for a user.</summary>
    Task<DetectiveProfileDto> GetProfileAsync(string userId, CancellationToken ct = default);

    /// <summary>
    /// Creator stats (cases authored + total plays). Returns null while GameCase has no
    /// author field, so cases cannot be attributed to a user.
    /// </summary>
    Task<CreatorStatsDto?> GetCreatorStatsAsync(string userId, CancellationToken ct = default);
}
