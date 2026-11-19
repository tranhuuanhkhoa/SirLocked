using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Profile;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services.Vip;

/// <summary>Adds the "Tác giả" badge (name and tier) to case cards, the case page and the detective profile.</summary>
public sealed class AuthorBadgeReader(MongoDbContext db)
{
    private IMongoCollection<AuthorStats> Stats => db.Database.GetCollection<AuthorStats>("authorStats");

    public async Task<List<T>> FillAsync<T>(List<T> cases, CancellationToken ct = default) where T : CaseSummaryResponse
    {
        var ids = cases.Select(item => item.AuthorUserId).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct().ToList();
        if (ids.Count == 0) return cases;
        var stats = (await Stats.Find(Builders<AuthorStats>.Filter.In(item => item.Id, ids)).ToListAsync(ct))
            .ToDictionary(item => item.Id, StringComparer.Ordinal);
        var names = (await db.Users.Find(Builders<User>.Filter.In(item => item.Id, ids))
                .Project(item => new { item.Id, item.FullName }).ToListAsync(ct))
            .ToDictionary(item => item.Id, item => item.FullName, StringComparer.Ordinal);
        foreach (var item in cases.Where(item => !string.IsNullOrWhiteSpace(item.AuthorUserId)))
        {
            item.AuthorName = names.GetValueOrDefault(item.AuthorUserId) ?? string.Empty;
            // A published case makes its author an author even before the hourly refresh.
            item.AuthorTier = stats.TryGetValue(item.AuthorUserId, out var stat) && stat.Tier.Length > 0
                ? stat.Tier
                : item.Status == CaseStatus.Published ? AuthorTiers.Author : string.Empty;
        }
        return cases;
    }

    public async Task<DetectiveProfileDto> FillAsync(DetectiveProfileDto profile, CancellationToken ct = default)
    {
        var stat = await Stats.Find(item => item.Id == profile.UserId).FirstOrDefaultAsync(ct);
        var published = (int)await db.Cases.CountDocumentsAsync(item => item.AuthorUserId == profile.UserId && item.Status == CaseStatus.Published,
            cancellationToken: ct);
        if (stat is null && published == 0) return profile;
        var plays = published == 0 ? 0 : (int)await db.GameResults.CountDocumentsAsync(
            Builders<GameResult>.Filter.In(item => item.CaseId,
                await db.Cases.Find(item => item.AuthorUserId == profile.UserId && item.Status == CaseStatus.Published)
                    .Project(item => item.CaseId).ToListAsync(ct)),
            cancellationToken: ct);
        profile.CreatorStats ??= new CreatorStatsDto();
        profile.CreatorStats.CasesCreated = published;
        profile.CreatorStats.TotalPlays = plays;
        profile.CreatorStats.AuthorTier = stat?.Tier is { Length: > 0 } tier ? tier : published > 0 ? AuthorTiers.Author : string.Empty;
        profile.CreatorStats.BestCompletions = stat?.BestCompletions ?? 0;
        profile.CreatorStats.BestRatingPercent = stat?.BestRatingPercent ?? 0;
        return profile;
    }
}
