using System.Net;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.WebAPI;
using SirLocked.Api.WebAPI.Controllers;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class GoogleAuthenticationFlowTests
{
    private const string Frontend = "https://game.example.test";

    [Theory]
    [InlineData("missing-state")]
    [InlineData("invalid-state")]
    [InlineData("missing-correlation-cookie")]
    [InlineData("wrong-correlation-cookie")]
    public async Task InvalidRoundTrip_RedirectsSafelyWithoutAuthenticating(string failure)
    {
        using var transport = new FakeGoogleTransport();
        using var server = CreateServer(transport);
        using var client = server.CreateClient();
        client.BaseAddress = new Uri("https://api.example.test");
        var challenge = await ChallengeAsync(client);
        var state = failure switch
        {
            "missing-state" => "",
            "invalid-state" => "invalid-test-state",
            _ => challenge.State
        };
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"/signin-google?code=test-code&state={Uri.EscapeDataString(state)}&returnUrl=https://untrusted.example.test");
        if (failure == "wrong-correlation-cookie")
            request.Headers.Add("Cookie", challenge.Cookie.Split('=')[0] + "=wrong-test-marker");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal($"{Frontend}/login?error=google_failed", response.Headers.Location!.ToString());
        Assert.Equal(0, transport.Calls);
        AssertNoExternalSignIn(response);
        Assert.DoesNotContain("test-code", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task CorrelatedCallback_UsesFakeBackchannelAndSignsInTheExternalIdentity()
    {
        using var transport = new FakeGoogleTransport();
        using var server = CreateServer(transport);
        using var client = server.CreateClient();
        client.BaseAddress = new Uri("https://api.example.test");
        var challenge = await ChallengeAsync(client);
        using var callback = new HttpRequestMessage(HttpMethod.Get,
            $"/signin-google?code=test-code&state={Uri.EscapeDataString(challenge.State)}");
        callback.Headers.Add("Cookie", challenge.Cookie);

        using var response = await client.SendAsync(callback);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal("/complete", response.Headers.Location!.ToString());
        Assert.Equal(2, transport.Calls);
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"),
            value => value.StartsWith("test.external=", StringComparison.Ordinal));
        using var completed = new HttpRequestMessage(HttpMethod.Get, "/complete");
        completed.Headers.Add("Cookie", cookie.Split(';')[0]);
        using var signedIn = await client.SendAsync(completed);
        Assert.Equal(HttpStatusCode.OK, signedIn.StatusCode);
        Assert.Equal("test-user@example.invalid", await signedIn.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task GoogleAuthControllerCallback_SetsRefreshCookieAndRedirectsWithoutTokens()
    {
        using var transport = new FakeGoogleTransport();
        using var server = CreateServer(transport);
        using var client = server.CreateClient();
        client.BaseAddress = new Uri("https://api.example.test");
        var challenge = await ChallengeAuthCallbackAsync(client);
        using var providerCallback = new HttpRequestMessage(HttpMethod.Get,
            $"/signin-google?code=test-code&state={Uri.EscapeDataString(challenge.State)}");
        providerCallback.Headers.Add("Cookie", challenge.Cookie);
        using var providerResponse = await client.SendAsync(providerCallback);

        Assert.Equal(HttpStatusCode.Redirect, providerResponse.StatusCode);
        Assert.False(providerResponse.Headers.Contains("Content-Security-Policy"));
        var externalCookie = Assert.Single(providerResponse.Headers.GetValues("Set-Cookie"),
            value => value.StartsWith("test.external=", StringComparison.Ordinal));
        using var callback = new HttpRequestMessage(HttpMethod.Get, "/api/auth/google/callback");
        callback.Headers.Add("Cookie", externalCookie.Split(';')[0]);
        using var response = await client.SendAsync(callback);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal($"{Frontend}/oauth-callback", response.Headers.Location!.ToString());
        Assert.DoesNotContain("token", response.Headers.Location.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("refreshToken", response.Headers.Location.ToString(), StringComparison.OrdinalIgnoreCase);
        var refreshCookie = Assert.Single(response.Headers.GetValues("Set-Cookie"),
            value => value.StartsWith("sirlocked_refresh=", StringComparison.Ordinal));
        Assert.Contains("HttpOnly", refreshCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("SameSite=Strict", refreshCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Path=/api/auth", refreshCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Expires=", refreshCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Secure", refreshCookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ProviderAccessDenied_ReturnsCancellationWithoutAnExternalSession()
    {
        using var transport = new FakeGoogleTransport();
        using var server = CreateServer(transport);
        using var client = server.CreateClient();
        client.BaseAddress = new Uri("https://api.example.test");
        var challenge = await ChallengeAsync(client);
        using var callback = new HttpRequestMessage(HttpMethod.Get,
            $"/signin-google?error=access_denied&error_description=provider-message&state={Uri.EscapeDataString(challenge.State)}");
        callback.Headers.Add("Cookie", challenge.Cookie);

        using var response = await client.SendAsync(callback);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal($"{Frontend}/login?error=google_cancelled", response.Headers.Location!.ToString());
        Assert.Equal(0, transport.Calls);
        AssertNoExternalSignIn(response);
    }

    private static async Task<(string State, string Cookie)> ChallengeAsync(HttpClient client)
    {
        using var response = await client.GetAsync("/start");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var redirect = response.Headers.Location!;
        var query = QueryHelpers.ParseQuery(redirect.Query);
        Assert.Equal("https://api.example.test/signin-google", query["redirect_uri"].ToString());
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=none", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/signin-google", cookie, StringComparison.OrdinalIgnoreCase);
        return (query["state"].ToString(), cookie.Split(';')[0]);
    }

    private static async Task<(string State, string Cookie)> ChallengeAuthCallbackAsync(HttpClient client)
    {
        using var response = await client.GetAsync("/start-auth-callback");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var redirect = response.Headers.Location!;
        var query = QueryHelpers.ParseQuery(redirect.Query);
        Assert.Equal("https://api.example.test/signin-google", query["redirect_uri"].ToString());
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        return (query["state"].ToString(), cookie.Split(';')[0]);
    }

    private static void AssertNoExternalSignIn(HttpResponseMessage response)
    {
        if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
            Assert.DoesNotContain(cookies, cookie => cookie.StartsWith("test.external=", StringComparison.Ordinal));
    }

    private static TestServer CreateServer(FakeGoogleTransport transport) => new(new WebHostBuilder()
        .ConfigureServices(services =>
        {
            services.AddRouting();
            services.AddDataProtection().UseEphemeralDataProtectionProvider();
            services.Configure<EmailSettings>(settings => settings.FrontendUrl = Frontend);
            services.AddSingleton<FrontendRedirects>();
            services.AddSingleton<IAuthService, TestAuthService>();
            services.AddControllers().AddApplicationPart(typeof(AuthController).Assembly);
            services.AddAuthorization();
            services.AddAuthentication("External")
                .AddCookie("External", options => options.Cookie.Name = "test.external")
                .AddGoogle(options =>
                {
                    GoogleAuthenticationSetup.Configure(options, new GoogleSettings
                    {
                        ClientId = "test-google-client", ClientSecret = "test-google-secret"
                    });
                    options.BackchannelHttpHandler = transport;
                });
        })
        .Configure(app =>
        {
            app.UseMiddleware<SirLocked.Api.WebAPI.Middlewares.SecurityHeadersMiddleware>();
            app.UseRouting();
            app.UseAuthentication();
            app.UseAuthorization();
            app.UseEndpoints(endpoints =>
            {
                endpoints.MapGet("/start", context => context.ChallengeAsync(GoogleDefaults.AuthenticationScheme,
                    new AuthenticationProperties { RedirectUri = "/complete" }));
                endpoints.MapGet("/start-auth-callback", context => context.ChallengeAsync(GoogleDefaults.AuthenticationScheme,
                    new AuthenticationProperties { RedirectUri = "/api/auth/google/callback" }));
                endpoints.MapControllers();
                endpoints.MapGet("/complete", async context =>
                {
                    var result = await context.AuthenticateAsync("External");
                    if (!result.Succeeded) { context.Response.StatusCode = 401; return; }
                    await context.Response.WriteAsync(result.Principal!.FindFirstValue(ClaimTypes.Email)!);
                });
            });
        }));

    private sealed class TestAuthService : IAuthService
    {
        public Task<AuthResponse> RegisterAsync(RegisterRequest request) => throw new NotSupportedException();
        public Task<AuthResponse> LoginAsync(LoginRequest request) => throw new NotSupportedException();
        public Task<AuthResponse> AdminLoginAsync(LoginRequest request) => throw new NotSupportedException();
        public Task<AuthResponse> RefreshTokenAsync(RefreshTokenRequest request) => throw new NotSupportedException();
        public Task<UserResponse> GetMeAsync(string userId) => throw new NotSupportedException();
        public Task ChangePasswordAsync(string userId, ChangePasswordRequest request) => throw new NotSupportedException();
        public Task LogoutAsync(string userId) => throw new NotSupportedException();
        public Task<bool> LogoutByRefreshTokenAsync(string refreshToken) => throw new NotSupportedException();
        public Task<object> ForgotPasswordAsync(ForgotPasswordRequest request) => throw new NotSupportedException();
        public Task ResetPasswordAsync(ResetPasswordRequest request) => throw new NotSupportedException();
        public Task<object> ResendVerificationAsync(string userId) => throw new NotSupportedException();
        public Task VerifyEmailAsync(VerifyEmailRequest request) => throw new NotSupportedException();
        public Task SeedAdminAsync(AdminSeedOptions options) => throw new NotSupportedException();

        public Task<AuthResponse> GoogleLoginAsync(string email, string fullName) => Task.FromResult(new AuthResponse
        {
            Token = "access-token",
            RefreshToken = "refresh-token",
            RefreshTokenExpiry = DateTime.UtcNow.AddDays(7),
            User = new UserResponse { UserId = "test-user", FullName = fullName, Email = email }
        });
    }

    private sealed class FakeGoogleTransport : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            // This is the only transport: no Google requests or real credentials leave the process.
            var json = request.Method == HttpMethod.Post
                ? "{\"access_token\":\"test-provider-access\",\"token_type\":\"Bearer\",\"expires_in\":3600}"
                : "{\"id\":\"test-subject\",\"email\":\"test-user@example.invalid\",\"name\":\"Test User\",\"verified_email\":true}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }
    }
}
