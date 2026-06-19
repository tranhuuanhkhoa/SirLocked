using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Conventions;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models;

namespace SirLocked.Api.DataAccess;

public class MongoDbContext
{
    static MongoDbContext()
    {
        // Store documents in camelCase to match ai-game-docs/DATABASE_SCHEMA.md.
        var pack = new ConventionPack
        {
            new CamelCaseElementNameConvention(),
            new IgnoreExtraElementsConvention(true)
        };
        ConventionRegistry.Register("sirlocked", pack, _ => true);
    }

    public MongoDbContext(IOptions<MongoDbSettings> options)
    {
        Settings = options.Value;
        var clientSettings = MongoClientSettings.FromConnectionString(Settings.ConnectionString);
        if (clientSettings.UseTls)
        {
            // Windows Schannel can fail the TLS 1.3 handshake against MongoDB Atlas
            // ("The Local Security Authority cannot be contacted"); pin TLS 1.2.
            clientSettings.SslSettings = new SslSettings
            {
                EnabledSslProtocols = System.Security.Authentication.SslProtocols.Tls12
            };
        }
        var client = new MongoClient(clientSettings);
        Database = client.GetDatabase(Settings.DatabaseName);
    }

    public MongoDbSettings Settings { get; }
    public IMongoDatabase Database { get; }

    public IMongoCollection<User> Users => Database.GetCollection<User>(Settings.UsersCollectionName);
    public IMongoCollection<GameCase> Cases => Database.GetCollection<GameCase>(Settings.CasesCollectionName);
    public IMongoCollection<GameRoom> Rooms => Database.GetCollection<GameRoom>(Settings.RoomsCollectionName);
    public IMongoCollection<GameResult> GameResults => Database.GetCollection<GameResult>(Settings.GameResultsCollectionName);
    public IMongoCollection<GameActionLog> ActionLogs => Database.GetCollection<GameActionLog>(Settings.ActionLogsCollectionName);
    public IMongoCollection<AiCaseDraft> AiCaseDrafts => Database.GetCollection<AiCaseDraft>(Settings.AiCaseDraftsCollectionName);
    public IMongoCollection<AiGenerationLog> AiGenerationLogs => Database.GetCollection<AiGenerationLog>(Settings.AiGenerationLogsCollectionName);
    public IMongoCollection<EvidencePhoto> EvidencePhotos => Database.GetCollection<EvidencePhoto>(Settings.EvidencePhotosCollectionName);
    public IMongoCollection<WeeklyFeature> WeeklyFeatures => Database.GetCollection<WeeklyFeature>(Settings.WeeklyFeaturesCollectionName);

    /// <summary>Creates the unique/lookup indexes required by DATABASE_SCHEMA.md. Safe to call repeatedly.</summary>
    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await Users.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<User>(
                Builders<User>.IndexKeys.Ascending(u => u.Email),
                new CreateIndexOptions { Unique = true, Name = "ux_users_email" }),
            new CreateIndexModel<User>(Builders<User>.IndexKeys.Ascending(u => u.Status))
        }, ct);

        await Cases.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<GameCase>(
                Builders<GameCase>.IndexKeys.Ascending(c => c.CaseId),
                new CreateIndexOptions { Unique = true, Name = "ux_cases_caseId" }),
            new CreateIndexModel<GameCase>(Builders<GameCase>.IndexKeys.Ascending(c => c.Status)),
            new CreateIndexModel<GameCase>(Builders<GameCase>.IndexKeys.Descending(c => c.UpdatedAt))
        }, ct);

        await Rooms.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<GameRoom>(
                Builders<GameRoom>.IndexKeys.Ascending(r => r.RoomCode),
                new CreateIndexOptions { Unique = true, Name = "ux_rooms_roomCode" }),
            new CreateIndexModel<GameRoom>(Builders<GameRoom>.IndexKeys.Ascending(r => r.CaseId)),
            new CreateIndexModel<GameRoom>(Builders<GameRoom>.IndexKeys.Ascending(r => r.HostUserId)),
            new CreateIndexModel<GameRoom>(Builders<GameRoom>.IndexKeys.Ascending(r => r.Status))
        }, ct);

        await GameResults.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<GameResult>(Builders<GameResult>.IndexKeys.Ascending(r => r.RoomId)),
            new CreateIndexModel<GameResult>(Builders<GameResult>.IndexKeys.Ascending(r => r.CaseId)),
            new CreateIndexModel<GameResult>(Builders<GameResult>.IndexKeys.Descending(r => r.CreatedAt))
        }, ct);

        await ActionLogs.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<GameActionLog>(Builders<GameActionLog>.IndexKeys
                .Ascending(l => l.RoomId).Descending(l => l.CreatedAt))
        }, ct);

        await AiCaseDrafts.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<AiCaseDraft>(Builders<AiCaseDraft>.IndexKeys.Ascending(d => d.Status)),
            new CreateIndexModel<AiCaseDraft>(Builders<AiCaseDraft>.IndexKeys.Descending(d => d.CreatedAt))
        }, ct);

        await AiGenerationLogs.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<AiGenerationLog>(Builders<AiGenerationLog>.IndexKeys
                .Ascending(l => l.DraftId).Descending(l => l.CreatedAt))
        }, ct);

        await EvidencePhotos.Indexes.CreateOneAsync(
            new CreateIndexModel<EvidencePhoto>(
                Builders<EvidencePhoto>.IndexKeys
                    .Ascending(p => p.RoomId)
                    .Ascending(p => p.ClueId),
                new CreateIndexOptions { Unique = true, Name = "ux_evidencePhotos_roomId_clueId" }),
            cancellationToken: ct);

        await WeeklyFeatures.Indexes.CreateOneAsync(
            new CreateIndexModel<WeeklyFeature>(
                Builders<WeeklyFeature>.IndexKeys
                    .Ascending(w => w.Type)
                    .Ascending(w => w.IsActive),
                new CreateIndexOptions { Name = "ix_weeklyFeatures_type_isActive" }),
            cancellationToken: ct);
    }

    public async Task<bool> PingAsync(CancellationToken ct = default)
    {
        await Database.RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1), cancellationToken: ct);
        return true;
    }
}
