using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace SirLocked.Api.Services;

public sealed record GeneratedImageProcessResult(
    int SourceWidth,
    int SourceHeight,
    int NormalizedWidth,
    int NormalizedHeight,
    bool HasAlpha,
    bool CornersTransparent,
    string ProcessingStatus);

public static class GeneratedImageProcessor
{
    public const int SceneWidth = 1600;
    public const int SceneHeight = 900;
    public const int SceneRequestHeight = 912;

    private static readonly PngEncoder PngWithAlpha = new()
    {
        ColorType = PngColorType.RgbWithAlpha
    };

    public static async Task<GeneratedImageProcessResult> NormalizeBackgroundAsync(
        string filePath,
        CancellationToken cancellationToken = default)
    {
        using var image = await Image.LoadAsync<Rgba32>(filePath, cancellationToken);
        var sourceWidth = image.Width;
        var sourceHeight = image.Height;

        image.Mutate(ctx => ctx.Resize(new ResizeOptions
        {
            Size = new Size(SceneWidth, SceneHeight),
            Mode = ResizeMode.Crop,
            Position = AnchorPositionMode.Center
        }));

        await image.SaveAsPngAsync(filePath, cancellationToken);
        return new GeneratedImageProcessResult(
            sourceWidth,
            sourceHeight,
            image.Width,
            image.Height,
            HasTransparentPixels(image),
            HasTransparentCorners(image),
            sourceWidth == SceneWidth && sourceHeight == SceneHeight ? "verified-background" : "normalized-background");
    }

    public static async Task<GeneratedImageProcessResult> NormalizeCutoutAsync(
        string filePath,
        int padding = 24,
        bool requireAlpha = true,
        CancellationToken cancellationToken = default)
    {
        using var image = await Image.LoadAsync<Rgba32>(filePath, cancellationToken);
        var sourceWidth = image.Width;
        var sourceHeight = image.Height;

        var hadAlpha = HasTransparentPixels(image);
        var removedBackgroundPixels = RemoveEdgeConnectedWhiteBackground(image);
        if (!hadAlpha && removedBackgroundPixels == 0 && requireAlpha)
        {
            throw new InvalidOperationException($"Generated cutout has an opaque non-white background that cannot be removed safely: {filePath}");
        }

        RemoveWhiteHalo(image);

        var bounds = GetAlphaBounds(image);
        if (bounds is null)
        {
            if (requireAlpha)
            {
                throw new InvalidOperationException($"Generated cutout has no opaque subject after background removal: {filePath}");
            }

            return new GeneratedImageProcessResult(sourceWidth, sourceHeight, image.Width, image.Height, false, false, "empty-cutout");
        }

        var crop = bounds.Value;
        using var cropped = image.Clone(ctx => ctx.Crop(crop));
        var canvasWidth = Math.Max(1, cropped.Width + padding * 2);
        var canvasHeight = Math.Max(1, cropped.Height + padding * 2);
        using var canvas = new Image<Rgba32>(Configuration.Default, canvasWidth, canvasHeight, new Rgba32(0, 0, 0, 0));
        canvas.Mutate(ctx => ctx.DrawImage(cropped, new Point(padding, padding), 1f));

        var hasAlpha = HasTransparentPixels(canvas);
        var cornersTransparent = HasTransparentCorners(canvas);
        if (requireAlpha && (!hasAlpha || !cornersTransparent))
        {
            throw new InvalidOperationException($"Generated cutout is still opaque after processing: {filePath}");
        }

        await canvas.SaveAsPngAsync(filePath, PngWithAlpha, cancellationToken);
        return new GeneratedImageProcessResult(
            sourceWidth,
            sourceHeight,
            canvas.Width,
            canvas.Height,
            hasAlpha,
            cornersTransparent,
            "white-background-removed");
    }

