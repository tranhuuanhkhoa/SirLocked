using System.Text;
using Microsoft.AspNetCore.Authorization;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.WebAPI.Controllers;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Gif;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace SirLocked.Tests;

public class AdminAssetTests
{
    private static readonly CurrentUser Admin = new("admin-1", "Yến", UserRole.Admin);

    /// <summary>Opaque on the left, half transparent in the middle, fully transparent on the right.</summary>
    private static byte[] TransparentPng(int width = 90, int height = 30)
    {
        using var image = new Image<Rgba32>(width, height);
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                image[x, y] = x < width / 3 ? new Rgba32(200, 40, 40, 255)
                    : x < 2 * width / 3 ? new Rgba32(40, 200, 40, 128)
                    : new Rgba32(0, 0, 0, 0);
            }
        }
        using var stream = new MemoryStream();
        image.SaveAsPng(stream);
        return stream.ToArray();
    }

    private static byte[] Solid(SixLabors.ImageSharp.Formats.IImageEncoder encoder, int width = 40, int height = 20)
    {
        using var image = new Image<Rgba32>(width, height, new Rgba32(50, 90, 200));
        using var stream = new MemoryStream();
        image.Save(stream, encoder);
        return stream.ToArray();
    }

    private static async Task<ApiException> Rejected(byte[] file, string code)
    {
        var exception = await Assert.ThrowsAsync<ApiException>(() => AdminAssetProcessor.ProcessAsync(file));
        var details = (ApiErrorDetails)exception.Errors!;
        Assert.Equal(code, details.Code);
        Assert.Equal($"admin.{code}", details.MessageKey);
        return exception;
    }

    [Fact]
    public async Task TransparencySurvivesTheConversion()
    {
        var asset = await AdminAssetProcessor.ProcessAsync(TransparentPng());

        using var decoded = Image.Load<Rgba32>(asset.Webp);
        Assert.IsType<WebpFormat>(Image.Identify(asset.Webp).Metadata.DecodedImageFormat);
        Assert.Equal(255, decoded[5, 15].A);
        Assert.InRange((int)decoded[45, 15].A, 120, 136);
        Assert.Equal(0, decoded[85, 15].A);
    }

    [Fact]
    public async Task SizeIsReportedAndUnchanged()
    {
        var asset = await AdminAssetProcessor.ProcessAsync(TransparentPng(321, 123));

        Assert.Equal(321, asset.Width);
        Assert.Equal(123, asset.Height);
        var info = Image.Identify(asset.Webp);
        Assert.Equal(321, info.Width);
        Assert.Equal(123, info.Height);
    }

    [Fact]
    public async Task JpegAndWebpAreAccepted()
    {
        Assert.NotEmpty((await AdminAssetProcessor.ProcessAsync(Solid(new JpegEncoder()))).Webp);
        Assert.NotEmpty((await AdminAssetProcessor.ProcessAsync(Solid(new WebpEncoder()))).Webp);
    }

    [Fact]
    public async Task SvgIsRejected()
    {
        var svg = Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"><script>alert(1)</script></svg>");

        await Rejected(svg, AdminAssetErrors.BadImage);
    }

    [Fact]
    public async Task AFileIsJudgedByItsBytesNotItsName()
    {
        // What a .png or .webp named text file looks like to the server: only bytes.
        await Rejected(Encoding.UTF8.GetBytes("this is not a picture, whatever the file is called"), AdminAssetErrors.BadImage);
        // A real picture of a format we do not take, renamed.
        await Rejected(Solid(new GifEncoder()), AdminAssetErrors.BadImage);
        // A real header on a body that is not a picture.
        var png = TransparentPng();
        await Rejected(png.Take(40).Concat(Encoding.UTF8.GetBytes(new string('x', 500))).ToArray(), AdminAssetErrors.BadImage);
    }

    [Fact]
    public async Task AnEmptyFileIsRejected() => await Rejected(Array.Empty<byte>(), AdminAssetErrors.BadImage);

    [Fact]
    public async Task AFileOverFiveMegabytesIsRejected()
    {
        var file = TransparentPng().Concat(new byte[AdminAssetProcessor.MaxBytes]).ToArray();

        await Rejected(file, AdminAssetErrors.TooLarge);
    }

    [Fact]
    public async Task AFileOfExactlyFiveMegabytesIsWithinTheLimit()
    {
        var png = TransparentPng();
        // Trailing bytes after the image end: the decoder ignores them, so this is a valid picture of exactly the limit.
        var file = png.Concat(new byte[AdminAssetProcessor.MaxBytes - png.Length]).ToArray();

        Assert.NotEmpty((await AdminAssetProcessor.ProcessAsync(file)).Webp);
    }

    [Fact]
    public async Task APictureTooLargeInPixelsIsRejected()
    {
        // A tiny file that would need gigabytes of memory to decode.
        using var image = new Image<Rgba32>(AdminAssetProcessor.MaxPixelSide + 1, 1);
        using var stream = new MemoryStream();
        image.SaveAsPng(stream);

        await Rejected(stream.ToArray(), AdminAssetErrors.BadImage);
    }

    [Fact]
    public async Task OnlyTheFirstFrameOfAnAnimationIsKept()
    {
        // Every frame of an animation would be decoded at full size: a small file could take the server's memory.
        using var animation = new Image<Rgba32>(30, 30, new Rgba32(200, 40, 40, 255));
        using var second = new Image<Rgba32>(30, 30, new Rgba32(40, 40, 200, 255));
        animation.Frames.AddFrame(second.Frames.RootFrame);
        using var stream = new MemoryStream();
        animation.SaveAsWebp(stream);

        var asset = await AdminAssetProcessor.ProcessAsync(stream.ToArray());

        using var decoded = Image.Load<Rgba32>(asset.Webp);
        Assert.Equal(1, decoded.Frames.Count);
        Assert.True(decoded[15, 15].R > decoded[15, 15].B);
    }

    [Fact]
    public async Task APhonePictureIsTurnedUprightBeforeItsOrientationTagIsDropped()
    {
        using var image = new Image<Rgba32>(40, 20, new Rgba32(1, 2, 3, 255));
        image.Metadata.ExifProfile = new ExifProfile();
        image.Metadata.ExifProfile.SetValue(ExifTag.Orientation, (ushort)6);
        using var stream = new MemoryStream();
        image.Save(stream, new JpegEncoder());

        var asset = await AdminAssetProcessor.ProcessAsync(stream.ToArray());

        Assert.Equal(20, asset.Width);
        Assert.Equal(40, asset.Height);
    }

    [Fact]
    public async Task MetadataIsStripped()
    {
        using var image = new Image<Rgba32>(20, 20, new Rgba32(1, 2, 3, 255));
        image.Metadata.ExifProfile = new ExifProfile();
        image.Metadata.ExifProfile.SetValue(ExifTag.Artist, "secret-location-tag");
        using var stream = new MemoryStream();
        image.Save(stream, new JpegEncoder());

        var asset = await AdminAssetProcessor.ProcessAsync(stream.ToArray());

        Assert.DoesNotContain("secret-location-tag", Encoding.ASCII.GetString(asset.Webp));
        Assert.Null(Image.Identify(asset.Webp).Metadata.ExifProfile);
    }

    private sealed class FakeStorage(bool available) : IAdminAssetStorage
    {
        public List<byte[]> Uploads { get; } = new();
        public bool IsAvailable => available;

        public Task<string> UploadAsync(byte[] webp, CancellationToken ct = default)
        {
            Uploads.Add(webp);
            return Task.FromResult("https://cdn.test/sirlocked/admin/x.webp");
        }
    }

    private sealed class FakeAudit : IAdminAudit
    {
        public List<(string Action, string TargetType, string TargetId, object? After)> Entries { get; } = new();

        public Task LogAsync(CurrentUser admin, string action, string targetType, string targetId, object? before, object? after, string? reason = null, CancellationToken ct = default)
        {
            Entries.Add((action, targetType, targetId, after));
            return Task.CompletedTask;
        }

        public Task<AdminAuditPageDto> QueryAsync(AdminAuditQuery query, CancellationToken ct = default) => throw new NotSupportedException();
    }

    [Fact]
    public async Task WithoutStorageTheUploadFailsWithAClearCode()
    {
        var storage = new FakeStorage(available: false);
        var audit = new FakeAudit();

        var exception = await Assert.ThrowsAsync<ApiException>(() => new AdminAssetService(storage, audit).UploadAsync(Admin, TransparentPng(), "a.png"));

        Assert.Equal(503, exception.StatusCode);
        Assert.Equal(AdminAssetErrors.StorageUnavailable, ((ApiErrorDetails)exception.Errors!).Code);
        Assert.Empty(storage.Uploads);
        Assert.Empty(audit.Entries);
    }

    [Fact]
    public async Task AnUploadStoresTheConvertedPictureAndIsAudited()
    {
        var storage = new FakeStorage(available: true);
        var audit = new FakeAudit();

        var result = await new AdminAssetService(storage, audit).UploadAsync(Admin, TransparentPng(60, 30), "khung.png");

        Assert.Equal(new AdminAssetDto("https://cdn.test/sirlocked/admin/x.webp", 60, 30), result);
        Assert.IsType<WebpFormat>(Image.Identify(Assert.Single(storage.Uploads)).Metadata.DecodedImageFormat);
        var entry = Assert.Single(audit.Entries);
        Assert.Equal("asset.upload", entry.Action);
        Assert.Equal("asset", entry.TargetType);
        Assert.Equal(result.Url, entry.TargetId);
    }

    [Fact]
    public async Task ARejectedPictureLeavesNoTrace()
    {
        var storage = new FakeStorage(available: true);
        var audit = new FakeAudit();

        await Assert.ThrowsAsync<ApiException>(() => new AdminAssetService(storage, audit).UploadAsync(Admin, Encoding.UTF8.GetBytes("<svg/>"), "x.svg"));

        Assert.Empty(storage.Uploads);
        Assert.Empty(audit.Entries);
    }

    [Theory]
    [InlineData(typeof(AdminAssetsController))]
    [InlineData(typeof(AdminAuditController))]
    public void TheNewEndpointsAreForAdminsOnly(Type controller)
    {
        var authorize = controller.GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single();

        Assert.Equal(UserRole.Admin, authorize.Roles);
    }
}
