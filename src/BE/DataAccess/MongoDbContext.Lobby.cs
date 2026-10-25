using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Models;

namespace SirLocked.Api.DataAccess;

/// <summary>Collections and indexes for public rooms and matchmaking.</summary>
public partial class MongoDbContext
{
    public const string MatchTicketsCollectionName = "matchTickets";
    public const string MatchProposalsCollectionName = "matchProposals";
    public const string ActiveTicketPerUserIndexName = "ux_matchTickets_userId_active";
    public const string RoomMatchIdIndexName = "ux_rooms_matchId";

    public IMongoCollection<MatchTicket> MatchTickets => Database.GetCollection<MatchTicket>(MatchTicketsCollectionName);
    public IMongoCollection<MatchProposal> MatchProposals => Database.GetCollection<MatchProposal>(MatchProposalsCollectionName);

    private async Task EnsureLobbyIndexesAsync(CancellationToken ct)
    {
        await Rooms.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<GameRoom>(
                Builders<GameRoom>.IndexKeys.Ascending(r => r.Visibility).Ascending(r => r.Status).Descending(r => r.UpdatedAt),
                new CreateIndexOptions { Name = "ix_rooms_visibility_status_updatedAt" }),
            // One room per match even if both acceptances race into room creation.
            new CreateIndexModel<GameRoom>(
                Builders<GameRoom>.IndexKeys.Ascending(r => r.MatchId),
                new CreateIndexOptions<GameRoom>
                {
                    Name = RoomMatchIdIndexName,
                    Unique = true,
                    PartialFilterExpression = Builders<GameRoom>.Filter.Type(r => r.MatchId, BsonType.String)
                })
        }, ct);

        await MatchTickets.Indexes.CreateManyAsync(new[]
        {
            // A user can never hold two live tickets, so they can never be matched twice.
            new CreateIndexModel<MatchTicket>(
                Builders<MatchTicket>.IndexKeys.Ascending(t => t.UserId),
                new CreateIndexOptions<MatchTicket>
                {
                    Name = ActiveTicketPerUserIndexName,
                    Unique = true,
                    PartialFilterExpression = Builders<MatchTicket>.Filter.Eq(t => t.IsActive, true)
                }),
            new CreateIndexModel<MatchTicket>(
                Builders<MatchTicket>.IndexKeys
                    .Ascending(t => t.Status).Ascending(t => t.Mode).Ascending(t => t.Language)
                    .Ascending(t => t.CaseLength).Ascending(t => t.SearchStartedAt),
                new CreateIndexOptions { Name = "ix_matchTickets_queue" }),
            new CreateIndexModel<MatchTicket>(
                Builders<MatchTicket>.IndexKeys.Ascending(t => t.Status).Ascending(t => t.LastSeenAt),
                new CreateIndexOptions { Name = "ix_matchTickets_status_lastSeenAt" }),
            new CreateIndexModel<MatchTicket>(
                Builders<MatchTicket>.IndexKeys.Ascending(t => t.UserId).Descending(t => t.UpdatedAt),
                new CreateIndexOptions { Name = "ix_matchTickets_userId_updatedAt" })
        }, ct);

        await MatchProposals.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<MatchProposal>(
                Builders<MatchProposal>.IndexKeys.Ascending(m => m.Status).Ascending(m => m.ExpiresAt),
                new CreateIndexOptions { Name = "ix_matchProposals_status_expiresAt" }),
            new CreateIndexModel<MatchProposal>(
                Builders<MatchProposal>.IndexKeys.Ascending(m => m.Status).Ascending(m => m.UpdatedAt),
                new CreateIndexOptions { Name = "ix_matchProposals_status_updatedAt" })
        }, ct);
    }
}
