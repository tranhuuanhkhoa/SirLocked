using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.API.Configurations;

namespace SirLocked.API.Services;

public sealed class DatabaseBootstrapService
{
    private readonly IMongoClient _mongoClient;
    private readonly MongoDbSettings _settings;
    private readonly ILogger<DatabaseBootstrapService> _logger;

    public DatabaseBootstrapService(
        IMongoClient mongoClient,
        IOptions<MongoDbSettings> settings,
        ILogger<DatabaseBootstrapService> logger)
    {
        _mongoClient = mongoClient;
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        var database = _mongoClient.GetDatabase(_settings.DatabaseName);
        await database.RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1), cancellationToken: cancellationToken);

        var collections = new[]
        {
            _settings.UsersCollectionName,
            _settings.RefreshTokensCollectionName,
            _settings.CasesCollectionName,
            _settings.RoomsCollectionName,
            _settings.RoomChatMessagesCollectionName,
            _settings.GameActionLogsCollectionName,
            _settings.GameResultsCollectionName,
            _settings.AiCaseDraftsCollectionName,
            _settings.AiGenerationLogsCollectionName,
            _settings.GeneratedAssetsCollectionName
        };

        var existingCollections = await (await database.ListCollectionNamesAsync(cancellationToken: cancellationToken))
            .ToListAsync(cancellationToken);

        foreach (var collectionName in collections.Where(name => !string.IsNullOrWhiteSpace(name)))
        {
            if (!existingCollections.Contains(collectionName, StringComparer.OrdinalIgnoreCase))
            {
                await database.CreateCollectionAsync(collectionName, cancellationToken: cancellationToken);
                _logger.LogInformation("Created MongoDB collection {CollectionName}.", collectionName);
            }
        }

        await EnsureCoreIndexesAsync(database, cancellationToken);
    }

    private async Task EnsureCoreIndexesAsync(IMongoDatabase database, CancellationToken cancellationToken)
    {
        await EnsureIndexAsync(database, _settings.UsersCollectionName, "ux_users_email",
            Builders<BsonDocument>.IndexKeys.Ascending("Email"), unique: true, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.UsersCollectionName, "ix_users_role_status",
            Builders<BsonDocument>.IndexKeys.Ascending("Role").Ascending("Status"), unique: false, cancellationToken: cancellationToken);

        await EnsureIndexAsync(database, _settings.RefreshTokensCollectionName, "ux_refreshTokens_token",
            Builders<BsonDocument>.IndexKeys.Ascending("Token"), unique: true, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.RefreshTokensCollectionName, "ix_refreshTokens_userId",
            Builders<BsonDocument>.IndexKeys.Ascending("UserId"), unique: false, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.RefreshTokensCollectionName, "ix_refreshTokens_expiresAt",
            Builders<BsonDocument>.IndexKeys.Ascending("ExpiresAt"), unique: false, cancellationToken: cancellationToken);

        await EnsureIndexAsync(database, _settings.CasesCollectionName, "ux_cases_caseId",
            Builders<BsonDocument>.IndexKeys.Ascending("CaseId"), unique: true, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.CasesCollectionName, "ix_cases_status_createdAt",
            Builders<BsonDocument>.IndexKeys.Ascending("Status").Descending("CreatedAt"), unique: false, cancellationToken: cancellationToken);

        await EnsureIndexAsync(database, _settings.RoomsCollectionName, "ux_rooms_roomCode",
            Builders<BsonDocument>.IndexKeys.Ascending("RoomCode"), unique: true, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.RoomsCollectionName, "ix_rooms_status_createdAt",
            Builders<BsonDocument>.IndexKeys.Ascending("Status").Descending("CreatedAt"), unique: false, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.RoomsCollectionName, "ix_rooms_players_userId",
            Builders<BsonDocument>.IndexKeys.Ascending("Players.UserId"), unique: false, cancellationToken: cancellationToken);

        await EnsureIndexAsync(database, _settings.RoomChatMessagesCollectionName, "ix_roomChatMessages_roomId_sentAt",
            Builders<BsonDocument>.IndexKeys.Ascending("RoomId").Ascending("SentAt"), unique: false, cancellationToken: cancellationToken);

        await EnsureIndexAsync(database, _settings.GameActionLogsCollectionName, "ix_gameActionLogs_roomId_createdAt",
            Builders<BsonDocument>.IndexKeys.Ascending("RoomId").Ascending("CreatedAt"), unique: false, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.GameActionLogsCollectionName, "ix_gameActionLogs_userId_createdAt",
            Builders<BsonDocument>.IndexKeys.Ascending("UserId").Descending("CreatedAt"), unique: false, cancellationToken: cancellationToken);

        await EnsureIndexAsync(database, _settings.GameResultsCollectionName, "ix_gameResults_roomId",
            Builders<BsonDocument>.IndexKeys.Ascending("RoomId"), unique: false, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.GameResultsCollectionName, "ix_gameResults_caseId_completedAt",
            Builders<BsonDocument>.IndexKeys.Ascending("CaseId").Descending("CompletedAt"), unique: false, cancellationToken: cancellationToken);

        await EnsureIndexAsync(database, _settings.AiCaseDraftsCollectionName, "ix_aiCaseDrafts_status_createdAt",
            Builders<BsonDocument>.IndexKeys.Ascending("Status").Descending("CreatedAt"), unique: false, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.AiGenerationLogsCollectionName, "ix_aiGenerationLogs_draftId_createdAt",
            Builders<BsonDocument>.IndexKeys.Ascending("DraftId").Ascending("CreatedAt"), unique: false, cancellationToken: cancellationToken);
        await EnsureIndexAsync(database, _settings.GeneratedAssetsCollectionName, "ix_generatedAssets_draftId_assetType",
            Builders<BsonDocument>.IndexKeys.Ascending("DraftId").Ascending("AssetType"), unique: false, cancellationToken: cancellationToken);
    }

    private static async Task EnsureIndexAsync(
        IMongoDatabase database,
        string collectionName,
        string indexName,
        IndexKeysDefinition<BsonDocument> keys,
        bool unique,
        CancellationToken cancellationToken)
    {
        var collection = database.GetCollection<BsonDocument>(collectionName);
        var existingIndexes = await (await collection.Indexes.ListAsync(cancellationToken)).ToListAsync(cancellationToken);
        if (existingIndexes.Any(index => index.TryGetValue("name", out var name) && name == indexName))
        {
            return;
        }

        await collection.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                keys,
                new CreateIndexOptions { Name = indexName, Unique = unique }),
            cancellationToken: cancellationToken);
    }
}
