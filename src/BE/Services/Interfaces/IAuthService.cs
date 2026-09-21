using SirLocked.Api.DTOs.Auth;

namespace SirLocked.Api.Services.Interfaces;

public interface IAuthService
{
    Task<AuthResponse> RegisterAsync(RegisterRequest request);
    Task<AuthResponse> LoginAsync(LoginRequest request);
    Task<AuthResponse> RefreshTokenAsync(RefreshTokenRequest request);
    Task<UserResponse> GetMeAsync(string userId);
    Task ChangePasswordAsync(string userId, ChangePasswordRequest request);
    Task<AuthResponse> GoogleLoginAsync(string email, string fullName);
    Task LogoutAsync(string userId);
    Task<object> ForgotPasswordAsync(ForgotPasswordRequest request);
    Task ResetPasswordAsync(ResetPasswordRequest request);
    Task<object> ResendVerificationAsync(string userId);
    Task VerifyEmailAsync(VerifyEmailRequest request);
    Task SeedAdminAsync(AdminSeedOptions options);
}
