using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests;

/// <summary>What leaves for Cloudinary and how its answers are read. The request format is checked against Cloudinary's documented signing rule, because no test account stands behind these tests.</summary>
public class CloudinaryAvatarStorageTests
{
    private const string Secret = "s3cret-value";
    private static readonly byte[] Webp = [1, 2, 3, 4];

    private static CloudinarySettings Settings() => new()
    {
        Enabled = true, CloudName = "my-cloud", ApiKey = "key-1", ApiSecret = Secret, Folder = "/sirlocked/cases/",
    };

    private sealed class FakeCloudinary(HttpStatusCode status, string answer) : HttpMessageHandler
    {
        public Uri? Url { get; private set; }
        public Dictionary<string, string> Fields { get; } = [];
        public string? FileName { get; private set; }
        public string? FileType { get; private set; }
        public byte[]? FileBytes { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Url = request.RequestUri;
            foreach (var part in (MultipartFormDataContent)request.Content!)
            {
                var name = part.Headers.ContentDisposition!.Name!.Trim('"');
                if (name == "file")
                {
                    FileName = part.Headers.ContentDisposition.FileName?.Trim('"');
                    FileType = part.Headers.ContentType?.MediaType;
                    FileBytes = await part.ReadAsByteArrayAsync(ct);
                }
                else Fields[name] = await part.ReadAsStringAsync(ct);
            }
            return new HttpResponseMessage(status) { Content = new StringContent(answer) };
        }
    }

    private sealed class ListLogger : ILogger<CloudinaryAvatarStorage>
    {
        public List<string> Lines { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) => Lines.Add(formatter(state, exception));
    }

    private static CloudinaryAvatarStorage Storage(HttpMessageHandler handler, CloudinarySettings? settings = null, ILogger<CloudinaryAvatarStorage>? logger = null) =>
        new(new HttpClient(handler), Options.Create(settings ?? Settings()), logger ?? NullLogger<CloudinaryAvatarStorage>.Instance);

    [Fact]
    public async Task AnUpload_IsSignedTheWayCloudinaryChecksIt()
    {
        var host = new FakeCloudinary(HttpStatusCode.OK, """{"secure_url":"https://res.cloudinary.com/my-cloud/image/upload/v7/a.webp"}""");

        var url = await Storage(host).UploadAsync("user-1", Webp);

        Assert.Equal("https://res.cloudinary.com/my-cloud/image/upload/v7/a.webp", url);
        Assert.Equal("https://api.cloudinary.com/v1_1/my-cloud/image/upload", host.Url!.ToString());
        Assert.Equal("key-1", host.Fields["api_key"]);
        Assert.Equal("true", host.Fields["overwrite"]);
        Assert.Equal("sirlocked/cases/avatars/user-1", host.Fields["public_id"]);
        // Every parameter but file and api_key, sorted, joined with &, the secret appended with no separator.
        var toSign = $"overwrite=true&public_id=sirlocked/cases/avatars/user-1&timestamp={host.Fields["timestamp"]}{Secret}";
        Assert.Equal(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(toSign))).ToLowerInvariant(), host.Fields["signature"]);
        Assert.Equal("image/webp", host.FileType);
        Assert.Equal("avatar.webp", host.FileName);
        Assert.Equal(Webp, host.FileBytes);
    }

    [Fact]
    public async Task TheSecret_NeverLeavesInTheRequest()
    {
        var host = new FakeCloudinary(HttpStatusCode.OK, """{"secure_url":"https://x/a.webp"}""");

        await Storage(host).UploadAsync("user-1", Webp);

        Assert.DoesNotContain(host.Fields.Values, value => value.Contains(Secret, StringComparison.Ordinal));
    }

    [Fact]
    public async Task ARefusedUpload_IsABadGateway_AndKeepsTheSecretOutOfTheMessage()
    {
        var host = new FakeCloudinary(HttpStatusCode.Unauthorized, """{"error":{"message":"Invalid Signature"}}""");

        var error = await Assert.ThrowsAsync<ApiException>(() => Storage(host).UploadAsync("user-1", Webp));

        Assert.Equal(502, error.StatusCode);
        Assert.DoesNotContain(Secret, error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ARefusedUpload_LeavesCloudinarysReasonInTheLog()
    {
        var host = new FakeCloudinary(HttpStatusCode.Unauthorized, """{"error":{"message":"Invalid Signature"}}""");
        var log = new ListLogger();

        await Assert.ThrowsAsync<ApiException>(() => Storage(host, logger: log).UploadAsync("user-1", Webp));

        var line = Assert.Single(log.Lines);
        Assert.Contains("401", line, StringComparison.Ordinal);
        Assert.Contains("Invalid Signature", line, StringComparison.Ordinal);
        Assert.DoesNotContain(Secret, line, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("<html>a proxy answered</html>")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("""{"secure_url":null}""")]
    [InlineData("""{"secure_url":""}""")]
    public async Task AnAnswerWithoutAnAddress_IsABadGateway(string answer)
    {
        var host = new FakeCloudinary(HttpStatusCode.OK, answer);

        var error = await Assert.ThrowsAsync<ApiException>(() => Storage(host).UploadAsync("user-1", Webp));

        Assert.Equal(502, error.StatusCode);
    }

    public static readonly TheoryData<Action<CloudinarySettings>> Missing = new()
    {
        s => s.Enabled = false,
        s => s.CloudName = " ",
        s => s.ApiKey = "",
        s => s.ApiSecret = "",
    };

    [Theory]
    [MemberData(nameof(Missing))]
    public void WithoutEverySetting_UploadIsNotOffered(Action<CloudinarySettings> remove)
    {
        var settings = Settings();
        remove(settings);

        Assert.False(Storage(new FakeCloudinary(HttpStatusCode.OK, "{}"), settings).IsAvailable);
    }

    [Fact]
    public void WithEverySetting_UploadIsOffered()
    {
        Assert.True(Storage(new FakeCloudinary(HttpStatusCode.OK, "{}")).IsAvailable);
    }
}
