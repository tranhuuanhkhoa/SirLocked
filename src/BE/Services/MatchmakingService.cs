using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Matchmaking;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Queue tickets → match proposals → a ready lobby. Standalone MongoDB has no transactions, so every
/// transition is a conditional single-document write and a lost race simply leaves the document to
/// whoever won:
/// <list type="bullet">
/// <item>a ticket moves SEARCHING → MATCHED only through a filter on status = SEARCHING, so it belongs to
/// at most one match; a unique partial index allows one active ticket per user;</item>
/// <item>a match is inserted as FORMING, both tickets are claimed in id order, and only then is it
/// published as PENDING; a failed claim unwinds the first one;</item>
/// <item>exactly one caller wins PENDING → CONFIRMED (all accepted) and creates the room; a unique
/// index on rooms.matchId makes a retried creation find the same room.</item>
/// </list>
/// </summary>
public sealed class MatchmakingService
{
    public const string NoCasesCode = "MATCH_NO_CASES";
    public const string PendingMatchCode = "MATCH_PENDING";
    public const string AlreadyQueuedCode = "MATCH_ALREADY_QUEUED";
    public const string MatchClosedCode = "MATCH_CLOSED";
    public const string MatchConfirmedCode = "MATCH_CONFIRMED";
    private const int CandidateLimit = 10;
    private const int SweepLimit = 200;

    private readonly MongoDbContext _db;
    private readonly ICaseService _cases;
    private readonly IMatchmakingNotifier _notifier;
    private readonly TimeProvider _time;
    private readonly ILogger<MatchmakingService> _logger;
    private readonly Random _random;
    private readonly CaseCatalogPolicy _catalog;

    public MatchmakingService(MongoDbContext db, ICaseService cases, IMatchmakingNotifier notifier,
        TimeProvider time, ILogger<MatchmakingService> logger, CaseCatalogPolicy? catalog = null)
        : this(db, cases, notifier, time, logger, Random.Shared, catalog)
    {
    }

    internal MatchmakingService(MongoDbContext db, ICaseService cases, IMatchmakingNotifier notifier,
        TimeProvider time, ILogger<MatchmakingService> logger, Random random, CaseCatalogPolicy? catalog = null)
    {
        _catalog = catalog ?? CaseCatalogPolicy.Open;
        _db = db;
        _cases = cases;
        _notifier = notifier;
        _time = time;
        _logger = logger;
        _random = random;
    }

    private IReadOnlyList<CaseSummaryResponse> FittingCases(IEnumerable<CaseSummaryResponse> published, string language, string length) =>
        _catalog.RelaxCaseFit
            ? MatchmakingRules.FittingCasesRelaxed(published, language, length)
            : MatchmakingRules.FittingCases(published, language, length);

    private DateTime Now => _time.GetUtcNow().UtcDateTime;
    private static FilterDefinitionBuilder<MatchTicket> TicketFilter => Builders<MatchTicket>.Filter;
    private static UpdateDefinitionBuilder<MatchTicket> TicketUpdate => Builders<MatchTicket>.Update;
    private static FilterDefinitionBuilder<MatchProposal> MatchFilter => Builders<MatchProposal>.Filter;
    private static UpdateDefinitionBuilder<MatchProposal> MatchUpdate => Builders<MatchProposal>.Update;

    /* ------------------------------------------------------------------ player actions */

    public async Task<MatchmakingStatusResponse> EnqueueAsync(CurrentUser user, EnqueueMatchRequest request, CancellationToken ct = default)
    {
        var errors = new Dictionary<string, string[]>();
        if (!MatchmakingRules.TryNormalizeMode(request.Mode, out var mode))
            errors["mode"] = [$"Use {string.Join(", ", MatchModes.All)}."];
        if (!MatchmakingRules.TryNormalizeRole(request.PreferredRole, out var role))
            errors["preferredRole"] = [$"Use {string.Join(", ", MatchRolePreferences.All)}."];
        if (!MatchmakingRules.TryNormalizeLength(request.CaseLength, out var length))
            errors["caseLength"] = [$"Use {string.Join(", ", MatchCaseLengths.All)}."];
        if (!MatchmakingRules.TryNormalizeLanguage(request.Language, out var language))
            errors["language"] = ["Use vi or en."];
        if (errors.Count > 0) throw ApiException.BadRequest(errors.Values.First()[0], errors);

        await EnsureEmailVerifiedAsync(user, ct);

        var fitting = FittingCases(await _cases.GetPublishedAsync(), language, length);
        if (fitting.Count == 0)
        {
            throw ApiException.Unprocessable("No published case fits this length and language yet.",
                new ApiErrorDetails(NoCasesCode, "matchmaking.noCases"));
        }

        var existing = await FindActiveTicketAsync(user.Id, ct);
        if (existing is not null)
        {
            if (existing.Status == MatchTicketStatuses.Matched)
                throw ApiException.Conflict("You already have a match waiting for confirmation.", PendingMatchCode, "matchmaking.pending");
            // Searching again with new settings replaces the old ticket, keeping one per user.
            if (!await EndTicketAsync(existing.Id, MatchTicketStatuses.Searching, null, MatchTicketStatuses.Cancelled, MatchEndReasons.Cancelled, ct))
                throw ApiException.Conflict("You already have a match waiting for confirmation.", PendingMatchCode, "matchmaking.pending");
        }

        var now = Now;
        var ticket = new MatchTicket
        {
            Id = ObjectId.GenerateNewId().ToString(),
            UserId = user.Id,
            Username = user.FullName,
            Mode = mode,
            PreferredRole = role,
            CaseLength = length,
            Language = language,
            Status = MatchTicketStatuses.Searching,
            IsActive = true,
            SearchStartedAt = now,
            LastSeenAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };
        try
        {
            await _db.MatchTickets.InsertOneAsync(ticket, cancellationToken: ct);
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Another tab enqueued at the same moment; the unique index kept a single ticket.
            throw ApiException.Conflict("You are already in the matchmaking queue.", AlreadyQueuedCode, "matchmaking.alreadyQueued");
        }

        await TryMatchAsync(ticket, ct);
        return await ReadStatusAsync(user.Id, ct);
    }

