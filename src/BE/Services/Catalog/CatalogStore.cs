using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models.Catalog;

namespace SirLocked.Api.Services.Catalog;

/// <summary>The collections behind the admin-managed catalog. Like MarketStore, they sit beside the shared context.</summary>
public sealed class CatalogStore
{
    private readonly MongoDbContext _db;

    public CatalogStore(MongoDbContext db) => _db = db;

    public IMongoCollection<CatalogItem> Items => _db.Database.GetCollection<CatalogItem>("catalogItems");
    public IMongoCollection<CatalogChest> Chests => _db.Database.GetCollection<CatalogChest>("chests");
    public IMongoCollection<CatalogLevelReward> LevelRewards => _db.Database.GetCollection<CatalogLevelReward>("levelRewards");
    public IMongoCollection<CatalogAchievement> Achievements => _db.Database.GetCollection<CatalogAchievement>("achievements");
    public IMongoCollection<ProgressSettingsDocument> ProgressSettings => _db.Database.GetCollection<ProgressSettingsDocument>("gameSettings");
    public IMongoCollection<CatalogSeedState> SeedState => _db.Database.GetCollection<CatalogSeedState>("gameSettings");
    public IMongoCollection<AdminAuditEntry> Audit => _db.Database.GetCollection<AdminAuditEntry>("adminAudit");

    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await Items.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<CatalogItem>(Builders<CatalogItem>.IndexKeys.Ascending(i => i.Category).Ascending(i => i.Rarity),
                new CreateIndexOptions { Name = "ix_catalogItems_category_rarity" }),
            new CreateIndexModel<CatalogItem>(Builders<CatalogItem>.IndexKeys.Ascending(i => i.Retired).Ascending(i => i.SortOrder),
                new CreateIndexOptions { Name = "ix_catalogItems_retired_sortOrder" }),
        }, ct);
        await Chests.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<CatalogChest>(Builders<CatalogChest>.IndexKeys.Ascending(c => c.Active).Ascending(c => c.SortOrder),
                new CreateIndexOptions { Name = "ix_chests_active_sortOrder" }),
            // A key opens exactly one chest type, so two chests can never share one.
            new CreateIndexModel<CatalogChest>(Builders<CatalogChest>.IndexKeys.Ascending(c => c.KeyDefId),
                new CreateIndexOptions { Name = "ux_chests_keyDefId", Unique = true }),
        }, ct);
        await LevelRewards.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<CatalogLevelReward>(Builders<CatalogLevelReward>.IndexKeys.Ascending(r => r.Level),
                new CreateIndexOptions { Name = "ix_levelRewards_level" }),
            new CreateIndexModel<CatalogLevelReward>(Builders<CatalogLevelReward>.IndexKeys.Ascending(r => r.DefId),
                new CreateIndexOptions { Name = "ix_levelRewards_defId" }),
        }, ct);
        await Audit.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<AdminAuditEntry>(Builders<AdminAuditEntry>.IndexKeys.Descending(a => a.At),
                new CreateIndexOptions { Name = "ix_adminAudit_at" }),
            new CreateIndexModel<AdminAuditEntry>(Builders<AdminAuditEntry>.IndexKeys.Ascending(a => a.TargetType).Ascending(a => a.TargetId).Descending(a => a.At),
                new CreateIndexOptions { Name = "ix_adminAudit_target_at" }),
            new CreateIndexModel<AdminAuditEntry>(Builders<AdminAuditEntry>.IndexKeys.Ascending(a => a.AdminId).Descending(a => a.At),
                new CreateIndexOptions { Name = "ix_adminAudit_admin_at" }),
        }, ct);
    }
}
