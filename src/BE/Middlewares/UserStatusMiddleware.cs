using System.Security.Claims;
using SirLocked.API.Helpers;
using SirLocked.API.Repositories;

namespace SirLocked.API.Middlewares;

public sealed class UserStatusMiddleware
{
    private readonly RequestDelegate _next;

    public UserStatusMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, IUserRepository users)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!string.IsNullOrWhiteSpace(userId))
            {
                var user = await users.GetByIdAsync(userId, context.RequestAborted);
                if (user is null)
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    await context.Response.WriteAsJsonAsync(ApiResponse<object>.Fail("User no longer exists."));
                    return;
                }

                if (user.Status == UserStatuses.Locked)
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsJsonAsync(ApiResponse<object>.Fail("This account is locked."));
                    return;
                }
            }
        }

        await _next(context);
    }
}