    public static async Task<GeneratedImageProcessResult> AnalyzeAsync(
        string filePath,
        CancellationToken cancellationToken = default)
    {
        using var image = await Image.LoadAsync<Rgba32>(filePath, cancellationToken);
        var hasAlpha = HasTransparentPixels(image);
        return new GeneratedImageProcessResult(
            image.Width,
            image.Height,
            image.Width,
            image.Height,
            hasAlpha,
            HasTransparentCorners(image),
            hasAlpha ? "verified-alpha" : "opaque");
    }

    public static async Task<GeneratedImageProcessResult> CreateCharacterPortraitAsync(
        string spritePath,
        string portraitPath,
        int portraitSize = 1024,
        CancellationToken cancellationToken = default)
    {
        using var sprite = await Image.LoadAsync<Rgba32>(spritePath, cancellationToken);
        var bounds = GetAlphaBounds(sprite)
            ?? throw new InvalidOperationException($"Character sprite has no visible subject: {spritePath}");

        var upperBodyHeight = Math.Clamp((int)Math.Ceiling(bounds.Height * 0.62), 1, bounds.Height);
        var cropWidth = Math.Clamp(Math.Max(bounds.Width, upperBodyHeight), 1, sprite.Width);
        var cropLeft = Math.Clamp(bounds.Left + (bounds.Width - cropWidth) / 2, 0, sprite.Width - cropWidth);
        var cropHeight = Math.Min(upperBodyHeight, sprite.Height - bounds.Top);
        var crop = new Rectangle(cropLeft, bounds.Top, cropWidth, cropHeight);

        using var upperBody = sprite.Clone(ctx => ctx.Crop(crop));
        var padding = Math.Max(16, portraitSize / 16);
        var available = Math.Max(1, portraitSize - padding * 2);
        var scale = Math.Min((double)available / upperBody.Width, (double)available / upperBody.Height);
        var targetWidth = Math.Max(1, (int)Math.Round(upperBody.Width * scale));
        var targetHeight = Math.Max(1, (int)Math.Round(upperBody.Height * scale));
        upperBody.Mutate(ctx => ctx.Resize(targetWidth, targetHeight, KnownResamplers.Lanczos3));

        using var portrait = new Image<Rgba32>(Configuration.Default, portraitSize, portraitSize, new Rgba32(0, 0, 0, 0));
        var x = (portraitSize - targetWidth) / 2;
        var y = portraitSize - padding - targetHeight;
        portrait.Mutate(ctx => ctx.DrawImage(upperBody, new Point(x, y), 1f));

        Directory.CreateDirectory(Path.GetDirectoryName(portraitPath)!);
        await portrait.SaveAsPngAsync(portraitPath, PngWithAlpha, cancellationToken);
        return new GeneratedImageProcessResult(
            sprite.Width,
            sprite.Height,
            portrait.Width,
            portrait.Height,
            HasTransparentPixels(portrait),
            HasTransparentCorners(portrait),
            "derived-character-portrait");
    }

    public static async Task CreatePlacementContextAsync(
        string backgroundPath,
        string outputPath,
        double x,
        double y,
        double width,
        double height,
        string anchor,
        CancellationToken cancellationToken = default)
    {
        using var background = await Image.LoadAsync<Rgba32>(backgroundPath, cancellationToken);
        var boxX = string.Equals(anchor, "bottom-center", StringComparison.OrdinalIgnoreCase)
            ? x - width / 2
            : x - width / 2;
        var boxY = string.Equals(anchor, "bottom-center", StringComparison.OrdinalIgnoreCase)
            ? y - height
            : y - height / 2;

        var marginX = Math.Max(140, width * 1.25);
        var marginY = Math.Max(120, height * 0.75);
        var left = (int)Math.Floor(Math.Max(0, boxX - marginX));
        var top = (int)Math.Floor(Math.Max(0, boxY - marginY));
        var right = (int)Math.Ceiling(Math.Min(background.Width, boxX + width + marginX));
        var bottom = (int)Math.Ceiling(Math.Min(background.Height, boxY + height + marginY));
        var crop = new Rectangle(left, top, Math.Max(1, right - left), Math.Max(1, bottom - top));

        using var context = background.Clone(ctx => ctx.Crop(crop));
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        await context.SaveAsPngAsync(outputPath, cancellationToken);
    }

