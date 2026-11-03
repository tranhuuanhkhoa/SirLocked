using SirLocked.Api.DTOs;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace SirLocked.Api.Services.Market;

/// <summary>
/// Turns an uploaded picture into the one thing we store: a 256px square WebP, centre-cropped and re-encoded, so
/// whatever the file carried besides pixels (metadata, a payload) never reaches the image host.
/// The format is read from the bytes; a client's file name or content type decides nothing.
/// </summary>
public static class AvatarImageProcessor
{
    /// <summary>The value of PlayerProgress.Avatar when a detective wears their own picture.</summary>
    public const string UploadedAvatar = "upload";
    public const int Side = 256;
    public const int MaxBytes = 2 * 1024 * 1024;
    public const int MaxPixelSide = 8000;

    private static ApiException TooLarge() =>
        MarketService.Error(400, AvatarErrors.TooLarge, "The picture must be 2 MB or smaller.");

    private static ApiException BadImage() =>
        MarketService.Error(400, AvatarErrors.BadImage, "Use a JPG, PNG or WebP picture.");

    public static async Task<byte[]> ToSquareAsync(byte[] source, CancellationToken ct = default)
    {
        if (source.Length > MaxBytes) throw TooLarge();
        if (source.Length == 0) throw BadImage();
        try
        {
            var info = Image.Identify(source);
            if (info.Metadata.DecodedImageFormat is not (JpegFormat or PngFormat or WebpFormat)) throw BadImage();
            if (info.Width < 1 || info.Height < 1 || info.Width > MaxPixelSide || info.Height > MaxPixelSide) throw BadImage();

            using var image = Image.Load<Rgba32>(source);
            image.Mutate(context => context.Resize(new ResizeOptions
            {
                Size = new Size(Side, Side),
                Mode = ResizeMode.Crop,
                Position = AnchorPositionMode.Center
            }));
            image.Metadata.ExifProfile = null;
            image.Metadata.XmpProfile = null;
            image.Metadata.IccProfile = null;
            using var output = new MemoryStream();
            await image.SaveAsWebpAsync(output, new WebpEncoder { Quality = 85 }, ct);
            return output.ToArray();
        }
        catch (Exception exception) when (exception is ImageFormatException or UnknownImageFormatException or NotSupportedException or InvalidImageContentException)
        {
            throw BadImage();
        }
    }
}
