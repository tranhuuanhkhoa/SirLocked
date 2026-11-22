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

    public string OAuthCallback() => $"{_baseUrl}/oauth-callback";
}
