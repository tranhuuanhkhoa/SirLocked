using SirLocked.Api.Services;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace SirLocked.Tests;

public class GeneratedImageProcessorTests
{
    [Fact]
    public async Task NormalizeBackgroundAsync_CropsSceneToRuntimeAspect()
    {
        var path = TempPngPath();
        try
        {
            using (var image = new Image<Rgba32>(Configuration.Default, 1600, 912, new Rgba32(30, 40, 50, 255)))
            {
                await image.SaveAsPngAsync(path);
            }

            var result = await GeneratedImageProcessor.NormalizeBackgroundAsync(path);

            Assert.Equal(1600, result.SourceWidth);
            Assert.Equal(912, result.SourceHeight);
            Assert.Equal(1600, result.NormalizedWidth);
            Assert.Equal(900, result.NormalizedHeight);

            using var normalized = await Image.LoadAsync<Rgba32>(path);
            Assert.Equal(1600, normalized.Width);
            Assert.Equal(900, normalized.Height);
        }
        finally
        {
            DeleteIfExists(path);
        }
    }

    [Fact]
    public async Task NormalizeCutoutAsync_RemovesEdgeConnectedWhiteBackground()
    {
        var path = TempPngPath();
        try
        {
            using (var image = new Image<Rgba32>(Configuration.Default, 96, 96, new Rgba32(255, 255, 255, 255)))
            {
                for (var y = 26; y < 70; y++)
                {
                    for (var x = 30; x < 68; x++)
                    {
                        image[x, y] = new Rgba32(180, 25, 20, 255);
                    }
                }

                await image.SaveAsPngAsync(path);
            }

            var result = await GeneratedImageProcessor.NormalizeCutoutAsync(path);

            Assert.True(result.HasAlpha);
            Assert.True(result.CornersTransparent);
            Assert.Equal("white-background-removed", result.ProcessingStatus);

            using var normalized = await Image.LoadAsync<Rgba32>(path);
            Assert.Equal(0, normalized[0, 0].A);
            Assert.Contains(Enumerable.Range(0, normalized.Height), y =>
                Enumerable.Range(0, normalized.Width).Any(x => normalized[x, y].R > 120 && normalized[x, y].A == 255));
        }
        finally
        {
            DeleteIfExists(path);
        }
    }

    [Fact]
    public async Task NormalizeCutoutAsync_RejectsOpaqueNonWhiteBackground()
    {
        var path = TempPngPath();
        try
        {
            using (var image = new Image<Rgba32>(Configuration.Default, 96, 96, new Rgba32(18, 37, 68, 255)))
            {
                await image.SaveAsPngAsync(path);
            }

            await Assert.ThrowsAsync<InvalidOperationException>(() => GeneratedImageProcessor.NormalizeCutoutAsync(path));
        }
        finally
        {
            DeleteIfExists(path);
        }
    }

    [Fact]
    public async Task CreatePlacementContextAsync_CropsAroundPlannedSlot()
    {
        var backgroundPath = TempPngPath();
        var contextPath = TempPngPath();
        try
        {
            using (var image = new Image<Rgba32>(Configuration.Default, 1600, 900, new Rgba32(20, 30, 40, 255)))
            {
                await image.SaveAsPngAsync(backgroundPath);
            }

            await GeneratedImageProcessor.CreatePlacementContextAsync(
                backgroundPath,
                contextPath,
                x: 1500,
                y: 760,
                width: 120,
                height: 180,
                anchor: "bottom-center");

            using var context = await Image.LoadAsync<Rgba32>(contextPath);
            Assert.InRange(context.Width, 120, 1600);
            Assert.InRange(context.Height, 180, 900);
            Assert.True(context.Width < 1600);
            Assert.True(context.Height < 900);
        }
        finally
        {
            DeleteIfExists(backgroundPath);
            DeleteIfExists(contextPath);
        }
    }

    [Fact]
    public async Task CreateCharacterPortraitAsync_DerivesSquareUpperBodyPortrait()
    {
        var spritePath = TempPngPath();
        var portraitPath = TempPngPath();
        try
        {
            using (var image = new Image<Rgba32>(Configuration.Default, 100, 160, new Rgba32(0, 0, 0, 0)))
            {
                for (var y = 10; y < 150; y++)
                {
                    for (var x = 30; x < 70; x++)
                    {
                        image[x, y] = new Rgba32(180, 25, 20, 255);
                    }
                }

                await image.SaveAsPngAsync(spritePath);
            }

            var result = await GeneratedImageProcessor.CreateCharacterPortraitAsync(spritePath, portraitPath, 128);

            Assert.Equal(128, result.NormalizedWidth);
            Assert.Equal(128, result.NormalizedHeight);
            Assert.True(result.HasAlpha);
            Assert.True(result.CornersTransparent);
            Assert.Equal("derived-character-portrait", result.ProcessingStatus);

            using var portrait = await Image.LoadAsync<Rgba32>(portraitPath);
            Assert.Equal(0, portrait[0, 0].A);
            Assert.Contains(Enumerable.Range(0, portrait.Height), y =>
                Enumerable.Range(0, portrait.Width).Any(x => portrait[x, y].A == 255));
        }
        finally
        {
            DeleteIfExists(spritePath);
            DeleteIfExists(portraitPath);
        }
    }

    [Fact]
    public async Task CreateCharacterPortraitAsync_RejectsEmptySprite()
    {
        var spritePath = TempPngPath();
        var portraitPath = TempPngPath();
        try
        {
            using (var image = new Image<Rgba32>(Configuration.Default, 64, 96, new Rgba32(0, 0, 0, 0)))
            {
                await image.SaveAsPngAsync(spritePath);
            }

            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                GeneratedImageProcessor.CreateCharacterPortraitAsync(spritePath, portraitPath, 128));
        }
        finally
        {
            DeleteIfExists(spritePath);
            DeleteIfExists(portraitPath);
        }
    }

    private static string TempPngPath() =>
        Path.Combine(Path.GetTempPath(), $"sirlocked-{Guid.NewGuid():N}.png");

    private static void DeleteIfExists(string path)
    {
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }
}
