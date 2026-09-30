using Microsoft.AspNetCore.Authentication.Google;
using SirLocked.Api.Configurations;

namespace SirLocked.Api.WebAPI;

public static class GoogleAuthenticationSetup
{
    public static void Configure(GoogleOptions options, GoogleSettings settings)
    {
        options.ClientId = settings.ClientId;
        options.ClientSecret = settings.ClientSecret;
        options.CallbackPath = "/signin-google";
        options.SignInScheme = "External";
        options.SaveTokens = true;

        // Correlation/state validation still runs in the Google handler. Failed or expired
        // round trips return to the configured login page without exposing provider details.
        options.Events.OnRemoteFailure = context =>
        {
            context.HandleResponse();
            context.Response.Redirect(context.HttpContext.RequestServices
                .GetRequiredService<FrontendRedirects>().LoginError("google_failed"));
            return Task.CompletedTask;
        };
        options.Events.OnAccessDenied = context =>
        {
            context.HandleResponse();
            context.Response.Redirect(context.HttpContext.RequestServices
                .GetRequiredService<FrontendRedirects>().LoginError("google_cancelled"));
            return Task.CompletedTask;
        };
    }
}
