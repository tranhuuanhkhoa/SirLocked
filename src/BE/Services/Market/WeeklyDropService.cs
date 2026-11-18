using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Weekly;

namespace SirLocked.Api.Services.Market;

/// <summary>
/// The weekly challenge chest. A game of the week's challenge case with enough points and the right culprit drops one
/// chest for each verified player who did not write the case, at most one per account per week.
/// Standalone MongoDB has no transactions, so every step can run again or at the same time as another:
/// the drop is one document per week and account (a second insert is a duplicate key), the chest and its item id are
/// rolled and stored before the item is made, and the item is put in the bag under an operation key
/// (<see cref="MarketService.GrantItemAsync"/>). A full bag leaves the chest waiting for the player to claim it.
/// Runs from the game result hook, and from the recovery sweep for drops left half-way and games the hook missed.
/// </summary>
public sealed class WeeklyDropService
{
    /// <summary>How far back the recovery sweep looks for finished games whose drop was never evaluated.</summary>
    public static readonly TimeSpan RecoveryWindow = TimeSpan.FromHours(48);
    private const int PendingBatch = 200;
    private const int ResultBatch = 500;
    /// <summary>Lost insert races before giving up; one is normal (the winner's drop is then read back), more means the drop keeps vanishing.</summary>
    private const int InsertAttempts = 3;

    private readonly MarketStore _store;
    private readonly MarketService _market;
    private readonly IWeeklyService _weekly;
    private readonly IChestRandom _random;
    private readonly WeeklyChallengeSettings _settings;
    private readonly ILogger<WeeklyDropService> _logger;
    private readonly ICatalogProvider _catalog;

    public WeeklyDropService(
        MarketStore store,
        MarketService market,
        IWeeklyService weekly,
        IChestRandom random,
        IOptions<WeeklyChallengeSettings> settings,
        ILogger<WeeklyDropService> logger,
        ICatalogProvider? catalog = null)
    {
        _store = store;
        _market = market;
        _weekly = weekly;
        _random = random;
        _settings = settings.Value;
        _logger = logger;
        _catalog = catalog ?? FixedCatalogProvider.Default;
    }

    private DateTime Now => _store.Now;

    /// <summary>The wallet operation that takes the drop's bag slot, once.</summary>
    internal static string OpKey(string dropId) => $"weekly:{dropId}";

    // ------------------------------------------------------------------ evaluating a game

