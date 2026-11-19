namespace SirLocked.Api.Configurations;

/// <summary>
/// The VIP lane of VUAN-7: paid VIP orders are written through the Claude API (Commercial Terms), never through the
/// ADMIN bot's personal plan. The key only ever comes from the environment (<c>Anthropic__ApiKey</c>); it is never
/// logged, returned by an API or written to the database.
/// </summary>
public class AnthropicSettings
{
    public string ApiKey { get; set; } = string.Empty;
    /// <summary>Optional API base URL (tests and proxies). Empty = the SDK default.</summary>
    public string BaseUrl { get; set; } = string.Empty;
    /// <summary>How often the batch worker asks about open Message Batches.</summary>
    public int BatchPollSeconds { get; set; } = 60;
    /// <summary>One synchronous call may take this long before the SDK gives up (it retries twice on its own).</summary>
    public int RequestTimeoutSeconds { get; set; } = 600;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}

/// <summary>Google H5 Games Ads (Ad Placement API) for rewarded hints. Off until Google approves the site.</summary>
public class AdsSettings
{
    public bool Enabled { get; set; }
    /// <summary>The AdSense publisher id, e.g. <c>ca-pub-…</c>. Public by nature (it is in the page), but set on the server.</summary>
    public string PublisherId { get; set; } = string.Empty;
    /// <summary>Marks the ad requests as tests (AdSense <c>data-adbreak-test</c>).</summary>
    public bool TestMode { get; set; }
    /// <summary>A rewarded-ad ticket must be redeemed within this many seconds of being issued.</summary>
    public int TicketTtlSeconds { get; set; } = 300;

    public bool IsActive => Enabled && !string.IsNullOrWhiteSpace(PublisherId);
}
