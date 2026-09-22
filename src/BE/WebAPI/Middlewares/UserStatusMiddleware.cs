using System.Security.Claims;
using MongoDB.Driver;
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

    public async Task InvokeAsync(HttpContext context, MongoDbContext db)
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
            if (long.TryParse(versionClaim, out var issuedVersion)
                && issuedVersion != user.AuthorizationVersion)
            {
                throw ApiException.Unauthorized("Your session is no longer valid. Please sign in again.");
            }
        }

        await _next(context);
    }
}