    /// <summary>
    /// Evaluates every player of a saved game (blank ids skipped, each player once). A game that cannot qualify on its
    /// score or culprit is skipped at once. One player's failure is logged and does not stop the others; the recovery
    /// sweep tries again.
    /// </summary>
    public async Task EvaluateAsync(GameResult result, CancellationToken ct = default)
    {
        if (!CanQualify(result)) return;
        foreach (var userId in result.Players.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal))
        {
            try
            {
                await EvaluatePlayerAsync(result, userId, ct);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogError(exception, "Weekly drop of {UserId} for room {RoomId} failed; recovery will retry.", userId, result.RoomId);
            }
        }
    }

    /// <summary>
    /// Whether this game drops this player's chest of the week, dropping it when it does. Safe to repeat and to run at the
    /// same time as any other evaluation: the answer for a game that already dropped the chest is the drop's state.
    /// Returns one of <see cref="WeeklyDropStatuses"/>.
    /// </summary>
    public async Task<string> EvaluatePlayerAsync(GameResult result, string userId, CancellationToken ct = default)
    {
        // 1. The challenge of the week the game was played in, not of the week it is now.
        var week = ChallengeWeek.Containing(result.CreatedAt);
        var challenge = await ChallengeOfAsync(week, ct);
        if (challenge is null || string.IsNullOrEmpty(result.CaseId) || challenge.CaseId != result.CaseId)
            return WeeklyDropStatuses.NotChallenge;

        var dropId = WeeklyDrop.IdOf(week.Key, userId);
        for (var attempt = 1; ; attempt++)
        {
            // 2. One drop per account per week. This game's own drop is finished again; another game's means this one is too late.
            var existing = await _store.WeeklyDrops.Find(d => d.Id == dropId).FirstOrDefaultAsync(ct);
            if (existing is not null)
            {
                if (existing.RoomId != result.RoomId) return WeeklyDropStatuses.AlreadyThisWeek;
                return StatusOf(await AdvanceAsync(existing, ct));
            }
            if (attempt > InsertAttempts)
                throw new InvalidOperationException($"Weekly drop {dropId} lost {InsertAttempts} insert races and cannot be read back.");

            // 3. Who may have one. Nothing is written for a player who may not, so a later good game of the week still counts.
            var author = await AuthorOfAsync(result.CaseId, ct);
            var verifiedActive = await IsVerifiedActiveAsync(userId, ct);
            var reason = WeeklyDropRules.Ineligibility(result, userId, author, verifiedActive, _settings.MinScore);
            if (reason is not null) return reason;

            // 4. Roll the chest with the odds in force now.
            var chest = WeeklyDropRules.RollChest(WeeklyDropRules.Odds(_catalog.Current.Chests), _random);
            if (chest is null)
            {
                _logger.LogWarning(
                    "Weekly drop {DropId}: no chest can drop (every chest is switched off or weighted 0), so room {RoomId} drops nothing.",
                    dropId, result.RoomId);
                return WeeklyDropStatuses.NoChest;
            }

            // 5. Record the roll before anything is given. A lost race reads the winner's drop instead.
            var now = Now;
            var drop = new WeeklyDrop
            {
                Id = dropId,
                UserId = userId,
                WeekKey = week.Key,
                CaseId = result.CaseId,
                RoomId = result.RoomId,
                ChestDefId = chest.Id,
                ItemId = MarketStore.NewId(),
                State = WeeklyDropStates.Pending,
                CreatedAt = now,
                UpdatedAt = now,
            };
            try
            {
                await _store.WeeklyDrops.InsertOneAsync(drop, cancellationToken: ct);
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                continue;
            }

            // 6. Give it.
            return StatusOf(await AdvanceAsync(drop, ct));
        }
    }

    /// <summary>
    /// Puts the drop's chest in the bag, or marks it waiting when the bag is full. Safe to repeat and to run at the same
    /// time as itself: the slot is taken once under <see cref="OpKey"/>, the item id was chosen at the roll, and a done
    /// drop never goes back. Returns the drop as stored afterwards.
    /// </summary>
    internal async Task<WeeklyDrop> AdvanceAsync(WeeklyDrop drop, CancellationToken ct)
    {
        if (drop.State == WeeklyDropStates.Done) return drop;

        // A detective who never opened the market has no account yet; the slot write needs one.
        await _market.EnsureAccountAsync(drop.UserId, ct);
        var granted = await _market.GrantItemAsync(drop.UserId, drop.ChestDefId, drop.ItemId, MarketItemSources.Weekly, OpKey(drop.Id), ct);

        var now = Now;
        var update = granted
            ? Builders<WeeklyDrop>.Update.Set(d => d.State, WeeklyDropStates.Done).Set(d => d.DeliveredAt, now).Set(d => d.UpdatedAt, now)
            : Builders<WeeklyDrop>.Update.Set(d => d.State, WeeklyDropStates.Waiting).Set(d => d.UpdatedAt, now);
        var stored = await _store.WeeklyDrops.FindOneAndUpdateAsync(
            d => d.Id == drop.Id && d.State != WeeklyDropStates.Done,
            update,
            new FindOneAndUpdateOptions<WeeklyDrop> { ReturnDocument = ReturnDocument.After },
            ct);
        if (stored is null)
        {
            // Another call delivered it first.
            return await _store.WeeklyDrops.Find(d => d.Id == drop.Id).FirstOrDefaultAsync(ct) ?? drop;
        }
        if (!granted && drop.State != WeeklyDropStates.Waiting)
        {
            _logger.LogInformation("Weekly drop {DropId}: the bag is full, so the chest {ChestId} waits to be claimed.", drop.Id, drop.ChestDefId);
        }
        return stored;
    }

    // ------------------------------------------------------------------ recovery

    /// <summary>
    /// Finishes drops left pending for longer than <paramref name="staleAfter"/> (a crash between the roll and the bag),
    /// then evaluates the challenge games of the last <see cref="RecoveryWindow"/> that ended before that and whose
    /// players have no drop of that week yet (a crash before the hook ran). Waiting drops are left for their player.
    /// Returns how many drops it finished or made.
    /// </summary>
    public async Task<int> RecoverAsync(TimeSpan staleAfter, CancellationToken ct = default)
    {
        var now = Now;
        var cutoff = now - staleAfter;
        var resumed = await ResumePendingAsync(cutoff, ct);
        var found = await EvaluateMissedAsync(now - RecoveryWindow, cutoff, ct);
        return resumed + found;
    }

    private async Task<int> ResumePendingAsync(DateTime cutoff, CancellationToken ct)
    {
        var stale = await _store.WeeklyDrops
            .Find(d => d.State == WeeklyDropStates.Pending && d.UpdatedAt < cutoff)
            .SortBy(d => d.UpdatedAt).Limit(PendingBatch).ToListAsync(ct);
        var done = 0;
        foreach (var drop in stale)
        {
            // Lease: only one sweeper resumes a drop.
            var leased = await _store.WeeklyDrops.UpdateOneAsync(
                d => d.Id == drop.Id && d.State == WeeklyDropStates.Pending && d.UpdatedAt == drop.UpdatedAt,
                Builders<WeeklyDrop>.Update.Set(d => d.UpdatedAt, Now), cancellationToken: ct);
            if (leased.ModifiedCount == 0) continue;
            try
            {
                await AdvanceAsync(drop, ct);
                done++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogError(exception, "Weekly drop recovery could not finish drop {DropId}.", drop.Id);
            }
        }
        return done;
    }

    /// <summary>
    /// Qualifying games of [<paramref name="from"/>, <paramref name="cutoff"/>) whose players have no drop of the game's
    /// week, newest first. Only games of each week's own challenge case are read: any other game would be NOT_CHALLENGE
    /// anyway, and leaving them out keeps the batch limit for the games that matter.
    /// </summary>
    private async Task<int> EvaluateMissedAsync(DateTime from, DateTime cutoff, CancellationToken ct)
    {
        if (cutoff <= from) return 0;
        var filter = Builders<GameResult>.Filter;
        var windows = new List<FilterDefinition<GameResult>>();
        for (var week = ChallengeWeek.Containing(from); week.StartUtc < cutoff; week = week.Previous(-1))
        {
            var challenge = await ChallengeOfAsync(week, ct);
            if (challenge is null || string.IsNullOrEmpty(challenge.CaseId)) continue;
            windows.Add(filter.Eq(r => r.CaseId, challenge.CaseId)
                & filter.Gte(r => r.CreatedAt, week.StartUtc > from ? week.StartUtc : from)
                & filter.Lt(r => r.CreatedAt, week.EndUtc < cutoff ? week.EndUtc : cutoff));
        }
        if (windows.Count == 0) return 0;

        var results = await _store.Context.GameResults
            .Find(filter.Or(windows) & filter.Eq(r => r.Success, true) & filter.Gte(r => r.ScoreSummary!.TotalScore, _settings.MinScore))
            .SortByDescending(r => r.CreatedAt).Limit(ResultBatch).ToListAsync(ct);
        // A guest id is never an account, so it can never earn a drop: not worth evaluating on every sweep.
        var candidates = results
            .SelectMany(result => result.Players
                .Where(id => ObjectId.TryParse(id, out _))
                .Distinct(StringComparer.Ordinal)
                .Select(userId => (Result: result, UserId: userId, DropId: WeeklyDrop.IdOf(ChallengeWeek.Containing(result.CreatedAt).Key, userId))))
            .ToList();
        if (candidates.Count == 0) return 0;

        var ids = candidates.Select(c => c.DropId).Distinct(StringComparer.Ordinal).ToList();
        var taken = (await _store.WeeklyDrops.Find(Builders<WeeklyDrop>.Filter.In(d => d.Id, ids)).Project(d => d.Id).ToListAsync(ct))
            .ToHashSet(StringComparer.Ordinal);
        var found = 0;
        foreach (var (result, userId, dropId) in candidates)
        {
            if (taken.Contains(dropId)) continue;
            try
            {
                var status = await EvaluatePlayerAsync(result, userId, ct);
                if (status is WeeklyDropStatuses.Granted or WeeklyDropStatuses.Waiting)
                {
                    found++;
                    _logger.LogInformation("Weekly drop recovery: room {RoomId} dropped {DropId}, which the game hook had missed.", result.RoomId, dropId);
                }
                if (status is WeeklyDropStatuses.Granted or WeeklyDropStatuses.Waiting or WeeklyDropStatuses.AlreadyThisWeek)
                    taken.Add(dropId);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogError(exception, "Weekly drop recovery could not evaluate {UserId} for room {RoomId}.", userId, result.RoomId);
            }
        }
        return found;
    }

    // ------------------------------------------------------------------ reads

    /// <summary>Score and culprit decide alone whether anyone in the game can have a chest. A result without a room (none is saved so) is skipped, like the coin reward.</summary>
    private bool CanQualify(GameResult result) =>
        !string.IsNullOrWhiteSpace(result.RoomId)
        && result.Success && result.ScoreSummary is not null && result.ScoreSummary.TotalScore >= _settings.MinScore;

    /// <summary>The week's challenge. This week's is picked when it has none yet; a past (or future) week's is only read.</summary>
    private Task<WeeklyFeature?> ChallengeOfAsync(ChallengeWeek week, CancellationToken ct) =>
        week.Contains(Now) ? _weekly.EnsureChallengeAsync(week, ct) : _weekly.FindChallengeAsync(week, ct);

    private async Task<string?> AuthorOfAsync(string caseId, CancellationToken ct) =>
        await _store.Context.Cases.Find(c => c.CaseId == caseId).Project(c => c.AuthorUserId).FirstOrDefaultAsync(ct);

    /// <summary>Same rule as the market's: a verified e-mail and an active account. A guest id is not an account id and is never looked up.</summary>
    private async Task<bool> IsVerifiedActiveAsync(string userId, CancellationToken ct) =>
        ObjectId.TryParse(userId, out _) && await _store.Context.Users.CountDocumentsAsync(
            u => u.Id == userId && u.IsEmailVerified && u.Status == UserStatus.Active, cancellationToken: ct) > 0;

    private static string StatusOf(WeeklyDrop drop) =>
        drop.State == WeeklyDropStates.Done ? WeeklyDropStatuses.Granted : WeeklyDropStatuses.Waiting;
}
