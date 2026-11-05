using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.WebAPI;
using Xunit;

namespace SirLocked.Tests;

public class FrontendRedirectsTests
{
    private readonly FrontendRedirects _redirects = new(Options.Create(new EmailSettings
    {
        FrontendUrl = "https://game.example.test/"
    }));

    [Fact]
    public void LoginError_UsesConfiguredFrontendAndEscapesTheCode()
    {
        var url = _redirects.LoginError("provider failed");

        Assert.Equal("https://game.example.test/login?error=provider%20failed", url);
    }

    [Fact]
    public void EmailLinks_ArePlainAddressesAndEscapeTheToken()
    {
        var redirects = new FrontendRedirects(Options.Create(new EmailSettings { FrontendUrl = "https://game.example.test/" }));

        Assert.Equal("https://game.example.test/verify-email?token=a%2Bb%3D", redirects.VerifyEmail("a+b="));
        Assert.Equal("https://game.example.test/reset-password?token=a%2Bb%3D", redirects.ResetPassword("a+b="));
    }

    [Fact]
    public void OAuthCallback_UsesConfiguredFrontendAndEscapesTokens()
    {
        var url = _redirects.OAuthCallback("access+/=", "refresh?&");

        Assert.Equal(
            "https://game.example.test/oauth-callback#token=access%2B%2F%3D&refreshToken=refresh%3F%26",
            url);
    }
}
