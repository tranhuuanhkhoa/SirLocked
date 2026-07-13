using Microsoft.AspNetCore.Http;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
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
    public async Task CapturePersistence_PhotoFailureDoesNotInvokeOrMutateRoomCommit()
    {
        var state = new GameplayState();
        var commitInvoked = false;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            EvidenceCapturePersistenceCoordinator.PersistAsync(
                () => throw new InvalidOperationException("photo write failed"),
                () =>
                {
                    commitInvoked = true;
                    state.CapturedClueIds.Add("clue-1");
                    state.UnlockedClueIds.Add("clue-1");
                    return Task.FromResult(true);
                }));

        Assert.False(commitInvoked);
        Assert.Empty(state.CapturedClueIds);
        Assert.Empty(state.UnlockedClueIds);
    }

    [Fact]
    public async Task CapturePersistence_ConflictReplayKeepsOrphanHiddenAndEventuallyCommits()
    {
        var persistedPhotos = new Dictionary<(string RoomId, string ClueId), byte[]>();
        var room = new GameRoom
        {
            GameplayState = new GameplayState
            {
                // The clue was unlocked by another mechanic before this camera attempt.
                UnlockedClueIds = new List<string> { "clue-1" }
            }
        };
        var upsertAttempts = 0;

        Task UpsertPhoto()
        {
            upsertAttempts++;
            persistedPhotos[("room-1", "clue-1")] = new byte[] { 4, 2 };
            return Task.CompletedTask;
        }

        var conflictedState = new GameplayState
        {
            UnlockedClueIds = new List<string> { "clue-1" }
        };
        var firstCommit = await EvidenceCapturePersistenceCoordinator.PersistAsync(
            UpsertPhoto,
            () =>
            {
                conflictedState.CapturedClueIds.Add("clue-1");
                return Task.FromResult(false);
            });

        Assert.False(firstCommit);
        Assert.Single(persistedPhotos);
        Assert.False(EvidenceCapturePersistenceCoordinator.IsPhotoVisible(room, "clue-1"));
        Assert.DoesNotContain(
            "clue-1",
            EvidenceCapturePersistenceCoordinator.VisiblePhotoClueIds(room.GameplayState!));

        var reloadedState = new GameplayState
        {
            UnlockedClueIds = new List<string> { "clue-1" }
        };
        var secondCommit = await EvidenceCapturePersistenceCoordinator.PersistAsync(
            UpsertPhoto,
            () =>
            {
                reloadedState.CapturedClueIds.Add("clue-1");
                room.GameplayState = reloadedState;
                return Task.FromResult(true);
            });

        Assert.True(secondCommit);
        Assert.Equal(2, upsertAttempts);
        Assert.Single(persistedPhotos);
        Assert.True(EvidenceCapturePersistenceCoordinator.IsPhotoVisible(room, "clue-1"));
        Assert.Contains(
            "clue-1",
            EvidenceCapturePersistenceCoordinator.VisiblePhotoClueIds(room.GameplayState!));
        Assert.Contains("clue-1", room.GameplayState!.CapturedClueIds);
    }

    private static EvidencePhotoService Service() => new(null!);

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
