using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace SirLocked.Api.WebAPI;

/// <summary>
/// The two sessions a browser keeps side by side (src/FE/Client/js/services/session.js): the game's and the admin pages'.
/// Each has its own HttpOnly refresh cookie, so signing in on /admin/login never replaces the game's account.
/// </summary>
public enum AuthSessionSide
{
    Player,
    Admin
}

public static class AuthCookies
{
    public const string RefreshCookieName = "sirlocked_refresh";
    public const string AdminRefreshCookieName = "sirlocked_admin_refresh";
    /// <summary>Sent by the web client on refresh and sign-out: "admin" for the admin pages' session, anything else is the game's.</summary>
    public const string SessionHeader = "X-SirLocked-Session";

    public static string CookieName(AuthSessionSide side) =>
        side == AuthSessionSide.Admin ? AdminRefreshCookieName : RefreshCookieName;

    public static AuthSessionSide SideOf(HttpRequest request) =>
        string.Equals(request.Headers[SessionHeader].ToString(), "admin", StringComparison.Ordinal)
            ? AuthSessionSide.Admin
            : AuthSessionSide.Player;

    public static string? ReadRefresh(HttpRequest request, AuthSessionSide side) => request.Cookies[CookieName(side)];

    public static void SetRefresh(HttpResponse response, string token, DateTime expiry, AuthSessionSide side = AuthSessionSide.Player)
    {
        var options = Options(response);
        options.Expires = expiry;
        response.Cookies.Append(CookieName(side), token, options);
    }

    public static void ClearRefresh(HttpResponse response, AuthSessionSide side = AuthSessionSide.Player) =>
        response.Cookies.Delete(CookieName(side), Options(response));

    private static CookieOptions Options(HttpResponse response)
    {
        var context = response.HttpContext;
        var environment = context.RequestServices.GetRequiredService<IWebHostEnvironment>();
        return new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Path = "/api/auth",
            Secure = context.Request.IsHttps || !environment.IsDevelopment()
        };
    }
}
