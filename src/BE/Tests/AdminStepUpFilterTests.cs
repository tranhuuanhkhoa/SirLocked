using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Http;
using SirLocked.Api.DTOs;
using SirLocked.Api.WebAPI;
using SirLocked.Api.Services.Security;
using Xunit;

namespace SirLocked.Api.Tests;

public sealed class AdminStepUpFilterTests
{
    [Fact]
    public async Task MissingOrExpiredStepUpReturnsTheStableForbiddenError()
    {
        var filter = new RequireAdminStepUpFilter(new ExpiredStepUp());
        var context = new ActionExecutingContext(
            new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor()),
            [],
            new Dictionary<string, object?>(),
            new object());
        context.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "admin-id")], "test"));

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            filter.OnActionExecutionAsync(context, () => throw new Xunit.Sdk.XunitException("Action must not run.")));

        Assert.Equal(403, error.StatusCode);
        Assert.Equal("STEP_UP_REQUIRED", Assert.IsType<ApiErrorDetails>(error.Errors).Code);
    }

    private sealed class ExpiredStepUp : IAdminStepUpValidator
    {
        public Task<bool> HasStepUpAsync(string adminId, CancellationToken ct = default) => Task.FromResult(false);
    }
}
