using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public partial class AiCaseService
{
    private async Task UploadAssetsToCloudinaryAsync(
        AiCaseDraft draft,
        GameCase gameCase,
        AiAssetManifest manifest,
        string caseSlug)
    {
        if (!_cloudinary.Enabled)
        {
            throw ApiException.BadRequest(
                "Cloudinary must be enabled before publishing generated case assets.",
                new { code = "CLOUDINARY_NOT_CONFIGURED" });
        }
        if (string.IsNullOrWhiteSpace(_cloudinary.CloudName)
            || string.IsNullOrWhiteSpace(_cloudinary.ApiKey)
            || string.IsNullOrWhiteSpace(_cloudinary.ApiSecret))
        {
            throw ApiException.BadRequest(
                "Cloudinary credentials are incomplete; generated assets were not published.",
                new { code = "CLOUDINARY_NOT_CONFIGURED" });
        }

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        var uploadedRoot = $"https://res.cloudinary.com/{_cloudinary.CloudName}/image/upload/{_cloudinary.Folder.Trim('/')}/{caseSlug}";
        var rootPath = Path.GetFullPath(manifest.AssetRootPath);
        var rootPrefix = rootPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        foreach (var asset in manifest.Assets)
        {
            if (string.IsNullOrWhiteSpace(asset.FilePath) || !File.Exists(asset.FilePath))
                throw ApiException.BadRequest($"Generated asset file is missing for {asset.AssetType}:{asset.TargetId}.");

            var fullPath = Path.GetFullPath(asset.FilePath);
            if (!fullPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                throw ApiException.BadRequest("Generated asset path is outside the case asset directory.");
            var relative = Path.GetRelativePath(rootPath, fullPath)
                .Replace(Path.DirectorySeparatorChar, '/');
            var publicId = $"{_cloudinary.Folder.Trim('/')}/{caseSlug}/{Path.ChangeExtension(relative, null)}".TrimEnd('.');
            var uploaded = await UploadCloudinaryFileAsync(client, asset.FilePath, publicId);
            asset.CloudinaryAssetId = uploaded.AssetId;
            asset.CloudinaryPublicId = uploaded.PublicId;
            asset.CloudinaryVersion = uploaded.Version;
            asset.SecureUrl = uploaded.SecureUrl;
            asset.Url = uploaded.SecureUrl;
        }

        manifest.AssetRootUrl = uploadedRoot;
        ApplyUploadedAssetUrls(gameCase, manifest);
    }

    private async Task<CloudinaryUpload> UploadCloudinaryFileAsync(HttpClient client, string path, string publicId)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        // Cloudinary signs the canonical parameter string before multipart form
        // encoding; keep the slash in public_id unchanged.
        var signaturePayload = $"public_id={publicId}&timestamp={timestamp}{_cloudinary.ApiSecret}";
        var signature = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(signaturePayload))).ToLowerInvariant();
        await using var stream = File.OpenRead(path);
        using var file = new StreamContent(stream);
        file.Headers.ContentType = new MediaTypeHeaderValue(ContentTypeFor(path));
        using var form = new MultipartFormDataContent();
        form.Add(file, "file", Path.GetFileName(path));
        form.Add(new StringContent(_cloudinary.ApiKey), "api_key");
        form.Add(new StringContent(timestamp), "timestamp");
        form.Add(new StringContent(publicId), "public_id");
        form.Add(new StringContent(signature), "signature");

        using var response = await client.PostAsync(
            $"https://api.cloudinary.com/v1_1/{_cloudinary.CloudName}/image/upload",
            form,
            _operationCancellationToken);
        var body = await response.Content.ReadAsStringAsync(_operationCancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Cloudinary upload failed with HTTP {StatusCode}: {Body}", response.StatusCode, Truncate(body, 500));
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
            _logger.LogError(ex, "Cloudinary returned an invalid upload response.");
            throw ApiException.BadGateway("Cloudinary returned an invalid upload response.");
        }
    }

    private static void ApplyUploadedAssetUrls(GameCase gameCase, AiAssetManifest manifest)
    {
        var by = manifest.Assets.ToDictionary(asset => $"{asset.AssetType}:{asset.TargetId}", StringComparer.Ordinal);
        if (by.TryGetValue($"cover:{gameCase.CaseId}", out var cover)) gameCase.CoverImageUrl = cover.Url;
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
        {
            if (by.TryGetValue($"background:{scene.SceneId}", out var background)) scene.BackgroundUrl = background.Url;
        }
        foreach (var character in gameCase.Characters)
        {
            if (by.TryGetValue($"character-portrait:{character.CharacterId}", out var portrait)) character.ImageUrl = portrait.Url;
        }
        foreach (var item in gameCase.Items)
        {
            if (by.TryGetValue($"item:{item.ItemId}", out var asset)) item.ImageUrl = asset.Url;
        }
    }

    private static string ContentTypeFor(string path) =>
        Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            _ => "image/png"
        };

    private sealed record CloudinaryUpload(string AssetId, string PublicId, int? Version, string SecureUrl);
}
