using MongoDB.Driver;
using SirLocked.Api.Models;

namespace SirLocked.Api.DataAccess;

/// <summary>The in-match chat. Its own collection, so no index from an older chat can clash with these.</summary>
public partial class MongoDbContext
{
    public const string TeamChatCollectionName = "teamChatMessages";
    public const string TeamChatRoomIndexName = "ix_teamChatMessages_roomId_sentAt";
    public const string TeamChatTtlIndexName = "ttl_teamChatMessages_sentAt";
    /// <summary>A match lasts minutes, not days: the chat is kept long enough for a reload, a reconnect or a report.</summary>
    public static readonly TimeSpan TeamChatRetention = TimeSpan.FromDays(3);

    public IMongoCollection<TeamChatMessage> TeamChatMessages => Database.GetCollection<TeamChatMessage>(TeamChatCollectionName);

    private Task EnsureTeamChatIndexesAsync(CancellationToken ct) =>
        TeamChatMessages.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<TeamChatMessage>(
                Builders<TeamChatMessage>.IndexKeys.Ascending(m => m.RoomId).Descending(m => m.SentAt),
                new CreateIndexOptions { Name = TeamChatRoomIndexName }),
            new CreateIndexModel<TeamChatMessage>(
                Builders<TeamChatMessage>.IndexKeys.Ascending(m => m.SentAt),
                new CreateIndexOptions { Name = TeamChatTtlIndexName, ExpireAfter = TeamChatRetention }),
        }, cancellationToken: ct);
}
