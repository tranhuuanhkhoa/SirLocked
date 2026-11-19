using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Bridge;

public sealed record BridgeImageInfo(string ContentType, string Extension, int Width, int Height, bool HasAlpha);

/// <summary>One stored file of the shared studio library (not tied to a draft).</summary>
public sealed record BridgeLibraryFile(string Key, string Role, string Url, string StorageId, string ContentType, int Width, int Height,
    bool HasAlpha, int Bytes, string Sha256);

public interface IBridgeAssetStorage
{
    bool IsAvailable { get; }
    Task<AiBridgeAssetUpload> SaveAsync(string draftId, string slotId, byte[] bytes, CancellationToken ct);
    /// <summary>Stores a file of the shared library under <c>library/&lt;key&gt;/&lt;role&gt;-&lt;sha12&gt;</c>.</summary>
    Task<BridgeLibraryFile> SaveLibraryAsync(string key, string role, byte[] bytes, CancellationToken ct);
}

/// <summary>
/// Stores pictures the bot uploads for a draft: Cloudinary when configured, otherwise (outside Production, when
/// <see cref="BridgeSettings.AllowLocalAssetStorage"/> is on) under the frontend's public assets folder.
/// </summary>
public sealed class BridgeAssetStorage(
    IHttpClientFactory httpClientFactory,
    IOptions<CloudinarySettings> cloudinary,
    IOptions<BridgeSettings> bridge,
    IWebHostEnvironment environment,
    ILogger<BridgeAssetStorage> logger) : IBridgeAssetStorage
{
    public bool IsAvailable => CloudinaryReady || LocalAllowed;

    private bool CloudinaryReady => cloudinary.Value.Enabled
        && !string.IsNullOrWhiteSpace(cloudinary.Value.CloudName)
        && !string.IsNullOrWhiteSpace(cloudinary.Value.ApiKey)
        && !string.IsNullOrWhiteSpace(cloudinary.Value.ApiSecret);

    private bool LocalAllowed => bridge.Value.AllowLocalAssetStorage && !environment.IsProduction();

    /// <summary>
    /// Accepts only real PNG or WebP files (the header is decoded, not trusted from the file name), at most
    /// <paramref name="maxBytes"/>. Returns the decoded size and whether the picture has an alpha channel.
    /// </summary>
    public static BridgeImageInfo Inspect(byte[] bytes, int maxBytes)
    {
        if (bytes.Length == 0)
            throw ApiException.BadRequest("The uploaded file is empty.", new ApiErrorDetails("ASSET_EMPTY", "ai.bridge.assetEmpty"));
        if (bytes.Length > maxBytes)
            throw ApiException.BadRequest($"Images may be at most {maxBytes / (1024 * 1024)} MB.",
                new ApiErrorDetails("ASSET_TOO_LARGE", "ai.bridge.assetTooLarge"));
        var isPng = bytes.Length > 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47
                    && bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A;
        var isWebp = bytes.Length > 12 && bytes[0] == (byte)'R' && bytes[1] == (byte)'I' && bytes[2] == (byte)'F' && bytes[3] == (byte)'F'
                     && bytes[8] == (byte)'W' && bytes[9] == (byte)'E' && bytes[10] == (byte)'B' && bytes[11] == (byte)'P';
        if (!isPng && !isWebp)
            throw ApiException.BadRequest("Only PNG and WebP images are accepted.",
                new ApiErrorDetails("ASSET_FORMAT_UNSUPPORTED", "ai.bridge.assetFormat"));
        ImageInfo info;
        try
        {
            info = Image.Identify(bytes);
        }
        catch (Exception exception) when (exception is UnknownImageFormatException or InvalidImageContentException or NotSupportedException)
        {
            throw ApiException.BadRequest("The image could not be decoded.",
                new ApiErrorDetails("ASSET_INVALID_IMAGE", "ai.bridge.assetInvalid"));
        }
        var formatMatches = isPng ? info.Metadata.DecodedImageFormat is PngFormat : info.Metadata.DecodedImageFormat is WebpFormat;
        if (!formatMatches || info.Width <= 0 || info.Height <= 0 || info.Width > 8192 || info.Height > 8192)
            throw ApiException.BadRequest("The image header does not describe a usable picture.",
                new ApiErrorDetails("ASSET_INVALID_IMAGE", "ai.bridge.assetInvalid"));
        var hasAlpha = info.PixelType.AlphaRepresentation is { } alpha && alpha != PixelAlphaRepresentation.None;
        if (!hasAlpha && isPng)
        {
            var png = info.Metadata.GetPngMetadata();
            hasAlpha = png.ColorType is PngColorType.RgbWithAlpha or PngColorType.GrayscaleWithAlpha || png.TransparentColor is not null;
        }
        if (!hasAlpha && isWebp) hasAlpha = info.PixelType.BitsPerPixel >= 32;
        return isPng
            ? new BridgeImageInfo("image/png", ".png", info.Width, info.Height, hasAlpha)
            : new BridgeImageInfo("image/webp", ".webp", info.Width, info.Height, hasAlpha);
    }

    public async Task<AiBridgeAssetUpload> SaveAsync(string draftId, string slotId, byte[] bytes, CancellationToken ct)
    {
        var info = Inspect(bytes, Math.Max(1024, bridge.Value.MaxAssetBytes));
        var sha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var safeSlot = SafeSegment(slotId);
        var upload = new AiBridgeAssetUpload
        {
            SlotId = slotId,
            ContentType = info.ContentType,
            Width = info.Width,
            Height = info.Height,
            HasAlpha = info.HasAlpha,
            Bytes = bytes.Length,
            Sha256 = sha,
            UploadedAt = DateTime.UtcNow
        };
        if (CloudinaryReady)
        {
            var publicId = $"{cloudinary.Value.Folder.Trim('/')}/claude/{SafeSegment(draftId)}/{safeSlot}-{sha[..12]}";
            var client = httpClientFactory.CreateClient(AiCaseService.AssetHttpClientName);
            client.Timeout = TimeSpan.FromMinutes(2);
            var stored = await AiCaseService.UploadCloudinaryBytesAsync(
                client, cloudinary.Value, bytes, safeSlot + info.Extension, info.ContentType, publicId, logger, ct);
            upload.Url = stored.SecureUrl;
            upload.StorageId = stored.PublicId;
            return upload;
        }
        if (!LocalAllowed)
            throw ApiException.Conflict(
                "Cloudinary is not configured on this server, so case images cannot be uploaded yet.",
                "ASSET_STORAGE_UNAVAILABLE",
                "ai.assetStorage.unconfigured");

        var publicRoot = FindPublicAssetsRoot()
            ?? throw ApiException.Conflict("The frontend assets folder was not found for local image storage.",
                "ASSET_STORAGE_UNAVAILABLE", "ai.assetStorage.unconfigured");
        var folder = Path.Combine(publicRoot, "ai-generated", "bridge", SafeSegment(draftId));
        Directory.CreateDirectory(folder);
        var fileName = $"{safeSlot}-{sha[..12]}{info.Extension}";
        await File.WriteAllBytesAsync(Path.Combine(folder, fileName), bytes, ct);
        upload.Url = $"/assets/ai-generated/bridge/{SafeSegment(draftId)}/{fileName}";
        upload.StorageId = $"local:{SafeSegment(draftId)}/{fileName}";
        return upload;
    }

    public async Task<BridgeLibraryFile> SaveLibraryAsync(string key, string role, byte[] bytes, CancellationToken ct)
    {
        var info = Inspect(bytes, Math.Max(1024, bridge.Value.MaxAssetBytes));
        var sha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var safeKey = SafeSegment(key);
        var safeRole = SafeSegment(role);
        var fileName = $"{safeRole}-{sha[..12]}";
        if (CloudinaryReady)
        {
            // The content hash is part of the id, so re-sending the same picture lands on the same public id.
            var publicId = $"{cloudinary.Value.Folder.Trim('/')}/library/{safeKey}/{fileName}";
            var client = httpClientFactory.CreateClient(AiCaseService.AssetHttpClientName);
            client.Timeout = TimeSpan.FromMinutes(2);
            var stored = await AiCaseService.UploadCloudinaryBytesAsync(
                client, cloudinary.Value, bytes, fileName + info.Extension, info.ContentType, publicId, logger, ct);
            return new BridgeLibraryFile(key, role, stored.SecureUrl, stored.PublicId, info.ContentType, info.Width, info.Height,
                info.HasAlpha, bytes.Length, sha);
        }
        if (!LocalAllowed)
            throw ApiException.Conflict(
                "Cloudinary is not configured on this server, so library images cannot be uploaded yet.",
                "ASSET_STORAGE_UNAVAILABLE",
                "ai.assetStorage.unconfigured");
        var publicRoot = FindPublicAssetsRoot()
            ?? throw ApiException.Conflict("The frontend assets folder was not found for local image storage.",
                "ASSET_STORAGE_UNAVAILABLE", "ai.assetStorage.unconfigured");
        var folder = Path.Combine(publicRoot, "ai-generated", "bridge", "library", safeKey);
        Directory.CreateDirectory(folder);
        await File.WriteAllBytesAsync(Path.Combine(folder, fileName + info.Extension), bytes, ct);
        return new BridgeLibraryFile(key, role, $"/assets/ai-generated/bridge/library/{safeKey}/{fileName}{info.Extension}",
            $"local:library/{safeKey}/{fileName}{info.Extension}", info.ContentType, info.Width, info.Height, info.HasAlpha, bytes.Length, sha);
    }

    private string? FindPublicAssetsRoot()
    {
        if (!string.IsNullOrWhiteSpace(bridge.Value.LocalAssetRoot)) return Path.GetFullPath(bridge.Value.LocalAssetRoot);
        var directory = new DirectoryInfo(environment.ContentRootPath);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "src", "FE", "public", "assets");
            if (Directory.Exists(candidate)) return candidate;
            directory = directory.Parent;
        }
        return null;
    }

    internal static string SafeSegment(string value)
    {
        var chars = (value ?? string.Empty).Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' ? char.ToLowerInvariant(ch) : '-').ToArray();
        var text = new string(chars).Trim('-');
        while (text.Contains("--", StringComparison.Ordinal)) text = text.Replace("--", "-", StringComparison.Ordinal);
        return string.IsNullOrEmpty(text) ? "asset" : text[..Math.Min(text.Length, 80)];
    }
}
