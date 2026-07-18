namespace SirLocked.Api.Configurations;

public sealed class V3LocalAuditSettings
{
    public bool SeedEnabled { get; set; }
    public string TestPassword { get; set; } = string.Empty;
}
