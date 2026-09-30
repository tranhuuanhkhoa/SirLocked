namespace SirLocked.Api.Configurations;

public class PresentationVideoSettings
{
    public bool Enabled { get; set; }
    public string ApiKey { get; set; } = string.Empty;
    public string Model { get; set; } = "grok-imagine-video-1.5";
    // No invented price: an operator must supply a current verified rate and its version.
    public decimal? PricePerSecondUsd { get; set; }
    public string PricingVersion { get; set; } = string.Empty;
    public decimal MaximumPackageUsd { get; set; } = 10m;
    public int PollSeconds { get; set; } = 10;
    public int JobTimeoutMinutes { get; set; } = 30;
    public int MaxVideoBytes { get; set; } = 32 * 1024 * 1024;
    public string Resolution { get; set; } = "480p";
    public List<string> DownloadHosts { get; set; } = ["vidgen.x.ai", "imgen.x.ai"];
    public bool HasPricing => PricePerSecondUsd is > 0 && !string.IsNullOrWhiteSpace(PricingVersion);
}
