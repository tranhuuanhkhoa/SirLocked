using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;

namespace SirLocked.Api.WebAPI;

public sealed class FrontendRedirects
{
    private readonly string _baseUrl;

    public FrontendRedirects(IOptions<EmailSettings> options)
    {
        _baseUrl = options.Value.FrontendUrl.TrimEnd('/');
    }

    public string VerifyEmail(string token) =>
        $"{_baseUrl}/verify-email?token={Uri.EscapeDataString(token)}";

    public string ResetPassword(string token) =>
        $"{_baseUrl}/reset-password?token={Uri.EscapeDataString(token)}";

    public string LoginError(string errorCode) =>
        $"{_baseUrl}/login?error={Uri.EscapeDataString(errorCode)}";

    /// <summary>The tokens go after the #: a browser sends that part to nobody, so they stay out of every server log.</summary>
    public string OAuthCallback(string token, string refreshToken) =>
        $"{_baseUrl}/oauth-callback#token={Uri.EscapeDataString(token)}&refreshToken={Uri.EscapeDataString(refreshToken)}";
}
