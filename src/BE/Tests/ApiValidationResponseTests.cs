using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Routing;
using SirLocked.Api.DTOs;
using SirLocked.Api.WebAPI;
using Xunit;

namespace SirLocked.Tests;

public class ApiValidationResponseTests
{
    [Fact]
    public void InvalidModelState_UsesApiEnvelopeAndFirstFieldMessage()
    {
        var context = new ActionContext(
            new DefaultHttpContext(),
            new RouteData(),
            new ActionDescriptor());
        context.ModelState.AddModelError("Password", "Password must contain letters and numbers.");

        var result = Assert.IsType<BadRequestObjectResult>(ApiValidationResponseFactory.Create(context));
        var envelope = Assert.IsType<ApiResponse<object>>(result.Value);

        Assert.False(envelope.Success);
        Assert.Equal("Password must contain letters and numbers.", envelope.Message);
        var errors = Assert.IsType<Dictionary<string, string[]>>(envelope.Errors);
        Assert.Equal(["Password must contain letters and numbers."], errors["Password"]);
    }
}
