using MongoDB.Driver;
using SirLocked.Api.Models;

namespace SirLocked.Api.DataAccess;

/// <summary>Collections of the Claude bridge: queued questions and the shared image library.</summary>
public partial class MongoDbContext
{
    public const string AiBridgeRequestsCollectionName = "aiBridgeRequests";
    public const string AssetLibraryCollectionName = "assetLibrary";

    public IMongoCollection<AiBridgeRequest> AiBridgeRequests =>
        Database.GetCollection<AiBridgeRequest>(AiBridgeRequestsCollectionName);

    public IMongoCollection<AssetLibraryEntry> AssetLibrary =>
        Database.GetCollection<AssetLibraryEntry>(AssetLibraryCollectionName);

    private async Task EnsureBridgeIndexesAsync(CancellationToken ct)
    {
        await Services.Bridge.AiBridgeRequestStore.EnsureIndexesAsync(AiBridgeRequests, ct);
        await AssetLibrary.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<AssetLibraryEntry>(
                Builders<AssetLibraryEntry>.IndexKeys.Ascending(item => item.Key),
                new CreateIndexOptions { Unique = true, Name = "ux_assetLibrary_key" }),
            new CreateIndexModel<AssetLibraryEntry>(
                Builders<AssetLibraryEntry>.IndexKeys.Ascending(item => item.World).Ascending(item => item.Kind),
                new CreateIndexOptions { Name = "ix_assetLibrary_world_kind" })
        }, ct);
    }
}
