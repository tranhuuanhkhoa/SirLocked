namespace SirLocked.Api.Configurations;

public class JwtSettings
{
    public const int MinimumSecretLength = 32;

    public string Secret { get; set; } = string.Empty;
    public string Issuer { get; set; } = "SirLocked";
    public string Audience { get; set; } = "SirLockedUsers";
    public int ExpiryHours { get; set; } = 12;

    public static bool IsSecretValid(string? secret) =>
        !string.IsNullOrWhiteSpace(secret) && secret.Length >= MinimumSecretLength;
}
