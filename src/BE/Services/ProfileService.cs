using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Profile;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Read-only detective profile + rank, aggregated from existing collections. Never writes.
///
/// Audit notes (Phase 4 — nothing fabricated):
///  - Attribution: GameResult has no single userId; it stores Players (the user ids in that game),
///    so a user's plays are the results whose Players list contains the user id.
///  - Creator stats: GameCase has no author/creator field, so cases cannot be attributed to a user.
///    GetCreatorStatsAsync returns null and the profile hides the "my cases" section. Add an
///    authorId field on GameCase (set at AI import/publish) to enable this and the Phase 4 wiring.
///  - Fastest solve: GameResult stores no duration; start/end live on the embedded
///    GameRoom.GameplayState. We join best-effort via RoomId and drop plays whose room was cleaned up.
/// </summary>
public class ProfileService : IProfileService
{
    private readonly MongoDbContext _db;

    public ProfileService(MongoDbContext db) => _db = db;

    public async Task<DetectiveProfileDto> GetProfileAsync(string userId, CancellationToken ct = default)
    {
        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync(ct)
                   ?? throw ApiException.NotFound("User not found.");

        var results = await _db.GameResults.Find(r => r.Players.Contains(userId)).ToListAsync(ct);

        // Batch-load the rooms behind these plays for best-effort fastest-solve timing (one query, no N+1).
        var roomIds = results
            .Select(r => r.RoomId)
            .Where(id => !string.IsNullOrEmpty(id))
            .Distinct()
            .ToList();
        var roomsById = new Dictionary<string, GameRoom>();
        if (roomIds.Count > 0)
        {
            var rooms = await _db.Rooms.Find(r => roomIds.Contains(r.Id)).ToListAsync(ct);
            foreach (var room in rooms)
            {
                roomsById[room.Id] = room;
            }
        }

        var profile = BuildProfile(user.Id, user.FullName, user.Role, results, roomsById);
        profile.IsEmailVerified = user.IsEmailVerified;
        profile.HasPassword = !string.IsNullOrWhiteSpace(user.PasswordHash);
        profile.CreatorStats = await GetCreatorStatsAsync(userId, ct);
        return profile;
    }

    public Task<CreatorStatsDto?> GetCreatorStatsAsync(string userId, CancellationToken ct = default)
    {
        // GameCase has no author/creator field, so authored cases cannot be identified.
        // Return null → frontend hides the creator section. See class note for the future field.
        return Task.FromResult<CreatorStatsDto?>(null);
    }

    // ----- Pure helpers (unit-tested directly) -----

    /// <summary>Builds the profile DTO from a user's own plays (already filtered to that user).</summary>
    public static DetectiveProfileDto BuildProfile(
        string userId, string displayName, string role,
        IReadOnlyCollection<GameResult> userResults,
        IReadOnlyDictionary<string, GameRoom> roomsById)
    {
        var casesPlayed = userResults
            .Select(r => r.CaseId)
            .Where(id => !string.IsNullOrEmpty(id))
            .Distinct()
            .Count();
        var casesSolved = userResults
            .Where(r => r.Success)
            .Select(r => r.CaseId)
            .Where(id => !string.IsNullOrEmpty(id))
            .Distinct()
            .Count();
        var totalPlays = userResults.Count;
        var wins = userResults.Count(r => r.Success);
        var successRate = totalPlays == 0 ? 0 : Math.Round((double)wins / totalPlays, 4);

        double? fastest = null;
        foreach (var r in userResults.Where(r => r.Success))
        {
            var seconds = TrySolveSeconds(r, roomsById);
            if (seconds is not null && (fastest is null || seconds < fastest))
            {
                fastest = seconds;
            }
        }

        return new DetectiveProfileDto
        {
            UserId = userId,
            DisplayName = displayName,
            Role = role,
            CasesSolved = casesSolved,
            CasesPlayed = casesPlayed,
            SuccessRate = successRate,
            Rank = ComputeRank(casesSolved),
            FastestSolveSeconds = fastest is null ? null : Math.Round(fastest.Value, 0),
            CreatorStats = null
        };
    }

    /// <summary>Maps a distinct-cases-solved count to a rank tier with progress toward the next tier.</summary>
    public static RankDto ComputeRank(int casesSolved)
    {
        var tiers = DetectiveRanks.Tiers;
        var idx = 0;
        for (var i = 0; i < tiers.Length; i++)
        {
            if (casesSolved >= tiers[i].Min)
            {
                idx = i;
            }
        }

        var current = tiers[idx];
        var isMax = idx == tiers.Length - 1;
        int? nextThreshold = isMax ? null : tiers[idx + 1].Min;
        var nextTierLabel = isMax ? null : tiers[idx + 1].Label;

        double progress;
        if (isMax)
        {
            progress = 100;
        }
        else
        {
            var span = tiers[idx + 1].Min - current.Min;
            progress = span <= 0 ? 100 : (double)(casesSolved - current.Min) / span * 100;
        }

        return new RankDto
        {
            Tier = current.Key,
            TierLabel = current.Label,
            Solved = casesSolved,
            NextThreshold = nextThreshold,
            NextTierLabel = nextTierLabel,
            ProgressPercent = Math.Round(Math.Clamp(progress, 0, 100), 1)
        };
    }

    private static double? TrySolveSeconds(GameResult r, IReadOnlyDictionary<string, GameRoom> roomsById)
    {
        if (string.IsNullOrEmpty(r.RoomId) || !roomsById.TryGetValue(r.RoomId, out var room))
        {
            return null;
        }
        var state = room.GameplayState;
        if (state is null)
        {
            return null;
        }
        var end = state.CompletedAt ?? r.CreatedAt;
        var span = end - state.StartedAt;
        return span > TimeSpan.Zero ? span.TotalSeconds : null;
    }
}
