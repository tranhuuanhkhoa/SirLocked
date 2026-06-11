namespace SirLocked.Api.Configurations;

public class JwtSettings
{
    public string Secret { get; set; } = string.Empty;
    public string Issuer { get; set; } = "SirLocked";
    public string Audience { get; set; } = "SirLockedUsers";
    public int ExpiryHours { get; set; } = 12;
}
