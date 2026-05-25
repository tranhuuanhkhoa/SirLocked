using SirLocked.API.DTOs.Users;

namespace SirLocked.API.Services;

public interface IUserService
{
    Task<UserProfileResponse?> GetByIdAsync(string id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<UserProfileResponse>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<UserProfileResponse?> UpdateProfileAsync(string id, UpdateProfileRequest request, CancellationToken cancellationToken = default);
    Task<UserProfileResponse?> LockAsync(string id, CancellationToken cancellationToken = default);
    Task<UserProfileResponse?> UnlockAsync(string id, CancellationToken cancellationToken = default);
}
