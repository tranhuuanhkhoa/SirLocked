using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.Tests.AdminPlayers;

/// <summary>What is sent to Cloudinary when an avatar is deleted. There is no account to test against here, so the wire format is what can be checked.</summary>
public class AdminPlayersAvatarFileTests
{
    private const string UserId = "507f1f77bcf86cd799439071";

    private static readonly CloudinarySettings Configured = new()
    {
        Enabled = true, CloudName = "demo cloud", ApiKey = "key-1", ApiSecret = "secret-1", Folder = "/sirlocked/",
    };

    private sealed class FakeHost(HttpStatusCode status, string body, Exception? failure = null) : HttpMessageHandler
    {
        public string? Url { get; private set; }
        public string? Sent { get; private set; }
        public int Calls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            if (failure is not null) throw failure;
            Url = request.RequestUri!.AbsoluteUri;
            Sent = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(status) { Content = new StringContent(body) };
        }
    }

    private static CloudinaryAvatarFileRemover Remover(FakeHost host, CloudinarySettings? settings = null) =>
        new(new HttpClient(host), Options.Create(settings ?? Configured), NullLogger<CloudinaryAvatarFileRemover>.Instance);

    private static Dictionary<string, string> Form(string sent) => sent.Split('&')
        .Select(pair => pair.Split('='))
        .ToDictionary(pair => pair[0], pair => WebUtility.UrlDecode(pair[1]));

    [Theory]
    [InlineData("""{"result":"ok"}""")]
    [InlineData("""{"result":"not found"}""")] // Already gone is what was asked for.
    public async Task AFileThatIsGoneCountsAsDeleted(string answer) =>
        Assert.True(await Remover(new FakeHost(HttpStatusCode.OK, answer)).TryRemoveAsync(UserId));

    [Fact]
    public async Task ItAsksForTheDestroyOfThatPicture_SignedTheWayCloudinaryChecks_AndPurgesTheCdn()
    {
        var host = new FakeHost(HttpStatusCode.OK, """{"result":"ok"}""");

        await Remover(host).TryRemoveAsync(UserId);

        Assert.Equal("https://api.cloudinary.com/v1_1/demo%20cloud/image/destroy", host.Url);
        var form = Form(host.Sent!);
        Assert.Equal($"sirlocked/avatars/{UserId}", form["public_id"]);
        Assert.Equal("true", form["invalidate"]);
        Assert.Equal("key-1", form["api_key"]);
        // Sorted parameters joined with &, then the secret, SHA-256 in lowercase hex. api_key and signature are not signed.
        var signed = $"invalidate=true&public_id=sirlocked/avatars/{UserId}&timestamp={form["timestamp"]}secret-1";
        Assert.Equal(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(signed))).ToLowerInvariant(), form["signature"]);
    }

    [Fact]
    public async Task ItDeletesExactlyWhereTheUploadWrites()
    {
        var upload = new FakeHost(HttpStatusCode.OK, """{"secure_url":"https://img.test/a.webp"}""");
        await new CloudinaryAvatarStorage(new HttpClient(upload), Options.Create(Configured), NullLogger<CloudinaryAvatarStorage>.Instance).UploadAsync(UserId, new byte[] { 1, 2, 3 });
        var delete = new FakeHost(HttpStatusCode.OK, """{"result":"ok"}""");

        await Remover(delete).TryRemoveAsync(UserId);

        Assert.Contains(Form(delete.Sent!)["public_id"], upload.Sent!);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "{}")]
    [InlineData(HttpStatusCode.InternalServerError, "oops")]
    [InlineData(HttpStatusCode.OK, "not json")]
    [InlineData(HttpStatusCode.OK, """{"result":"error"}""")]
    public async Task ARefusalIsAFalse_NotAnException(HttpStatusCode status, string body) =>
        Assert.False(await Remover(new FakeHost(status, body)).TryRemoveAsync(UserId));

    [Fact]
    public async Task ANetworkFailureIsAFalse_NotAnException() =>
        Assert.False(await Remover(new FakeHost(HttpStatusCode.OK, "", new HttpRequestException("down"))).TryRemoveAsync(UserId));

    [Fact]
    public async Task ATimeoutIsAFalse_NotAnException() =>
        Assert.False(await Remover(new FakeHost(HttpStatusCode.OK, "", new TaskCanceledException("slow"))).TryRemoveAsync(UserId));

    [Theory]
    [InlineData(false, "demo", "key", "secret")]
    [InlineData(true, "", "key", "secret")]
    [InlineData(true, "demo", "", "secret")]
    [InlineData(true, "demo", "key", "")]
    public async Task WithoutCloudinaryNothingIsSent(bool enabled, string cloud, string key, string secret)
    {
        var host = new FakeHost(HttpStatusCode.OK, """{"result":"ok"}""");

        var removed = await Remover(host, new CloudinarySettings { Enabled = enabled, CloudName = cloud, ApiKey = key, ApiSecret = secret }).TryRemoveAsync(UserId);

        Assert.False(removed);
        Assert.Equal(0, host.Calls);
    }
}
