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

    public string LoginError(string errorCode) =>
        $"{_baseUrl}/#/login?error={Uri.EscapeDataString(errorCode)}";

    public string OAuthCallback(string token, string refreshToken) =>
        $"{_baseUrl}/#/oauth-callback?token={Uri.EscapeDataString(token)}&refreshToken={Uri.EscapeDataString(refreshToken)}";
}
