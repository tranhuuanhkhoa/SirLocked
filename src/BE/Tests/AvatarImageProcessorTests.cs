using SirLocked.Api.DTOs;
using SirLocked.Api.Services.Market;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace SirLocked.Tests;

public class AvatarImageProcessorTests
{
    private static byte[] Encode(int width, int height, SixLabors.ImageSharp.Formats.IImageEncoder encoder)
    {
        using var image = new Image<Rgba32>(width, height, new Rgba32(180, 40, 40));
        using var stream = new MemoryStream();
        image.Save(stream, encoder);
        return stream.ToArray();
    }

    public static readonly TheoryData<string, int, int> Sources = new()
    {
        { "png", 640, 360 },
        { "jpeg", 300, 900 },
        { "webp", 512, 512 },
        { "png", 64, 40 },
    };

    private static byte[] Sample(string format, int width, int height) => format switch
    {
        "png" => Encode(width, height, new PngEncoder()),
        "jpeg" => Encode(width, height, new JpegEncoder()),
        _ => Encode(width, height, new WebpEncoder()),
    };

    [Theory]
    [MemberData(nameof(Sources))]
    public async Task EveryAcceptedFormat_BecomesASquare256Webp(string format, int width, int height)
    {
        var bytes = await AvatarImageProcessor.ToSquareAsync(Sample(format, width, height));

        var decoded = Image.Identify(bytes);
        Assert.Equal(AvatarImageProcessor.Side, decoded.Width);
        Assert.Equal(AvatarImageProcessor.Side, decoded.Height);
        Assert.Equal("WEBP", decoded.Metadata.DecodedImageFormat!.Name.ToUpperInvariant());
    }

    [Fact]
    public async Task AFileOverTwoMegabytes_IsRefused_BeforeBeingDecoded()
    {
        var error = await Assert.ThrowsAsync<ApiException>(() => AvatarImageProcessor.ToSquareAsync(new byte[AvatarImageProcessor.MaxBytes + 1]));
        Assert.Equal(400, error.StatusCode);
        Assert.Equal(AvatarErrors.TooLarge, (error.Errors as ApiErrorDetails)?.Code);
    }

    [Fact]
    public async Task AnEmptyFile_IsRefused()
    {
        var error = await Assert.ThrowsAsync<ApiException>(() => AvatarImageProcessor.ToSquareAsync(Array.Empty<byte>()));
        Assert.Equal(AvatarErrors.BadImage, (error.Errors as ApiErrorDetails)?.Code);
    }

    [Theory]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")]
    [InlineData("not an image at all")]
    public async Task AnythingThatIsNotAnAcceptedImage_IsRefused_WhateverItClaimsToBe(string body)
    {
        var error = await Assert.ThrowsAsync<ApiException>(() => AvatarImageProcessor.ToSquareAsync(System.Text.Encoding.UTF8.GetBytes(body)));
        Assert.Equal(AvatarErrors.BadImage, (error.Errors as ApiErrorDetails)?.Code);
    }

    [Fact]
    public async Task AGif_IsRefused_EvenThoughTheDecoderCouldReadIt()
    {
        var gif = Encode(32, 32, new SixLabors.ImageSharp.Formats.Gif.GifEncoder());
        var error = await Assert.ThrowsAsync<ApiException>(() => AvatarImageProcessor.ToSquareAsync(gif));
        Assert.Equal(AvatarErrors.BadImage, (error.Errors as ApiErrorDetails)?.Code);
    }

    [Fact]
    public async Task HugeDimensions_AreRefused_WithoutDecodingThePixels()
    {
        // A tiny file can still claim enormous dimensions and exhaust memory when decoded.
        var bomb = Encode(AvatarImageProcessor.MaxPixelSide + 1, 2, new PngEncoder());
        var error = await Assert.ThrowsAsync<ApiException>(() => AvatarImageProcessor.ToSquareAsync(bomb));
        Assert.Equal(AvatarErrors.BadImage, (error.Errors as ApiErrorDetails)?.Code);
    }
}
