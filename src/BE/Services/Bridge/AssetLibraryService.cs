using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Bridge;

public sealed class AssetLibraryUpsertRequest
{
    public List<AssetLibraryEntry> Items { get; set; } = new();
}

public sealed record AssetLibraryUpsertResult(int Received, int Inserted, int Updated, int Unchanged);

/// <summary>The shared studio image library: the bot pushes it, the order form reads it.</summary>
public sealed class AssetLibraryService(MongoDbContext db)
{
    public const int MaxItemsPerUpsert = 500;
    public const int MaxFilesPerItem = 20;

    public async Task<List<AssetLibraryEntry>> ListAsync(string? world, string? kind, CancellationToken ct = default) =>
        await ListAsync(world, kind, includeRetired: false, ct);

    /// <summary>The bot sees retired pictures too (to keep its local index in sync); the order form never does.</summary>
    public async Task<List<AssetLibraryEntry>> ListAsync(string? world, string? kind, bool includeRetired, CancellationToken ct = default)
    {
        var filter = Builders<AssetLibraryEntry>.Filter.Empty;
        if (!string.IsNullOrWhiteSpace(world))
        {
            var normalized = world.Trim().ToUpperInvariant();
            if (!AiCaseWorlds.LibraryWorlds.Contains(normalized))
                throw ApiException.BadRequest($"world '{world}' is not supported.");
            // Entries for every world belong to each world's catalogue.
            filter &= normalized == AiCaseWorlds.All
                ? Builders<AssetLibraryEntry>.Filter.Eq(item => item.World, AiCaseWorlds.All)
                : Builders<AssetLibraryEntry>.Filter.In(item => item.World, [normalized, AiCaseWorlds.All]);
        }
        if (!string.IsNullOrWhiteSpace(kind))
        {
            var normalized = kind.Trim().ToUpperInvariant();
            if (!AssetLibraryKinds.All.Contains(normalized))
                throw ApiException.BadRequest($"kind '{kind}' is not supported.");
            filter &= Builders<AssetLibraryEntry>.Filter.Eq(item => item.Kind, normalized);
        }
        if (!includeRetired) filter &= Builders<AssetLibraryEntry>.Filter.Ne(item => item.Retired, true);
        return await db.AssetLibrary.Find(filter)
            .SortBy(item => item.Kind).ThenBy(item => item.Key)
            .Limit(5000)
            .ToListAsync(ct);
    }

    /// <summary>Inserts or updates by key. Sending the same list twice changes nothing and never duplicates.</summary>
    public async Task<AssetLibraryUpsertResult> UpsertAsync(AssetLibraryUpsertRequest request, CancellationToken ct = default)
    {
        var items = request.Items ?? new List<AssetLibraryEntry>();
        if (items.Count == 0) return new AssetLibraryUpsertResult(0, 0, 0, 0);
        if (items.Count > MaxItemsPerUpsert)
            throw ApiException.BadRequest($"Send at most {MaxItemsPerUpsert} library items per request.");
        var normalized = items.Select(Normalize).ToList();
        var duplicateKey = normalized.GroupBy(item => item.Key, StringComparer.Ordinal).FirstOrDefault(group => group.Count() > 1);
        if (duplicateKey is not null)
            throw ApiException.BadRequest($"Library key '{duplicateKey.Key}' appears more than once in the request.");

        int inserted = 0, updated = 0, unchanged = 0;
        var now = DateTime.UtcNow;
        foreach (var item in normalized)
        {
            var existing = await db.AssetLibrary.Find(entry => entry.Key == item.Key).FirstOrDefaultAsync(ct);
            if (existing is not null && SameContent(existing, item))
            {
                unchanged++;
                continue;
            }
            var update = Builders<AssetLibraryEntry>.Update
                .Set(entry => entry.Kind, item.Kind)
                .Set(entry => entry.World, item.World)
                .Set(entry => entry.Tags, item.Tags)
                .Set(entry => entry.NameVi, item.NameVi)
                .Set(entry => entry.NameEn, item.NameEn)
                .Set(entry => entry.Url, item.Url)
                .Set(entry => entry.ThumbUrl, item.ThumbUrl)
                .Set(entry => entry.Width, item.Width)
                .Set(entry => entry.Height, item.Height)
                .Set(entry => entry.ParentKey, item.ParentKey)
                .Set(entry => entry.Variant, item.Variant)
                .Set(entry => entry.Source, item.Source)
                .Set(entry => entry.PixelLabJobId, item.PixelLabJobId)
                .Set(entry => entry.FirstUsedByCaseId, item.FirstUsedByCaseId)
                .Set(entry => entry.Prompt, item.Prompt)
                .Set(entry => entry.Files, item.Files)
                .Set(entry => entry.Retired, item.Retired)
                .Set(entry => entry.UpdatedAt, now)
                .SetOnInsert(entry => entry.Key, item.Key)
                .SetOnInsert(entry => entry.CreatedAt, now);
            try
            {
                var result = await db.AssetLibrary.UpdateOneAsync(
                    entry => entry.Key == item.Key, update, new UpdateOptions { IsUpsert = true }, ct);
                if (result.UpsertedId is not null) inserted++;
                else updated++;
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                // Another upsert of the same key won the race; apply ours as an update.
                await db.AssetLibrary.UpdateOneAsync(entry => entry.Key == item.Key, update, cancellationToken: ct);
                updated++;
            }
        }
        return new AssetLibraryUpsertResult(items.Count, inserted, updated, unchanged);
    }

