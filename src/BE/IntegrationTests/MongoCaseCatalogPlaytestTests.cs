using System.Text.Json;
using System.Text.Json.Nodes;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// VUAN-6B part C (Bước 3 mục 5) against a real loopback MongoDB, with the production catalogue (PixelOnly): an
/// imported AI draft stays unpublished, yet an admin or its author can play it in a private room and invite one player
/// by link; nobody else gets in, and the draft reaches no public list, matchmaking or leaderboard.
/// </summary>
public sealed partial class MongoCaseCatalogTests
{
    private const string DraftCase = "case-ai-playtest-draft-vi";

    [Fact]
    public Task Playtest_AdminPlaysAnUnpublishedDraft_WithOnePlayerInvitedByLink() => WithCatalog(async c =>
    {
        var vip = await VipAsync(c, "VIP tác giả");
        var draftId = await ImportedDraftAsync(c, DraftCase, vip);
        var admin = new CurrentUser(NewId(), "Yen", UserRole.Admin);
        var friend = await c.UserAsync("Bạn được mời");
        var stranger = await c.UserAsync("Người lạ");
        var rooms = c.PixelOnly.Rooms;

        var lobby = await rooms.CreatePlaytestAsync(admin, draftId);
        Assert.Equal(DraftCase, lobby.CaseId);
        Assert.Equal(RoomVisibility.Private, lobby.Visibility);
        Assert.Equal(draftId, lobby.Playtest!.DraftId);
        var token = Assert.IsType<string>(lobby.Playtest.InviteToken);
        Assert.False(lobby.Playtest.InviteClaimed);
        // Pressing "Chơi thử" again reopens the same room instead of piling up new ones.
        Assert.Equal(lobby.RoomId, (await rooms.CreatePlaytestAsync(admin, draftId)).RoomId);

        // The room code (the ordinary invite link) is not enough, nor is a wrong secret.
        await AssertForbiddenAsync(() => rooms.JoinAsync(stranger, lobby.RoomCode));
        await AssertForbiddenAsync(() => rooms.JoinAsync(stranger, lobby.RoomCode, token[..^1] + (token[^1] == 'A' ? 'B' : 'A')));
        // The invite link lets the friend in and is then bound to them.
        var joined = await rooms.JoinAsync(friend, lobby.RoomCode, token);
        Assert.Equal(2, joined.Players.Count);
        Assert.True(joined.Playtest!.InviteClaimed);
        Assert.Null(joined.Playtest.InviteToken);
        var stored = await c.Db.Rooms.Find(room => room.Id == lobby.RoomId).FirstAsync();
        Assert.Equal(friend.Id, stored.Playtest!.InvitedUserId);
        // Someone else holding the same link is refused for being uninvited, not merely because the room is full.
        await AssertForbiddenAsync(() => rooms.JoinAsync(stranger, lobby.RoomCode, token));
        await rooms.LeaveAsync(friend, lobby.RoomId);
        await AssertForbiddenAsync(() => rooms.JoinAsync(stranger, lobby.RoomCode, token));
        await rooms.JoinAsync(friend, lobby.RoomCode); // the invited player comes back without the link

        // A stranger cannot read the room either.
        Assert.Equal(403, (await Assert.ThrowsAsync<ApiException>(() => rooms.GetAsync(stranger.Id, lobby.RoomId))).StatusCode);

        await rooms.SelectRoleAsync(admin, lobby.RoomId, PlayerRole.Investigator);
        await rooms.SelectRoleAsync(friend, lobby.RoomId, PlayerRole.Interrogator);
        await rooms.SetReadyAsync(admin, lobby.RoomId, true);
        await rooms.SetReadyAsync(friend, lobby.RoomId, true);
        var started = await rooms.StartAsync(admin, lobby.RoomId);
        Assert.Equal(RoomStatus.InProgress, started.Status);

        // The unpublished case really plays: the game state builds for both seats and says it is a playtest.
        var room = await c.Db.Rooms.Find(candidate => candidate.Id == lobby.RoomId).FirstAsync();
        var gameCase = await c.PixelOnly.Cases.GetCaseAsync(DraftCase);
        Assert.Equal(CaseStatus.Draft, gameCase.Status);
        Assert.True(CaseCatalogRules.IsPixel(gameCase));
        var state = await new GameStateBuilder(c.Db).BuildStateAsync(room, gameCase, admin.Id);
        Assert.True(state.IsPlaytest);
        Assert.Equal(DraftCase, state.CaseId);
        Assert.True((await new GameStateBuilder(c.Db).BuildStateAsync(room, gameCase, friend.Id)).IsPlaytest);

        // Members of the playtest (only they) may read the unpublished case's detail and intro.
        Assert.True(await rooms.IsPlaytestMemberAsync(admin.Id, lobby.RoomId, DraftCase));
        Assert.True(await rooms.IsPlaytestMemberAsync(friend.Id, lobby.RoomId, DraftCase));
        Assert.False(await rooms.IsPlaytestMemberAsync(stranger.Id, lobby.RoomId, DraftCase));
        Assert.False(await rooms.IsPlaytestMemberAsync(admin.Id, lobby.RoomId, PixelIds[1]));
        Assert.False(await rooms.IsPlaytestMemberAsync(admin.Id, "not-an-id", DraftCase));
    });

