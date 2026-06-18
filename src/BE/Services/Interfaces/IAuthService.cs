using SirLocked.Api.DTOs.Auth;

namespace SirLocked.Api.Services.Interfaces;

public interface IAuthService
{
    Task<AuthResponse> RegisterAsync(RegisterRequest request);
    Task<AuthResponse> LoginAsync(LoginRequest request);
    Task<UserResponse> GetMeAsync(string userId);
    Task SeedAdminAsync(AdminSeedOptions options);
}
