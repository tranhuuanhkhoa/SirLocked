using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.DTOs.Weekly;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Weekly;

namespace SirLocked.Api.Services.Market;

/// <summary>Stable error codes of the weekly chest; the frontend maps each one to a Vietnamese/English message.</summary>
public static class WeeklyDropErrors
{
    public const string NotFound = "WEEKLY_DROP_NOT_FOUND";
}

/// <summary>
/// The weekly challenge chest. A game of the week's challenge case with enough points and the right culprit drops one
/// chest for each verified player who did not write the case, at most one per account per week.
/// Standalone MongoDB has no transactions, so every step can run again or at the same time as another:
/// the drop is one document per week and account (a second insert is a duplicate key), the chest and its item id are
/// rolled and stored before the item is made, and the item is put in the bag under an operation key
/// (<see cref="MarketService.GrantItemAsync"/>). A full bag leaves the chest waiting for the player to claim it.
/// Runs from the game result hook, and from the recovery sweep for drops left half-way and games the hook missed.
/// The reward API (WeeklyController) reads a player's drops and claims the waiting ones.
/// </summary>
public sealed class WeeklyDropService
{
    /// <summary>
    /// How far back the recovery sweep looks for finished games whose drop was never evaluated. The sweep only exists for
    /// games whose hook never ran because the process died, and those are found within a sweep or two of the restart.
    /// Keeping the window short also keeps the verification edge short (spec 7.3): an account that verifies its e-mail
    /// later does not get the chest of an older game through the sweep; it plays a good game again. The result page
    /// (<see cref="GetForRoomAsync"/>) rolls only within the same window.
    /// </summary>
    public static readonly TimeSpan RecoveryWindow = TimeSpan.FromHours(2);
    private const int PendingBatch = 200;
    private const int ResultBatch = 500;
    /// <summary>Lost insert races before giving up; one is normal (the winner's drop is then read back), more means the drop keeps vanishing.</summary>
    private const int InsertAttempts = 3;
    /// <summary>Waiting chests listed at most. One per week, so this is years of unclaimed chests.</summary>
    private const int WaitingListLimit = 100;

    /// <summary>Only what an evaluation reads from a game: never the case snapshot or the accusation (the sweep reads every 30 seconds).</summary>
    private static readonly ProjectionDefinition<GameResult> EvaluationFields = Builders<GameResult>.Projection
        .Include(r => r.RoomId).Include(r => r.CaseId).Include(r => r.Players)
        .Include(r => r.CreatedAt).Include(r => r.Success).Include(r => r.ScoreSummary);

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
    /// same time as any other evaluation: the answer for a game that already dropped the chest is the drop's state (even
    /// after an admin changed the week's case), and once the player has the week's chest any other challenge game of that
    /// week is ALREADY_THIS_WEEK while a game of another case stays NOT_CHALLENGE.
    /// Returns one of <see cref="WeeklyDropStatuses"/>.
    /// </summary>
    public Task<string> EvaluatePlayerAsync(GameResult result, string userId, CancellationToken ct = default) =>
        EvaluatePlayerAsync(result, userId, mayRoll: true, ct);

    /// <param name="mayRoll">
    /// False: everything is answered as usual and a drop this game already has is still finished, but no new chest is
    /// rolled; a game that would roll one answers NO_CHEST instead.
    /// </param>
    private async Task<string> EvaluatePlayerAsync(GameResult result, string userId, bool mayRoll, CancellationToken ct)
    {
        // The week the game was played in, not the week it is now.
        var week = ChallengeWeek.Containing(result.CreatedAt);
        var dropId = WeeklyDrop.IdOf(week.Key, userId);

        // 1. One drop per account per week, read first: this game's own drop is finished again and stays its answer even
        //    if an admin changed the week's case since.
        var existing = await FindDropAsync(dropId, ct);
        if (existing is not null && existing.RoomId == result.RoomId) return StatusOf(await AdvanceAsync(existing, ct));

        // 2. The challenge of that week. A game of any other case is not the challenge, drop or no drop.
        var challenge = await ChallengeOfAsync(week, ct);
        if (challenge is null || string.IsNullOrEmpty(result.CaseId) || challenge.CaseId != result.CaseId)
            return WeeklyDropStatuses.NotChallenge;
        // A challenge game after another game already dropped the week's chest is too late.
        if (existing is not null) return WeeklyDropStatuses.AlreadyThisWeek;

        for (var attempt = 1; ; attempt++)
        {
            // 3. Who may have one. Nothing is written for a player who may not, so a later good game of the week still counts.
            var author = await AuthorOfAsync(result.CaseId, ct);
            var verifiedActive = await IsVerifiedActiveAsync(userId, ct);
            var reason = WeeklyDropRules.Ineligibility(result, userId, author, verifiedActive, _settings.MinScore);
            if (reason is not null) return reason;
            if (!mayRoll) return WeeklyDropStatuses.NoChest;

            // 4. Roll the chest with the odds in force now.
            var chest = WeeklyDropRules.RollChest(WeeklyDropRules.Odds(_catalog.Current.Chests), _random);
            if (chest is null)
            {
                _logger.LogWarning(
                    "Weekly drop {DropId}: no chest can drop (every chest is switched off or weighted 0), so room {RoomId} drops nothing.",
                    dropId, result.RoomId);
                return WeeklyDropStatuses.NoChest;
            }

            // 5. Record the roll before anything is given. A lost race answers with the winner's drop instead.
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
            var inserted = false;
            try
            {
                await _store.WeeklyDrops.InsertOneAsync(drop, cancellationToken: ct);
                inserted = true;
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                var winner = await FindDropAsync(dropId, ct);
                if (winner is not null) return await AnswerForAsync(winner, result, ct);
                if (attempt >= InsertAttempts)
                    throw new InvalidOperationException($"Weekly drop {dropId} lost {InsertAttempts} insert races and cannot be read back.");
            }

            // 6. Give it.
            if (inserted) return StatusOf(await AdvanceAsync(drop, ct));
        }
    }

