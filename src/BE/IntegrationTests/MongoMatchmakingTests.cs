using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Matchmaking;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// Matchmaking and public rooms against a real loopback MongoDB (SIRLOCKED_RUN_MONGO_IT=true):
/// atomic pairing under concurrency, accept/decline/timeout transitions and the public listing.
/// </summary>
public sealed class MongoMatchmakingTests
{
    private static readonly DateTime Start = new(2026, 10, 25, 9, 0, 0, DateTimeKind.Utc);

    private static EnqueueMatchRequest Prefs(string role = "ANY", string length = "SHORT", string language = "vi", string mode = "QUICK") =>
        new() { Mode = mode, PreferredRole = role, CaseLength = length, Language = language };

    [Fact]
    public Task TwoCompatiblePlayers_AreMatchedOnEnqueueWithTheirPreferredRolesAndAFittingCase() => WithHarness(async h =>
    {
        var a = await h.UserAsync("Thám tử An");
        var b = await h.UserAsync("Thám tử Bình");

        var first = await h.Service.EnqueueAsync(a, Prefs(role: "INTERROGATOR"));
        Assert.Equal(MatchmakingPhases.Searching, first.Phase);
        Assert.Null(first.Match);

        var second = await h.Service.EnqueueAsync(b, Prefs(role: "ANY"));
        Assert.Equal(MatchmakingPhases.Found, second.Phase);
        Assert.NotNull(second.Match);
        Assert.Equal(PlayerRole.Investigator, second.Match!.YourRole);
        Assert.Equal(PlayerRole.Interrogator, second.Match.PartnerRole);
        Assert.Equal("Thám tử An", second.Match.PartnerUsername);
        Assert.Equal("vi-short", second.Match.CaseId);
        Assert.Equal(h.Now + MatchmakingRules.AcceptWindow, second.Match.ExpiresAt);

        var forA = await h.Service.GetStatusAsync(a.Id);
        Assert.Equal(MatchmakingPhases.Found, forA.Phase);
        Assert.Equal(PlayerRole.Interrogator, forA.Match!.YourRole);
        Assert.Equal(second.Match.MatchId, forA.Match.MatchId);
        // Both players were pushed the FOUND state.
        Assert.Contains(h.Pushes, push => push.UserId == a.Id && push.Status.Phase == MatchmakingPhases.Found);
        Assert.Contains(h.Pushes, push => push.UserId == b.Id && push.Status.Phase == MatchmakingPhases.Found);
    });

    [Fact]
    public Task IncompatibleTickets_StayInTheQueue() => WithHarness(async h =>
    {
        await h.Service.EnqueueAsync(await h.UserAsync("A"), Prefs(role: "INVESTIGATOR"));
        await h.Service.EnqueueAsync(await h.UserAsync("B"), Prefs(role: "INVESTIGATOR"));
        await h.Service.EnqueueAsync(await h.UserAsync("C"), Prefs(language: "en"));
        await h.Service.EnqueueAsync(await h.UserAsync("D"), Prefs(mode: "RANKED"));
        await h.Service.EnqueueAsync(await h.UserAsync("E"), Prefs(length: "MEDIUM"));
        await h.Service.RunMaintenanceAsync();

        Assert.Equal(0, await h.Db.MatchProposals.CountDocumentsAsync(m => m.Status == MatchStatuses.Pending));
        Assert.Equal(5, await h.Db.MatchTickets.CountDocumentsAsync(t => t.Status == MatchTicketStatuses.Searching));
    });

