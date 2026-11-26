using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using SirLocked.Api.WebAPI;
using Xunit;

namespace SirLocked.Tests;

public sealed class AuthCookiesTests
{
    [Theory]
    [InlineData("Development", "http", false)]
    [InlineData("Development", "https", true)]
    [InlineData("Production", "http", true)]
    public void SetRefresh_UsesTheRequiredCookieAttributes(string environmentName, string scheme, bool secure)
    {
        var (context, services) = CreateContext(environmentName, scheme);
        using (services)
        {
            AuthCookies.SetRefresh(context.Response, "refresh-value", DateTime.UtcNow.AddDays(7));

            var cookie = context.Response.Headers.SetCookie.ToString();
            Assert.Contains("sirlocked_refresh=refresh-value", cookie, StringComparison.Ordinal);
            Assert.Contains("path=/api/auth", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("expires=", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(secure, cookie.Contains("secure", StringComparison.OrdinalIgnoreCase));
        }
    }

    [Fact]
    public void ClearRefresh_ExpiresTheScopedHttpOnlyCookie()
    {
        var (context, services) = CreateContext("Development", "http");
        using (services)
        {
            AuthCookies.ClearRefresh(context.Response);

            var cookie = context.Response.Headers.SetCookie.ToString();
            Assert.Contains("sirlocked_refresh=", cookie, StringComparison.Ordinal);
            Assert.Contains("path=/api/auth", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("expires=", cookie, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void AdminSide_HasItsOwnCookie_WithTheSameAttributes()
    {
        var (context, services) = CreateContext("Production", "https");
        using (services)
        {
            AuthCookies.SetRefresh(context.Response, "admin-value", DateTime.UtcNow.AddDays(7), AuthSessionSide.Admin);

            var cookie = context.Response.Headers.SetCookie.ToString();
            Assert.StartsWith("sirlocked_admin_refresh=admin-value", cookie, StringComparison.Ordinal);
            Assert.DoesNotContain("sirlocked_refresh=", cookie, StringComparison.Ordinal);
            Assert.Contains("path=/api/auth", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Theory]
    [InlineData("admin", AuthSessionSide.Admin)]
    [InlineData("player", AuthSessionSide.Player)]
    [InlineData("Admin", AuthSessionSide.Player)]
    [InlineData(null, AuthSessionSide.Player)]
    public void SideOf_ReadsTheSessionHeader(string? header, AuthSessionSide expected)
    {
        var context = new DefaultHttpContext();
        if (header is not null) context.Request.Headers[AuthCookies.SessionHeader] = header;
        Assert.Equal(expected, AuthCookies.SideOf(context.Request));
    }

    private static (DefaultHttpContext Context, ServiceProvider Services) CreateContext(string environmentName, string scheme)
    {
        var services = new ServiceCollection()
            .AddSingleton<IWebHostEnvironment>(new TestEnvironment { EnvironmentName = environmentName })
            .BuildServiceProvider();
        var context = new DefaultHttpContext { RequestServices = services };
        context.Request.Scheme = scheme;
        return (context, services);
    }

    private sealed class TestEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "SirLocked";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = string.Empty;
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
