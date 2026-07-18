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
        if (Settings.AuditSafetyMode)
        {
            V3LocalMongoSafetyGuard.EnsureSafe(Settings);
        }
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
    public IMongoCollection<CaseReview> Reviews => Database.GetCollection<CaseReview>(Settings.ReviewsCollectionName);
    public IMongoCollection<WeeklyFeature> WeeklyFeatures => Database.GetCollection<WeeklyFeature>(Settings.WeeklyFeaturesCollectionName);
    public IMongoCollection<PlaytestEventRecord> PlaytestEvents => Database.GetCollection<PlaytestEventRecord>(Settings.PlaytestEventsCollectionName);

    /// <summary>Creates the unique/lookup indexes required by DATABASE_SCHEMA.md. Safe to call repeatedly.</summary>
    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        // This invariant must be established before any noncritical index work. Program calls
        // PingAsync first, and any failure from this phase is converted to a fail-fast exception.
        await EnsureGameResultIndexesAsync(ct);

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
            new CreateIndexModel<GameCase>(Builders<GameCase>.IndexKeys.Descending(c => c.UpdatedAt)),
            new CreateIndexModel<GameCase>(
                Builders<GameCase>.IndexKeys.Ascending(c => c.Status).Descending(c => c.UpdatedAt),
                new CreateIndexOptions { Name = "ix_cases_status_updatedAt" })
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

        await Reviews.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<CaseReview>(
                Builders<CaseReview>.IndexKeys.Ascending(r => r.CaseId).Ascending(r => r.UserId),
                new CreateIndexOptions { Unique = true, Name = "ux_reviews_caseId_userId" }),
            new CreateIndexModel<CaseReview>(
                Builders<CaseReview>.IndexKeys.Ascending(r => r.CaseId).Descending(r => r.CreatedAt))
        }, ct);

        await WeeklyFeatures.Indexes.CreateOneAsync(
            new CreateIndexModel<WeeklyFeature>(
                Builders<WeeklyFeature>.IndexKeys
                    .Ascending(w => w.Type)
                    .Ascending(w => w.IsActive),
                new CreateIndexOptions { Name = "ix_weeklyFeatures_type_isActive" }),
            cancellationToken: ct);
    }

    private async Task EnsureGameResultIndexesAsync(CancellationToken ct)
    {
        try
        {
            // Never replace the historical non-unique RoomId index until existing data passes
            // a read-only duplicate preflight. Operators receive every duplicate group and must
            // resolve it explicitly; startup never deletes or merges result documents.
            var duplicateRoomIds = await GameResults.Aggregate()
                .Group<BsonDocument>(new BsonDocument
                {
                    { "_id", "$roomId" },
                    { "count", new BsonDocument("$sum", 1) },
                    { "resultIds", new BsonDocument("$push", "$_id") }
                })
                .Match(new BsonDocument("count", new BsonDocument("$gt", 1)))
                .ToListAsync(ct);
            if (duplicateRoomIds.Count > 0)
            {
                throw new GameResultIndexInvariantException(duplicateRoomIds.Select(group =>
                    new DuplicateGameResultRoom(
                        group["_id"].ToString() ?? "null",
                        group["count"].ToInt64(),
                        group["resultIds"].AsBsonArray
                            .Select(resultId => resultId.ToString() ?? "null")
                            .ToList()))
                    .ToList());
            }

            using (var cursor = await GameResults.Indexes.ListAsync(ct))
            {
                var indexes = await cursor.ToListAsync(ct);
                foreach (var index in indexes.Where(GameResultIndexMigration.IsRoomIdOnlyIndex))
                {
                    if (GameResultIndexMigration.IsDesiredRoomIdIndex(index)) continue;

                    var name = index["name"].AsString;
                    try
                    {
                        await GameResults.Indexes.DropOneAsync(name, ct);
                    }
                    catch (MongoCommandException exception) when (
                        GameResultIndexMigration.IsIndexNotFound(exception.Code, exception.CodeName))
                    {
                        // Another app instance already removed the same legacy index.
                    }
                }
            }

            await GameResults.Indexes.CreateManyAsync(new[]
            {
                new CreateIndexModel<GameResult>(
                    Builders<GameResult>.IndexKeys.Ascending(result => result.RoomId),
                    new CreateIndexOptions { Unique = true, Name = GameResultIndexMigration.RequiredIndexName }),
                new CreateIndexModel<GameResult>(Builders<GameResult>.IndexKeys.Ascending(result => result.CaseId)),
                new CreateIndexModel<GameResult>(Builders<GameResult>.IndexKeys.Descending(result => result.CreatedAt))
            }, ct);

            using var verificationCursor = await GameResults.Indexes.ListAsync(ct);
            var verifiedIndexes = await verificationCursor.ToListAsync(ct);
            if (!verifiedIndexes.Any(GameResultIndexMigration.IsDesiredRoomIdIndex))
            {
                throw new GameResultIndexInvariantException(
                    $"MongoDB did not confirm required unique index '{GameResultIndexMigration.RequiredIndexName}'.");
            }
        }
        catch (GameResultIndexInvariantException)
        {
            throw;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new GameResultIndexInvariantException(
                $"MongoDB did not confirm required unique index '{GameResultIndexMigration.RequiredIndexName}'.",
                exception);
        }
    }

    public async Task<bool> PingAsync(CancellationToken ct = default)
    {
        await Database.RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1), cancellationToken: ct);
        return true;
    }
}

public sealed record DuplicateGameResultRoom(
    string RoomId,
    long Count,
    IReadOnlyList<string> ResultIds);

public sealed class GameResultIndexInvariantException : Exception
{
    public GameResultIndexInvariantException(IReadOnlyList<DuplicateGameResultRoom> duplicates)
        : base(BuildDuplicateMessage(duplicates)) => Duplicates = duplicates;

    public GameResultIndexInvariantException(string message, Exception? innerException = null)
        : base(message, innerException) => Duplicates = Array.Empty<DuplicateGameResultRoom>();

    public IReadOnlyList<DuplicateGameResultRoom> Duplicates { get; }

    private static string BuildDuplicateMessage(IReadOnlyList<DuplicateGameResultRoom> duplicates) =>
        $"Cannot create {GameResultIndexMigration.RequiredIndexName}; duplicate GameResult.RoomId values exist: "
        + string.Join("; ", duplicates.Select(duplicate =>
            $"roomId={duplicate.RoomId}, count={duplicate.Count}, resultIds=[{string.Join(",", duplicate.ResultIds)}]"));
}

public static class GameResultIndexMigration
{
    public const string RequiredIndexName = "ux_gameResults_roomId";

    public static bool IsRoomIdOnlyIndex(BsonDocument index)
    {
        if (!index.TryGetValue("key", out var keyValue) || !keyValue.IsBsonDocument) return false;
        var keys = keyValue.AsBsonDocument;
        return keys.ElementCount == 1
               && keys.TryGetValue("roomId", out var direction)
               && direction.IsNumeric
               && direction.ToInt32() == 1;
    }

    public static bool IsDesiredRoomIdIndex(BsonDocument index) =>
        IsRoomIdOnlyIndex(index)
        && index.TryGetValue("name", out var name)
        && name.IsString
        && name.AsString == RequiredIndexName
        && index.TryGetValue("unique", out var unique)
        && unique.IsBoolean
        && unique.AsBoolean;

    public static bool IsIndexNotFound(int code, string? codeName) =>
        code == 27 || string.Equals(codeName, "IndexNotFound", StringComparison.Ordinal);
}
