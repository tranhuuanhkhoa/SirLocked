using SirLocked.API.DTOs.Users;
using SirLocked.API.Helpers;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class UserService : IUserService
{
    private readonly IUserRepository _users;

    public UserService(IUserRepository users)
    {
        _users = users;
    }

    public async Task<UserProfileResponse?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        var user = await _users.GetByIdAsync(id, cancellationToken);
        return user is null ? null : MapToProfile(user);
    }

    public async Task<IReadOnlyList<UserProfileResponse>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var users = await _users.GetAllAsync(cancellationToken);
        return users.Select(MapToProfile).ToList();
    }

    public async Task<UserProfileResponse?> UpdateProfileAsync(string id, UpdateProfileRequest request, CancellationToken cancellationToken = default)
    {
        var user = await _users.GetByIdAsync(id, cancellationToken);
        if (user is null)
        {
            return null;
        }

        user.FullName = request.FullName.Trim();
        await _users.UpdateAsync(user, cancellationToken);
        return MapToProfile(user);
    }

    public async Task<UserProfileResponse?> LockAsync(string id, CancellationToken cancellationToken = default)
    {
        return await SetStatusAsync(id, UserStatuses.Locked, cancellationToken);
    }

    public async Task<UserProfileResponse?> UnlockAsync(string id, CancellationToken cancellationToken = default)
    {
        return await SetStatusAsync(id, UserStatuses.Active, cancellationToken);
    }

    public static UserProfileResponse MapToProfile(User user)
    {
        return new UserProfileResponse
        {
            Id = user.Id ?? string.Empty,
            FullName = user.FullName,
            Email = user.Email,
            Role = user.Role,
            Status = user.Status,
            CreatedAt = user.CreatedAt,
            UpdatedAt = user.UpdatedAt
        };
    }

    private async Task<UserProfileResponse?> SetStatusAsync(string id, string status, CancellationToken cancellationToken)
    {
        var user = await _users.GetByIdAsync(id, cancellationToken);
        if (user is null)
        {
            return null;
        }

        user.Status = status;
        await _users.UpdateAsync(user, cancellationToken);
        return MapToProfile(user);
    }
}
