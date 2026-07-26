namespace SirLocked.Api.Configurations;

public class PlaytestSettings
{
    public const int MinimumPseudonymKeyLength = 32;

    /// <summary>HMAC key behind every stored pseudonym. Required outside Development.</summary>
    public string PseudonymKey { get; set; } = string.Empty;

    /// <summary>TTL for playtest events; the only data-protection control until the lifecycle policy lands.</summary>
    public int RetentionDays { get; set; } = 30;

    public static bool IsPseudonymKeyValid(string? key) =>
        !string.IsNullOrWhiteSpace(key) && key.Length >= MinimumPseudonymKeyLength;
}
