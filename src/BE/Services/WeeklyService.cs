using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.DTOs.Weekly;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Weekly;

namespace SirLocked.Api.Services;

/// <summary>
/// Weekly features. The Case of the Week is admin-curated. The Weekly Challenge has one document per challenge
/// week (unique on type + week key): an admin may choose or stop a week, and a week nobody chose gets a good case
/// picked on its own the first time anything asks for it (a request, or <see cref="WeeklyChallengeWorker"/>).
/// The challenge leaderboard delegates to <see cref="ILeaderboardService"/> (Phase 3) with the week as the time
/// filter, so no leaderboard logic is duplicated here.
/// </summary>
public class WeeklyService : IWeeklyService
{
    /// <summary>A challenge weekStart older than this is a missing value, not a week anyone means.</summary>
    private const int EarliestChallengeYear = 2000;

    private readonly MongoDbContext _db;
    private readonly ILeaderboardService _leaderboard;
    private readonly CaseCatalogPolicy _catalog;
    private readonly WeeklyChallengeSettings _settings;
    private readonly ICatalogProvider _chests;
    private readonly IChestRandom _random;
    private readonly TimeProvider _time;
    private readonly ILogger<WeeklyService> _logger;

    public WeeklyService(
        MongoDbContext db,
        ILeaderboardService leaderboard,
        CaseCatalogPolicy? catalog = null,
        IOptions<WeeklyChallengeSettings>? settings = null,
        ICatalogProvider? chests = null,
        IChestRandom? random = null,
        TimeProvider? time = null,
        ILogger<WeeklyService>? logger = null)
    {
        _db = db;
        _leaderboard = leaderboard;
        _catalog = catalog ?? CaseCatalogPolicy.Open;
        _settings = settings?.Value ?? new WeeklyChallengeSettings();
        _chests = chests ?? FixedCatalogProvider.Default;
        _random = random ?? new CryptoChestRandom();
        _time = time ?? TimeProvider.System;
        _logger = logger ?? NullLogger<WeeklyService>.Instance;
    }

    private DateTime UtcNow => _time.GetUtcNow().UtcDateTime;

    private static FilterDefinitionBuilder<WeeklyFeature> Filter => Builders<WeeklyFeature>.Filter;

    /// <summary>The one document of a challenge week.</summary>
    private static FilterDefinition<WeeklyFeature> WeekFilter(ChallengeWeek week) =>
        Filter.Eq(w => w.Type, WeeklyFeatureTypes.WeeklyChallenge) & Filter.Eq(w => w.WeekKey, week.Key);

    /// <summary>Challenge documents written before weeks had keys: any window, no week key.</summary>
    private static FilterDefinition<WeeklyFeature> LegacyChallengeFilter =>
        Filter.Eq(w => w.Type, WeeklyFeatureTypes.WeeklyChallenge) & Filter.Not(Filter.Type(w => w.WeekKey, BsonType.String));

    // ------------------------------------------------------------------ players

    public async Task<WeeklyFeatureDto?> GetActiveCaseOfWeekAsync(CancellationToken ct = default)
    {
        var active = await _db.WeeklyFeatures
            .Find(Filter.Eq(w => w.Type, WeeklyFeatureTypes.CaseOfWeek) & Filter.Eq(w => w.IsActive, true))
            .ToListAsync(ct);
        var feature = WeeklyRules.PickActive(active, WeeklyFeatureTypes.CaseOfWeek, UtcNow);
        if (feature is null)
        {
            return null;
        }
        var gameCase = await FindCaseAsync(feature.CaseId, ct);
        // A feature that points at a case players can no longer play is treated as not set.
        if (_catalog.PixelOnly && gameCase is not null && !_catalog.IsPlayable(gameCase)) return null;
        return ToDto(feature, gameCase);
    }

    public async Task<WeeklyFeatureDto?> GetActiveChallengeAsync(CancellationToken ct = default)
    {
        var week = ChallengeWeek.Containing(UtcNow);
        var feature = await EnsureChallengeAsync(week, ct);
        if (feature is null)
        {
            return null;
        }
        var gameCase = await FindCaseAsync(feature.CaseId, ct);
        // A challenge whose case players can no longer play (unpublished or gone mid-week) is treated as not set.
        if (gameCase is null || !_catalog.IsPlayable(gameCase)) return null;
        return ToChallengeDto(feature, gameCase, week);
    }

