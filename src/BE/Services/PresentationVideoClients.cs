using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public record VideoProviderResponse(string Status, string? RequestId, string? VideoUrl, string Body, int StatusCode);
public interface IPresentationVideoProvider
{
    Task<VideoProviderResponse> SubmitAsync(PresentationStoryboardClip clip, string imageDataUri, string model, CancellationToken ct);
    Task<VideoProviderResponse> PollAsync(string requestId, CancellationToken ct);
}

public sealed class XaiPresentationVideoProvider(HttpClient client, IOptions<PresentationVideoSettings> options) : IPresentationVideoProvider
{
    public async Task<VideoProviderResponse> SubmitAsync(PresentationStoryboardClip clip, string imageDataUri, string model, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.x.ai/v1/videos/generations");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.Value.ApiKey);
        request.Content = JsonContent.Create(new
        {
            model, prompt = clip.Prompt,
            image = new { url = imageDataUri }, duration = clip.DurationSeconds, resolution = options.Value.Resolution
        });
        using var response = await client.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            return new((int)response.StatusCode >= 500 || (int)response.StatusCode == 408 ? "unknown" : "rejected", null, null, body, (int)response.StatusCode);
        using var json = JsonDocument.Parse(body);
        var id = json.RootElement.TryGetProperty("request_id", out var value) ? value.GetString() : null;
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("Video submission returned no recoverable request ID.");
        return new("pending", id, null, body, (int)response.StatusCode);
    }

    public async Task<VideoProviderResponse> PollAsync(string requestId, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.x.ai/v1/videos/{Uri.EscapeDataString(requestId)}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.Value.ApiKey);
        using var response = await client.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode) return new("poll_error", requestId, null, body, (int)response.StatusCode);
        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;
        var status = root.TryGetProperty("status", out var state) ? state.GetString() ?? "pending" : "pending";
        var url = root.TryGetProperty("video", out var video) && video.TryGetProperty("url", out var value) ? value.GetString() : null;
        return new(status, requestId, url, body, (int)response.StatusCode);
    }
}

public record PresentationMediaBytes(byte[] Bytes, string ContentType);
public interface IPresentationMediaStorage
{
    Task<PresentationMediaBytes> ReadSourceAsync(string url, CancellationToken ct);
    Task<PresentationMediaAsset> UploadPosterAsync(PresentationVideoJob job, PresentationMediaBytes source, CancellationToken ct);
    Task<PresentationMediaAsset> UploadVideoAsync(PresentationVideoJob job, string providerUrl, CancellationToken ct);
    Task<PresentationMediaBytes> DownloadAsync(PresentationMediaAsset asset, CancellationToken ct);
}

