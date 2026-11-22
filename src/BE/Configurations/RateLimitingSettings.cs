namespace SirLocked.Api.Configurations;

public sealed class RateLimitingSettings
{
    public AuthRateLimitSettings Login { get; set; } = new() { PermitLimit = 5, WindowSeconds = 60 };
    public AuthRateLimitSettings Register { get; set; } = new() { PermitLimit = 3, WindowSeconds = 300 };

    public static RateLimitingSettings FromConfiguration(IConfiguration configuration) =>
        configuration.GetSection("RateLimiting").Get<RateLimitingSettings>() ?? new();
}

public sealed class AuthRateLimitSettings
{
    public int PermitLimit { get; set; }
    public int WindowSeconds { get; set; }
}
