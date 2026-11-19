using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Services.Market;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace SirLocked.Api.Services.Admin;

public static class AdminAssetErrors
{
    public const string TooLarge = "ASSET_TOO_LARGE";
    public const string BadImage = "ASSET_BAD_IMAGE";
    public const string StorageUnavailable = "ASSET_STORAGE_UNAVAILABLE";
}

/// <summary>A picture ready to store: WebP bytes and the size of the image they hold.</summary>
public sealed record ProcessedAdminAsset(byte[] Webp, int Width, int Height);

/// <summary>
/// Turns an uploaded picture into the one thing we store: a re-encoded WebP with its transparency intact, so whatever
/// the file carried besides pixels (metadata, a payload) never reaches the image host. The format is read from the
/// bytes; a client's file name or content type decides nothing. That also keeps SVG out, which could carry a script.
/// </summary>
public static class AdminAssetProcessor
{
    public const int MaxBytes = 5 * 1024 * 1024;
    public const int MaxPixelSide = AvatarImageProcessor.MaxPixelSide;

    internal static ApiException Error(int status, string code, string message) =>
        new(status, message, new ApiErrorDetails(code, "admin." + code));

    public static ApiException TooLarge() =>
        Error(400, AdminAssetErrors.TooLarge, "Ảnh phải nhỏ hơn hoặc bằng 5 MB.");

    private static ApiException BadImage() =>
        Error(400, AdminAssetErrors.BadImage, "Chỉ nhận ảnh PNG, WebP hoặc JPG.");

    public static async Task<ProcessedAdminAsset> ProcessAsync(byte[] source, CancellationToken ct = default)
    {
        if (source.Length > MaxBytes) throw TooLarge();
        if (source.Length == 0) throw BadImage();
        try
        {
            var info = Image.Identify(source);
            if (info.Metadata.DecodedImageFormat is not (JpegFormat or PngFormat or WebpFormat)) throw BadImage();
            if (info.Width < 1 || info.Height < 1 || info.Width > MaxPixelSide || info.Height > MaxPixelSide) throw BadImage();

            // One frame only: decoding every frame of an animation at full size could take the server's memory.
            using var image = Image.Load<Rgba32>(new DecoderOptions { MaxFrames = 1 }, source);
            // The orientation tag is about to go, so apply it first or a phone picture comes out sideways.
            image.Mutate(context => context.AutoOrient());
            image.Metadata.ExifProfile = null;
            image.Metadata.XmpProfile = null;
            image.Metadata.IccProfile = null;
            using var output = new MemoryStream();
            await image.SaveAsWebpAsync(output, new WebpEncoder
            {
                FileFormat = WebpFileFormatType.Lossy,
                Quality = 90,
                // Colour is lossy but the alpha plane is not: the edges of a hand-drawn frame stay exactly as drawn.
                UseAlphaCompression = true,
                TransparentColorMode = WebpTransparentColorMode.Preserve,
            }, ct);
            return new ProcessedAdminAsset(output.ToArray(), image.Width, image.Height);
        }
        catch (Exception exception) when (exception is ImageFormatException or UnknownImageFormatException or NotSupportedException or InvalidImageContentException)
        {
            throw BadImage();
        }
    }
}

/// <summary>Where admin pictures go.</summary>
public interface IAdminAssetStorage
{
    bool IsAvailable { get; }

    /// <summary>Stores one picture and returns its public URL. The same bytes always land on the same address.</summary>
    Task<string> UploadAsync(byte[] webp, CancellationToken ct = default);
}

/// <summary>The project's existing Cloudinary account, in its own folder. Named by content, so uploading a picture twice costs no storage.</summary>
public sealed class CloudinaryAdminAssetStorage(HttpClient client, IOptions<CloudinarySettings> cloudinary) : IAdminAssetStorage
{
    public const string Folder = "sirlocked/admin";

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

    public async Task<string> UploadAsync(byte[] webp, CancellationToken ct = default)
    {
        var settings = cloudinary.Value;
        var contentName = Convert.ToHexString(SHA256.HashData(webp))[..32].ToLowerInvariant();
        var parameters = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["overwrite"] = "true",
            ["public_id"] = $"{Folder}/{contentName}",
            ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
        };
        using var form = new MultipartFormDataContent();
        foreach (var (key, value) in parameters) form.Add(new StringContent(value), key);
        form.Add(new StringContent(settings.ApiKey), "api_key");
        form.Add(new StringContent(CloudinaryPresentationMediaStorage.Sign(parameters, settings.ApiSecret)), "signature");
        using var file = new ByteArrayContent(webp);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/webp");
        form.Add(file, "file", "asset.webp");

        using var response = await client.PostAsync($"https://api.cloudinary.com/v1_1/{Uri.EscapeDataString(settings.CloudName)}/image/upload", form, ct);
        if (!response.IsSuccessStatusCode) throw ApiException.BadGateway("Máy chủ ảnh từ chối ảnh này.");
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return json.RootElement.GetProperty("secure_url").GetString()
            ?? throw ApiException.BadGateway("Máy chủ ảnh không trả về địa chỉ của ảnh.");
    }
}

/// <summary>Checks, converts, stores and records one admin upload.</summary>
public sealed class AdminAssetService
{
    private readonly IAdminAssetStorage _storage;
    private readonly IAdminAudit _audit;

    public AdminAssetService(IAdminAssetStorage storage, IAdminAudit audit)
    {
        _storage = storage;
        _audit = audit;
    }

    public async Task<AdminAssetDto> UploadAsync(CurrentUser admin, byte[] source, string? fileName, CancellationToken ct = default)
    {
        if (!_storage.IsAvailable)
            throw AdminAssetProcessor.Error(503, AdminAssetErrors.StorageUnavailable, "Chưa cấu hình nơi lưu ảnh (Cloudinary) nên chưa tải được ảnh.");

        var asset = await AdminAssetProcessor.ProcessAsync(source, ct);
        var url = await _storage.UploadAsync(asset.Webp, ct);
        var result = new AdminAssetDto(url, asset.Width, asset.Height);
        await _audit.LogAsync(admin, "asset.upload", "asset", url, null,
            new { url, width = asset.Width, height = asset.Height, bytes = asset.Webp.Length, fileName }, null, ct);
        return result;
    }
}
