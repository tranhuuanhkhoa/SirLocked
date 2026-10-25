using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class MatchmakingRulesTests
{
    private const string Inv = PlayerRole.Investigator;
    private const string Int = PlayerRole.Interrogator;
    private const string Any = MatchRolePreferences.Any;
    private static readonly DateTime Now = new(2026, 10, 25, 12, 0, 0, DateTimeKind.Utc);

    private static MatchTicket Ticket(string id, string user, string role = Any, string mode = MatchModes.Quick,
        string language = CaseLanguages.Vietnamese, string length = MatchCaseLengths.Short) => new()
    {
        Id = id, UserId = user, Username = user, PreferredRole = role, Mode = mode, Language = language,
        CaseLength = length, Status = MatchTicketStatuses.Searching, SearchStartedAt = Now, LastSeenAt = Now
    };

    [Fact]
    public void LengthBucket_UsesTheDesignBoundaries()
    {
        Assert.Equal(MatchCaseLengths.Short, MatchmakingRules.LengthBucket(1));
        Assert.Equal(MatchCaseLengths.Short, MatchmakingRules.LengthBucket(10));
        Assert.Equal(MatchCaseLengths.Short, MatchmakingRules.LengthBucket(20));
        Assert.Equal(MatchCaseLengths.Medium, MatchmakingRules.LengthBucket(21));
        Assert.Equal(MatchCaseLengths.Medium, MatchmakingRules.LengthBucket(35));
        Assert.Equal(MatchCaseLengths.Medium, MatchmakingRules.LengthBucket(45));
        Assert.Equal(MatchCaseLengths.Long, MatchmakingRules.LengthBucket(46));
        Assert.Equal(MatchCaseLengths.Long, MatchmakingRules.LengthBucket(80));
        // A case without an estimate is treated as a middle-length case, never as "short".
        Assert.Equal(MatchCaseLengths.Medium, MatchmakingRules.LengthBucket(0));
        Assert.Equal(MatchCaseLengths.Medium, MatchmakingRules.LengthBucket(-5));
    }

    [Fact]
    public void AssignRoles_HonorsEveryExplicitPreference()
    {
        Assert.Equal((Inv, Int), MatchmakingRules.AssignRoles(Inv, Int, coinFlip: true));
        Assert.Equal((Inv, Int), MatchmakingRules.AssignRoles(Inv, Int, coinFlip: false));
        Assert.Equal((Int, Inv), MatchmakingRules.AssignRoles(Int, Inv, coinFlip: true));
        Assert.Equal((Inv, Int), MatchmakingRules.AssignRoles(Inv, Any, coinFlip: false));
        Assert.Equal((Int, Inv), MatchmakingRules.AssignRoles(Int, Any, coinFlip: true));
        Assert.Equal((Int, Inv), MatchmakingRules.AssignRoles(Any, Inv, coinFlip: true));
        Assert.Equal((Inv, Int), MatchmakingRules.AssignRoles(Any, Int, coinFlip: false));
    }

    [Fact]
    public void AssignRoles_SplitsTwoAnyPlayersByTheCoinAndAlwaysGivesDifferentRoles()
    {
        Assert.Equal((Inv, Int), MatchmakingRules.AssignRoles(Any, Any, coinFlip: true));
        Assert.Equal((Int, Inv), MatchmakingRules.AssignRoles(Any, Any, coinFlip: false));
        foreach (var a in MatchRolePreferences.All)
        foreach (var b in MatchRolePreferences.All)
        {
            if (!MatchmakingRules.CompatiblePartnerRoles(a).Contains(b)) continue;
            foreach (var coin in new[] { true, false })
            {
                var (roleA, roleB) = MatchmakingRules.AssignRoles(a, b, coin);
                Assert.True(PlayerRole.IsValid(roleA) && PlayerRole.IsValid(roleB));
                Assert.NotEqual(roleA, roleB);
                if (a != Any) Assert.Equal(a, roleA);
                if (b != Any) Assert.Equal(b, roleB);
            }
        }
    }

    [Fact]
    public void AssignRoles_RefusesTwoPlayersWhoWantTheSameRole()
    {
        Assert.Throws<InvalidOperationException>(() => MatchmakingRules.AssignRoles(Inv, Inv, true));
        Assert.Throws<InvalidOperationException>(() => MatchmakingRules.AssignRoles(Int, Int, false));
    }

    [Fact]
    public void AreCompatible_RequiresSameModeLanguageLengthAndDistinctRoles()
    {
        var a = Ticket("a", "u1", Inv);
        Assert.True(MatchmakingRules.AreCompatible(a, Ticket("b", "u2", Int)));
        Assert.True(MatchmakingRules.AreCompatible(a, Ticket("b", "u2", Any)));
        Assert.False(MatchmakingRules.AreCompatible(a, Ticket("b", "u2", Inv)));
        Assert.False(MatchmakingRules.AreCompatible(a, Ticket("b", "u2", Int, mode: MatchModes.Ranked)));
        Assert.False(MatchmakingRules.AreCompatible(a, Ticket("b", "u2", Int, language: CaseLanguages.English)));
        Assert.False(MatchmakingRules.AreCompatible(a, Ticket("b", "u2", Int, length: MatchCaseLengths.Long)));
        // Never with yourself, never with the same ticket, never with a ticket that left the queue.
        Assert.False(MatchmakingRules.AreCompatible(a, Ticket("b", "u1", Int)));
        Assert.False(MatchmakingRules.AreCompatible(a, a));
        var taken = Ticket("b", "u2", Int);
        taken.Status = MatchTicketStatuses.Matched;
        Assert.False(MatchmakingRules.AreCompatible(a, taken));
        // Ranked pairs with ranked.
        Assert.True(MatchmakingRules.AreCompatible(Ticket("r1", "u1", mode: MatchModes.Ranked), Ticket("r2", "u2", mode: MatchModes.Ranked)));
    }

    [Fact]
    public void CompatiblePartnerRoles_IsSymmetric()
    {
        foreach (var a in MatchRolePreferences.All)
        foreach (var b in MatchRolePreferences.All)
        {
            Assert.Equal(MatchmakingRules.CompatiblePartnerRoles(a).Contains(b), MatchmakingRules.CompatiblePartnerRoles(b).Contains(a));
        }
        Assert.Equal(new[] { Int, Any }, MatchmakingRules.CompatiblePartnerRoles(Inv));
        Assert.Equal(new[] { Inv, Any }, MatchmakingRules.CompatiblePartnerRoles(Int));
        Assert.Equal(3, MatchmakingRules.CompatiblePartnerRoles(Any).Count);
    }

    [Fact]
    public void ClaimOrder_IsTheSameFromEitherSide()
    {
        var a = Ticket("650000000000000000000001", "u1");
        var b = Ticket("650000000000000000000002", "u2");
        Assert.Equal(MatchmakingRules.ClaimOrder(a, b), MatchmakingRules.ClaimOrder(b, a));
        Assert.Equal("650000000000000000000001", MatchmakingRules.ClaimOrder(b, a).First.Id);
    }

    [Fact]
    public void Normalizers_DefaultBlankValuesAndRejectUnknownOnes()
    {
        Assert.True(MatchmakingRules.TryNormalizeMode(null, out var mode));
        Assert.Equal(MatchModes.Quick, mode);
        Assert.True(MatchmakingRules.TryNormalizeMode(" ranked ", out mode));
        Assert.Equal(MatchModes.Ranked, mode);
        Assert.False(MatchmakingRules.TryNormalizeMode("casual", out _));

        Assert.True(MatchmakingRules.TryNormalizeRole("", out var role));
        Assert.Equal(Any, role);
        Assert.True(MatchmakingRules.TryNormalizeRole("interrogator", out role));
        Assert.Equal(Int, role);
        Assert.False(MatchmakingRules.TryNormalizeRole("DETECTIVE", out _));

        Assert.True(MatchmakingRules.TryNormalizeLength("long", out var length));
        Assert.Equal(MatchCaseLengths.Long, length);
        Assert.False(MatchmakingRules.TryNormalizeLength("EPIC", out _));

        Assert.True(MatchmakingRules.TryNormalizeLanguage("EN", out var language));
        Assert.Equal(CaseLanguages.English, language);
        Assert.True(MatchmakingRules.TryNormalizeLanguage(null, out language));
        Assert.Equal(CaseLanguages.Vietnamese, language);
        Assert.False(MatchmakingRules.TryNormalizeLanguage("fr", out _));
    }

    [Fact]
    public void FittingCases_KeepsPublishedPlayableCasesOfTheChosenLanguageAndLength()
    {
        var cases = new List<CaseSummaryResponse>
        {
            new() { CaseId = "vi-short", Language = "vi", EstimatedMinutes = 20, Status = CaseStatus.Published, StageCount = 1 },
            new() { CaseId = "vi-medium", Language = "vi", EstimatedMinutes = 30, Status = CaseStatus.Published, StageCount = 2 },
            new() { CaseId = "en-short", Language = "en", EstimatedMinutes = 10, Status = CaseStatus.Published, StageCount = 1 },
            new() { CaseId = "vi-short-draft", Language = "vi", EstimatedMinutes = 10, Status = CaseStatus.Draft, StageCount = 1 },
            new() { CaseId = "vi-short-empty", Language = "vi", EstimatedMinutes = 10, Status = CaseStatus.Published, StageCount = 0 },
        };
        Assert.Equal(new[] { "vi-short" }, MatchmakingRules.FittingCases(cases, "vi", MatchCaseLengths.Short).Select(c => c.CaseId));
        Assert.Equal(new[] { "vi-medium" }, MatchmakingRules.FittingCases(cases, "vi", MatchCaseLengths.Medium).Select(c => c.CaseId));
        Assert.Equal(new[] { "en-short" }, MatchmakingRules.FittingCases(cases, "en", MatchCaseLengths.Short).Select(c => c.CaseId));
        Assert.Empty(MatchmakingRules.FittingCases(cases, "en", MatchCaseLengths.Long));
    }

    [Fact]
    public void Expiry_AppliesOnlyToPendingMatchesThatAreNotFullyAccepted()
    {
        var match = new MatchProposal
        {
            Status = MatchStatuses.Pending,
            ExpiresAt = Now,
            Players = [new MatchPlayer { UserId = "u1", Accepted = true }, new MatchPlayer { UserId = "u2" }]
        };
        Assert.False(MatchmakingRules.IsPendingExpired(match, Now.AddMilliseconds(-1)));
        Assert.True(MatchmakingRules.IsPendingExpired(match, Now));
        Assert.True(MatchmakingRules.IsPendingExpired(match, Now.AddSeconds(30)));
        match.Players[1].Accepted = true;
        Assert.True(MatchmakingRules.AllAccepted(match));
        Assert.False(MatchmakingRules.IsPendingExpired(match, Now.AddSeconds(30)));
        match.Players[1].Accepted = false;
        match.Status = MatchStatuses.Declined;
        Assert.False(MatchmakingRules.IsPendingExpired(match, Now.AddSeconds(30)));
        Assert.Equal(TimeSpan.FromSeconds(15), MatchmakingRules.AcceptWindow);
    }

    [Fact]
    public void Outcomes_RequeueTheInnocentPlayerOnly()
    {
        var accepted = new MatchPlayer { UserId = "u1", Accepted = true };
        var silent = new MatchPlayer { UserId = "u2", Accepted = false };
        Assert.Equal(TicketOutcome.Requeue, MatchmakingRules.OutcomeOnExpiry(accepted));
        Assert.Equal(TicketOutcome.Expire, MatchmakingRules.OutcomeOnExpiry(silent));
        Assert.Equal(TicketOutcome.Cancel, MatchmakingRules.OutcomeOnDecline(silent, declinedByUserId: "u2"));
        Assert.Equal(TicketOutcome.Requeue, MatchmakingRules.OutcomeOnDecline(accepted, declinedByUserId: "u2"));
        // Declining after having accepted still removes the decliner.
        Assert.Equal(TicketOutcome.Cancel, MatchmakingRules.OutcomeOnDecline(accepted, declinedByUserId: "u1"));
    }

    [Fact]
    public void StaleTickets_AreSearchingTicketsWithoutARecentHeartbeat()
    {
        var ticket = Ticket("a", "u1");
        Assert.False(MatchmakingRules.IsTicketStale(ticket, Now + MatchmakingRules.TicketHeartbeatTimeout - TimeSpan.FromSeconds(1)));
        Assert.True(MatchmakingRules.IsTicketStale(ticket, Now + MatchmakingRules.TicketHeartbeatTimeout));
        ticket.Status = MatchTicketStatuses.Matched;
        Assert.False(MatchmakingRules.IsTicketStale(ticket, Now.AddHours(1)));
    }

    [Fact]
    public void PickHost_IsThePlayerWhoWaitedLongest()
    {
        var match = new MatchProposal
        {
            Players = [new MatchPlayer { UserId = "late", TicketId = "t-late" }, new MatchPlayer { UserId = "early", TicketId = "t-early" }]
        };
        var started = new Dictionary<string, DateTime> { ["t-late"] = Now, ["t-early"] = Now.AddMinutes(-2) };
        Assert.Equal("early", MatchmakingRules.PickHost(match, started).UserId);
    }

    [Fact]
    public void RoomVisibility_DefaultsToPrivateAndRejectsUnknownValues()
    {
        Assert.True(RoomVisibility.TryNormalize(null, out var visibility));
        Assert.Equal(RoomVisibility.Private, visibility);
        Assert.True(RoomVisibility.TryNormalize(" public ", out visibility));
        Assert.Equal(RoomVisibility.Public, visibility);
        Assert.True(RoomVisibility.TryNormalize("PRIVATE", out visibility));
        Assert.Equal(RoomVisibility.Private, visibility);
        Assert.False(RoomVisibility.TryNormalize("FRIENDS", out _));
        // Legacy room documents without the field read back as private.
        Assert.Equal(RoomVisibility.Private, new GameRoom().Visibility);
    }

    [Fact]
    public void PublicRoomLanguageFilter_AcceptsViEnAllOrNothing()
    {
        Assert.True(PublicRoomRules.TryParseLanguage(null, out var language));
        Assert.Null(language);
        Assert.True(PublicRoomRules.TryParseLanguage("all", out language));
        Assert.Null(language);
        Assert.True(PublicRoomRules.TryParseLanguage("VI", out language));
        Assert.Equal("vi", language);
        Assert.True(PublicRoomRules.TryParseLanguage("en", out language));
        Assert.Equal("en", language);
        Assert.False(PublicRoomRules.TryParseLanguage("jp", out _));
    }

    [Fact]
    public void PublicRoomSearch_IgnoresCaseAndVietnameseDiacritics()
    {
        var row = new PublicRoomResponse { RoomCode = "M3T7QZ", CaseTitle = "Đêm khóa sổ", HostUsername = "Thanh Tra Lê" };
        Assert.True(PublicRoomRules.MatchesSearch(row, null));
        Assert.True(PublicRoomRules.MatchesSearch(row, "  "));
        Assert.True(PublicRoomRules.MatchesSearch(row, "m3t7"));
        Assert.True(PublicRoomRules.MatchesSearch(row, "dem khoa"));
        Assert.True(PublicRoomRules.MatchesSearch(row, "ĐÊM KHÓA SỔ"));
        Assert.True(PublicRoomRules.MatchesSearch(row, "tra le"));
        Assert.False(PublicRoomRules.MatchesSearch(row, "chuyến tàu"));
    }

    [Fact]
    public void PublicRoomList_FiltersThenPutsJoinableRoomsFirst()
    {
        PublicRoomResponse Row(string code, string language, bool joinable, int minutesAgo) => new()
        {
            RoomCode = code, CaseTitle = code, Language = language, IsJoinable = joinable,
            Status = joinable ? RoomStatus.Waiting : RoomStatus.InProgress, CreatedAt = Now.AddMinutes(-minutesAgo)
        };
        var rows = new[]
        {
            Row("PLAY01", "vi", joinable: false, minutesAgo: 30),
            Row("WAIT02", "vi", joinable: true, minutesAgo: 2),
            Row("WAIT01", "vi", joinable: true, minutesAgo: 5),
            Row("PLAY02", "vi", joinable: false, minutesAgo: 1),
            Row("ENWAIT", "en", joinable: true, minutesAgo: 9),
        };
        Assert.Equal(new[] { "ENWAIT", "WAIT01", "WAIT02", "PLAY02", "PLAY01" },
            PublicRoomRules.Apply(rows, null, false, null, 50).Select(r => r.RoomCode));
        Assert.Equal(new[] { "WAIT01", "WAIT02", "PLAY02", "PLAY01" },
            PublicRoomRules.Apply(rows, "vi", false, null, 50).Select(r => r.RoomCode));
        Assert.Equal(new[] { "WAIT01", "WAIT02" },
            PublicRoomRules.Apply(rows, "vi", true, null, 50).Select(r => r.RoomCode));
        Assert.Equal(new[] { "PLAY02", "PLAY01" },
            PublicRoomRules.Apply(rows, null, false, "play", 50).Select(r => r.RoomCode));
        Assert.Single(PublicRoomRules.Apply(rows, null, false, null, 1));
    }

    [Fact]
    public void PublicRoomJoinable_OnlyWaitingRoomsWithAFreeSeat()
    {
        var room = new GameRoom { Status = RoomStatus.Waiting, Players = [new RoomPlayer { UserId = "a" }] };
        Assert.True(PublicRoomRules.IsJoinable(room));
        room.Players.Add(new RoomPlayer { UserId = "b" });
        Assert.False(PublicRoomRules.IsJoinable(room));
        room.Players.RemoveAt(1);
        room.Status = RoomStatus.InProgress;
        Assert.False(PublicRoomRules.IsJoinable(room));
    }
}
