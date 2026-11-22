namespace SirLocked.Api.Configurations;

public class JwtSettings
{
    public const int MinimumSecretLength = 32;

    public string Secret { get; set; } = string.Empty;
    public string Issuer { get; set; } = "SirLocked";
    public string Audience { get; set; } = "SirLockedUsers";
    public int? ExpiryMinutes { get; set; }
    public int? ExpiryHours { get; set; }
    public int EffectiveExpiryMinutes => ExpiryMinutes ?? (ExpiryHours is int hours ? checked(hours * 60) : 60);

    public static bool IsSecretValid(string? secret) =>
        !string.IsNullOrWhiteSpace(secret) && secret.Length >= MinimumSecretLength;
}