    private static int RemoveEdgeConnectedWhiteBackground(Image<Rgba32> image)
    {
        var width = image.Width;
        var height = image.Height;
        var visited = new bool[width * height];
        var queue = new Queue<(int X, int Y)>();
        var removed = 0;

        void EnqueueIfBackground(int x, int y)
        {
            var index = y * width + x;
            if (visited[index] || !IsBackgroundCandidate(image[x, y]))
            {
                return;
            }

            visited[index] = true;
            queue.Enqueue((x, y));
        }

        for (var x = 0; x < width; x++)
        {
            EnqueueIfBackground(x, 0);
            EnqueueIfBackground(x, height - 1);
        }

        for (var y = 0; y < height; y++)
        {
            EnqueueIfBackground(0, y);
            EnqueueIfBackground(width - 1, y);
        }

        while (queue.Count > 0)
        {
            var (x, y) = queue.Dequeue();
            var pixel = image[x, y];
            if (pixel.A != 0)
            {
                pixel.A = 0;
                image[x, y] = pixel;
                removed++;
            }

            if (x > 0) EnqueueIfBackground(x - 1, y);
            if (x < width - 1) EnqueueIfBackground(x + 1, y);
            if (y > 0) EnqueueIfBackground(x, y - 1);
            if (y < height - 1) EnqueueIfBackground(x, y + 1);
        }

        return removed;
    }

    private static void RemoveWhiteHalo(Image<Rgba32> image)
    {
        var width = image.Width;
        var height = image.Height;
        var clear = new List<(int X, int Y)>();

        for (var y = 1; y < height - 1; y++)
        {
            for (var x = 1; x < width - 1; x++)
            {
                var pixel = image[x, y];
                if (pixel.A == 0 || !IsBackgroundCandidate(pixel))
                {
                    continue;
                }

                if (image[x - 1, y].A == 0 ||
                    image[x + 1, y].A == 0 ||
                    image[x, y - 1].A == 0 ||
                    image[x, y + 1].A == 0)
                {
                    clear.Add((x, y));
                }
            }
        }

        foreach (var (x, y) in clear)
        {
            var pixel = image[x, y];
            pixel.A = 0;
            image[x, y] = pixel;
        }
    }

    private static Rectangle? GetAlphaBounds(Image<Rgba32> image)
    {
        var minX = image.Width;
        var minY = image.Height;
        var maxX = -1;
        var maxY = -1;

        for (var y = 0; y < image.Height; y++)
        {
            for (var x = 0; x < image.Width; x++)
            {
                if (image[x, y].A <= 10)
                {
                    continue;
                }

                minX = Math.Min(minX, x);
                minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x);
                maxY = Math.Max(maxY, y);
            }
        }

        if (maxX < minX || maxY < minY)
        {
            return null;
        }

        return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    private static bool HasTransparentPixels(Image<Rgba32> image)
    {
        for (var y = 0; y < image.Height; y++)
        {
            for (var x = 0; x < image.Width; x++)
            {
                if (image[x, y].A < 255)
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static bool HasTransparentCorners(Image<Rgba32> image) =>
        image[0, 0].A == 0 &&
        image[image.Width - 1, 0].A == 0 &&
        image[0, image.Height - 1].A == 0 &&
        image[image.Width - 1, image.Height - 1].A == 0;

    private static bool IsBackgroundCandidate(Rgba32 pixel)
    {
        if (pixel.A == 0)
        {
            return true;
        }

        var max = Math.Max(pixel.R, Math.Max(pixel.G, pixel.B));
        var min = Math.Min(pixel.R, Math.Min(pixel.G, pixel.B));
        var nearNeutral = max - min <= 30;
        return pixel.R >= 235 && pixel.G >= 235 && pixel.B >= 235 && nearNeutral;
    }
}
