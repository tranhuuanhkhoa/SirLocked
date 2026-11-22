using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using SirLocked.Api.DTOs;
using SirLocked.Api.Services.Security;

namespace SirLocked.Api.WebAPI;

[AttributeUsage(AttributeTargets.Method)]
public sealed class RequireAdminStepUpAttribute : TypeFilterAttribute
{
    public RequireAdminStepUpAttribute() : base(typeof(RequireAdminStepUpFilter)) { }
}

public sealed class RequireAdminStepUpFilter(IAdminStepUpValidator security) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var adminId = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(adminId) || !await security.HasStepUpAsync(adminId, context.HttpContext.RequestAborted))
            throw ApiException.Forbidden("Re-authenticate before performing this action.",
                "STEP_UP_REQUIRED", "admin.stepUpRequired");

        await next();
    }
}