    public async Task<MatchmakingStatusResponse> GetStatusAsync(string userId, bool heartbeat = true, CancellationToken ct = default)
    {
        var ticket = await FindActiveTicketAsync(userId, ct);
        if (ticket?.Status == MatchTicketStatuses.Searching && heartbeat)
        {
            await _db.MatchTickets.UpdateOneAsync(
                TicketFilter.Eq(t => t.Id, ticket.Id) & TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Searching),
                TicketUpdate.Set(t => t.LastSeenAt, Now), cancellationToken: ct);
        }
        else if (ticket?.Status == MatchTicketStatuses.Matched && ticket.MatchId is { } matchId)
        {
            // Polling clients must not depend on the worker to see a timeout or a stuck room creation.
            var match = await FindMatchAsync(matchId, ct);
            if (match is not null && await RepairMatchAsync(match, ct))
                ticket = await FindActiveTicketAsync(userId, ct);
        }
        return await BuildStatusAsync(userId, ticket, ct);
    }

    public async Task<MatchmakingStatusResponse> CancelAsync(CurrentUser user, CancellationToken ct = default)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var ticket = await FindActiveTicketAsync(user.Id, ct);
            if (ticket is null) break;
            if (ticket.Status == MatchTicketStatuses.Searching)
            {
                if (await EndTicketAsync(ticket.Id, MatchTicketStatuses.Searching, null, MatchTicketStatuses.Cancelled, MatchEndReasons.Cancelled, ct))
                    break;
                continue; // claimed by a match meanwhile: cancelling now means declining it
            }
            if (ticket.MatchId is { } matchId)
            {
                var match = await FindMatchAsync(matchId, ct);
                if (match?.Status is MatchStatuses.Confirmed or MatchStatuses.RoomReady)
                    throw ApiException.Conflict("Both players already accepted this match.", MatchConfirmedCode, "matchmaking.confirmed");
                if (match?.Status == MatchStatuses.Pending)
                {
                    await DeclineMatchAsync(match, user.Id, ct);
                    break;
                }
                // FORMING: wait for the claim to finish or unwind, then try again.
                await Task.Delay(50, ct);
            }
        }
        return await ReadStatusAsync(user.Id, ct);
    }

    public async Task<MatchmakingStatusResponse> AcceptAsync(CurrentUser user, string matchId, CancellationToken ct = default)
    {
        var match = await RequireVisibleMatchAsync(user.Id, matchId, ct);
        switch (match.Status)
        {
            case MatchStatuses.RoomReady:
                return await ReadStatusAsync(user.Id, ct);
            case MatchStatuses.Confirmed:
                await FinalizeAsync(match, ct);
                return await ReadStatusAsync(user.Id, ct);
            case MatchStatuses.Pending:
                break;
            default:
                throw ApiException.Conflict("This match is no longer available.", MatchClosedCode, "matchmaking.closed");
        }

        var now = Now;
        if (now >= match.ExpiresAt)
        {
            await RepairMatchAsync(match, ct);
            throw ApiException.Conflict("The time to accept this match has run out.", MatchClosedCode, "matchmaking.expired");
        }

        var accepted = await _db.MatchProposals.UpdateOneAsync(
            MatchFilter.Eq(m => m.Id, match.Id)
            & MatchFilter.Eq(m => m.Status, MatchStatuses.Pending)
            & MatchFilter.Gt(m => m.ExpiresAt, now)
            & MatchFilter.ElemMatch(m => m.Players, p => p.UserId == user.Id),
            MatchUpdate.Set("players.$.accepted", true).Set("players.$.acceptedAt", now).Set(m => m.UpdatedAt, now),
            cancellationToken: ct);
        if (accepted.MatchedCount == 0)
        {
            var current = await FindMatchAsync(match.Id, ct);
            if (current?.Status is MatchStatuses.Confirmed or MatchStatuses.RoomReady)
                return await ReadStatusAsync(user.Id, ct);
            throw ApiException.Conflict("This match is no longer available.", MatchClosedCode, "matchmaking.closed");
        }

        if (!await TryConfirmAsync(match.Id, ct))
        {
            // Still waiting for the partner: tell them this player is in.
            await NotifyPlayersAsync(match, ct);
        }
        return await ReadStatusAsync(user.Id, ct);
    }

    public async Task<MatchmakingStatusResponse> DeclineAsync(CurrentUser user, string matchId, CancellationToken ct = default)
    {
        var match = await RequireVisibleMatchAsync(user.Id, matchId, ct);
        if (match.Status is MatchStatuses.Confirmed or MatchStatuses.RoomReady)
            throw ApiException.Conflict("Both players already accepted this match.", MatchConfirmedCode, "matchmaking.confirmed");
        if (match.Status == MatchStatuses.Pending)
            await DeclineMatchAsync(match, user.Id, ct);
        return await ReadStatusAsync(user.Id, ct);
    }

    /* ------------------------------------------------------------------ matching */

    /// <summary>Tries to pair one SEARCHING ticket with the longest-waiting compatible ticket.</summary>
    /// <returns>The published (PENDING) match, or null when no pairing was made.</returns>
    public async Task<MatchProposal?> TryMatchAsync(MatchTicket ticket, CancellationToken ct = default)
    {
        if (ticket.Status != MatchTicketStatuses.Searching) return null;
        var fitting = FittingCases(await _cases.GetPublishedAsync(), ticket.Language, ticket.CaseLength);
        if (fitting.Count == 0) return null;

        var candidates = await _db.MatchTickets.Find(
                TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Searching)
                & TicketFilter.Eq(t => t.Mode, ticket.Mode)
                & TicketFilter.Eq(t => t.Language, ticket.Language)
                & TicketFilter.Eq(t => t.CaseLength, ticket.CaseLength)
                & TicketFilter.In(t => t.PreferredRole, MatchmakingRules.CompatiblePartnerRoles(ticket.PreferredRole))
                & TicketFilter.Ne(t => t.UserId, ticket.UserId)
                & TicketFilter.Ne(t => t.Id, ticket.Id))
            .SortBy(t => t.SearchStartedAt).ThenBy(t => t.Id)
            .Limit(CandidateLimit)
            .ToListAsync(ct);

        foreach (var candidate in candidates)
        {
            if (!MatchmakingRules.AreCompatible(ticket, candidate)) continue;
            var (outcome, match) = await TryPairAsync(ticket, candidate, fitting, ct);
            if (outcome == PairOutcome.Matched) return match;
            if (outcome == PairOutcome.SelfUnavailable) return null;
        }
        return null;
    }

    private enum PairOutcome { Matched, CandidateUnavailable, SelfUnavailable }

    private async Task<(PairOutcome, MatchProposal?)> TryPairAsync(MatchTicket self, MatchTicket candidate, IReadOnlyList<CaseSummaryResponse> fitting, CancellationToken ct)
    {
        var (roleSelf, roleCandidate) = MatchmakingRules.AssignRoles(self.PreferredRole, candidate.PreferredRole, _random.Next(2) == 0);
        var gameCase = fitting[_random.Next(fitting.Count)];
        var now = Now;
        var match = new MatchProposal
        {
            Id = ObjectId.GenerateNewId().ToString(),
            Mode = self.Mode,
            CaseId = gameCase.CaseId,
            CaseTitle = gameCase.Title,
            EstimatedMinutes = gameCase.EstimatedMinutes,
            Language = CaseLanguages.Normalize(gameCase.Language), // the case's language, which can differ from the search language
            CaseLength = self.CaseLength,
            Status = MatchStatuses.Forming,
            // The older ticket is listed first; it also hosts the room.
            Players = new[] { (self, roleSelf), (candidate, roleCandidate) }
                .OrderBy(pair => pair.Item1.SearchStartedAt).ThenBy(pair => pair.Item1.Id, StringComparer.Ordinal)
                .Select(pair => new MatchPlayer
                {
                    UserId = pair.Item1.UserId,
                    Username = pair.Item1.Username,
                    TicketId = pair.Item1.Id,
                    PreferredRole = pair.Item1.PreferredRole,
                    Role = pair.Item2
                }).ToList(),
            ExpiresAt = now + MatchmakingRules.AcceptWindow,
            CreatedAt = now,
            UpdatedAt = now
        };
        await _db.MatchProposals.InsertOneAsync(match, cancellationToken: ct);

        var (first, second) = MatchmakingRules.ClaimOrder(self, candidate);
        if (!await ClaimTicketAsync(first.Id, match.Id, ct))
        {
            await AbortFormingAsync(match, [], ct);
            return (first.Id == self.Id ? PairOutcome.SelfUnavailable : PairOutcome.CandidateUnavailable, null);
        }
        if (!await ClaimTicketAsync(second.Id, match.Id, ct))
        {
            await AbortFormingAsync(match, [first.Id], ct);
            return (second.Id == self.Id ? PairOutcome.SelfUnavailable : PairOutcome.CandidateUnavailable, null);
        }

        // The acceptance window starts when the players can actually see the match.
        var published = Now;
        var shown = await _db.MatchProposals.UpdateOneAsync(
            MatchFilter.Eq(m => m.Id, match.Id) & MatchFilter.Eq(m => m.Status, MatchStatuses.Forming),
            MatchUpdate.Set(m => m.Status, MatchStatuses.Pending)
                .Set(m => m.ExpiresAt, published + MatchmakingRules.AcceptWindow)
                .Set(m => m.UpdatedAt, published),
            cancellationToken: ct);
        if (shown.ModifiedCount == 0)
        {
            // Only a sweep that took this match for abandoned can get here.
            await AbortFormingAsync(match, [first.Id, second.Id], ct);
            return (PairOutcome.CandidateUnavailable, null);
        }
        match.Status = MatchStatuses.Pending;
        _logger.LogInformation("Matched tickets {First} and {Second} into {MatchId} on case {CaseId}.",
            first.Id, second.Id, match.Id, match.CaseId);
        await NotifyPlayersAsync(match, ct);
        return (PairOutcome.Matched, match);
    }

    private async Task<bool> ClaimTicketAsync(string ticketId, string matchId, CancellationToken ct)
    {
        var result = await _db.MatchTickets.UpdateOneAsync(
            TicketFilter.Eq(t => t.Id, ticketId)
            & TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Searching)
            & TicketFilter.Eq(t => t.IsActive, true),
            TicketUpdate.Set(t => t.Status, MatchTicketStatuses.Matched)
                .Set(t => t.MatchId, matchId)
                .Set(t => t.UpdatedAt, Now),
            cancellationToken: ct);
        return result.ModifiedCount == 1;
    }

    private async Task AbortFormingAsync(MatchProposal match, IReadOnlyCollection<string> claimedTicketIds, CancellationToken ct)
    {
        foreach (var ticketId in claimedTicketIds)
            await RequeueTicketAsync(ticketId, match.Id, endReason: null, ct);
        await _db.MatchProposals.UpdateOneAsync(
            MatchFilter.Eq(m => m.Id, match.Id) & MatchFilter.Eq(m => m.Status, MatchStatuses.Forming),
            MatchUpdate.Set(m => m.Status, MatchStatuses.Aborted).Set(m => m.UpdatedAt, Now),
            cancellationToken: ct);
    }

    /* ------------------------------------------------------------------ resolution */

    private async Task<bool> TryConfirmAsync(string matchId, CancellationToken ct)
    {
        var confirmed = await _db.MatchProposals.FindOneAndUpdateAsync(
            MatchFilter.Eq(m => m.Id, matchId)
            & MatchFilter.Eq(m => m.Status, MatchStatuses.Pending)
            & MatchFilter.Not(MatchFilter.ElemMatch(m => m.Players, p => p.Accepted == false)),
            MatchUpdate.Set(m => m.Status, MatchStatuses.Confirmed).Set(m => m.UpdatedAt, Now),
            new FindOneAndUpdateOptions<MatchProposal> { ReturnDocument = ReturnDocument.After },
            ct);
        if (confirmed is null) return false;
        await FinalizeAsync(confirmed, ct);
        return true;
    }

    /// <summary>Creates (or finds) the room of a CONFIRMED match and sends both players to it.</summary>
    private async Task FinalizeAsync(MatchProposal match, CancellationToken ct)
    {
        var room = await _db.Rooms.Find(r => r.MatchId == match.Id).FirstOrDefaultAsync(ct)
            ?? await CreateMatchRoomAsync(match, ct);
        if (room is null) return; // the match failed and both players were requeued

        var now = Now;
        await _db.MatchProposals.UpdateOneAsync(
            MatchFilter.Eq(m => m.Id, match.Id) & MatchFilter.Eq(m => m.Status, MatchStatuses.Confirmed),
            MatchUpdate.Set(m => m.Status, MatchStatuses.RoomReady)
                .Set(m => m.RoomId, room.Id)
                .Set(m => m.RoomCode, room.RoomCode)
                .Set(m => m.UpdatedAt, now),
            cancellationToken: ct);
        await _db.MatchTickets.UpdateManyAsync(
            TicketFilter.In(t => t.Id, match.Players.Select(p => p.TicketId))
            & TicketFilter.Eq(t => t.MatchId, match.Id)
            & TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Matched),
            TicketUpdate.Set(t => t.Status, MatchTicketStatuses.RoomReady)
                .Set(t => t.IsActive, false)
                .Set(t => t.RoomId, room.Id)
                .Set(t => t.UpdatedAt, now),
            cancellationToken: ct);
        await NotifyPlayersAsync(match, ct);
    }

    private async Task<GameRoom?> CreateMatchRoomAsync(MatchProposal match, CancellationToken ct)
    {
        GameCase? gameCase = null;
        try
        {
            gameCase = await _cases.GetCaseAsync(match.CaseId);
        }
        catch (ApiException missing) when (missing.StatusCode == 404)
        {
        }
        if (gameCase is null || gameCase.Status != CaseStatus.Published || gameCase.Stages.Count == 0)
        {
            await FailMatchAsync(match, ct);
            return null;
        }

        var tickets = await _db.MatchTickets.Find(TicketFilter.In(t => t.Id, match.Players.Select(p => p.TicketId)))
            .ToListAsync(ct);
        var host = MatchmakingRules.PickHost(match, tickets.ToDictionary(t => t.Id, t => t.SearchStartedAt));
        var now = Now;
        var room = new GameRoom
        {
            Id = ObjectId.GenerateNewId().ToString(),
            CaseId = gameCase.CaseId,
            HostUserId = host.UserId,
            Status = RoomStatus.Waiting,
            Visibility = RoomVisibility.Private,
            MatchId = match.Id,
            // Roles come from matchmaking; readiness and the start stay in the normal lobby flow.
            Players = match.Players.OrderBy(p => p.UserId == host.UserId ? 0 : 1)
                .Select(p => new RoomPlayer { UserId = p.UserId, Username = p.Username, Role = p.Role, IsReady = false })
                .ToList(),
            CreatedAt = now,
            UpdatedAt = now
        };
        for (var attempt = 0; ; attempt++)
        {
            room.RoomCode = RoomService.GenerateRoomCode();
            try
            {
                await _db.Rooms.InsertOneAsync(room, cancellationToken: ct);
                return room;
            }
            catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                // Either a concurrent finalizer already created this match's room, or the code collided.
                var existing = await _db.Rooms.Find(r => r.MatchId == match.Id).FirstOrDefaultAsync(ct);
                if (existing is not null) return existing;
                if (attempt >= 5) throw;
            }
        }
    }

    private async Task FailMatchAsync(MatchProposal match, CancellationToken ct)
    {
        var failed = await _db.MatchProposals.UpdateOneAsync(
            MatchFilter.Eq(m => m.Id, match.Id) & MatchFilter.Eq(m => m.Status, MatchStatuses.Confirmed),
            MatchUpdate.Set(m => m.Status, MatchStatuses.Failed).Set(m => m.UpdatedAt, Now),
            cancellationToken: ct);
        if (failed.ModifiedCount == 0) return;
        _logger.LogWarning("Match {MatchId} could not open case {CaseId}; both players were requeued.", match.Id, match.CaseId);
        foreach (var player in match.Players)
            await RequeueTicketAsync(player.TicketId, match.Id, MatchEndReasons.RoomFailed, ct);
        await NotifyPlayersAsync(match, ct);
        await RetryRequeuedAsync(match, ct);
    }

    private async Task DeclineMatchAsync(MatchProposal match, string declinedByUserId, CancellationToken ct)
    {
        var declined = await _db.MatchProposals.UpdateOneAsync(
            MatchFilter.Eq(m => m.Id, match.Id) & MatchFilter.Eq(m => m.Status, MatchStatuses.Pending),
            MatchUpdate.Set(m => m.Status, MatchStatuses.Declined)
                .Set(m => m.DeclinedByUserId, declinedByUserId)
                .Set(m => m.UpdatedAt, Now),
            cancellationToken: ct);
        if (declined.ModifiedCount == 0)
        {
            var current = await FindMatchAsync(match.Id, ct);
            if (current?.Status is MatchStatuses.Confirmed or MatchStatuses.RoomReady)
                throw ApiException.Conflict("Both players already accepted this match.", MatchConfirmedCode, "matchmaking.confirmed");
            return; // already declined or expired
        }
        foreach (var player in match.Players)
        {
            if (MatchmakingRules.OutcomeOnDecline(player, declinedByUserId) == TicketOutcome.Requeue)
                await RequeueTicketAsync(player.TicketId, match.Id, MatchEndReasons.DeclinedByPartner, ct);
            else
                await EndTicketAsync(player.TicketId, MatchTicketStatuses.Matched, match.Id, MatchTicketStatuses.Cancelled, MatchEndReasons.DeclinedByYou, ct);
        }
        await NotifyPlayersAsync(match, ct);
        await RetryRequeuedAsync(match, ct);
    }

    /// <summary>
    /// Settles a match whose state cannot wait for its players: an elapsed acceptance window, an
    /// all-accepted match that was never confirmed, or a confirmed match still missing its room.
    /// Returns true when it changed something.
    /// </summary>
    public async Task<bool> RepairMatchAsync(MatchProposal match, CancellationToken ct = default)
    {
        var now = Now;
        if (match.Status == MatchStatuses.Pending && MatchmakingRules.AllAccepted(match))
            return await TryConfirmAsync(match.Id, ct);
        if (MatchmakingRules.IsPendingExpired(match, now))
            return await ExpireMatchAsync(match, now, ct);
        if (match.Status == MatchStatuses.Confirmed && now - match.UpdatedAt >= MatchmakingRules.ConfirmRetryDelay)
        {
            await FinalizeAsync(match, ct);
            return true;
        }
        return false;
    }

    private async Task<bool> ExpireMatchAsync(MatchProposal match, DateTime now, CancellationToken ct)
    {
        var expired = await _db.MatchProposals.FindOneAndUpdateAsync(
            MatchFilter.Eq(m => m.Id, match.Id)
            & MatchFilter.Eq(m => m.Status, MatchStatuses.Pending)
            & MatchFilter.Lte(m => m.ExpiresAt, now)
            // An all-accepted match is confirmed, never expired, even when confirmation is late.
            & MatchFilter.ElemMatch(m => m.Players, p => p.Accepted == false),
            MatchUpdate.Set(m => m.Status, MatchStatuses.Expired).Set(m => m.UpdatedAt, now),
            new FindOneAndUpdateOptions<MatchProposal> { ReturnDocument = ReturnDocument.After },
            ct);
        if (expired is null) return false;
        foreach (var player in expired.Players)
        {
            if (MatchmakingRules.OutcomeOnExpiry(player) == TicketOutcome.Requeue)
                await RequeueTicketAsync(player.TicketId, expired.Id, MatchEndReasons.PartnerTimeout, ct);
            else
                await EndTicketAsync(player.TicketId, MatchTicketStatuses.Matched, expired.Id, MatchTicketStatuses.Expired, MatchEndReasons.Timeout, ct);
        }
        await NotifyPlayersAsync(expired, ct);
        await RetryRequeuedAsync(expired, ct);
        return true;
    }

    private async Task RetryRequeuedAsync(MatchProposal match, CancellationToken ct)
    {
        foreach (var player in match.Players)
        {
            var ticket = await _db.MatchTickets.Find(t => t.Id == player.TicketId).FirstOrDefaultAsync(ct);
            if (ticket?.Status == MatchTicketStatuses.Searching) await TryMatchAsync(ticket, ct);
        }
    }

    private async Task RequeueTicketAsync(string ticketId, string matchId, string? endReason, CancellationToken ct)
    {
        var update = TicketUpdate.Set(t => t.Status, MatchTicketStatuses.Searching)
            .Unset(t => t.MatchId)
            // Requeued players keep their place (SearchStartedAt) and get a fresh heartbeat.
            .Set(t => t.LastSeenAt, Now)
            .Set(t => t.UpdatedAt, Now);
        update = endReason is null ? update.Unset(t => t.EndReason) : update.Set(t => t.EndReason, endReason);
        await _db.MatchTickets.UpdateOneAsync(
            TicketFilter.Eq(t => t.Id, ticketId)
            & TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Matched)
            & TicketFilter.Eq(t => t.MatchId, matchId),
            update, cancellationToken: ct);
    }

    private async Task<bool> EndTicketAsync(string ticketId, string expectedStatus, string? expectedMatchId,
        string finalStatus, string reason, CancellationToken ct)
    {
        var filter = TicketFilter.Eq(t => t.Id, ticketId) & TicketFilter.Eq(t => t.Status, expectedStatus);
        if (expectedMatchId is not null) filter &= TicketFilter.Eq(t => t.MatchId, expectedMatchId);
        var result = await _db.MatchTickets.UpdateOneAsync(filter,
            TicketUpdate.Set(t => t.Status, finalStatus)
                .Set(t => t.IsActive, false)
                .Set(t => t.EndReason, reason)
                .Set(t => t.UpdatedAt, Now),
            cancellationToken: ct);
        return result.ModifiedCount == 1;
    }

    /* ------------------------------------------------------------------ background sweep */

    /// <summary>One worker pass: settle due matches, unwind abandoned ones, drop silent tickets, match the queue.</summary>
    public async Task RunMaintenanceAsync(CancellationToken ct = default)
    {
        var now = Now;
        var due = await _db.MatchProposals.Find(
                (MatchFilter.Eq(m => m.Status, MatchStatuses.Pending) & MatchFilter.Lte(m => m.ExpiresAt, now))
                | (MatchFilter.Eq(m => m.Status, MatchStatuses.Confirmed) & MatchFilter.Lte(m => m.UpdatedAt, now - MatchmakingRules.ConfirmRetryDelay)))
            .Limit(SweepLimit).ToListAsync(ct);
        foreach (var match in due) await RepairMatchAsync(match, ct);

        var forming = await _db.MatchProposals.Find(
                MatchFilter.Eq(m => m.Status, MatchStatuses.Forming) & MatchFilter.Lte(m => m.CreatedAt, now - MatchmakingRules.FormingTimeout))
            .Limit(SweepLimit).ToListAsync(ct);
        foreach (var match in forming)
            await AbortFormingAsync(match, match.Players.Select(p => p.TicketId).ToList(), ct);

        await ReleaseOrphanedTicketsAsync(now, ct);

        await _db.MatchTickets.UpdateManyAsync(
            TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Searching)
            & TicketFilter.Lte(t => t.LastSeenAt, now - MatchmakingRules.TicketHeartbeatTimeout),
            TicketUpdate.Set(t => t.Status, MatchTicketStatuses.Expired)
                .Set(t => t.IsActive, false)
                .Set(t => t.EndReason, MatchEndReasons.Stale)
                .Set(t => t.UpdatedAt, now),
            cancellationToken: ct);

        var queue = await _db.MatchTickets.Find(TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Searching))
            .SortBy(t => t.SearchStartedAt).ThenBy(t => t.Id)
            .Limit(SweepLimit).ToListAsync(ct);
        var taken = new HashSet<string>(StringComparer.Ordinal);
        foreach (var ticket in queue)
        {
            // The snapshot goes stale as the pass pairs tickets; skipping known pairs avoids pointless claims.
            if (taken.Contains(ticket.Id)) continue;
            var match = await TryMatchAsync(ticket, ct);
            foreach (var player in match?.Players ?? []) taken.Add(player.TicketId);
        }
    }

    /// <summary>A MATCHED ticket whose match ended without updating it (a crash mid-way) goes back to searching.</summary>
    private async Task ReleaseOrphanedTicketsAsync(DateTime now, CancellationToken ct)
    {
        var suspects = await _db.MatchTickets.Find(
                TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Matched)
                & TicketFilter.Lte(t => t.UpdatedAt, now - MatchmakingRules.FormingTimeout))
            .Limit(SweepLimit).ToListAsync(ct);
        foreach (var ticket in suspects)
        {
            var match = ticket.MatchId is null ? null : await FindMatchAsync(ticket.MatchId, ct);
            switch (match?.Status)
            {
                case MatchStatuses.Forming or MatchStatuses.Pending or MatchStatuses.Confirmed:
                    continue; // still live; the passes above settle it
                case MatchStatuses.RoomReady:
                    await _db.MatchTickets.UpdateOneAsync(
                        TicketFilter.Eq(t => t.Id, ticket.Id) & TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Matched),
                        TicketUpdate.Set(t => t.Status, MatchTicketStatuses.RoomReady).Set(t => t.IsActive, false)
                            .Set(t => t.RoomId, match.RoomId).Set(t => t.UpdatedAt, now),
                        cancellationToken: ct);
                    break;
                default:
                    await _db.MatchTickets.UpdateOneAsync(
                        TicketFilter.Eq(t => t.Id, ticket.Id) & TicketFilter.Eq(t => t.Status, MatchTicketStatuses.Matched)
                        & TicketFilter.Eq(t => t.MatchId, ticket.MatchId),
                        TicketUpdate.Set(t => t.Status, MatchTicketStatuses.Searching).Unset(t => t.MatchId)
                            .Set(t => t.LastSeenAt, now).Set(t => t.UpdatedAt, now),
                        cancellationToken: ct);
                    break;
            }
        }
    }

    /* ------------------------------------------------------------------ reads */

    /// <summary>The caller's state as stored, without heartbeat or repairs (safe inside other transitions).</summary>
    private async Task<MatchmakingStatusResponse> ReadStatusAsync(string userId, CancellationToken ct) =>
        await BuildStatusAsync(userId, await FindActiveTicketAsync(userId, ct), ct);

    private Task<MatchTicket?> FindActiveTicketAsync(string userId, CancellationToken ct) =>
        _db.MatchTickets.Find(TicketFilter.Eq(t => t.UserId, userId) & TicketFilter.Eq(t => t.IsActive, true))
            .FirstOrDefaultAsync(ct)!;

    private Task<MatchProposal?> FindMatchAsync(string matchId, CancellationToken ct) =>
        _db.MatchProposals.Find(m => m.Id == matchId).FirstOrDefaultAsync(ct)!;

    private async Task<MatchProposal> RequireVisibleMatchAsync(string userId, string matchId, CancellationToken ct)
    {
        if (!ObjectId.TryParse(matchId, out _)) throw ApiException.NotFound("Match not found.");
        var match = await FindMatchAsync(matchId, ct);
        // FORMING/ABORTED matches were never shown to anyone; a non-member learns nothing either.
        if (match is null || match.Status is MatchStatuses.Forming or MatchStatuses.Aborted)
            throw ApiException.NotFound("Match not found.");
        if (match.Players.All(p => p.UserId != userId))
            throw ApiException.Forbidden("You are not part of this match.");
        return match;
    }

    private async Task<MatchmakingStatusResponse> BuildStatusAsync(string userId, MatchTicket? ticket, CancellationToken ct)
    {
        // With no live ticket, the latest finished one still explains what just happened (a room to
        // open, a timeout) for a short while.
        ticket ??= await _db.MatchTickets.Find(
                TicketFilter.Eq(t => t.UserId, userId)
                & TicketFilter.Gte(t => t.UpdatedAt, Now - MatchmakingRules.FinishedTicketVisibility))
            .SortByDescending(t => t.UpdatedAt).FirstOrDefaultAsync(ct);
        var response = new MatchmakingStatusResponse { ServerTime = Now };
        if (ticket is null) return response;

        response.TicketId = ticket.Id;
        response.Mode = ticket.Mode;
        response.PreferredRole = ticket.PreferredRole;
        response.CaseLength = ticket.CaseLength;
        response.Language = ticket.Language;
        response.SearchStartedAt = ticket.SearchStartedAt;
        response.EndReason = ticket.EndReason;

        switch (ticket.Status)
        {
            case MatchTicketStatuses.Searching:
                response.Phase = MatchmakingPhases.Searching;
                break;
            case MatchTicketStatuses.Matched:
                var match = ticket.MatchId is null ? null : await FindMatchAsync(ticket.MatchId, ct);
                var me = match?.Players.FirstOrDefault(p => p.UserId == userId);
                if (match is null || me is null || match.Status is MatchStatuses.Forming or MatchStatuses.Aborted)
                {
                    response.Phase = MatchmakingPhases.Searching;
                    break;
                }
                response.Match = Summary(match, me);
                response.Phase = match.Status switch
                {
                    MatchStatuses.Pending when !me.Accepted => MatchmakingPhases.Found,
                    MatchStatuses.Pending or MatchStatuses.Confirmed => MatchmakingPhases.Accepted,
                    MatchStatuses.RoomReady => MatchmakingPhases.Ready,
                    _ => MatchmakingPhases.Searching
                };
                response.RoomId = match.RoomId;
                break;
            case MatchTicketStatuses.RoomReady:
                response.Phase = MatchmakingPhases.Ready;
                response.RoomId = ticket.RoomId;
                if (ticket.MatchId is { } readyMatchId && await FindMatchAsync(readyMatchId, ct) is { } readyMatch
                    && readyMatch.Players.FirstOrDefault(p => p.UserId == userId) is { } readyMe)
                {
                    response.Match = Summary(readyMatch, readyMe);
                }
                break;
            default:
                response.Phase = MatchmakingPhases.Ended;
                break;
        }
        return response;
    }

    private static MatchSummaryDto Summary(MatchProposal match, MatchPlayer me)
    {
        var partner = match.Players.FirstOrDefault(p => p.UserId != me.UserId);
        return new MatchSummaryDto
        {
            MatchId = match.Id,
            Mode = match.Mode,
            CaseId = match.CaseId,
            CaseTitle = match.CaseTitle,
            EstimatedMinutes = match.EstimatedMinutes,
            Language = match.Language,
            YourRole = me.Role,
            YouAccepted = me.Accepted,
            PartnerUsername = partner?.Username ?? string.Empty,
            PartnerRole = partner?.Role ?? string.Empty,
            PartnerAccepted = partner?.Accepted ?? false,
            ExpiresAt = match.ExpiresAt,
            Status = match.Status
        };
    }

    private async Task NotifyPlayersAsync(MatchProposal match, CancellationToken ct)
    {
        foreach (var player in match.Players)
        {
            try
            {
                await _notifier.StatusChanged(player.UserId, await ReadStatusAsync(player.UserId, ct));
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                _logger.LogWarning(error, "Could not build the matchmaking push for user {UserId}.", player.UserId);
            }
        }
    }

    private async Task EnsureEmailVerifiedAsync(CurrentUser user, CancellationToken ct)
    {
        if (user.Role == UserRole.Admin) return;
        var account = await _db.Users.Find(u => u.Id == user.Id).FirstOrDefaultAsync(ct);
        if (account is null || !account.IsEmailVerified)
            throw ApiException.Forbidden("Vui lòng xác minh email trước khi vào game.");
        // Người mới chọn "Nhập môn" phải chơi xong màn tân thủ trước khi tìm trận.
        TutorialRules.EnsureNotRequired(account);
    }
}
