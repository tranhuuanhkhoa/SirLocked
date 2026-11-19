using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace SirLocked.Api.Services.TeamComms;

/// <summary>
/// "Voice" section of the configuration: the servers that help two browsers find each other.
/// STUN alone connects most home networks. Some networks (many 4G carriers, office firewalls) need a TURN relay;
/// set either the Cloudflare TURN key or a coturn shared secret, both only through environment variables.
/// </summary>
public sealed class VoiceSettings
{
    /// <summary>Free public STUN servers. Kept in code, not appsettings: the configuration binder appends to an array.</summary>
    public string[] StunUrls { get; set; } = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

    /// <summary>Cloudflare Realtime TURN: the key id (Voice__CloudflareTurnKeyId).</summary>
    public string? CloudflareTurnKeyId { get; set; }

    /// <summary>Cloudflare Realtime TURN: the key's API token (Voice__CloudflareTurnApiToken). Never in a file in the repo.</summary>
    public string? CloudflareTurnApiToken { get; set; }

    /// <summary>A self-hosted coturn: its URLs, e.g. "turn:turn.sirlocked.id.vn:3478?transport=udp".</summary>
    public string[] TurnUrls { get; set; } = [];

    /// <summary>coturn's static-auth-secret (use-auth-secret mode). Never in a file in the repo.</summary>
    public string? TurnSharedSecret { get; set; }

    /// <summary>How long relay credentials handed to a player stay valid. A match is shorter.</summary>
    public int CredentialLifetimeMinutes { get; set; } = 360;

    /// <summary>
    /// Send all voice through the relay, so the two players never learn each other's IP address. Needs TURN; costs relay
    /// traffic. Off by default.
    /// </summary>
    public bool RelayOnly { get; set; }
}

public sealed record IceServerDto(IReadOnlyList<string> Urls, string? Username = null, string? Credential = null);

/// <summary>What a browser needs to open the voice connection.</summary>
public sealed record VoiceConfigDto(IReadOnlyList<IceServerDto> IceServers, bool HasRelay, bool RelayOnly);

public sealed class IceServerProvider
{
    public const string CloudflareEndpoint = "https://rtc.live.cloudflare.com/v1/turn/keys/{0}/credentials/generate-ice-servers";

    private readonly HttpClient _http;
    private readonly VoiceSettings _settings;
    private readonly TimeProvider _time;
    private readonly ILogger<IceServerProvider> _logger;

    public IceServerProvider(HttpClient http, IOptions<VoiceSettings> options, TimeProvider time, ILogger<IceServerProvider> logger)
    {
        _http = http;
        _settings = options.Value;
        _time = time;
        _logger = logger;
    }

    public async Task<VoiceConfigDto> ForUserAsync(string userId, CancellationToken ct)
    {
        var servers = new List<IceServerDto>();
        var stun = _settings.StunUrls.Where(url => !string.IsNullOrWhiteSpace(url)).ToArray();
        if (stun.Length > 0) servers.Add(new IceServerDto(stun));

        var relays = new List<IceServerDto>();
        if (!string.IsNullOrWhiteSpace(_settings.CloudflareTurnKeyId) && !string.IsNullOrWhiteSpace(_settings.CloudflareTurnApiToken))
        {
            try
            {
                relays.AddRange(await CloudflareRelaysAsync(ct));
            }
            catch (Exception error) when (error is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                // Voice still works on most networks with STUN; a coturn, if set, takes over below.
                _logger.LogWarning(error, "Cloudflare TURN credentials could not be generated; voice falls back to STUN.");
            }
        }
        var turnUrls = _settings.TurnUrls.Where(url => !string.IsNullOrWhiteSpace(url)).ToArray();
        if (relays.Count == 0 && turnUrls.Length > 0 && !string.IsNullOrWhiteSpace(_settings.TurnSharedSecret))
        {
            var expires = _time.GetUtcNow().AddMinutes(Math.Max(5, _settings.CredentialLifetimeMinutes));
            relays.Add(CoturnCredentials(turnUrls, _settings.TurnSharedSecret, userId, expires));
        }

        servers.AddRange(relays);
        var hasRelay = relays.Count > 0;
        return new VoiceConfigDto(servers, hasRelay, _settings.RelayOnly && hasRelay);
    }

    /// <summary>
    /// coturn's "TURN REST API" credentials: the user name is "expiry:userId", the password its HMAC-SHA1 with the shared
    /// secret, in base64. coturn checks both without storing anything.
    /// </summary>
    public static IceServerDto CoturnCredentials(IReadOnlyList<string> urls, string secret, string userId, DateTimeOffset expires)
    {
        var username = $"{expires.ToUnixTimeSeconds()}:{userId}";
        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        var credential = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(username)));
        return new IceServerDto(urls, username, credential);
    }

    private async Task<IReadOnlyList<IceServerDto>> CloudflareRelaysAsync(CancellationToken ct)
    {
        var url = string.Format(CloudflareEndpoint, Uri.EscapeDataString(_settings.CloudflareTurnKeyId!));
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(new { ttl = Math.Max(300, _settings.CredentialLifetimeMinutes * 60) }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.CloudflareTurnApiToken);
        using var response = await _http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        return ParseCloudflareRelays(document.RootElement);
    }

    /// <summary>
    /// Keeps the TURN entries of Cloudflare's answer (its STUN entry duplicates ours) and drops port 53, which browsers block,
    /// so a candidate on it would only time out.
    /// </summary>
    public static IReadOnlyList<IceServerDto> ParseCloudflareRelays(JsonElement root)
    {
        var relays = new List<IceServerDto>();
        if (!root.TryGetProperty("iceServers", out var list)) return relays;
        var entries = list.ValueKind == JsonValueKind.Array ? list.EnumerateArray().ToList() : [list];
        foreach (var entry in entries)
        {
            if (entry.ValueKind != JsonValueKind.Object) continue;
            var username = entry.TryGetProperty("username", out var user) && user.ValueKind == JsonValueKind.String ? user.GetString() : null;
            var credential = entry.TryGetProperty("credential", out var secret) && secret.ValueKind == JsonValueKind.String ? secret.GetString() : null;
            if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(credential) || !entry.TryGetProperty("urls", out var urls)) continue;
            var values = urls.ValueKind == JsonValueKind.Array
                ? urls.EnumerateArray().Where(url => url.ValueKind == JsonValueKind.String).Select(url => url.GetString()!).ToList()
                : urls.ValueKind == JsonValueKind.String ? [urls.GetString()!] : [];
            var usable = values.Where(url => url.StartsWith("turn", StringComparison.OrdinalIgnoreCase) && !UsesPort53(url)).ToList();
            if (usable.Count > 0) relays.Add(new IceServerDto(usable, username, credential));
        }
        return relays;
    }

    private static bool UsesPort53(string url)
    {
        var withoutQuery = url.Split('?', 2)[0];
        return withoutQuery.EndsWith(":53", StringComparison.Ordinal);
    }
}
