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
using SirLocked.Api.WebAPI;
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
        Assert.Equal($"{Frontend}/#/login?error=google_failed", response.Headers.Location!.ToString());
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
        Assert.Equal($"{Frontend}/#/login?error=google_cancelled", response.Headers.Location!.ToString());
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
            app.UseRouting();
            app.UseAuthentication();
            app.UseEndpoints(endpoints =>
            {
                endpoints.MapGet("/start", context => context.ChallengeAsync(GoogleDefaults.AuthenticationScheme,
                    new AuthenticationProperties { RedirectUri = "/complete" }));
                endpoints.MapGet("/complete", async context =>
                {
                    var result = await context.AuthenticateAsync("External");
                    if (!result.Succeeded) { context.Response.StatusCode = 401; return; }
                    await context.Response.WriteAsync(result.Principal!.FindFirstValue(ClaimTypes.Email)!);
                });
            });
        }));

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
