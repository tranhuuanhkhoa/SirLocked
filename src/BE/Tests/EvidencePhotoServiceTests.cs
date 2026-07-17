using Microsoft.AspNetCore.Http;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SirLocked.Api.DTOs;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class EvidencePhotoServiceTests
{
    [Fact]
    public async Task NormalizeAsync_ConvertsAndResizesValidImage()
    {
        await using var source = new MemoryStream();
        using (var image = new Image<Rgba32>(800, 400, new Rgba32(20, 40, 60)))
        {
            await image.SaveAsPngAsync(source);
        }
        source.Position = 0;

        var result = await Service().NormalizeAsync(FormFile(source, "image/png"));

        Assert.Equal("image/webp", result.ContentType);
        Assert.Equal(640, result.Width);
        Assert.Equal(320, result.Height);
        Assert.NotEmpty(result.Data);
    }

    [Fact]
    public async Task NormalizeAsync_RejectsUnsupportedContentType()
    {
        await using var source = new MemoryStream(new byte[] { 1, 2, 3 });
        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Service().NormalizeAsync(FormFile(source, "application/octet-stream")));

        Assert.Equal(400, error.StatusCode);
    }

    [Fact]
    public async Task NormalizeAsync_RejectsUndecodableImage()
    {
        await using var source = new MemoryStream(new byte[] { 1, 2, 3, 4 });
        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Service().NormalizeAsync(FormFile(source, "image/png")));

        Assert.Equal(400, error.StatusCode);
    }

    [Fact]
    public async Task NormalizeAsync_RejectsFileOverOneMegabyte()
    {
        await using var source = new MemoryStream(new byte[EvidencePhotoService.MaxUploadBytes + 1]);
        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Service().NormalizeAsync(FormFile(source, "image/png")));

        Assert.Equal(400, error.StatusCode);
    }

    [Fact]
    public void CaptureClueAsync_PersistsPhotoOnlyAfterStateSaveSucceeds()
    {
        var source = File.ReadAllText(Path.Combine(RepoRoot(), "src", "BE", "Services", "GameplayService.cs"));
        var methodStart = source.IndexOf("public async Task<GameActionResponse> CaptureClueAsync", StringComparison.Ordinal);
        Assert.True(methodStart >= 0);

        var normalize = source.IndexOf("_evidencePhotos.NormalizeAsync", methodStart, StringComparison.Ordinal);
        var trySave = source.IndexOf("if (!await TrySaveStateAsync(room, gameCase))", normalize, StringComparison.Ordinal);
        var upsert = source.IndexOf("_evidencePhotos.UpsertAsync", normalize, StringComparison.Ordinal);

        Assert.True(normalize > methodStart);
        Assert.True(trySave > normalize);
        Assert.True(upsert > trySave);
    }

    private static EvidencePhotoService Service() => new(null!);

    private static string RepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "SirLocked.sln")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new InvalidOperationException("Could not locate repository root.");
    }

    private static FormFile FormFile(Stream stream, string contentType) => new(
        stream,
        0,
        stream.Length,
        "photo",
        "evidence.png")
    {
        Headers = new HeaderDictionary(),
        ContentType = contentType
    };
}
