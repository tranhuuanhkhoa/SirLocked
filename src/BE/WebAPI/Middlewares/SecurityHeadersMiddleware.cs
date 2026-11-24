namespace SirLocked.Api.WebAPI.Middlewares;

public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;
        headers["X-Content-Type-Options"] = "nosniff";
        headers["X-Frame-Options"] = "DENY";
        headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=(self)";

        if (context.Request.Path.StartsWithSegments("/api"))
            headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";

        await next(context);
    }
}
