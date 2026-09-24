using Microsoft.AspNetCore.Http;
using MongoDB.Driver;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class EvidencePhotoService : IEvidencePhotoService
{
    public const long MaxUploadBytes = 1_000_000;
    private const int MaxDimension = 640;
    private const long MaxDecodedPixels = 4_000_000;
    private static readonly HashSet<string> AllowedContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png",
        "image/jpeg",
        "image/webp"
    };

    private readonly MongoDbContext _db;

    public EvidencePhotoService(MongoDbContext db) => _db = db;

    public async Task<NormalizedEvidencePhoto> NormalizeAsync(
        IFormFile photo,
        CancellationToken cancellationToken = default)
    {
        if (photo is null || photo.Length <= 0)
        {
            throw ApiException.BadRequest("A captured photo is required.");
        }
        if (photo.Length > MaxUploadBytes)
        {
            throw ApiException.BadRequest("The captured photo is too large. Maximum size is 1 MB.");
        }
        if (!AllowedContentTypes.Contains(photo.ContentType))
        {
            throw ApiException.BadRequest("The captured photo must be PNG, JPEG, or WebP.");
        }

        try
        {
            await using var input = photo.OpenReadStream();
            // Identify reads the image header before allocating the decoded pixel
            // buffer. Reject decompression-bomb dimensions even when the compressed
            // upload is below the byte limit.
            var metadata = await Image.IdentifyAsync(input, cancellationToken);
            if (metadata is null || metadata.Width <= 0 || metadata.Height <= 0)
            {
                throw ApiException.BadRequest("The captured photo has invalid dimensions.");
            }
            if ((long)metadata.Width * metadata.Height > MaxDecodedPixels)
            {
                throw ApiException.BadRequest("The captured photo has too many pixels to process.");
            }
            input.Position = 0;
            using var image = await Image.LoadAsync(input, cancellationToken);
            if (image.Width <= 0 || image.Height <= 0)
            {
                throw ApiException.BadRequest("The captured photo has invalid dimensions.");
            }

            if (image.Width > MaxDimension || image.Height > MaxDimension)
            {
                var scale = Math.Min((double)MaxDimension / image.Width, (double)MaxDimension / image.Height);
                image.Mutate(context => context.Resize(
                    Math.Max(1, (int)Math.Round(image.Width * scale)),
                    Math.Max(1, (int)Math.Round(image.Height * scale))));
            }

            await using var output = new MemoryStream();
            await image.SaveAsync(output, new WebpEncoder { Quality = 82 }, cancellationToken);
            return new NormalizedEvidencePhoto(output.ToArray(), "image/webp", image.Width, image.Height);
        }
        catch (ApiException)
        {
            throw;
        }
        catch (Exception ex) when (ex is UnknownImageFormatException or InvalidImageContentException or ArgumentException)
        {
            throw ApiException.BadRequest("The captured photo could not be decoded.");
        }
    }

    public async Task UpsertAsync(
        string roomId,
        string clueId,
        string sceneId,
        string userId,
        NormalizedEvidencePhoto photo,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var filter = Builders<EvidencePhoto>.Filter.And(
            Builders<EvidencePhoto>.Filter.Eq(p => p.RoomId, roomId),
            Builders<EvidencePhoto>.Filter.Eq(p => p.ClueId, clueId));
        var update = Builders<EvidencePhoto>.Update
            .Set(p => p.SceneId, sceneId)
            .Set(p => p.CapturedByUserId, userId)
            .Set(p => p.ContentType, photo.ContentType)
            .Set(p => p.ImageData, photo.Data)
            .Set(p => p.Width, photo.Width)
            .Set(p => p.Height, photo.Height)
            .Set(p => p.UpdatedAt, now)
            .SetOnInsert(p => p.CreatedAt, now);

        await _db.EvidencePhotos.UpdateOneAsync(
            filter,
            update,
            new UpdateOptions { IsUpsert = true },
            cancellationToken);
    }

    public async Task<EvidencePhoto?> GetAsync(
        string roomId,
        string clueId,
        CancellationToken cancellationToken = default) =>
        await _db.EvidencePhotos.Find(p => p.RoomId == roomId && p.ClueId == clueId)
            .FirstOrDefaultAsync(cancellationToken);
}

/// <summary>
/// Orders the two independently durable writes used by a camera hit. The photo write is
/// idempotent, so optimistic room-save retries may safely replay it.
/// </summary>
public static class EvidenceCapturePersistenceCoordinator
{
    public static async Task<bool> PersistAsync(
        Func<Task> persistPhoto,
        Func<Task<bool>> commitRoomState)
    {
        await persistPhoto();
        return await commitRoomState();
    }

    public static bool IsPhotoVisible(GameRoom room, string clueId) =>
        room.GameplayState is { } state
        && state.UnlockedClueIds.Contains(clueId)
        && state.CapturedClueIds.Contains(clueId);

    public static HashSet<string> VisiblePhotoClueIds(GameplayState state) =>
        state.CapturedClueIds.Where(state.UnlockedClueIds.Contains).ToHashSet();
}