    [Fact]
    public Task ConcurrentEnqueuesAndSweeps_NeverPutATicketInTwoMatches() => WithHarness(async h =>
    {
        const int players = 24;
        var users = new List<CurrentUser>();
        for (var i = 0; i < players; i++) users.Add(await h.UserAsync($"Player {i:00}"));

        var work = users.Select((user, index) => Task.Run(() => h.Service.EnqueueAsync(user,
                Prefs(role: (index % 3) switch { 0 => "INVESTIGATOR", 1 => "INTERROGATOR", _ => "ANY" }))))
            .Cast<Task>()
            .Concat(Enumerable.Range(0, 6).Select(_ => Task.Run(() => h.Service.RunMaintenanceAsync())))
            .ToList();
        await Task.WhenAll(work);
        // A few more sweeps pair anything that lost a race.
        for (var pass = 0; pass < 4; pass++) await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => h.Service.RunMaintenanceAsync()));

        var tickets = await h.Db.MatchTickets.Find(_ => true).ToListAsync();
        var pending = await h.Db.MatchProposals.Find(m => m.Status == MatchStatuses.Pending).ToListAsync();
        Assert.Equal(players, tickets.Count);
        Assert.Equal(0, await h.Db.MatchProposals.CountDocumentsAsync(m => m.Status == MatchStatuses.Forming));
        Assert.NotEmpty(pending);
        var seen = new HashSet<string>();
        foreach (var match in pending)
        {
            Assert.Equal(2, match.Players.Count);
            Assert.NotEqual(match.Players[0].UserId, match.Players[1].UserId);
            Assert.NotEqual(match.Players[0].Role, match.Players[1].Role);
            foreach (var player in match.Players)
            {
                Assert.True(seen.Add(player.TicketId), $"ticket {player.TicketId} is in two matches");
                var ticket = Assert.Single(tickets, t => t.Id == player.TicketId);
                Assert.Equal(MatchTicketStatuses.Matched, ticket.Status);
                Assert.Equal(match.Id, ticket.MatchId);
                if (ticket.PreferredRole != MatchRolePreferences.Any) Assert.Equal(ticket.PreferredRole, player.Role);
            }
        }
        // Whoever is left must be unpairable with everyone else left (greedy pairing is maximal).
        var left = tickets.Where(t => !seen.Contains(t.Id)).ToList();
        Assert.All(left, ticket => Assert.Equal(MatchTicketStatuses.Searching, ticket.Status));
        foreach (var x in left)
        foreach (var y in left)
            Assert.False(MatchmakingRules.AreCompatible(x, y), $"{x.PreferredRole} and {y.PreferredRole} were left unpaired");
        Assert.Equal(players, seen.Count + left.Count);
    });

    [Fact]
    public Task BothAccepting_CreatesExactlyOnePrivateRoomWithBothPlayersAndRoles() => WithHarness(async h =>
    {
        var a = await h.UserAsync("Host");
        var b = await h.UserAsync("Guest");
        await h.Service.EnqueueAsync(a, Prefs(role: "INVESTIGATOR"));
        h.Advance(TimeSpan.FromSeconds(3));
        var found = await h.Service.EnqueueAsync(b, Prefs());
        var matchId = found.Match!.MatchId;

        // Both accept at the same moment, twice each.
        var results = await Task.WhenAll(
            Task.Run(() => h.Service.AcceptAsync(a, matchId)), Task.Run(() => h.Service.AcceptAsync(b, matchId)),
            Task.Run(() => h.Service.AcceptAsync(a, matchId)), Task.Run(() => h.Service.AcceptAsync(b, matchId)));
        Assert.All(results, status => Assert.True(status.Phase is MatchmakingPhases.Accepted or MatchmakingPhases.Ready));

        var rooms = await h.Db.Rooms.Find(r => r.MatchId == matchId).ToListAsync();
        var room = Assert.Single(rooms);
        Assert.Equal(RoomVisibility.Private, room.Visibility);
        Assert.Equal(RoomStatus.Waiting, room.Status);
        Assert.Equal(a.Id, room.HostUserId); // waited longest
        Assert.Equal(2, room.Players.Count);
        Assert.Equal(PlayerRole.Investigator, room.Players.Single(p => p.UserId == a.Id).Role);
        Assert.Equal(PlayerRole.Interrogator, room.Players.Single(p => p.UserId == b.Id).Role);
        Assert.All(room.Players, p => Assert.False(p.IsReady));
        Assert.Equal("vi-short", room.CaseId);

        foreach (var user in new[] { a, b })
        {
            var status = await h.Service.GetStatusAsync(user.Id);
            Assert.Equal(MatchmakingPhases.Ready, status.Phase);
            Assert.Equal(room.Id, status.RoomId);
        }
        Assert.Equal(MatchStatuses.RoomReady, (await h.Db.MatchProposals.Find(m => m.Id == matchId).SingleAsync()).Status);
        Assert.Equal(0, await h.Db.MatchTickets.CountDocumentsAsync(t => t.IsActive));
        // A finished ticket does not block searching again.
        Assert.Equal(MatchmakingPhases.Searching, (await h.Service.EnqueueAsync(a, Prefs())).Phase);
    });

    [Fact]
    public Task Declining_RequeuesThePartnerWithTheirPlaceAndRemovesTheDecliner() => WithHarness(async h =>
    {
        var a = await h.UserAsync("Patient");
        var b = await h.UserAsync("Picky");
        var queued = await h.Service.EnqueueAsync(a, Prefs());
        h.Advance(TimeSpan.FromSeconds(4));
        var found = await h.Service.EnqueueAsync(b, Prefs());
        await h.Service.AcceptAsync(a, found.Match!.MatchId);

        var declined = await h.Service.DeclineAsync(b, found.Match.MatchId);
        Assert.Equal(MatchmakingPhases.Ended, declined.Phase);
        Assert.Equal(MatchEndReasons.DeclinedByYou, declined.EndReason);

        var partner = await h.Service.GetStatusAsync(a.Id);
        Assert.Equal(MatchmakingPhases.Searching, partner.Phase);
        Assert.Equal(MatchEndReasons.DeclinedByPartner, partner.EndReason);
        Assert.Equal(queued.SearchStartedAt, partner.SearchStartedAt);
        Assert.Contains(h.Pushes, push => push.UserId == a.Id && push.Status.Phase == MatchmakingPhases.Searching
            && push.Status.EndReason == MatchEndReasons.DeclinedByPartner);

        // Accepting a declined match is refused; the requeued player is matched with the next one.
        var refused = await Assert.ThrowsAsync<ApiException>(() => h.Service.AcceptAsync(a, found.Match.MatchId));
        Assert.Equal(409, refused.StatusCode);
        var c = await h.UserAsync("Next");
        var next = await h.Service.EnqueueAsync(c, Prefs());
        Assert.Equal(MatchmakingPhases.Found, next.Phase);
        Assert.Equal("Patient", next.Match!.PartnerUsername);
    });

    [Fact]
    public Task Timeout_RequeuesWhoeverAcceptedAndExpiresWhoeverDidNot() => WithHarness(async h =>
    {
        var a = await h.UserAsync("Quick");
        var b = await h.UserAsync("Away");
        await h.Service.EnqueueAsync(a, Prefs());
        var found = await h.Service.EnqueueAsync(b, Prefs());
        var accepted = await h.Service.AcceptAsync(a, found.Match!.MatchId);
        Assert.Equal(MatchmakingPhases.Accepted, accepted.Phase);
        Assert.True(accepted.Match!.YouAccepted);
        Assert.False(accepted.Match.PartnerAccepted);

        h.Advance(MatchmakingRules.AcceptWindow - TimeSpan.FromSeconds(1));
        await h.Service.RunMaintenanceAsync();
        Assert.Equal(MatchmakingPhases.Found, (await h.Service.GetStatusAsync(b.Id)).Phase);

        h.Advance(TimeSpan.FromSeconds(1));
        await h.Service.RunMaintenanceAsync();
        var quick = await h.Service.GetStatusAsync(a.Id);
        Assert.Equal(MatchmakingPhases.Searching, quick.Phase);
        Assert.Equal(MatchEndReasons.PartnerTimeout, quick.EndReason);
        var away = await h.Service.GetStatusAsync(b.Id);
        Assert.Equal(MatchmakingPhases.Ended, away.Phase);
        Assert.Equal(MatchEndReasons.Timeout, away.EndReason);
        var late = await Assert.ThrowsAsync<ApiException>(() => h.Service.AcceptAsync(b, found.Match.MatchId));
        Assert.Equal(409, late.StatusCode);
        Assert.Equal(0, await h.Db.Rooms.CountDocumentsAsync(_ => true));
    });

    [Fact]
    public Task PollingAlone_ExpiresAnUnansweredMatchWithoutTheWorker() => WithHarness(async h =>
    {
        var a = await h.UserAsync("A");
        var b = await h.UserAsync("B");
        await h.Service.EnqueueAsync(a, Prefs());
        await h.Service.EnqueueAsync(b, Prefs());
        h.Advance(MatchmakingRules.AcceptWindow + TimeSpan.FromSeconds(1));
        var status = await h.Service.GetStatusAsync(a.Id);
        Assert.Equal(MatchmakingPhases.Ended, status.Phase);
        Assert.Equal(MatchEndReasons.Timeout, status.EndReason);
    });

    [Fact]
    public Task LateConfirmation_IsNotExpiredOnceBothAccepted() => WithHarness(async h =>
    {
        var a = await h.UserAsync("A");
        var b = await h.UserAsync("B");
        await h.Service.EnqueueAsync(a, Prefs());
        var found = await h.Service.EnqueueAsync(b, Prefs());
        // Simulate a crash between the second acceptance and the confirmation.
        await h.Db.MatchProposals.UpdateOneAsync(m => m.Id == found.Match!.MatchId,
            Builders<MatchProposal>.Update.Set("players.0.accepted", true).Set("players.1.accepted", true));
        h.Advance(TimeSpan.FromMinutes(1));
        await h.Service.RunMaintenanceAsync();
        Assert.Equal(MatchmakingPhases.Ready, (await h.Service.GetStatusAsync(a.Id)).Phase);
        Assert.Equal(1, await h.Db.Rooms.CountDocumentsAsync(r => r.MatchId == found.Match!.MatchId));
    });

    [Fact]
    public Task SilentSearchingTickets_LeaveTheQueue() => WithHarness(async h =>
    {
        var a = await h.UserAsync("Gone");
        await h.Service.EnqueueAsync(a, Prefs());
        h.Advance(MatchmakingRules.TicketHeartbeatTimeout - TimeSpan.FromSeconds(1));
        await h.Service.RunMaintenanceAsync();
        Assert.Equal(1, await h.Db.MatchTickets.CountDocumentsAsync(t => t.Status == MatchTicketStatuses.Searching));
        await h.Service.GetStatusAsync(a.Id); // heartbeat
        h.Advance(MatchmakingRules.TicketHeartbeatTimeout - TimeSpan.FromSeconds(1));
        await h.Service.RunMaintenanceAsync();
        Assert.Equal(1, await h.Db.MatchTickets.CountDocumentsAsync(t => t.Status == MatchTicketStatuses.Searching));
        h.Advance(TimeSpan.FromSeconds(2));
        await h.Service.RunMaintenanceAsync();
        var ticket = await h.Db.MatchTickets.Find(t => t.UserId == a.Id).SingleAsync();
        Assert.Equal(MatchTicketStatuses.Expired, ticket.Status);
        Assert.Equal(MatchEndReasons.Stale, ticket.EndReason);
        Assert.False(ticket.IsActive);
    });

    [Fact]
    public Task Enqueue_ValidatesInputCasesVerificationAndPendingMatches() => WithHarness(async h =>
    {
        var a = await h.UserAsync("A");
        var bad = await Assert.ThrowsAsync<ApiException>(() => h.Service.EnqueueAsync(a, Prefs(mode: "CASUAL")));
        Assert.Equal(400, bad.StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => h.Service.EnqueueAsync(a, Prefs(role: "JUDGE")))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => h.Service.EnqueueAsync(a, Prefs(length: "EPIC")))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => h.Service.EnqueueAsync(a, Prefs(language: "fr")))).StatusCode);
        var noCase = await Assert.ThrowsAsync<ApiException>(() => h.Service.EnqueueAsync(a, Prefs(length: "LONG")));
        Assert.Equal(422, noCase.StatusCode);

        var unverified = await h.UserAsync("Unverified", verified: false);
        Assert.Equal(403, (await Assert.ThrowsAsync<ApiException>(() => h.Service.EnqueueAsync(unverified, Prefs()))).StatusCode);

        // Re-enqueueing while searching replaces the ticket; while matched it is refused.
        await h.Service.EnqueueAsync(a, Prefs());
        await h.Service.EnqueueAsync(a, Prefs(role: "INVESTIGATOR"));
        Assert.Equal(1, await h.Db.MatchTickets.CountDocumentsAsync(t => t.UserId == a.Id && t.IsActive));
        var b = await h.UserAsync("B");
        await h.Service.EnqueueAsync(b, Prefs());
        var pending = await Assert.ThrowsAsync<ApiException>(() => h.Service.EnqueueAsync(a, Prefs()));
        Assert.Equal(409, pending.StatusCode);
        Assert.Equal(1, await h.Db.MatchTickets.CountDocumentsAsync(t => t.UserId == a.Id && t.IsActive));
    });

    [Fact]
    public Task Outsiders_CannotActOnSomeoneElsesMatch_AndCancelDeclines() => WithHarness(async h =>
    {
        var a = await h.UserAsync("A");
        var b = await h.UserAsync("B");
        var outsider = await h.UserAsync("Outsider");
        await h.Service.EnqueueAsync(a, Prefs());
        var found = await h.Service.EnqueueAsync(b, Prefs());
        Assert.Equal(403, (await Assert.ThrowsAsync<ApiException>(() => h.Service.AcceptAsync(outsider, found.Match!.MatchId))).StatusCode);
        Assert.Equal(403, (await Assert.ThrowsAsync<ApiException>(() => h.Service.DeclineAsync(outsider, found.Match!.MatchId))).StatusCode);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => h.Service.AcceptAsync(a, "not-an-id"))).StatusCode);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => h.Service.AcceptAsync(a, ObjectId.GenerateNewId().ToString()))).StatusCode);

        // Cancelling during FOUND declines the match: B leaves, A goes back to searching.
        var cancelled = await h.Service.CancelAsync(b);
        Assert.Equal(MatchmakingPhases.Ended, cancelled.Phase);
        Assert.Equal(MatchmakingPhases.Searching, (await h.Service.GetStatusAsync(a.Id)).Phase);
        var idle = await h.Service.CancelAsync(a);
        Assert.Equal(MatchmakingPhases.Ended, idle.Phase);
        Assert.Equal(MatchEndReasons.Cancelled, idle.EndReason);
        Assert.Equal(0, await h.Db.MatchTickets.CountDocumentsAsync(t => t.IsActive));
    });

    [Fact]
    public Task UnpublishedCase_FailsTheMatchAndRequeuesBoth() => WithHarness(async h =>
    {
        var a = await h.UserAsync("A");
        var b = await h.UserAsync("B");
        await h.Service.EnqueueAsync(a, Prefs());
        var found = await h.Service.EnqueueAsync(b, Prefs());
        h.Cases.Unpublished.Add("vi-short");
        await h.Service.AcceptAsync(a, found.Match!.MatchId);
        await h.Service.AcceptAsync(b, found.Match.MatchId);
        Assert.Equal(MatchStatuses.Failed, (await h.Db.MatchProposals.Find(m => m.Id == found.Match.MatchId).SingleAsync()).Status);
        var status = await h.Service.GetStatusAsync(a.Id);
        Assert.Equal(MatchEndReasons.RoomFailed, status.EndReason);
        Assert.Equal(0, await h.Db.Rooms.CountDocumentsAsync(_ => true));
    });

    [Fact]
    public Task PublicListing_ShowsOnlyPublicWaitingRoomsWithASeatAndPublicGamesInProgress() => WithHarness(async h =>
    {
        var rooms = new RoomService(h.Db, h.Cases, new SilentGameNotifier());
        var host = await h.UserAsync("Chủ phòng");
        var guest = await h.UserAsync("Khách");

        var open = await rooms.CreateAsync(host, "vi-short", "public");
        var hidden = await rooms.CreateAsync(host, "vi-short");
        var english = await rooms.CreateAsync(host, "en-short", RoomVisibility.Public);
        var full = await rooms.CreateAsync(host, "vi-short", RoomVisibility.Public);
        await rooms.JoinAsync(guest, full.RoomCode);
        var playing = await rooms.CreateAsync(host, "vi-short", RoomVisibility.Public);
        await h.Db.Rooms.UpdateOneAsync(r => r.Id == playing.RoomId, Builders<GameRoom>.Update
            .Set(r => r.Status, RoomStatus.InProgress)
            .Push(r => r.Players, new RoomPlayer { UserId = guest.Id, Username = guest.FullName, IsConnected = true }));
        var ghost = await rooms.CreateAsync(host, "vi-short", RoomVisibility.Public);
        await h.Db.Rooms.UpdateOneAsync(r => r.Id == ghost.RoomId, Builders<GameRoom>.Update
            .Set(r => r.CreatedAt, DateTime.UtcNow - PublicRoomRules.NewRoomGrace - TimeSpan.FromMinutes(1)));

        Assert.Equal(RoomVisibility.Public, open.Visibility);
        Assert.Equal(RoomVisibility.Private, hidden.Visibility);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => rooms.CreateAsync(host, "vi-short", "friends"))).StatusCode);

        var all = await rooms.ListPublicAsync(guest.Id, new PublicRoomQuery());
        Assert.Equal(new[] { open.RoomCode, english.RoomCode, playing.RoomCode }.Order(), all.Select(r => r.RoomCode).Order());
        var row = all.Single(r => r.RoomCode == open.RoomCode);
        Assert.Equal("Vụ ngắn", row.CaseTitle);
        Assert.Equal(15, row.EstimatedMinutes);
        Assert.Equal("vi", row.Language);
        Assert.Equal("Chủ phòng", row.HostUsername);
        Assert.Equal(1, row.PlayerCount);
        Assert.True(row.IsJoinable);
        Assert.False(row.IsMember);
        var inProgress = all.Single(r => r.RoomCode == playing.RoomCode);
        Assert.Equal(RoomStatus.InProgress, inProgress.Status);
        Assert.False(inProgress.IsJoinable);
        Assert.True(inProgress.IsMember);
        Assert.Equal(open.RoomCode, all[0].RoomCode == english.RoomCode ? all[1].RoomCode : all[0].RoomCode);

        Assert.Equal(new[] { english.RoomCode }, (await rooms.ListPublicAsync(guest.Id, new PublicRoomQuery { Language = "en" })).Select(r => r.RoomCode));
        Assert.DoesNotContain(await rooms.ListPublicAsync(guest.Id, new PublicRoomQuery { OpenOnly = true }), r => r.RoomCode == playing.RoomCode);
        Assert.Equal(new[] { open.RoomCode }, (await rooms.ListPublicAsync(guest.Id, new PublicRoomQuery { Q = open.RoomCode.ToLowerInvariant() })).Select(r => r.RoomCode));
        Assert.Equal(3, (await rooms.ListPublicAsync(guest.Id, new PublicRoomQuery { Q = "chu phong" })).Count);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => rooms.ListPublicAsync(guest.Id, new PublicRoomQuery { Language = "de" }))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => rooms.ListPublicAsync(guest.Id, new PublicRoomQuery { Q = new string('x', 65) }))).StatusCode);

        // The listing never leaks gameplay state, and a code-joined public room behaves like any other.
        var json = JsonSerializer.Serialize(all, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.DoesNotContain("gameplayState", json);
        var joined = await rooms.JoinAsync(guest, open.RoomCode);
        Assert.Equal(2, joined.Players.Count);
        Assert.DoesNotContain(await rooms.ListPublicAsync(guest.Id, new PublicRoomQuery()), r => r.RoomCode == open.RoomCode);
        Assert.Equal(1, (await rooms.GetMineAsync(host.Id)).Count(r => r.RoomCode == hidden.RoomCode && r.Visibility == RoomVisibility.Private));
    });

    /* ------------------------------------------------------------------ harness */

    private sealed class Harness
    {
        public required MongoDbContext Db { get; init; }
        public required MatchmakingService Service { get; init; }
        public required StubCases Cases { get; init; }
        public required ManualTime Time { get; init; }
        public required ConcurrentQueue<(string UserId, MatchmakingStatusResponse Status)> Pushes { get; init; }
        public DateTime Now => Time.GetUtcNow().UtcDateTime;
        public void Advance(TimeSpan by) => Time.Advance(by);

        public async Task<CurrentUser> UserAsync(string name, bool verified = true)
        {
            var user = new User
            {
                Id = ObjectId.GenerateNewId().ToString(), FullName = name, Email = $"{Guid.NewGuid():N}@tests.invalid",
                IsEmailVerified = verified, Role = UserRole.Player
            };
            await Db.Users.InsertOneAsync(user);
            return new CurrentUser(user.Id, name, UserRole.Player);
        }
    }

    private sealed class ManualTime(DateTime start) : TimeProvider
    {
        private long _ticks = start.Ticks;
        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref _ticks), TimeSpan.Zero);
        public void Advance(TimeSpan by) => Interlocked.Add(ref _ticks, by.Ticks);
    }

    private sealed class RecordingNotifier(ConcurrentQueue<(string UserId, MatchmakingStatusResponse Status)> pushes) : IMatchmakingNotifier
    {
        public Task StatusChanged(string userId, MatchmakingStatusResponse status)
        {
            pushes.Enqueue((userId, status));
            return Task.CompletedTask;
        }
    }

    private sealed class StubCases : ICaseService
    {
        public HashSet<string> Unpublished { get; } = new();

        private static readonly (string Id, string Title, string Language, int Minutes)[] Catalogue =
        [
            ("vi-short", "Vụ ngắn", "vi", 15),
            ("vi-medium", "Vụ vừa", "vi", 35),
            ("en-short", "Short case", "en", 10)
        ];

        public Task<List<CaseSummaryResponse>> GetPublishedAsync() => Task.FromResult(Catalogue
            .Where(c => !Unpublished.Contains(c.Id))
            .Select(c => new CaseSummaryResponse
            {
                CaseId = c.Id, Title = c.Title, Language = c.Language, EstimatedMinutes = c.Minutes,
                Status = CaseStatus.Published, StageCount = 1
            }).ToList());

        public Task<GameCase> GetCaseAsync(string caseId)
        {
            var entry = Catalogue.FirstOrDefault(c => c.Id == caseId);
            if (entry.Id is null) throw ApiException.NotFound("Case not found.");
            return Task.FromResult(new GameCase
            {
                CaseId = entry.Id, Title = entry.Title, Language = entry.Language, EstimatedMinutes = entry.Minutes,
                Status = Unpublished.Contains(caseId) ? CaseStatus.Archived : CaseStatus.Published,
                Stages = [new CaseStage { StageId = "s1", Order = 1, Scenes = [new CaseScene { SceneId = "scene-1" }] }]
            });
        }

        public Task<GameCase?> FindCaseAsync(string caseId) => throw new NotSupportedException();
        public Task<CasePublicDetailResponse> GetPublicDetailAsync(string caseId) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> GetAllForAdminAsync() => throw new NotSupportedException();
        public CaseValidationResponse ValidateJson(JsonElement caseJson) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> ImportJsonAsync(JsonElement caseJson, bool overwrite, bool preserveServerMetadata = false) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> PublishAsync(string caseId) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> UnpublishAsync(string caseId) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> SeedSampleAsync(bool publish) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedDemoAsync() => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedCrackDemoAsync() => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedPointClickDemoAsync() => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedPixelDemoAsync() => throw new NotSupportedException();
        public GameCase ParseCase(JsonElement caseJson) => throw new NotSupportedException();
        public GameCase ParseCase(string caseJson) => throw new NotSupportedException();
    }

    private sealed class SilentGameNotifier : IGameNotifier
    {
        public Task PlayerJoined(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task PlayerLeft(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task RolesUpdated(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task ReadyUpdated(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task GameStarted(string roomId, RoomResponse room) => Task.CompletedTask;
        public Task GameStateUpdated(string roomId, long version) => Task.CompletedTask;
        public Task ItemFound(string roomId, string itemId, string userId, long version) => Task.CompletedTask;
        public Task ClueUnlocked(string roomId, string clueId, string? sourceId, string userId, long version) => Task.CompletedTask;
        public Task DialogueAnswered(string roomId, string dialogueId, string userId, long version) => Task.CompletedTask;
        public Task EvidencePresented(string roomId, string dialogueId, string evidenceId, string userId, long version) => Task.CompletedTask;
        public Task InvestigationUpdate(string roomId, SirLocked.Api.DTOs.Investigation.InvestigationUpdateDto update) => Task.CompletedTask;
        public Task SceneChanged(string roomId, string previousSceneId, string currentSceneId, string userId, long version) => Task.CompletedTask;
        public Task StageChanged(string roomId, string previousStageId, string currentStageId, string previousSceneId, string currentSceneId, bool isFinalStageCompleted, string userId, long version) => Task.CompletedTask;
        public Task GameCompleted(string roomId, SirLocked.Api.DTOs.Submission.GameResultResponse result) => Task.CompletedTask;
        public Task SystemMessage(string roomId, string message) => Task.CompletedTask;
        public Task PlayerEntrance(string roomId, SirLocked.Api.DTOs.Market.PlayerEntranceDto entrance) => Task.CompletedTask;
    }

    private static async Task WithHarness(Func<Harness, Task> test)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase))
            return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        EnsureLoopbackTestDatabase(settings);
        var db = new MongoDbContext(Options.Create(settings));
        try
        {
            await db.PingAsync();
            await db.EnsureIndexesAsync();
            var time = new ManualTime(Start);
            var cases = new StubCases();
            var pushes = new ConcurrentQueue<(string UserId, MatchmakingStatusResponse Status)>();
            await test(new Harness
            {
                Db = db,
                Cases = cases,
                Time = time,
                Pushes = pushes,
                Service = new MatchmakingService(db, cases, new RecordingNotifier(pushes), time,
                    NullLogger<MatchmakingService>.Instance, new Random(7))
            });
        }
        finally
        {
            EnsureLoopbackTestDatabase(settings);
            await new MongoClient(settings.ConnectionString).DropDatabaseAsync(settings.DatabaseName);
        }
    }

    private static void EnsureLoopbackTestDatabase(MongoDbSettings settings)
    {
        if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal))
            throw new InvalidOperationException("Test database must start with 'sirlocked_it_'.");
        var servers = new MongoUrl(settings.ConnectionString).Servers.ToList();
        if (servers.Count == 0 || servers.Any(server => !(string.Equals(server.Host, "localhost", StringComparison.OrdinalIgnoreCase)
                || (IPAddress.TryParse(server.Host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address)))))
            throw new InvalidOperationException("Integration tests require a loopback-only MongoDB connection.");
    }
}
