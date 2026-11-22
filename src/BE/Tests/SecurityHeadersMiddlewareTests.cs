using Microsoft.AspNetCore.Http;
using SirLocked.Api.WebAPI.Middlewares;
using Xunit;

namespace SirLocked.Tests;

public sealed class SecurityHeadersMiddlewareTests
{
    [Theory]
    [InlineData("/api/auth/login", true)]
    [InlineData("/live", false)]
    [InlineData("/signin-google", false)]
    public async Task AddsSecurityHeadersAndScopesApiCsp(string path, bool hasApiCsp)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        var middleware = new SecurityHeadersMiddleware(httpContext =>
        {
            if (httpContext.Request.Path == "/signin-google")
                httpContext.Response.Redirect("/api/auth/google/callback");
            return Task.CompletedTask;
        });

        await middleware.InvokeAsync(context);

        Assert.Equal("nosniff", context.Response.Headers["X-Content-Type-Options"]);
        Assert.Equal("DENY", context.Response.Headers["X-Frame-Options"]);
        Assert.Equal("strict-origin-when-cross-origin", context.Response.Headers["Referrer-Policy"]);
        Assert.Equal("camera=(), geolocation=(), microphone=(self)", context.Response.Headers["Permissions-Policy"]);
        if (hasApiCsp)
            Assert.Equal("default-src 'none'; frame-ancestors 'none'", context.Response.Headers["Content-Security-Policy"]);
        else
            Assert.False(context.Response.Headers.ContainsKey("Content-Security-Policy"));
    }
}