    public async Task<LeaderboardDto> GetChallengeLeaderboardAsync(int limit = 100, CancellationToken ct = default)
    {
        var week = ChallengeWeek.Containing(UtcNow);
        var challenge = await EnsureChallengeAsync(week, ct);
        if (challenge is null)
        {
            return new LeaderboardDto { Metric = LeaderboardMetrics.Fastest, TotalRanked = 0 };
        }

        // Reuse Phase 3, restricted to plays inside the challenge week [start, end).
        return await _leaderboard.GetCaseLeaderboardAsync(
            challenge.CaseId, LeaderboardMetrics.Fastest, limit,
            after: week.StartUtc, before: week.EndUtc, ct: ct);
    }

    // ------------------------------------------------------------------ the week's challenge

    public async Task<WeeklyFeature?> FindChallengeAsync(ChallengeWeek week, CancellationToken ct = default)
    {
        var stored = await FindWeekAsync(RequireKey(week), ct);
        return stored is { IsActive: true } ? stored : null;
    }

    public async Task<WeeklyFeature?> EnsureChallengeAsync(ChallengeWeek week, CancellationToken ct = default)
    {
        // 1. The week already has its document: an admin's choice, an earlier pick, or a stop. Never overwritten here.
        var stored = await FindWeekAsync(RequireKey(week), ct);
        if (stored is not null)
        {
            return stored.IsActive ? stored : null;
        }

        // 2. A challenge the admin set before weeks had keys, still running now, carries on as this week's choice.
        var now = UtcNow;
        var legacy = week.Contains(now) ? await FindLegacyAsync(now, ct) : null;
        if (legacy is null && !_settings.AutoPick)
        {
            return null;
        }

        var playable = await LoadPlayableAsync(ct);
        WeeklyFeature feature;
        int? step = null;
        if (legacy is not null && playable.Any(c => c.CaseId == legacy.CaseId))
        {
            feature = NewWeek(week, legacy.CaseId, WeeklyFeatureSources.Admin, legacy.CreatedBy, now);
        }
        else
        {
            if (legacy is not null)
            {
                _logger.LogWarning(
                    "Weekly challenge {WeekKey}: the admin's earlier case {CaseId} can no longer be played, so it is not carried on.",
                    week.Key, legacy.CaseId);
            }
            if (!_settings.AutoPick)
            {
                return null;
            }

            // 3. Pick a good case on its own.
            var pick = await PickAsync(week, playable, ct);
            if (pick is null)
            {
                _logger.LogWarning(
                    "Weekly challenge {WeekKey}: no playable case to pick, so the week has no challenge for now.", week.Key);
                return null;
            }
            feature = NewWeek(week, pick.Value.Case.CaseId, WeeklyFeatureSources.Auto, string.Empty, now);
            step = pick.Value.Pool.Step;
            _logger.LogDebug(
                "Weekly challenge {WeekKey}: {Eligible} of {Playable} playable case(s) qualified at step {Step}.",
                week.Key, pick.Value.Pool.Cases.Count, playable.Count, step);
        }

        // 4. Store it. When another request stored the week first, theirs stands and is returned instead.
        try
        {
            await _db.WeeklyFeatures.InsertOneAsync(feature, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            var winner = await FindWeekAsync(week, ct);
            return winner is { IsActive: true } ? winner : null;
        }

        // 5. Say what happened, with the loosening step so a week that had to lower the bar is visible.
        if (step is null)
        {
            _logger.LogInformation(
                "Weekly challenge {WeekKey}: carried on {CaseId}, which an admin set before weeks had keys.", week.Key, feature.CaseId);
        }
        else
        {
            _logger.LogInformation(
                "Weekly challenge {WeekKey}: picked {CaseId} at loosening step {Step}.", week.Key, feature.CaseId, step);
        }
        return feature;
    }

    // ------------------------------------------------------------------ admin

    public async Task<WeeklyFeatureDto> SetWeeklyFeatureAsync(CurrentUser user, SetWeeklyFeatureRequest request, CancellationToken ct = default)
    {
        WeeklyRules.EnsureAdmin(user.Role);

        if (!WeeklyFeatureTypes.IsValid(request.Type))
        {
            throw ApiException.BadRequest("Invalid weekly feature type.");
        }
        var challenge = request.Type == WeeklyFeatureTypes.WeeklyChallenge;
        ChallengeWeek week = default;
        if (challenge)
        {
            // The challenge always runs a whole week: weekStart only says which week, and weekEnd is not read.
            if (request.WeekStart.Year < EarliestChallengeYear)
            {
                throw ApiException.BadRequest("weekStart is required.");
            }
            // Only the running week or the next one (spec 7.2): an ended week's chests are already decided, and a
            // week further out would be chosen before anyone knows which cases are good then. A moment at or after
            // the end of next week is refused before it becomes a week, so even the last day a DateTime holds is a 400.
            var now = UtcNow;
            var nextWeek = ChallengeWeek.Containing(now).Previous(-1);
            if (request.WeekStart.ToUniversalTime() >= nextWeek.EndUtc)
            {
                throw ApiException.BadRequest("Chỉ chọn được tuần đang chạy hoặc tuần sau.");
            }
            week = ChallengeWeek.Containing(request.WeekStart);
            if (week.EndUtc <= now)
            {
                throw ApiException.BadRequest("Tuần này đã kết thúc; chỉ chọn được tuần đang chạy hoặc tuần sau.");
            }
        }
        else if (request.WeekEnd <= request.WeekStart)
        {
            throw ApiException.BadRequest("weekEnd must be after weekStart.");
        }

        var gameCase = await _db.Cases.Find(c => c.CaseId == request.CaseId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Case not found.");
        if (_catalog.PixelOnly && !CaseCatalogRules.IsPixel(gameCase))
        {
            throw ApiException.BadRequest("Only pixel cases can be featured.");
        }

        if (challenge)
        {
            return await SetChallengeAsync(user, gameCase, week, ct);
        }

        // Case of the week: flip any existing active feature of the same type off, then activate the new one.
        await _db.WeeklyFeatures.UpdateManyAsync(
            Filter.And(
                Filter.Eq(w => w.Type, request.Type),
                Filter.Eq(w => w.IsActive, true)),
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
            CreatedAt = UtcNow
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

        if (type != WeeklyFeatureTypes.WeeklyChallenge)
        {
            var result = await _db.WeeklyFeatures.UpdateManyAsync(
                Filter.And(
                    Filter.Eq(w => w.Type, type),
                    Filter.Eq(w => w.IsActive, true)),
                Builders<WeeklyFeature>.Update.Set(w => w.IsActive, false),
                cancellationToken: ct);

            return result.ModifiedCount > 0;
        }

        // Stop this week: its document stays, switched off (case kept if it had one), so nothing picks again until
        // the next week starts. A week with no document yet gets an empty, switched-off one.
        var now = UtcNow;
        var week = ChallengeWeek.Containing(now);
        var stopped = await UpsertWeekAsync(week, Builders<WeeklyFeature>.Update
            .Set(w => w.IsActive, false)
            .SetOnInsert(w => w.CaseId, string.Empty)
            .SetOnInsert(w => w.Source, WeeklyFeatureSources.Admin)
            .SetOnInsert(w => w.WeekStart, week.StartUtc)
            .SetOnInsert(w => w.WeekEnd, week.EndUtc)
            .SetOnInsert(w => w.CreatedBy, user.Id)
            .SetOnInsert(w => w.CreatedAt, now), ct);

        // Documents from before weeks had keys are switched off as before.
        var legacy = await _db.WeeklyFeatures.UpdateManyAsync(
            LegacyChallengeFilter & Filter.Eq(w => w.IsActive, true),
            Builders<WeeklyFeature>.Update.Set(w => w.IsActive, false),
            cancellationToken: ct);

        _logger.LogInformation("Weekly challenge {WeekKey}: stopped by admin {AdminId}.", week.Key, user.Id);
        return stopped.ModifiedCount > 0 || stopped.UpsertedId is not null || legacy.ModifiedCount > 0;
    }

    /// <summary>The admin's case for the week, replacing whatever the week held (a pick or a stop).</summary>
    private async Task<WeeklyFeatureDto> SetChallengeAsync(CurrentUser user, GameCase gameCase, ChallengeWeek week, CancellationToken ct)
    {
        await UpsertWeekAsync(week, Builders<WeeklyFeature>.Update
            .Set(w => w.CaseId, gameCase.CaseId)
            .Set(w => w.IsActive, true)
            .Set(w => w.Source, WeeklyFeatureSources.Admin)
            .Set(w => w.WeekStart, week.StartUtc)
            .Set(w => w.WeekEnd, week.EndUtc)
            .Set(w => w.CreatedBy, user.Id)
            .SetOnInsert(w => w.CreatedAt, UtcNow), ct);

        var feature = await FindWeekAsync(week, ct)
            ?? throw new InvalidOperationException($"The weekly challenge of {week.Key} was written but cannot be read back.");
        _logger.LogInformation("Weekly challenge {WeekKey}: admin {AdminId} chose {CaseId}.", week.Key, user.Id, feature.CaseId);
        return ToChallengeDto(feature, gameCase, week);
    }

    /// <summary>
    /// Updates the week's document, creating it when missing. Two upserts racing on a missing week can both try to
    /// insert; the loser gets a duplicate key and runs again, now matching the document the winner made.
    /// </summary>
    private async Task<UpdateResult> UpsertWeekAsync(ChallengeWeek week, UpdateDefinition<WeeklyFeature> update, CancellationToken ct)
    {
        var options = new UpdateOptions { IsUpsert = true };
        try
        {
            return await _db.WeeklyFeatures.UpdateOneAsync(WeekFilter(week), update, options, ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            return await _db.WeeklyFeatures.UpdateOneAsync(WeekFilter(week), update, options, ct);
        }
    }

    // ------------------------------------------------------------------ picking

    /// <summary>Cases players can open now, without the tutorial. The policy decides (published, and pixel when that is on).</summary>
    private async Task<List<GameCase>> LoadPlayableAsync(CancellationToken ct)
    {
        var published = await _db.Cases.Find(c => c.Status == CaseStatus.Published).ToListAsync(ct);
        return published
            .Where(c => _catalog.IsPlayable(c) && !TutorialRules.IsTutorialCase(c.CaseId))
            .ToList();
    }

    private async Task<(ChallengeCandidate Case, ChallengePool Pool)?> PickAsync(
        ChallengeWeek week, IReadOnlyList<GameCase> playable, CancellationToken ct)
    {
        if (playable.Count == 0)
        {
            return null;
        }

        var ratings = await CountedRatingsAsync(playable, ct);
        var candidates = playable
            .Select(c => ratings.TryGetValue(c.CaseId, out var rating)
                ? new ChallengeCandidate(c.CaseId, (double)rating.Sum / rating.Count, rating.Count)
                : new ChallengeCandidate(c.CaseId, 0, 0))
            .ToList();
        var (recent, lastWeek) = await RecentCasesAsync(week, ct);
        var pool = ChallengePickRules.Eligible(candidates, recent, lastWeek, _settings);
        var picked = ChallengePickRules.Pick(pool, _random);
        return picked is null ? null : (picked, pool);
    }

    /// <summary>
    /// The sum and count of the stars that count, per case. A review counts when it is not hidden, was not written
    /// by the case's own author, and its account is verified and active (a guest id never matches an account).
    /// </summary>
    private async Task<Dictionary<string, (long Sum, int Count)>> CountedRatingsAsync(IReadOnlyList<GameCase> cases, CancellationToken ct)
    {
        var match = new BsonDocument
        {
            { "caseId", new BsonDocument("$in", new BsonArray(cases.Select(c => c.CaseId))) },
            { "hidden", new BsonDocument("$ne", true) },
        };
        var ownReviews = cases
            .Where(c => !string.IsNullOrEmpty(c.AuthorUserId))
            .Select(c => new BsonDocument { { "caseId", c.CaseId }, { "userId", c.AuthorUserId } })
            .ToList();
        if (ownReviews.Count > 0)
        {
            match.Add("$nor", new BsonArray(ownReviews));
        }

        var accountId = new BsonDocument("$convert", new BsonDocument
        {
            { "input", "$userId" }, { "to", "objectId" }, { "onError", BsonNull.Value }, { "onNull", BsonNull.Value },
        });
        var pipeline = new List<BsonDocument>
        {
            new("$match", match),
            new("$lookup", new BsonDocument
            {
                { "from", _db.Settings.UsersCollectionName },
                { "let", new BsonDocument("accountId", accountId) },
                {
                    "pipeline", new BsonArray
                    {
                        new BsonDocument("$match", new BsonDocument("$expr", new BsonDocument("$eq", new BsonArray { "$_id", "$$accountId" }))),
                        new BsonDocument("$match", new BsonDocument { { "isEmailVerified", true }, { "status", UserStatus.Active } }),
                        new BsonDocument("$project", new BsonDocument("_id", 1)),
                    }
                },
                { "as", "account" },
            }),
            new("$match", new BsonDocument("account.0", new BsonDocument("$exists", true))),
            new("$group", new BsonDocument
            {
                { "_id", "$caseId" },
                { "sum", new BsonDocument("$sum", "$rating") },
                { "count", new BsonDocument("$sum", 1) },
            }),
        };

        var rows = await _db.Reviews.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);
        return rows.ToDictionary(
            row => row["_id"].AsString,
            row => (row["sum"].ToInt64(), row["count"].ToInt32()),
            StringComparer.Ordinal);
    }

    /// <summary>
    /// The cases of the weeks before <paramref name="week"/> that must not run again first (at least last week), and
    /// last week's case, which only the loosest step may repeat. A week an admin stopped still counts with its case.
    /// A document from before weeks had keys counts for every week its window touches.
    /// </summary>
    private async Task<(List<string> Recent, string? LastWeek)> RecentCasesAsync(ChallengeWeek week, CancellationToken ct)
    {
        var weeks = Enumerable.Range(1, Math.Max(1, _settings.NoRepeatWeeks)).Select(weeksAgo => week.Previous(weeksAgo)).ToList();
        var keys = weeks.Select(w => w.Key).ToList();
        var documents = await _db.WeeklyFeatures.Find(
                (Filter.Eq(w => w.Type, WeeklyFeatureTypes.WeeklyChallenge) & Filter.In(w => w.WeekKey, keys))
                | (LegacyChallengeFilter & Filter.Lt(w => w.WeekStart, week.StartUtc) & Filter.Gt(w => w.WeekEnd, weeks[^1].StartUtc)))
            .ToListAsync(ct);

        var lastWeek = weeks[0];
        var lastWeekDocument = documents.FirstOrDefault(d => d.WeekKey == lastWeek.Key)
            ?? documents
                .Where(d => d.WeekKey is null && d.WeekStart < lastWeek.EndUtc && d.WeekEnd > lastWeek.StartUtc && d.CaseId.Length > 0)
                .MaxBy(d => d.CreatedAt);
        var lastWeekCase = lastWeekDocument?.CaseId;
        var recent = documents
            .Select(d => d.CaseId)
            .Where(caseId => caseId.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return (recent, string.IsNullOrEmpty(lastWeekCase) ? null : lastWeekCase);
    }

    // ------------------------------------------------------------------ reads

    private static ChallengeWeek RequireKey(ChallengeWeek week) =>
        week.Key is null
            ? throw new ArgumentException("Build the week with ChallengeWeek.Containing or FromKey.", nameof(week))
            : week;

    private async Task<WeeklyFeature?> FindWeekAsync(ChallengeWeek week, CancellationToken ct) =>
        await _db.WeeklyFeatures.Find(WeekFilter(week)).SortBy(w => w.Id).FirstOrDefaultAsync(ct);

    /// <summary>The newest active challenge from before weeks had keys whose window holds <paramref name="now"/>.</summary>
    private async Task<WeeklyFeature?> FindLegacyAsync(DateTime now, CancellationToken ct)
    {
        var active = await _db.WeeklyFeatures
            .Find(LegacyChallengeFilter & Filter.Eq(w => w.IsActive, true))
            .ToListAsync(ct);
        return WeeklyRules.PickActive(active, WeeklyFeatureTypes.WeeklyChallenge, now);
    }

    private async Task<GameCase?> FindCaseAsync(string caseId, CancellationToken ct) =>
        await _db.Cases.Find(c => c.CaseId == caseId).FirstOrDefaultAsync(ct);

    private static WeeklyFeature NewWeek(ChallengeWeek week, string caseId, string source, string createdBy, DateTime now) => new()
    {
        Id = ObjectId.GenerateNewId().ToString(),
        Type = WeeklyFeatureTypes.WeeklyChallenge,
        WeekKey = week.Key,
        Source = source,
        CaseId = caseId,
        WeekStart = week.StartUtc,
        WeekEnd = week.EndUtc,
        IsActive = true,
        CreatedBy = createdBy,
        CreatedAt = now,
    };

    // ------------------------------------------------------------------ DTOs

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

    /// <summary>The challenge as players read it: the whole week as its window, the score it needs and the chests it drops.</summary>
    private WeeklyFeatureDto ToChallengeDto(WeeklyFeature feature, GameCase? gameCase, ChallengeWeek week)
    {
        var dto = ToDto(feature, gameCase);
        dto.WeekStart = week.StartUtc;
        dto.WeekEnd = week.EndUtc;
        dto.WeekKey = week.Key;
        dto.Source = feature.Source;
        dto.MinScore = _settings.MinScore;
        dto.Drops = WeeklyDropRules.Odds(_chests.Current.Chests)
            .Select(odds => new WeeklyDropOddsDto(
                odds.Chest.Id,
                odds.Chest.Name,
                odds.Chest.NameEn,
                odds.Chest.IconKey,
                odds.Chest.Look is { } look ? ChestLookDto.Of(look) : null,
                odds.Percent))
            .ToList();
        return dto;
    }
}
