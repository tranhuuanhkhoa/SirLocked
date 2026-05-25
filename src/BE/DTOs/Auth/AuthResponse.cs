using SirLocked.API.DTOs.Users;

namespace SirLocked.API.DTOs.Auth;

public sealed class AuthResponse
{
    public string AccessToken { get; init; } = string.Empty;
    public DateTime ExpiresAt { get; init; }
    public UserProfileResponse User { get; init; } = new();
}