    private static bool SameContent(AssetLibraryEntry left, AssetLibraryEntry right) =>
        left.Kind == right.Kind && left.World == right.World && left.Tags.SequenceEqual(right.Tags)
        && left.NameVi == right.NameVi && left.NameEn == right.NameEn && left.Url == right.Url
        && left.ThumbUrl == right.ThumbUrl && left.Width == right.Width && left.Height == right.Height
        && left.ParentKey == right.ParentKey && left.Variant == right.Variant && left.Source == right.Source
        && left.PixelLabJobId == right.PixelLabJobId && left.FirstUsedByCaseId == right.FirstUsedByCaseId
        && left.Prompt == right.Prompt && left.Retired == right.Retired
        && (left.Files ?? new()).Count == (right.Files ?? new()).Count
        && (left.Files ?? new()).All(pair => (right.Files ?? new()).TryGetValue(pair.Key, out var value) && value == pair.Value);

    private static AssetLibraryEntry Normalize(AssetLibraryEntry item)
    {
        static ApiException Invalid(string message) =>
            ApiException.BadRequest(message, new ApiErrorDetails("ASSET_LIBRARY_INVALID", "ai.library.invalid"));
        var key = (item.Key ?? string.Empty).Trim();
        if (key.Length is 0 or > 120 || key.Any(char.IsWhiteSpace)) throw Invalid("Every library item needs a key without spaces (at most 120 characters).");
        var kind = (item.Kind ?? string.Empty).Trim().ToUpperInvariant();
        if (!AssetLibraryKinds.All.Contains(kind)) throw Invalid($"Library item '{key}' has an unsupported kind.");
        var world = string.IsNullOrWhiteSpace(item.World) ? AiCaseWorlds.All : item.World.Trim().ToUpperInvariant();
        if (!AiCaseWorlds.LibraryWorlds.Contains(world)) throw Invalid($"Library item '{key}' has an unsupported world.");
        var source = string.IsNullOrWhiteSpace(item.Source) ? AssetLibrarySources.PixelLab : item.Source.Trim().ToUpperInvariant();
        if (!AssetLibrarySources.All.Contains(source)) throw Invalid($"Library item '{key}' has an unsupported source.");
        var url = (item.Url ?? string.Empty).Trim();
        if (!IsSafeUrl(url)) throw Invalid($"Library item '{key}' needs an https:// or /assets/ URL.");
        var thumb = (item.ThumbUrl ?? string.Empty).Trim();
        if (thumb.Length > 0 && !IsSafeUrl(thumb)) throw Invalid($"Library item '{key}' has an unsafe thumbnail URL.");
        if (item.Width is < 0 or > 8192 || item.Height is < 0 or > 8192) throw Invalid($"Library item '{key}' has an invalid size.");
        var files = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (role, fileUrl) in item.Files ?? new Dictionary<string, string>())
        {
            var normalizedRole = (role ?? string.Empty).Trim().ToLowerInvariant();
            if (!IsSafeRole(normalizedRole)) throw Invalid($"Library item '{key}' has an invalid file role '{role}'.");
            var value = (fileUrl ?? string.Empty).Trim();
            if (!IsSafeUrl(value)) throw Invalid($"Library item '{key}' file '{normalizedRole}' needs an https:// or /assets/ URL.");
            files[normalizedRole] = value;
        }
        if (files.Count > MaxFilesPerItem) throw Invalid($"Library item '{key}' has more than {MaxFilesPerItem} files.");
        return new AssetLibraryEntry
        {
            Key = key,
            Kind = kind,
            World = world,
            Tags = (item.Tags ?? new List<string>()).Where(tag => !string.IsNullOrWhiteSpace(tag))
                .Select(tag => tag.Trim().ToLowerInvariant()).Distinct(StringComparer.Ordinal).Take(40).ToList(),
            NameVi = Clip(item.NameVi, 200),
            NameEn = Clip(item.NameEn, 200),
            Url = url,
            ThumbUrl = thumb,
            Width = item.Width,
            Height = item.Height,
            ParentKey = Clip(item.ParentKey, 120),
            Variant = Clip(item.Variant, 2000),
            Source = source,
            PixelLabJobId = Clip(item.PixelLabJobId, 200),
            FirstUsedByCaseId = Clip(item.FirstUsedByCaseId, 200),
            Prompt = Clip(item.Prompt, 2000),
            Files = files,
            Retired = item.Retired
        };
    }

    private static string Clip(string? value, int max)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length <= max ? text : text[..max];
    }

    /// <summary>A file role or library key segment: lowercase letters, digits and dashes, 1-40 characters.</summary>
    internal static bool IsSafeRole(string role) =>
        role.Length is > 0 and <= 40 && role.All(ch => ch is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '-');

    internal static bool IsSafeUrl(string url) =>
        url.StartsWith("/assets/", StringComparison.Ordinal) && !url.Contains("..", StringComparison.Ordinal)
        || (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && string.IsNullOrEmpty(uri.UserInfo));
}
