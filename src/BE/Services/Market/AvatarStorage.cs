using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;

namespace SirLocked.Api.Services.Market;

/// <summary>Where uploaded avatars go. <see cref="IsAvailable"/> decides whether the upload button exists at all.</summary>
public interface IAvatarStorage
{
    bool IsAvailable { get; }

    /// <summary>Stores one detective's avatar, replacing the previous one, and returns its public URL.</summary>
    Task<string> UploadAsync(string userId, byte[] webp, CancellationToken ct = default);
}

/// <summary>The project's existing Cloudinary account. A signed upload to one fixed public id per user, so re-uploading costs no storage.</summary>
public sealed class CloudinaryAvatarStorage(HttpClient client, IOptions<CloudinarySettings> cloudinary, ILogger<CloudinaryAvatarStorage> logger) : IAvatarStorage
{
    private const int MaxLoggedAnswer = 500;

    public bool IsAvailable
    {
        get
        {
            var settings = cloudinary.Value;
            return settings.Enabled
                && !string.IsNullOrWhiteSpace(settings.CloudName)
                && !string.IsNullOrWhiteSpace(settings.ApiKey)
                && !string.IsNullOrWhiteSpace(settings.ApiSecret);
        }
    }

    public async Task<string> UploadAsync(string userId, byte[] webp, CancellationToken ct = default)
    {
        var settings = cloudinary.Value;
        var parameters = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["overwrite"] = "true",
            ["public_id"] = $"{settings.Folder.Trim('/')}/avatars/{userId}",
            ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
        };
        using var form = new MultipartFormDataContent();
        foreach (var (key, value) in parameters) form.Add(new StringContent(value), key);
        form.Add(new StringContent(settings.ApiKey), "api_key");
        form.Add(new StringContent(CloudinaryPresentationMediaStorage.Sign(parameters, settings.ApiSecret)), "signature");
        using var file = new ByteArrayContent(webp);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/webp");
        form.Add(file, "file", "avatar.webp");

        using var response = await client.PostAsync($"https://api.cloudinary.com/v1_1/{Uri.EscapeDataString(settings.CloudName)}/image/upload", form, ct);
        var answer = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            // Says what Cloudinary disliked, such as a wrong key or signature. Its answers carry no secret.
            logger.LogError("Cloudinary refused an avatar with HTTP {StatusCode}: {Answer}", (int)response.StatusCode, answer[..Math.Min(answer.Length, MaxLoggedAnswer)]);
            throw ApiException.BadGateway("The image host rejected the picture.");
        }
        return AddressIn(answer) ?? throw ApiException.BadGateway("The image host returned no address for the picture.");
    }

    private static string? AddressIn(string answer)
    {
        try
        {
            using var json = JsonDocument.Parse(answer);
            return json.RootElement.ValueKind == JsonValueKind.Object
                && json.RootElement.TryGetProperty("secure_url", out var url)
                && url.ValueKind == JsonValueKind.String
                && url.GetString() is { Length: > 0 } address ? address : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
