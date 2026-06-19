using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs.Badge;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Read-only achievement derivation. Achievements are computed on the fly from a user's winning
/// gameResults joined to their room GameplayState; nothing is persisted.
/// </summary>
public class BadgeService : IBadgeService
{
    private readonly MongoDbContext _db;

    public BadgeService(MongoDbContext db) => _db = db;

    public async Task<List<BadgeDto>> GetUserBadgesAsync(string userId, CancellationToken ct = default)
    {
        var results = await _db.GameResults
            .Find(Builders<GameResult>.Filter.And(
                Builders<GameResult>.Filter.AnyEq(r => r.Players, userId),
                Builders<GameResult>.Filter.Eq(r => r.Success, true)))
            .ToListAsync(ct);

        if (results.Count == 0)
        {
            // No wins yet: return the full catalog, all unearned.
            return BadgeRules.Evaluate(Array.Empty<BadgePlay>());
        }

        var roomIds = results.Select(r => r.RoomId).Where(id => !string.IsNullOrEmpty(id)).Distinct().ToList();
        var rooms = roomIds.Count == 0
            ? new List<GameRoom>()
            : await _db.Rooms.Find(Builders<GameRoom>.Filter.In(r => r.Id, roomIds)).ToListAsync(ct);
        var roomsById = rooms.ToDictionary(r => r.Id);

        var caseIds = results.Select(r => r.CaseId).Where(id => !string.IsNullOrEmpty(id)).Distinct().ToList();
        var titlesByCaseId = caseIds.Count == 0
            ? new Dictionary<string, string>()
            : (await _db.Cases.Find(Builders<GameCase>.Filter.In(c => c.CaseId, caseIds)).ToListAsync(ct))
                .GroupBy(c => c.CaseId)
                .ToDictionary(g => g.Key, g => g.First().Title);

        var plays = results.Select(r => ToPlay(r, roomsById, titlesByCaseId)).ToList();
        return BadgeRules.Evaluate(plays);
    }

    private static BadgePlay ToPlay(
        GameResult r,
        IReadOnlyDictionary<string, GameRoom> roomsById,
        IReadOnlyDictionary<string, string> titlesByCaseId)
    {
        GameRoom? room = null;
        if (!string.IsNullOrEmpty(r.RoomId))
        {
            roomsById.TryGetValue(r.RoomId, out room);
        }
        var state = room?.GameplayState;

        int? durationSeconds = null;
        if (state is not null)
        {
            var span = (state.CompletedAt ?? r.CreatedAt) - state.StartedAt;
            if (span > TimeSpan.Zero)
            {
                durationSeconds = (int)Math.Round(span.TotalSeconds);
            }
        }

        titlesByCaseId.TryGetValue(r.CaseId, out var title);

        return new BadgePlay(
            CaseId: r.CaseId,
            CaseTitle: title ?? string.Empty,
            HasDetailedStats: state is not null,
            UsedHint: state is not null && state.UsedHintIds.Count > 0,
            DurationSeconds: durationSeconds,
            WrongDeductionCount: state?.WrongDeductionCount ?? 0,
            WrongEvidenceCount: state?.WrongEvidencePresentationCount ?? 0,
            CameraMissCount: state?.CameraMissCount ?? 0,
            Score: r.ScoreSummary?.TotalScore ?? 0,
            CompletedAt: state?.CompletedAt ?? r.CreatedAt);
    }
}