    [Fact]
    public Task Playtest_AVipPlaysTheirOwnDraft_ButNeverAnotherVipsDraft() => WithCatalog(async c =>
    {
        var vipA = await VipAsync(c, "VIP A");
        var draftA = await ImportedDraftAsync(c, DraftCase, vipA);
        var vipB = await VipAsync(c, "VIP B");
        var draftB = await ImportedDraftAsync(c, DraftCase + "-b", vipB);
        var rooms = c.PixelOnly.Rooms;

        var roomA = await rooms.CreatePlaytestAsync(vipA, draftA);
        Assert.Equal(DraftCase, roomA.CaseId);
        Assert.NotNull(roomA.Playtest!.InviteToken);

        // B can neither open A's draft nor walk into A's room with its code.
        var refused = await Assert.ThrowsAsync<ApiException>(() => rooms.CreatePlaytestAsync(vipB, draftA));
        Assert.Equal(403, refused.StatusCode);
        Assert.Equal(PlaytestRoomRules.ForbiddenCode, Assert.IsType<ApiErrorDetails>(refused.Errors).Code);
        await AssertForbiddenAsync(() => rooms.JoinAsync(vipB, roomA.RoomCode));

        // ...and the same the other way round.
        var roomB = await rooms.CreatePlaytestAsync(vipB, draftB);
        await AssertForbiddenAsync(() => rooms.CreatePlaytestAsync(vipA, draftB));
        await AssertForbiddenAsync(() => rooms.JoinAsync(vipA, roomB.RoomCode));

        // An admin may join a VIP's playtest as the second seat without the invite.
        var admin = new CurrentUser(NewId(), "Yen", UserRole.Admin);
        Assert.Equal(2, (await rooms.JoinAsync(admin, roomA.RoomCode)).Players.Count);

        // Drafts that are not imported, cancelled, missing or malformed cannot be playtested.
        var notImported = new AiCaseDraft { Id = NewId(), Status = AiDraftStatus.ReadyToPublish, CreatedByUserId = vipA.Id, CreatedByRole = UserRole.Vip };
        var cancelled = new AiCaseDraft { Id = NewId(), Status = AiDraftStatus.Cancelled, ImportedCaseId = DraftCase, CreatedByUserId = vipA.Id };
        await c.Db.AiCaseDrafts.InsertManyAsync([notImported, cancelled]);
        var pending = await Assert.ThrowsAsync<ApiException>(() => rooms.CreatePlaytestAsync(vipA, notImported.Id));
        Assert.Equal(409, pending.StatusCode);
        Assert.Equal(PlaytestRoomRules.NotImportedCode, Assert.IsType<ApiErrorDetails>(pending.Errors).Code);
        Assert.Equal(409, (await Assert.ThrowsAsync<ApiException>(() => rooms.CreatePlaytestAsync(vipA, cancelled.Id))).StatusCode);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => rooms.CreatePlaytestAsync(vipA, NewId()))).StatusCode);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => rooms.CreatePlaytestAsync(vipA, "../etc"))).StatusCode);

        // A VIP whose email is not verified plays nothing, like every player.
        await c.Db.Users.UpdateOneAsync(user => user.Id == vipA.Id, Builders<User>.Update.Set(user => user.IsEmailVerified, false));
        await c.Db.Rooms.DeleteManyAsync(room => room.Id == roomA.RoomId);
        Assert.Equal(403, (await Assert.ThrowsAsync<ApiException>(() => rooms.CreatePlaytestAsync(vipA, draftA))).StatusCode);
    });

    [Fact]
    public Task Playtest_TheUnpublishedDraftStaysOutOfListsMatchmakingAndLeaderboards() => WithCatalog(async c =>
    {
        var vip = await VipAsync(c, "VIP tác giả");
        var draftId = await ImportedDraftAsync(c, DraftCase, vip);
        var host = await c.UserAsync("Chủ phòng");
        var rooms = c.PixelOnly.Rooms;

        // Public case lists, case pages, the workshop: the draft is in none of them, with the catalogue open or not.
        foreach (var side in new[] { c.Open, c.PixelOnly })
        {
            Assert.DoesNotContain(await side.Cases.GetPublishedAsync(), summary => summary.CaseId == DraftCase);
            Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => side.Cases.GetPublicDetailAsync(DraftCase))).StatusCode);
            Assert.DoesNotContain((await side.Workshop.GetWorkshopCasesAsync(null, "hot", 1, 48)).Items, item => item.CaseId == DraftCase);
        }
        // An ordinary room cannot be made of it, so the playtest room is the only way in.
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => rooms.CreateAsync(host, DraftCase, "PUBLIC"))).StatusCode);

        // The public room table never lists a playtest room, even one forced to PUBLIC; an ordinary public room is listed.
        var playtest = await rooms.CreatePlaytestAsync(vip, draftId);
        await c.Db.Rooms.UpdateOneAsync(room => room.Id == playtest.RoomId,
            Builders<GameRoom>.Update.Set(room => room.Visibility, RoomVisibility.Public));
        var ordinary = await rooms.CreateAsync(host, PixelIds[1], "PUBLIC");
        var listed = await rooms.ListPublicAsync(host.Id, new PublicRoomQuery());
        Assert.Contains(listed, row => row.RoomId == ordinary.RoomId);
        Assert.DoesNotContain(listed, row => row.RoomId == playtest.RoomId || row.CaseId == DraftCase);
        Assert.DoesNotContain(await rooms.ListPublicAsync(vip.Id, new PublicRoomQuery { Q = playtest.RoomCode }), row => row.RoomId == playtest.RoomId);

        // The case leaderboard stays empty, whatever the playtest does (no GameResult is ever written for it).
        Assert.Equal(0, (await c.PixelOnly.Leaderboard.GetCaseLeaderboardAsync(DraftCase, LeaderboardMetrics.TopScore)).TotalRanked);

        // Matchmaking: with every published case taken down, the (pixel) draft is still not offered.
        await c.Open.Cases.UnpublishAsync(PixelIds[0]);
        await c.Open.Cases.UnpublishAsync(PixelIds[1]);
        await c.Db.Rooms.DeleteManyAsync(room => room.Id == ordinary.RoomId);
        foreach (var side in new[] { c.Open, c.PixelOnly })
        {
            var none = await Assert.ThrowsAsync<ApiException>(() => side.Matchmaking.EnqueueAsync(host, Prefs("vi", "SHORT")));
            Assert.Equal(MatchmakingService.NoCasesCode, Assert.IsType<ApiErrorDetails>(none.Errors).Code);
        }
        Assert.Empty(MatchmakingRules.FittingCasesRelaxed(await c.PixelOnly.Cases.GetAllForAdminAsync(), "vi", "SHORT"));
    });

    private static async Task<CurrentUser> VipAsync(Catalog c, string name)
    {
        var player = await c.UserAsync(name);
        await c.Db.Users.UpdateOneAsync(user => user.Id == player.Id, Builders<User>.Update.Set(user => user.Role, UserRole.Vip));
        return player with { Role = UserRole.Vip };
    }

    /// <summary>
    /// What the bridge import leaves behind: a copy of Trâm hồng ngọc (the pixel reference case) imported under a new
    /// caseId through <see cref="CaseService.ImportJsonAsync"/> (so it stays DRAFT), and an IMPORTED draft ordered by the VIP.
    /// </summary>
    private static async Task<string> ImportedDraftAsync(Catalog c, string caseId, CurrentUser author)
    {
        if (await c.Open.Cases.FindCaseAsync(PixelIds[1]) is null) await c.SeedPixelOnlyAsync();
        var draftId = NewId();
        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        // A deep copy: the cached reference case must never be changed.
        var copy = JsonNode.Parse(JsonSerializer.Serialize(await c.Open.Cases.GetCaseAsync(PixelIds[1]), web))!.AsObject();
        copy["id"] = string.Empty;
        copy["caseId"] = caseId;
        copy["title"] = $"Bản nháp AI {caseId}";
        copy["sourceAiDraftId"] = draftId;
        copy["status"] = CaseStatus.Published; // the import forces DRAFT whatever the JSON says
        using var json = JsonDocument.Parse(copy.ToJsonString());
        var imported = await c.Open.Cases.ImportJsonAsync(json.RootElement, overwrite: false, preserveServerMetadata: true);
        Assert.Equal(CaseStatus.Draft, imported.Status);
        await c.Db.AiCaseDrafts.InsertOneAsync(new AiCaseDraft
        {
            Id = draftId, Status = AiDraftStatus.Imported, ImportedCaseId = caseId, CaseId = caseId, CaseTitle = imported.Title,
            CreatedByUserId = author.Id, CreatedByRole = author.Role, VisualPipeline = AiVisualPipelines.PixelV1,
            OrderStatus = AiOrderStatuses.Submitted
        });
        return draftId;
    }

    private static async Task AssertForbiddenAsync(Func<Task> action)
    {
        var error = await Assert.ThrowsAsync<ApiException>(action);
        Assert.Equal(403, error.StatusCode);
        Assert.Equal(PlaytestRoomRules.ForbiddenCode, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
    }
}
