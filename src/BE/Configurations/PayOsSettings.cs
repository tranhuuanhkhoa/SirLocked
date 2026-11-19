namespace SirLocked.Api.Configurations;

public sealed class PayOsSettings
{
    public bool Enabled { get; set; }
    public string ClientId { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public string ChecksumKey { get; set; } = "";
    public string FrontendUrl { get; set; } = "http://localhost:5173";
    public int ExpiryMinutes { get; set; } = 15;
    // Sample prices. Confirm with the project owner before enabling real payments.
    public List<CoinPackage> Packages { get; set; } =
    [new("starter", 10000, 1000), new("detective", 50000, 5000), new("master", 100000, 10000)];

    public bool IsValid() => !Enabled ||
        (!string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ApiKey)
         && !string.IsNullOrWhiteSpace(ChecksumKey)
         && Uri.TryCreate(FrontendUrl, UriKind.Absolute, out var uri)
         && (uri.Scheme == "https" || uri.Scheme == "http" && uri.IsLoopback)
         && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Fragment)
         && string.IsNullOrEmpty(uri.Query) && uri.AbsolutePath == "/"
         && ExpiryMinutes is >= 5 and <= 60 && Packages.Count is > 0 and <= 20
         && Packages.All(p => System.Text.RegularExpressions.Regex.IsMatch(p.Id, "^[a-z0-9-]{1,32}$")
             && p.Amount is >= 2000 and <= 10000000 && p.Coins is > 0 and <= 10000000)
         && Packages.Select(p => p.Id).Distinct().Count() == Packages.Count);
}

public sealed record CoinPackage(string Id, int Amount, long Coins);
