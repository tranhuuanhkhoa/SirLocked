using SirLocked.Api.DTOs.Auth;

namespace SirLocked.Api.Services.Interfaces;

public interface IAdminService
{
    Task<object> GetDashboardAsync();
    Task<List<UserResponse>> GetUsersAsync();
    Task<UserResponse> SetUserStatusAsync(string userId, string status);
    Task<UserResponse> SetUserRoleAsync(string userId, string role);
}
