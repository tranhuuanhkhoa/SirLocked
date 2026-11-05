using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>Deletes an uploaded avatar's file from the image host. False when it could not: the caller carries on, and says so.</summary>
public interface IAvatarFileRemover
{
    Task<bool> TryRemoveAsync(string userId, CancellationToken ct = default);
}

/// <summary>Deletes the one fixed public id <see cref="CloudinaryAvatarStorage"/> uploads each detective's avatar to, and purges the CDN's copy.</summary>
public sealed class CloudinaryAvatarFileRemover(HttpClient client, IOptions<CloudinarySettings> cloudinary, ILogger<CloudinaryAvatarFileRemover> logger) : IAvatarFileRemover
{
    public async Task<bool> TryRemoveAsync(string userId, CancellationToken ct = default)
    {
        var settings = cloudinary.Value;
        if (!settings.Enabled || string.IsNullOrWhiteSpace(settings.CloudName)
            || string.IsNullOrWhiteSpace(settings.ApiKey) || string.IsNullOrWhiteSpace(settings.ApiSecret))
            return false;
        var parameters = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["invalidate"] = "true",
            ["public_id"] = $"{settings.Folder.Trim('/')}/avatars/{userId}",
            ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
        };
        var form = new Dictionary<string, string>(parameters)
        {
            ["api_key"] = settings.ApiKey,
            ["signature"] = CloudinaryPresentationMediaStorage.Sign(parameters, settings.ApiSecret),
        };
        try
        {
            using var response = await client.PostAsync(
                $"https://api.cloudinary.com/v1_1/{Uri.EscapeDataString(settings.CloudName)}/image/destroy", new FormUrlEncodedContent(form), ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Cloudinary refused to delete the avatar of {UserId}: {Status}.", userId, (int)response.StatusCode);
                return false;
            }
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            // "not found" means the file is gone, which is what was asked for.
            return json.RootElement.TryGetProperty("result", out var result) && result.GetString() is "ok" or "not found";
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(exception, "The avatar file of {UserId} could not be deleted from Cloudinary.", userId);
            return false;
        }
    }
}

/// <summary>The grid of uploaded avatars: newest first, and which ones nobody has looked at yet.</summary>
public sealed class AdminAvatarModeration
{
    private readonly AdminPlayersStore _store;
    private readonly MarketStore _market;
    private readonly IAdminAudit _audit;

    public AdminAvatarModeration(AdminPlayersStore store, MarketStore market, IAdminAudit audit)
    {
        _store = store;
        _market = market;
        _audit = audit;
    }

    private static List<BsonDocument> BasePipeline(bool pendingOnly)
    {
        var stages = new List<BsonDocument>
        {
            new("$match", new BsonDocument("avatarUrl", new BsonDocument("$type", "string"))),
            new("$lookup", new BsonDocument
            {
                { "from", "adminAvatarReviews" }, { "localField", "_id" }, { "foreignField", "_id" }, { "as", "review" },
            }),
            new("$addFields", new BsonDocument
            {
                { "reviewedUrl", new BsonDocument("$first", "$review.url") },
                // Pictures older than the upload time fall back to the last profile write.
                { "sortAt", new BsonDocument("$ifNull", new BsonArray { "$avatarUploadedAt", "$updatedAt" }) },
            }),
        };
        // A new upload has a new address, so an old approval stops matching.
        if (pendingOnly)
            stages.Add(new BsonDocument("$match", new BsonDocument("$expr", new BsonDocument("$ne", new BsonArray { "$reviewedUrl", "$avatarUrl" }))));
        return stages;
    }

    public async Task<AdminPageDto<AdminAvatarRowDto>> ListAsync(bool pendingOnly, int page, int pageSize, CancellationToken ct = default)
    {
        (page, pageSize) = AdminPlayersRules.Paging(page, pageSize);
        var total = await CountAsync(pendingOnly, ct);
        var pipeline = BasePipeline(pendingOnly);
        pipeline.Add(new BsonDocument("$sort", new BsonDocument { { "sortAt", -1 }, { "_id", -1 } }));
        pipeline.Add(new BsonDocument("$skip", (page - 1) * pageSize));
        pipeline.Add(new BsonDocument("$limit", pageSize));
        pipeline.Add(new BsonDocument("$project", new BsonDocument { { "avatarUrl", 1 }, { "reviewedUrl", 1 }, { "sortAt", 1 } }));
        var rows = await _market.PlayerProgress.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);

        var ids = rows.Select(row => row["_id"].AsString).ToList();
        var users = await AdminPlayersLookups.UsersByIdAsync(_market.Context, ids, ct);
        var items = rows.Select(row =>
        {
            var id = row["_id"].AsString;
            var url = row["avatarUrl"].AsString;
            users.TryGetValue(id, out var user);
            return new AdminAvatarRowDto(
                id, user?.FullName ?? id, user?.Email ?? string.Empty, url,
                row.GetValue("sortAt", BsonNull.Value) is { IsBsonNull: false } at ? at.ToUniversalTime() : default,
                row.GetValue("reviewedUrl", BsonNull.Value) is { IsString: true } reviewed && reviewed.AsString == url);
        }).ToList();
        return new AdminPageDto<AdminAvatarRowDto>(items, page, pageSize, total);
    }

    public Task<long> PendingCountAsync(CancellationToken ct = default) => CountAsync(pendingOnly: true, ct);

    private async Task<long> CountAsync(bool pendingOnly, CancellationToken ct)
    {
        var pipeline = BasePipeline(pendingOnly);
        pipeline.Add(new BsonDocument("$count", "n"));
        var counted = await _market.PlayerProgress.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).FirstOrDefaultAsync(ct);
        return counted?["n"].ToInt64() ?? 0;
    }

    /// <summary>Takes this exact picture off the waiting list. Nothing changes for the player.</summary>
    public async Task ApproveAsync(CurrentUser admin, string userId, CancellationToken ct = default)
    {
        var progress = await _market.PlayerProgress.Find(p => p.Id == userId).FirstOrDefaultAsync(ct);
        if (string.IsNullOrEmpty(progress?.AvatarUrl))
            throw AdminPlayersRules.Error(409, AdminPlayerErrors.NoAvatar, "Người chơi này không có ảnh tải lên.");
        var previous = await _store.AvatarReviews.Find(r => r.Id == userId).FirstOrDefaultAsync(ct);
        await _store.AvatarReviews.ReplaceOneAsync(r => r.Id == userId,
            new AdminAvatarReview { Id = userId, Url = progress.AvatarUrl, ReviewedBy = admin.Id, ReviewedAt = _market.Now },
            new ReplaceOptions { IsUpsert = true }, ct);
        await _audit.LogAsync(admin, "player.avatar.approve", "user", userId,
            new { reviewedUrl = previous?.Url }, new { reviewedUrl = progress.AvatarUrl }, null, ct);
    }
}
