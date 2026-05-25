using SirLocked.API.Models;

namespace SirLocked.API.Services;

public interface IJwtService
{
    (string Token, DateTime ExpiresAt) CreateAccessToken(User user);
}
