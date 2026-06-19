using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.DTOs.Weekly;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Manages admin-curated weekly features (Case of the Week, Weekly Challenge) and exposes the
/// weekly-windowed challenge leaderboard by delegating to <see cref="ILeaderboardService"/>
/// (Phase 3) with a time filter — no leaderboard logic is duplicated here.
/// </summary>
public class WeeklyService : IWeeklyService
{
    private readonly MongoDbContext _db;
    private readonly ILeaderboardService _leaderboard;

    public WeeklyService(MongoDbContext db, ILeaderboardService leaderboard)
    {
        _db = db;
        _leaderboard = leaderboard;
    }

    public Task<WeeklyFeatureDto?> GetActiveCaseOfWeekAsync(CancellationToken ct = default) =>
        GetActiveAsync(WeeklyFeatureTypes.CaseOfWeek, ct);

    public Task<WeeklyFeatureDto?> GetActiveChallengeAsync(CancellationToken ct = default) =>
        GetActiveAsync(WeeklyFeatureTypes.WeeklyChallenge, ct);

    public async Task<LeaderboardDto> GetChallengeLeaderboardAsync(int limit = 100, CancellationToken ct = default)
    {
        var challenge = await GetActiveFeatureAsync(WeeklyFeatureTypes.WeeklyChallenge, ct);
        if (challenge is null)
        {
            return new LeaderboardDto { Metric = LeaderboardMetrics.Fastest, TotalRanked = 0 };
        }

        // Reuse Phase 3, restricted to plays inside the challenge window.
        return await _leaderboard.GetCaseLeaderboardAsync(
            challenge.CaseId, LeaderboardMetrics.Fastest, limit,
            after: challenge.WeekStart, before: challenge.WeekEnd, ct: ct);
    }

    public async Task<WeeklyFeatureDto> SetWeeklyFeatureAsync(CurrentUser user, SetWeeklyFeatureRequest request, CancellationToken ct = default)
    {
        WeeklyRules.EnsureAdmin(user.Role);

        if (!WeeklyFeatureTypes.IsValid(request.Type))
        {
            throw ApiException.BadRequest("Invalid weekly feature type.");
        }
        if (request.WeekEnd <= request.WeekStart)
        {
            throw ApiException.BadRequest("weekEnd must be after weekStart.");
        }

        var gameCase = await _db.Cases.Find(c => c.CaseId == request.CaseId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Case not found.");

        // Flip any existing active feature of the same type off, then activate the new one.
        await _db.WeeklyFeatures.UpdateManyAsync(
            Builders<WeeklyFeature>.Filter.And(
                Builders<WeeklyFeature>.Filter.Eq(w => w.Type, request.Type),
                Builders<WeeklyFeature>.Filter.Eq(w => w.IsActive, true)),
            Builders<WeeklyFeature>.Update.Set(w => w.IsActive, false),
            cancellationToken: ct);

        var feature = new WeeklyFeature
        {
            Type = request.Type,
            CaseId = request.CaseId,
            WeekStart = request.WeekStart,
            WeekEnd = request.WeekEnd,
            IsActive = true,
            CreatedBy = user.Id,
            CreatedAt = DateTime.UtcNow
        };
        await _db.WeeklyFeatures.InsertOneAsync(feature, cancellationToken: ct);

        return ToDto(feature, gameCase);
    }

    public async Task<bool> ClearWeeklyFeatureAsync(CurrentUser user, string type, CancellationToken ct = default)
    {
        WeeklyRules.EnsureAdmin(user.Role);
        if (!WeeklyFeatureTypes.IsValid(type))
        {
            throw ApiException.BadRequest("Invalid weekly feature type.");
        }

        var result = await _db.WeeklyFeatures.UpdateManyAsync(
            Builders<WeeklyFeature>.Filter.And(
                Builders<WeeklyFeature>.Filter.Eq(w => w.Type, type),
                Builders<WeeklyFeature>.Filter.Eq(w => w.IsActive, true)),
            Builders<WeeklyFeature>.Update.Set(w => w.IsActive, false),
            cancellationToken: ct);

        return result.ModifiedCount > 0;
    }

    private async Task<WeeklyFeatureDto?> GetActiveAsync(string type, CancellationToken ct)
    {
        var feature = await GetActiveFeatureAsync(type, ct);
        if (feature is null)
        {
            return null;
        }
        var gameCase = await _db.Cases.Find(c => c.CaseId == feature.CaseId).FirstOrDefaultAsync(ct);
        return ToDto(feature, gameCase);
    }

    private async Task<WeeklyFeature?> GetActiveFeatureAsync(string type, CancellationToken ct)
    {
        var active = await _db.WeeklyFeatures
            .Find(Builders<WeeklyFeature>.Filter.And(
                Builders<WeeklyFeature>.Filter.Eq(w => w.Type, type),
                Builders<WeeklyFeature>.Filter.Eq(w => w.IsActive, true)))
            .ToListAsync(ct);
        return WeeklyRules.PickActive(active, type, DateTime.UtcNow);
    }

    private static WeeklyFeatureDto ToDto(WeeklyFeature feature, GameCase? gameCase) => new()
    {
        Type = feature.Type,
        CaseId = feature.CaseId,
        CaseTitle = gameCase?.Title ?? string.Empty,
        Summary = gameCase?.Summary ?? string.Empty,
        CoverImageUrl = gameCase?.CoverImageUrl ?? string.Empty,
        EstimatedMinutes = gameCase?.EstimatedMinutes ?? 0,
        WeekStart = feature.WeekStart,
        WeekEnd = feature.WeekEnd
    };
}
