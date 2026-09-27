using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using SirLocked.Api.WebAPI.Middlewares;
using Xunit;

namespace SirLocked.Tests;

public class CorrelationIdMiddlewareTests
{
    [Fact]
    public async Task ValidClientCorrelationId_IsUsedForTraceAndResponse()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers[CorrelationIdMiddleware.HeaderName] = "client-request-123";
        var middleware = CreateMiddleware();

        await middleware.InvokeAsync(context);

        Assert.Equal("client-request-123", context.TraceIdentifier);
        Assert.Equal("client-request-123", context.Response.Headers[CorrelationIdMiddleware.HeaderName]);
    }

    [Fact]
    public async Task InvalidClientCorrelationId_FallsBackToServerTraceIdentifier()
    {
        var context = new DefaultHttpContext { TraceIdentifier = "server-request-456" };
        context.Request.Headers[CorrelationIdMiddleware.HeaderName] = "contains spaces";
        var middleware = CreateMiddleware();

        await middleware.InvokeAsync(context);

        Assert.Equal("server-request-456", context.TraceIdentifier);
        Assert.Equal("server-request-456", context.Response.Headers[CorrelationIdMiddleware.HeaderName]);
    }

    private static CorrelationIdMiddleware CreateMiddleware() =>
        new(async context => await context.Response.StartAsync(),
            NullLogger<CorrelationIdMiddleware>.Instance);
}