    /// <summary>The answer for a challenge game whose insert lost the race: finished again if the drop is this game's, else too late.</summary>
    private async Task<string> AnswerForAsync(WeeklyDrop drop, GameResult result, CancellationToken ct) =>
        drop.RoomId == result.RoomId ? StatusOf(await AdvanceAsync(drop, ct)) : WeeklyDropStatuses.AlreadyThisWeek;

    private async Task<WeeklyDrop?> FindDropAsync(string dropId, CancellationToken ct) =>
        await _store.WeeklyDrops.Find(d => d.Id == dropId).FirstOrDefaultAsync(ct);

    /// <summary>
    /// Puts the drop's chest in the bag, or marks it waiting when the bag is full. Safe to repeat and to run at the same
    /// time as itself: the slot is taken once under <see cref="OpKey"/>, the item id was chosen at the roll, and a done
    /// drop never goes back. A waiting drop is tried again only from pending (<see cref="ReopenAsync"/>).
    /// Returns the drop as stored afterwards.
    /// </summary>
    internal async Task<WeeklyDrop> AdvanceAsync(WeeklyDrop drop, CancellationToken ct)
    {
        if (drop.State == WeeklyDropStates.Done) return drop;
        if (drop.State != WeeklyDropStates.Waiting) return await DeliverAsync(drop, retry: false, ct);

        var reopened = await ReopenAsync(drop.Id, userId: null, ct);
        if (reopened is not null) return await DeliverAsync(reopened, retry: true, ct);
        // Moved by someone else meanwhile: delivered, waiting again, or being tried again from pending (safe to join).
        var current = await FindDropAsync(drop.Id, ct) ?? drop;
        return current.State == WeeklyDropStates.Pending ? await DeliverAsync(current, retry: true, ct) : current;
    }

    /// <summary>
    /// Moves a waiting drop back to pending before its slot is taken again. The sweep leaves a waiting drop alone and it may
    /// wait for weeks, longer than the wallet remembers an operation key: if the process stopped between taking the slot
    /// and making the chest, a retry that late would take a second slot. A pending drop is finished by the sweep within
    /// minutes, while its key is still remembered. Null when no such waiting drop exists (of <paramref name="userId"/>, if given).
    /// </summary>
    private async Task<WeeklyDrop?> ReopenAsync(string dropId, string? userId, CancellationToken ct)
    {
        var filter = Builders<WeeklyDrop>.Filter;
        var match = filter.Eq(d => d.Id, dropId) & filter.Eq(d => d.State, WeeklyDropStates.Waiting);
        if (userId is not null) match &= filter.Eq(d => d.UserId, userId);
        return await _store.WeeklyDrops.FindOneAndUpdateAsync(
            match,
            Builders<WeeklyDrop>.Update.Set(d => d.State, WeeklyDropStates.Pending).Set(d => d.UpdatedAt, Now),
            new FindOneAndUpdateOptions<WeeklyDrop> { ReturnDocument = ReturnDocument.After },
            ct);
    }

