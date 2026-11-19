using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;

namespace SirLocked.Api.Services;

public partial class AiCaseService
{
    internal sealed record CloudinaryUpload(string AssetId, string PublicId, int? Version, string SecureUrl);

    /// <summary>
    /// Signed Cloudinary upload of one case image, used by the bridge when the bot uploads a picture. The bytes are
    /// stored as they are, so PNG/WebP transparency is kept.
    /// </summary>
    internal static async Task<CloudinaryUpload> UploadCloudinaryBytesAsync(
        HttpClient client,
        CloudinarySettings cloudinary,
        byte[] bytes,
        string fileName,
        string contentType,
        string publicId,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        if (!cloudinary.Enabled
            || string.IsNullOrWhiteSpace(cloudinary.CloudName)
            || string.IsNullOrWhiteSpace(cloudinary.ApiKey)
            || string.IsNullOrWhiteSpace(cloudinary.ApiSecret))
            throw ApiException.Conflict(
                "Cloudinary is not configured; case images cannot be stored yet.",
                "ASSET_STORAGE_UNAVAILABLE",
                "ai.assetStorage.unconfigured");

        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        // Cloudinary signs the canonical parameter string before multipart form
        // encoding; keep the slash in public_id unchanged.
        var signaturePayload = $"public_id={publicId}&timestamp={timestamp}{cloudinary.ApiSecret}";
        var signature = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(signaturePayload))).ToLowerInvariant();
        using var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        using var form = new MultipartFormDataContent();
        form.Add(file, "file", fileName);
        form.Add(new StringContent(cloudinary.ApiKey), "api_key");
        form.Add(new StringContent(timestamp), "timestamp");
        form.Add(new StringContent(publicId), "public_id");
        form.Add(new StringContent(signature), "signature");

        using var response = await client.PostAsync(
            $"https://api.cloudinary.com/v1_1/{cloudinary.CloudName}/image/upload",
            form,
            cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogError("Cloudinary refused a case image upload with HTTP {StatusCode}.", (int)response.StatusCode);
            throw ApiException.BadGateway($"Cloudinary upload failed with HTTP {(int)response.StatusCode}.");
        }

        try
        {
            using var json = JsonDocument.Parse(body);
            var root = json.RootElement;
            var secureUrl = root.GetProperty("secure_url").GetString();
            var returnedPublicId = root.GetProperty("public_id").GetString();
            var assetId = root.GetProperty("asset_id").GetString();
            if (string.IsNullOrWhiteSpace(secureUrl) || string.IsNullOrWhiteSpace(returnedPublicId) || string.IsNullOrWhiteSpace(assetId))
                throw new InvalidOperationException("Cloudinary response omitted an asset identity or secure URL.");
            return new CloudinaryUpload(
                assetId,
                returnedPublicId,
                root.TryGetProperty("version", out var version) && version.TryGetInt32(out var parsedVersion) ? parsedVersion : null,
                secureUrl);
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            logger.LogError(ex, "Cloudinary returned an invalid upload response.");
            throw ApiException.BadGateway("Cloudinary returned an invalid upload response.");
        }
    }
}
