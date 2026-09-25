using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Read-only leaderboard aggregation. Derived entirely from existing collections (gameResults +
/// gameRooms); never writes. Two batched reads avoid an N+1 over rooms.
/// </summary>
public class LeaderboardService : ILeaderboardService
{
    private readonly MongoDbContext _db;

    public LeaderboardService(MongoDbContext db) => _db = db;

    public async Task<LeaderboardDto> GetCaseLeaderboardAsync(
        string caseId, string? metric, int limit = 100,
        DateTime? after = null, DateTime? before = null, CancellationToken ct = default)
    {
        var filter = Builders<GameResult>.Filter.And(
            Builders<GameResult>.Filter.Eq(r => r.CaseId, caseId),
            Builders<GameResult>.Filter.Eq(r => r.Success, true));
        if (after is not null)
        {
            filter &= Builders<GameResult>.Filter.Gte(r => r.CreatedAt, after.Value);
        }
        if (before is not null)
        {
            filter &= Builders<GameResult>.Filter.Lt(r => r.CreatedAt, before.Value);
        }

        var results = await _db.GameResults.Find(filter).ToListAsync(ct);

        if (results.Count == 0)
        {
            return new LeaderboardDto { Metric = LeaderboardMetrics.Normalize(metric), TotalRanked = 0 };
        }

        var roomIds = results
            .Select(r => r.RoomId)
            .Where(id => !string.IsNullOrEmpty(id))
            .Distinct()
            .ToList();

        var rooms = roomIds.Count == 0
            ? new List<GameRoom>()
            : await _db.Rooms.Find(Builders<GameRoom>.Filter.In(r => r.Id, roomIds)).ToListAsync(ct);

        var roomsById = rooms.ToDictionary(r => r.Id);
        return LeaderboardRules.Build(results, roomsById, metric, limit, after, before);
    }
}
