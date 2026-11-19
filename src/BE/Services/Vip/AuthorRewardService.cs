using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Vip;

/// <summary>
/// Authors of VIP cases (VUAN-7 part H). Rewards come only from what the case earns:
/// <list type="bullet">
/// <item>30% (setting) of the hint coins and rewarded-ad revenue of the author's case, as bonus coins;</item>
/// <item>a one-time bonus for the silver and gold tiers;</item>
/// <item>held 7 days before paying, capped per calendar month, revocable by an admin;</item>
/// <item>anti-fraud: the author's own plays, accounts younger than 7 days, accounts that played no other case, games
/// shorter than half the case's estimated time and accounts sharing a network fingerprint with a counted one do not
/// count; hidden reviews do not count toward the rating. Coins never turn into money.</item>
/// </list>
/// </summary>
public sealed class AuthorRewardService(
    MongoDbContext db,
    CoinWalletService wallet,
    VipSettingsStore settings,
    ILogger<AuthorRewardService> logger,
    TimeProvider? time = null)
{
    /// <summary>A revenue event of a game still running is judged once the game ends, or ineligible after this long.</summary>
    public static readonly TimeSpan UnfinishedGameGrace = TimeSpan.FromDays(2);
    public const int MaxCompletionsScanned = 5_000;

    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private DateTime Now => _time.GetUtcNow().UtcDateTime;

    public IMongoCollection<AuthorPayout> Payouts => db.Database.GetCollection<AuthorPayout>("authorPayouts");
    public IMongoCollection<AuthorStats> Stats => db.Database.GetCollection<AuthorStats>("authorStats");
    public IMongoCollection<UserNetworkKeys> NetworkKeys => db.Database.GetCollection<UserNetworkKeys>("userNetworkKeys");
    public IMongoCollection<CaseRevenueEvent> Revenue => db.Database.GetCollection<CaseRevenueEvent>("caseRevenue");
    private IMongoCollection<CountedPayers> Counted => db.Database.GetCollection<CountedPayers>("authorCountedPayers");

    public async Task EnsureIndexesAsync(CancellationToken ct = default) =>
        await Payouts.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<AuthorPayout>(Builders<AuthorPayout>.IndexKeys.Ascending(item => item.State).Ascending(item => item.AvailableAt),
                new CreateIndexOptions { Name = "ix_authorPayouts_state_availableAt" }),
            new CreateIndexModel<AuthorPayout>(Builders<AuthorPayout>.IndexKeys.Ascending(item => item.AuthorUserId).Ascending(item => item.MonthKey),
                new CreateIndexOptions { Name = "ix_authorPayouts_author_month" })
        }, ct);

    public static string MonthKey(DateTime utc)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "SE Asia Standard Time" : "Asia/Ho_Chi_Minh");
        return TimeZoneInfo.ConvertTimeFromUtc(utc, zone).ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);
    }

    // ------------------------------------------------------------------ network fingerprints

    public async Task RecordNetworkKeyAsync(string userId, string key, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(key)) return;
        var current = await NetworkKeys.Find(item => item.Id == userId).FirstOrDefaultAsync(ct);
        if (current?.Keys.Contains(key) == true) return;
        await NetworkKeys.UpdateOneAsync(item => item.Id == userId,
            Builders<UserNetworkKeys>.Update
                .PushEach(item => item.Keys, new[] { key }, slice: -10)
                .Set(item => item.UpdatedAt, Now),
            new UpdateOptions { IsUpsert = true }, ct);
    }

    // ------------------------------------------------------------------ revenue share

    private enum Decision { Eligible, Ineligible, Wait }

    [MongoDB.Bson.Serialization.Attributes.BsonIgnoreExtraElements]
    private sealed class CountedPayers
    {
        [MongoDB.Bson.Serialization.Attributes.BsonId] public string Id { get; set; } = string.Empty;
        public List<string> Users { get; set; } = new();
        public List<string> Keys { get; set; } = new();
    }

    /// <summary>
    /// Turns the case revenue events no share has looked at into author payouts (one per case per pass), held for the
    /// hold period. Events of a game still running wait; ineligible events are marked with the reason.
    /// </summary>
    public async Task<int> ShareAsync(int limit = 500, CancellationToken ct = default)
    {
        var rules = await settings.GetAuthorsAsync(ct);
        var pricing = await settings.GetPricingAsync(ct);
        var events = await Revenue.Find(item => item.ShareBatchId == null).SortBy(item => item.At).Limit(limit).ToListAsync(ct);
        var payouts = 0;
        foreach (var group in events.GroupBy(item => item.CaseId))
        {
            var gameCase = await db.Cases.Find(item => item.CaseId == group.Key).FirstOrDefaultAsync(ct);
            var author = gameCase?.AuthorUserId ?? string.Empty;
            var batchId = $"share:{group.Key}:{MongoDB.Bson.ObjectId.GenerateNewId()}";
            var counted = await Counted.Find(item => item.Id == group.Key).FirstOrDefaultAsync(ct) ?? new CountedPayers { Id = group.Key };
            long eligibleXu = 0, eligibleVnd = 0;
            var decided = new List<(CaseRevenueEvent Event, bool Eligible, string Reason)>();
            foreach (var item in group)
            {
                var (decision, reason) = string.IsNullOrWhiteSpace(author)
                    ? (Decision.Ineligible, "NO_AUTHOR")
                    : await DecideAsync(item, author, gameCase!.EstimatedMinutes, rules, counted, ct);
                if (decision == Decision.Wait) continue;
                decided.Add((item, decision == Decision.Eligible, reason));
                if (decision != Decision.Eligible) continue;
                eligibleXu += item.Xu;
                eligibleVnd += item.Vnd;
            }
            if (decided.Count == 0) continue;

            string? payoutId = null;
            var shareXu = (long)Math.Floor((eligibleXu + eligibleVnd / (decimal)Math.Max(1, pricing.VndPerXu)) * rules.RevenueSharePercent / 100m);
            if (shareXu > 0)
            {
                var payout = await CreatePayoutAsync(new AuthorPayout
                {
                    Id = batchId,
                    AuthorUserId = author,
                    CaseId = group.Key,
                    Kind = AuthorPayoutKinds.Share,
                    SourceXu = eligibleXu,
                    SourceVnd = eligibleVnd,
                    EligibleEvents = decided.Count(item => item.Eligible),
                    IneligibleEvents = decided.Count(item => !item.Eligible)
                }, shareXu, rules, ct);
                payoutId = payout.Id;
                payouts++;
            }
            await Counted.ReplaceOneAsync(item => item.Id == counted.Id, counted, new ReplaceOptions { IsUpsert = true }, ct);
            foreach (var (item, eligible, reason) in decided)
                await Revenue.UpdateOneAsync(entry => entry.Id == item.Id && entry.ShareBatchId == null,
                    Builders<CaseRevenueEvent>.Update
                        .Set(entry => entry.ShareBatchId, batchId)
                        .Set(entry => entry.ShareEligible, eligible)
                        .Set(entry => entry.ShareReason, reason)
                        .Set(entry => entry.PayoutId, eligible ? payoutId : null),
                    cancellationToken: ct);
        }
        return payouts;
    }

    private async Task<(Decision, string)> DecideAsync(
        CaseRevenueEvent item, string author, int estimatedMinutes, AuthorRewardSettings rules, CountedPayers counted, CancellationToken ct)
    {
        if (item.UserId == author) return (Decision.Ineligible, "OWN_CASE");
        var room = await db.Rooms.Find(entry => entry.Id == item.RoomId).FirstOrDefaultAsync(ct);
        var startedAt = room?.GameplayState?.StartedAt;
        var completedAt = room?.GameplayState?.CompletedAt;
        if (completedAt is null)
            return Now - item.At < UnfinishedGameGrace ? (Decision.Wait, string.Empty) : (Decision.Ineligible, "GAME_UNFINISHED");
        var facts = await PlayerFactsAsync(item.UserId, item.CaseId, ct);
        var verdict = Judge(facts, author, startedAt, completedAt, estimatedMinutes, rules, counted, item.At);
        return (verdict.Length == 0 ? Decision.Eligible : Decision.Ineligible, verdict);
    }

    private sealed record PlayerFacts(string UserId, DateTime? CreatedAt, int OtherCasesPlayed, List<string> Keys);

    private async Task<PlayerFacts> PlayerFactsAsync(string userId, string caseId, CancellationToken ct)
    {
        var user = await db.Users.Find(item => item.Id == userId).Project(item => (DateTime?)item.CreatedAt).FirstOrDefaultAsync(ct);
        var otherCases = await db.GameResults.Distinct(item => item.CaseId,
            Builders<GameResult>.Filter.AnyEq(item => item.Players, userId) & Builders<GameResult>.Filter.Ne(item => item.CaseId, caseId),
            cancellationToken: ct).ToListAsync(ct);
        var keys = await NetworkKeys.Find(item => item.Id == userId).Project(item => item.Keys).FirstOrDefaultAsync(ct) ?? [];
        return new PlayerFacts(userId, user, otherCases.Count, keys);
    }

    /// <summary>Empty when the player counts; otherwise the reason. Counts the player (and their fingerprints) when they do.</summary>
    private static string Judge(
        PlayerFacts facts, string author, DateTime? startedAt, DateTime? completedAt, int estimatedMinutes,
        AuthorRewardSettings rules, CountedPayers counted, DateTime at)
    {
        if (facts.UserId == author) return "OWN_CASE";
        if (facts.CreatedAt is null || at - facts.CreatedAt.Value < TimeSpan.FromDays(rules.MinAccountAgeDays)) return "ACCOUNT_TOO_NEW";
        if (facts.OtherCasesPlayed < rules.MinOtherCasesPlayed) return "NO_OTHER_CASE";
        if (estimatedMinutes > 0 && startedAt is not null && completedAt is not null
            && (completedAt.Value - startedAt.Value).TotalMinutes < estimatedMinutes * (double)rules.MinPlayTimeRatio)
            return "GAME_TOO_SHORT";
        if (!counted.Users.Contains(facts.UserId))
        {
            if (facts.Keys.Any(counted.Keys.Contains)) return "SHARED_DEVICE_OR_IP";
            counted.Users.Add(facts.UserId);
            counted.Keys.AddRange(facts.Keys.Where(key => !counted.Keys.Contains(key)));
        }
        return string.Empty;
    }

    /// <summary>Applies the monthly cap and stores the payout (held for the hold period). Idempotent by id.</summary>
    private async Task<AuthorPayout> CreatePayoutAsync(AuthorPayout payout, long xu, AuthorRewardSettings rules, CancellationToken ct)
    {
        var now = Now;
        payout.MonthKey = MonthKey(now);
        var monthTotal = (await Payouts.Find(item => item.AuthorUserId == payout.AuthorUserId && item.MonthKey == payout.MonthKey
                                                    && item.State != AuthorPayoutStates.Revoked)
                .Project(item => item.Xu).ToListAsync(ct)).Sum();
        var allowed = Math.Max(0, rules.MonthlyCapXu - monthTotal);
        payout.Xu = Math.Min(xu, allowed);
        payout.ClippedXu = xu - payout.Xu;
        payout.CreatedAt = now;
        payout.AvailableAt = now + TimeSpan.FromDays(rules.HoldDays);
        payout.State = payout.Xu > 0 ? AuthorPayoutStates.Held : AuthorPayoutStates.Paid;
        try
        {
            await Payouts.InsertOneAsync(payout, cancellationToken: ct);
            return payout;
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            return await Payouts.Find(item => item.Id == payout.Id).FirstAsync(ct);
        }
    }

    // ------------------------------------------------------------------ tiers and badges

    /// <summary>
    /// Recomputes every author's badge from their published cases (counted completions, rating without hidden
    /// reviews) and creates the one-time tier bonus the first time a tier is reached.
    /// </summary>
    public async Task<int> RefreshStatsAsync(CancellationToken ct = default)
    {
        var rules = await settings.GetAuthorsAsync(ct);
        var published = await db.Cases.Find(item => item.AuthorUserId != null && item.AuthorUserId != ""
                                                     && item.Status == CaseStatus.Published).ToListAsync(ct);
        var updated = 0;
        foreach (var authorCases in published.GroupBy(item => item.AuthorUserId))
        {
            var best = (Completions: 0, Rating: 0, CaseId: string.Empty);
            var tier = AuthorTiers.Author;
            foreach (var gameCase in authorCases)
            {
                var completions = await CountedCompletionsAsync(gameCase, authorCases.Key, rules, ct);
                var rating = await RatingPercentAsync(gameCase.CaseId, ct);
                if (completions > best.Completions || completions == best.Completions && rating > best.Rating)
                    best = (completions, rating, gameCase.CaseId);
                var caseTier = completions >= rules.GoldCompletions && rating >= rules.GoldMinRatingPercent ? AuthorTiers.Gold
                    : completions >= rules.SilverCompletions && rating >= rules.SilverMinRatingPercent ? AuthorTiers.Silver
                    : AuthorTiers.Author;
                if (AuthorTiers.Rank(caseTier) > AuthorTiers.Rank(tier)) tier = caseTier;
            }
            await Stats.ReplaceOneAsync(item => item.Id == authorCases.Key, new AuthorStats
            {
                Id = authorCases.Key,
                Tier = tier,
                PublishedCases = authorCases.Count(),
                BestCompletions = best.Completions,
                BestRatingPercent = best.Rating,
                BestCaseId = best.CaseId,
                UpdatedAt = Now
            }, new ReplaceOptions { IsUpsert = true }, ct);
            if (AuthorTiers.Rank(tier) >= AuthorTiers.Rank(AuthorTiers.Silver))
                await TierBonusAsync(authorCases.Key, AuthorTiers.Silver, rules.SilverBonusXu, best.CaseId, rules, ct);
            if (tier == AuthorTiers.Gold)
                await TierBonusAsync(authorCases.Key, AuthorTiers.Gold, rules.GoldBonusXu, best.CaseId, rules, ct);
            updated++;
        }
        return updated;
    }

    private async Task TierBonusAsync(string author, string tier, long xu, string caseId, AuthorRewardSettings rules, CancellationToken ct)
    {
        var id = $"tier:{author}:{tier}";
        if (xu <= 0 || await Payouts.Find(item => item.Id == id).AnyAsync(ct)) return;
        await CreatePayoutAsync(new AuthorPayout { Id = id, AuthorUserId = author, CaseId = caseId, Kind = AuthorPayoutKinds.Tier, Tier = tier },
            xu, rules, ct);
    }

    /// <summary>Distinct players who finished the case and pass the anti-fraud rules (never the author).</summary>
    public async Task<int> CountedCompletionsAsync(GameCase gameCase, string author, AuthorRewardSettings rules, CancellationToken ct)
    {
        var results = await db.GameResults.Find(item => item.CaseId == gameCase.CaseId)
            .SortBy(item => item.CreatedAt).Limit(MaxCompletionsScanned).ToListAsync(ct);
        var rooms = (await db.Rooms.Find(Builders<GameRoom>.Filter.In(item => item.Id, results.Select(item => item.RoomId).Distinct()))
                .ToListAsync(ct))
            .ToDictionary(item => item.Id, StringComparer.Ordinal);
        var counted = new CountedPayers();
        var facts = new Dictionary<string, PlayerFacts>(StringComparer.Ordinal);
        foreach (var result in results)
        {
            rooms.TryGetValue(result.RoomId, out var room);
            foreach (var player in result.Players.Distinct())
            {
                if (counted.Users.Contains(player)) continue;
                if (!facts.TryGetValue(player, out var fact)) facts[player] = fact = await PlayerFactsAsync(player, gameCase.CaseId, ct);
                Judge(fact, author, room?.GameplayState?.StartedAt, room?.GameplayState?.CompletedAt ?? result.CreatedAt,
                    gameCase.EstimatedMinutes, rules, counted, result.CreatedAt);
            }
        }
        return counted.Users.Count;
    }

    /// <summary>Average rating of the visible reviews as a percent of five stars (0 without reviews).</summary>
    public async Task<int> RatingPercentAsync(string caseId, CancellationToken ct)
    {
        var ratings = await db.Reviews.Find(item => item.CaseId == caseId && !item.Hidden).Project(item => item.Rating).ToListAsync(ct);
        return ratings.Count == 0 ? 0 : (int)Math.Round(ratings.Average() / 5.0 * 100, MidpointRounding.AwayFromZero);
    }

    public async Task<Dictionary<string, AuthorStats>> BadgesAsync(IEnumerable<string> userIds, CancellationToken ct = default)
    {
        var ids = userIds.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<string, AuthorStats>(StringComparer.Ordinal);
        return (await Stats.Find(Builders<AuthorStats>.Filter.In(item => item.Id, ids)).ToListAsync(ct))
            .ToDictionary(item => item.Id, StringComparer.Ordinal);
    }

    // ------------------------------------------------------------------ paying

    /// <summary>Pays every held payout whose hold period is over, as bonus coins (once per payout).</summary>
    public async Task<int> PayDueAsync(CancellationToken ct = default)
    {
        var now = Now;
        var due = await Payouts.Find(item => item.State == AuthorPayoutStates.Held && item.AvailableAt <= now && item.Xu > 0)
            .Limit(200).ToListAsync(ct);
        var paid = 0;
        foreach (var payout in due)
        {
            var kind = payout.Kind == AuthorPayoutKinds.Tier ? WalletLedgerKinds.AuthorTier : WalletLedgerKinds.AuthorShare;
            var credit = await wallet.CreditBonusAsync(payout.AuthorUserId, $"author-payout:{payout.Id}", payout.Xu, kind, payout.CaseId,
                payout.Kind == AuthorPayoutKinds.Tier ? $"Tier {payout.Tier}" : null, ct);
            if (!credit.Succeeded) continue;
            var update = await Payouts.UpdateOneAsync(item => item.Id == payout.Id && item.State == AuthorPayoutStates.Held,
                Builders<AuthorPayout>.Update.Set(item => item.State, AuthorPayoutStates.Paid).Set(item => item.PaidAt, now), cancellationToken: ct);
            if (update.ModifiedCount == 1) paid++;
        }
        return paid;
    }

    // ------------------------------------------------------------------ admin

    public Task<List<AuthorPayout>> ListAsync(string? state, string? authorUserId, int limit, CancellationToken ct = default)
    {
        var filter = Builders<AuthorPayout>.Filter.Empty;
        if (!string.IsNullOrWhiteSpace(state)) filter &= Builders<AuthorPayout>.Filter.Eq(item => item.State, state.Trim().ToUpperInvariant());
        if (!string.IsNullOrWhiteSpace(authorUserId)) filter &= Builders<AuthorPayout>.Filter.Eq(item => item.AuthorUserId, authorUserId.Trim());
        return Payouts.Find(filter).SortByDescending(item => item.CreatedAt).Limit(Math.Clamp(limit, 1, 500)).ToListAsync(ct);
    }

    public Task<AuthorPayout> HoldAsync(string id, string adminId, string reason, CancellationToken ct = default) =>
        TransitionAsync(id, AuthorPayoutStates.Held, AuthorPayoutStates.OnHold, adminId, reason, ct);

    public Task<AuthorPayout> ReleaseAsync(string id, string adminId, CancellationToken ct = default) =>
        TransitionAsync(id, AuthorPayoutStates.OnHold, AuthorPayoutStates.Held, adminId, string.Empty, ct);

    /// <summary>
    /// Takes a payout back: one not paid yet is simply cancelled; a paid one takes the bonus coins back, as many as the
    /// author still has (bonus coins already spent are not clawed from ordinary coins).
    /// </summary>
    public async Task<AuthorPayout> RevokeAsync(string id, string adminId, string reason, CancellationToken ct = default)
    {
        var payout = await Payouts.Find(item => item.Id == id).FirstOrDefaultAsync(ct) ?? throw ApiException.NotFound("Payout not found.");
        if (payout.State == AuthorPayoutStates.Revoked) return payout;
        long taken = 0;
        if (payout.State == AuthorPayoutStates.Paid && payout.Xu > 0)
        {
            var account = await db.Database.GetCollection<MarketAccount>("marketAccounts").Find(item => item.Id == payout.AuthorUserId)
                .FirstOrDefaultAsync(ct);
            taken = Math.Min(payout.Xu, Math.Max(0, account?.BonusBalance ?? 0));
            if (taken > 0)
            {
                var debit = await wallet.DebitBonusAsync(payout.AuthorUserId, $"author-revoke:{payout.Id}", taken,
                    WalletLedgerKinds.AuthorRevoke, payout.CaseId, reason, ct);
                if (!debit.Succeeded) throw ApiException.Conflict("The author's bonus coins changed; try again.", "AUTHOR_REVOKE_RETRY", "admin.authors.revokeRetry");
            }
        }
        var revoked = await Payouts.FindOneAndUpdateAsync(item => item.Id == id && item.State != AuthorPayoutStates.Revoked,
            Builders<AuthorPayout>.Update
                .Set(item => item.State, AuthorPayoutStates.Revoked)
                .Set(item => item.RevokedAt, Now)
                .Set(item => item.RevokedXu, taken)
                .Set(item => item.ChangedByUserId, adminId)
                .Set(item => item.Reason, reason),
            new FindOneAndUpdateOptions<AuthorPayout> { ReturnDocument = ReturnDocument.After }, ct);
        return revoked ?? await Payouts.Find(item => item.Id == id).FirstAsync(ct);
    }

    private async Task<AuthorPayout> TransitionAsync(string id, string from, string to, string adminId, string reason, CancellationToken ct)
    {
        var changed = await Payouts.FindOneAndUpdateAsync(item => item.Id == id && item.State == from,
            Builders<AuthorPayout>.Update.Set(item => item.State, to).Set(item => item.ChangedByUserId, adminId).Set(item => item.Reason, reason),
            new FindOneAndUpdateOptions<AuthorPayout> { ReturnDocument = ReturnDocument.After }, ct);
        if (changed is not null) return changed;
        var current = await Payouts.Find(item => item.Id == id).FirstOrDefaultAsync(ct) ?? throw ApiException.NotFound("Payout not found.");
        if (current.State == to) return current;
        throw ApiException.Conflict($"Only a {from} payout can become {to}; this one is {current.State}.", "AUTHOR_PAYOUT_STATE", "admin.authors.state");
    }

    public void LogIfSlow(string pass, TimeSpan took)
    {
        if (took > TimeSpan.FromSeconds(30)) logger.LogWarning("Author reward pass {Pass} took {Seconds:F0}s.", pass, took.TotalSeconds);
    }
}
