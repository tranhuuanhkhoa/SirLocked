using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace SirLocked.Api.WebAPI;

public static class AuthCookies
{
    public const string RefreshCookieName = "sirlocked_refresh";

    public static void SetRefresh(HttpResponse response, string token, DateTime expiry)
    {
        var options = Options(response);
        options.Expires = expiry;
        response.Cookies.Append(RefreshCookieName, token, options);
    }

    public static void ClearRefresh(HttpResponse response) =>
        response.Cookies.Delete(RefreshCookieName, Options(response));

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
