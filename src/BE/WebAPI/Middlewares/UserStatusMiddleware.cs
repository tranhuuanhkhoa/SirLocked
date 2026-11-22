using System.Security.Claims;
using MongoDB.Driver;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.WebAPI.Middlewares;

/// <summary>Blocks LOCKED/DELETED accounts from all authenticated endpoints even when their JWT is still valid.</summary>
public class UserStatusMiddleware
{
    private readonly RequestDelegate _next;

    public UserStatusMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, MongoDbContext db, IOptions<AdminSecuritySettings> adminSecurity)
    {
        var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!string.IsNullOrEmpty(userId))
        {
            var user = await db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync();
            if (user is null || user.Status != UserStatus.Active)
            {
                throw ApiException.Forbidden("This account is locked or no longer exists.");
            }

            var versionClaim = context.User.FindFirstValue(User.AuthorizationVersionClaim);
            if (!long.TryParse(versionClaim, out var issuedVersion)
                || issuedVersion != user.AuthorizationVersion)
            {
                throw ApiException.Unauthorized("Your session is no longer valid. Please sign in again.");
            }

            if (adminSecurity.Value.RequireTwoFactor
                && user.Role == UserRole.Admin
                && context.Request.Path.StartsWithSegments("/api/admin")
                && !user.TwoFactorEnabled)
            {
                throw ApiException.Forbidden("Set up two-factor authentication to access admin endpoints.",
                    "TWO_FACTOR_SETUP_REQUIRED", "auth.twoFactorSetupRequired");
            }
        }

        await _next(context);
    }
}