    /// <summary>
    /// Takes the slot under the drop's operation key and makes the chest, or marks the drop waiting when the bag is full.
    /// <paramref name="retry"/>: a waiting chest tried again, whose full bag was already logged.
    /// </summary>
    private async Task<WeeklyDrop> DeliverAsync(WeeklyDrop drop, bool retry, CancellationToken ct)
    {
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
        if (!granted && !retry)
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
    /// anyway, and leaving them out keeps the batch limit for the games that matter. When no chest can drop at all, no game
    /// is evaluated (the hook already warned about each one), so the sweep neither repeats that warning every 30 seconds
    /// nor drops old games once weights come back.
    /// </summary>
    private async Task<int> EvaluateMissedAsync(DateTime from, DateTime cutoff, CancellationToken ct)
    {
        if (cutoff <= from) return 0;
        if (WeeklyDropRules.Odds(_catalog.Current.Chests).Count == 0)
        {
            _logger.LogDebug("Weekly drop recovery: no chest can drop (every chest is switched off or weighted 0), so no game is evaluated.");
            return 0;
        }
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
            .SortByDescending(r => r.CreatedAt).Limit(ResultBatch).Project<GameResult>(EvaluationFields).ToListAsync(ct);
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

    // ------------------------------------------------------------------ the reward API

    /// <summary>
    /// What the game in <paramref name="roomId"/> did for this player's weekly chest, for the result page. The game is
    /// evaluated (safe to repeat), so the page has its answer even when the hook failed and the sweep has not run yet.
    /// Like the sweep, only a game of the last <see cref="RecoveryWindow"/> can still roll its chest here: eligibility is
    /// decided when the game ends (spec 7.3), so verifying an e-mail later does not drop the chests of older games when
    /// their pages are opened again. An older game that never dropped one answers NO_CHEST.
    /// A game that does not exist, or that the player was not in, is NOT_CHALLENGE.
    /// </summary>
    public async Task<WeeklyDropStatusDto> GetForRoomAsync(string userId, string roomId, CancellationToken ct = default)
    {
        var result = string.IsNullOrWhiteSpace(roomId)
            ? null
            : await _store.Context.GameResults.Find(r => r.RoomId == roomId).Project<GameResult>(EvaluationFields).FirstOrDefaultAsync(ct);
        if (result?.Players is null || string.IsNullOrWhiteSpace(userId) || !result.Players.Contains(userId))
            return new WeeklyDropStatusDto(WeeklyDropStatuses.NotChallenge, null, _settings.MinScore);

        var status = await EvaluatePlayerAsync(result, userId, mayRoll: result.CreatedAt >= Now - RecoveryWindow, ct);
        // The week's chest: the one this game dropped, or the one the week already gave.
        var drop = status is WeeklyDropStatuses.Granted or WeeklyDropStatuses.Waiting or WeeklyDropStatuses.AlreadyThisWeek
            ? await FindDropAsync(WeeklyDrop.IdOf(ChallengeWeek.Containing(result.CreatedAt).Key, userId), ct)
            : null;
        return new WeeklyDropStatusDto(status, drop is null ? null : ToDto(drop), _settings.MinScore);
    }

    /// <summary>
    /// The player's weekly reward for the challenge page: this week's chest if the week gave one, and every chest still
    /// waiting for room (this week's included), newest week first. Only reads; claiming is <see cref="ClaimAsync"/>.
    /// </summary>
    public async Task<WeeklyRewardDto> GetMineAsync(string userId, CancellationToken ct = default)
    {
        var week = ChallengeWeek.Containing(Now);
        var thisWeek = await FindDropAsync(WeeklyDrop.IdOf(week.Key, userId), ct);
        var waiting = await _store.WeeklyDrops
            .Find(d => d.UserId == userId && d.State == WeeklyDropStates.Waiting)
            .SortByDescending(d => d.WeekKey).Limit(WaitingListLimit).ToListAsync(ct);
        return new WeeklyRewardDto(week.Key, _settings.MinScore, thisWeek is null ? null : ToDto(thisWeek), waiting.Select(ToDto).ToList());
    }

    /// <summary>
    /// Puts one of the player's waiting chests in the bag once they made room: the chest and item id rolled when the game
    /// ended, never a new roll. The drop goes back to pending before its slot is taken (<see cref="ReopenAsync"/>), so a
    /// claim cut short is the recovery sweep's to finish. A chest already in the bag is answered again and a pending one is
    /// finished. Someone else's drop, or none, is 404 WEEKLY_DROP_NOT_FOUND; a bag still full is 409 SLOTS_FULL.
    /// </summary>
    public async Task<WeeklyDropDto> ClaimAsync(CurrentUser user, string dropId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(dropId) || string.IsNullOrWhiteSpace(user.Id)) throw DropNotFound();

        var reopened = await ReopenAsync(dropId, user.Id, ct);
        WeeklyDrop stored;
        if (reopened is not null)
        {
            stored = await DeliverAsync(reopened, retry: true, ct);
        }
        else
        {
            var drop = await _store.WeeklyDrops.Find(d => d.Id == dropId && d.UserId == user.Id).FirstOrDefaultAsync(ct)
                ?? throw DropNotFound();
            stored = await AdvanceAsync(drop, ct);
        }
        if (stored.State != WeeklyDropStates.Done) throw MarketService.Error(409, ChestErrors.SlotsFull, "Your inventory is full.");
        return ToDto(stored);
    }

    private static ApiException DropNotFound() =>
        MarketService.Error(404, WeeklyDropErrors.NotFound, "This weekly challenge chest was not found.");

    /// <summary>The drop as the player sees it. A chest kind that has left the catalog shows its id as its name, never an error.</summary>
    private WeeklyDropDto ToDto(WeeklyDrop drop)
    {
        var chest = _catalog.Current.FindChest(drop.ChestDefId);
        return new WeeklyDropDto(
            drop.Id,
            drop.WeekKey,
            drop.ChestDefId,
            chest?.Name ?? drop.ChestDefId,
            chest?.NameEn ?? drop.ChestDefId,
            chest?.IconKey ?? string.Empty,
            chest?.Look is { } look ? ChestLookDto.Of(look) : null,
            drop.State,
            drop.CreatedAt);
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