public sealed class CloudinaryPresentationMediaStorage(
    HttpClient client, IOptions<CloudinarySettings> cloudinary, IOptions<PresentationVideoSettings> video,
    IWebHostEnvironment environment) : IPresentationMediaStorage
{
    private const int MaximumImageBytes = 10 * 1024 * 1024;

    public async Task<PresentationMediaBytes> ReadSourceAsync(string url, CancellationToken ct)
    {
        if (url.StartsWith("/assets/", StringComparison.Ordinal))
        {
            var root = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "..", "FE", "public"));
            var path = Path.GetFullPath(Path.Combine(root, Uri.UnescapeDataString(url.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
                throw ApiException.BadRequest("The presentation source image is unavailable.");
            if (new FileInfo(path).Length > MaximumImageBytes) throw ApiException.BadRequest("The source image is too large.");
            var contentType = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".webp" => "image/webp",
                _ => throw ApiException.BadRequest("Unsupported presentation image format.")
            };
            return new(await File.ReadAllBytesAsync(path, ct), contentType);
        }
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https"
            || uri.Host != "res.cloudinary.com" || !uri.AbsolutePath.StartsWith($"/{cloudinary.Value.CloudName}/", StringComparison.Ordinal))
            throw ApiException.BadRequest("Presentation image must be a local case asset or this project's Cloudinary asset.");
        return await DownloadBoundedAsync(uri.ToString(), MaximumImageBytes, "image/", ct);
    }

    public Task<PresentationMediaAsset> UploadPosterAsync(PresentationVideoJob job, PresentationMediaBytes source, CancellationToken ct) =>
        UploadAsync(job, "poster", "image", source, ct);

    public async Task<PresentationMediaAsset> UploadVideoAsync(PresentationVideoJob job, string providerUrl, CancellationToken ct)
    {
        if (!Uri.TryCreate(providerUrl, UriKind.Absolute, out var uri) || uri.Scheme != "https"
            || !video.Value.DownloadHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase) || uri.UserInfo.Length != 0)
            throw ApiException.BadGateway("The video provider returned an unsupported download location.");
        var source = await DownloadBoundedAsync(uri.ToString(), video.Value.MaxVideoBytes, "video/", ct);
        return await UploadAsync(job, "video", "video", source, ct);
    }

    private async Task<PresentationMediaAsset> UploadAsync(PresentationVideoJob job, string suffix, string resourceType, PresentationMediaBytes source, CancellationToken ct)
    {
        var settings = cloudinary.Value;
        var publicId = $"{settings.Folder.Trim('/')}/presentation/{job.Id}/{suffix}";
        var parameters = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["overwrite"] = "true", ["public_id"] = publicId,
            ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture), ["type"] = "authenticated"
        };
        using var form = new MultipartFormDataContent();
        foreach (var (key, value) in parameters) form.Add(new StringContent(value), key);
        form.Add(new StringContent(settings.ApiKey), "api_key");
        form.Add(new StringContent(Sign(parameters, settings.ApiSecret)), "signature");
        using var file = new ByteArrayContent(source.Bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(source.ContentType);
        form.Add(file, "file", resourceType == "video" ? "clip.mp4" : "poster.png");
        using var response = await client.PostAsync($"https://api.cloudinary.com/v1_1/{Uri.EscapeDataString(settings.CloudName)}/{resourceType}/upload", form, ct);
        if (!response.IsSuccessStatusCode) throw ApiException.BadGateway("Protected media storage rejected the upload.");
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var root = json.RootElement;
        if (root.GetProperty("type").GetString() != "authenticated") throw ApiException.BadGateway("Protected media storage returned an invalid delivery type.");
        var format = root.GetProperty("format").GetString() ?? (resourceType == "video" ? "mp4" : "png");
        return new PresentationMediaAsset
        {
            Id = $"{job.Id}-{suffix}", DraftId = job.DraftId, JobId = job.Id,
            PublicId = root.GetProperty("public_id").GetString() ?? publicId, ResourceType = resourceType,
            Format = format, ContentType = resourceType == "video" ? "video/mp4" : format == "jpg" ? "image/jpeg" : $"image/{format}",
            Bytes = source.Bytes.LongLength,
            Sha256 = Convert.ToHexString(SHA256.HashData(source.Bytes)).ToLowerInvariant(),
            Width = root.TryGetProperty("width", out var width) && width.TryGetInt32(out var w) ? w : null,
            Height = root.TryGetProperty("height", out var height) && height.TryGetInt32(out var h) ? h : null,
            DurationSeconds = root.TryGetProperty("duration", out var duration) && duration.TryGetDouble(out var seconds) ? seconds : null
        };
    }

    public Task<PresentationMediaBytes> DownloadAsync(PresentationMediaAsset asset, CancellationToken ct)
    {
        var settings = cloudinary.Value;
        var now = DateTimeOffset.UtcNow;
        var parameters = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["expires_at"] = now.AddMinutes(2).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
            ["format"] = asset.Format, ["public_id"] = asset.PublicId,
            ["timestamp"] = now.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture), ["type"] = "authenticated"
        };
        var query = string.Join('&', parameters.Select(pair => $"{pair.Key}={Uri.EscapeDataString(pair.Value)}"));
        var url = $"https://api.cloudinary.com/v1_1/{Uri.EscapeDataString(settings.CloudName)}/{asset.ResourceType}/download?{query}&api_key={Uri.EscapeDataString(settings.ApiKey)}&signature={Sign(parameters, settings.ApiSecret)}";
        // Signed URLs remain server-side; clients receive authenticated bytes, never redirects.
        return DownloadBoundedAsync(url, asset.ResourceType == "video" ? video.Value.MaxVideoBytes : MaximumImageBytes,
            asset.ResourceType == "video" ? "video/" : "image/", ct);
    }

    private async Task<PresentationMediaBytes> DownloadBoundedAsync(string url, int limit, string contentPrefix, CancellationToken ct)
    {
        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) throw ApiException.BadGateway("The media could not be retrieved.");
        var type = response.Content.Headers.ContentType?.MediaType ?? "";
        if (!type.StartsWith(contentPrefix, StringComparison.OrdinalIgnoreCase) || response.Content.Headers.ContentLength > limit)
            throw ApiException.BadGateway("The media format or size is invalid.");
        await using var input = await response.Content.ReadAsStreamAsync(ct);
        using var output = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int count;
        while ((count = await input.ReadAsync(buffer, ct)) != 0)
        {
            if (output.Length + count > limit) throw ApiException.BadGateway("The media exceeds its maximum size.");
            await output.WriteAsync(buffer.AsMemory(0, count), ct);
        }
        return new(output.ToArray(), type);
    }

    public static string Sign(IEnumerable<KeyValuePair<string, string>> parameters, string secret) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('&', parameters.OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => $"{pair.Key}={pair.Value}")) + secret))).ToLowerInvariant();
}
