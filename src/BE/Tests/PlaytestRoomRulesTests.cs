using System.Text.Json;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.WebAPI.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace SirLocked.Tests;

/// <summary>VUAN-6B part C: who may open and enter the playtest room of an unpublished AI draft.</summary>
public class PlaytestRoomRulesTests
{
    private static readonly CurrentUser Admin = new("admin-1", "Yen", UserRole.Admin);
    private static readonly CurrentUser Author = new("vip-author", "Tác giả", UserRole.Vip);
    private static readonly CurrentUser OtherVip = new("vip-other", "VIP khác", UserRole.Vip);
    private static readonly CurrentUser Friend = new("player-friend", "Bạn được mời", UserRole.Player);
    private static readonly CurrentUser Stranger = new("player-stranger", "Người lạ", UserRole.Player);

    private static AiCaseDraft Draft(string status = AiDraftStatus.Imported, string? importedCaseId = "case-ai-draft", string owner = "vip-author") => new()
    {
        Id = "6a0000000000000000000001", Status = status, ImportedCaseId = importedCaseId, CreatedByUserId = owner, CreatedByRole = UserRole.Vip
    };

    private static RoomPlaytest Playtest(string? invited = null) => new()
    {
        DraftId = "6a0000000000000000000001", AuthorUserId = Author.Id, CreatedByUserId = Admin.Id,
        InviteToken = "AbCdEfGhIjKlMnOpQrStUvWx", InvitedUserId = invited
    };

    [Fact]
    public void OnlyAnAdminOrTheDraftsAuthor_CanOpenAPlaytest()
    {
        Assert.True(PlaytestRoomRules.CanHost(Admin, Draft()));
        Assert.True(PlaytestRoomRules.CanHost(Author, Draft()));
        Assert.False(PlaytestRoomRules.CanHost(OtherVip, Draft()));
        Assert.False(PlaytestRoomRules.CanHost(Stranger, Draft()));
        // A draft without an owner (older data) is admin-only, never "everyone whose id is empty".
        Assert.False(PlaytestRoomRules.CanHost(new CurrentUser("", "Không id", UserRole.Vip), Draft(owner: "")));
        Assert.True(PlaytestRoomRules.CanHost(Admin, Draft(owner: "")));
    }

    [Fact]
    public void OnlyAnImportedDraftThatIsNotCancelled_CanBePlaytested()
    {
        Assert.True(PlaytestRoomRules.IsPlaytestable(Draft()));
        Assert.True(PlaytestRoomRules.IsPlaytestable(Draft(AiDraftStatus.Published)));
        Assert.False(PlaytestRoomRules.IsPlaytestable(Draft(AiDraftStatus.ReadyToPublish, importedCaseId: null)));
        Assert.False(PlaytestRoomRules.IsPlaytestable(Draft(AiDraftStatus.Imported, importedCaseId: " ")));
        Assert.False(PlaytestRoomRules.IsPlaytestable(Draft(AiDraftStatus.Cancelled)));
    }

    [Fact]
    public void AdminAndAuthor_EnterWithoutTheInvite_TheInviteLetsInExactlyOneOtherPlayer()
    {
        var open = Playtest();
        Assert.Equal(PlaytestEntry.Allowed, PlaytestRoomRules.Evaluate(open, Admin, null));
        Assert.Equal(PlaytestEntry.Allowed, PlaytestRoomRules.Evaluate(open, Author, null));
        // The room code alone, a wrong secret or another VIP's own rights are not enough.
        Assert.Equal(PlaytestEntry.Forbidden, PlaytestRoomRules.Evaluate(open, Stranger, null));
        Assert.Equal(PlaytestEntry.Forbidden, PlaytestRoomRules.Evaluate(open, Stranger, ""));
        Assert.Equal(PlaytestEntry.Forbidden, PlaytestRoomRules.Evaluate(open, Stranger, "AbCdEfGhIjKlMnOpQrStUvWy"));
        Assert.Equal(PlaytestEntry.Forbidden, PlaytestRoomRules.Evaluate(open, Stranger, "abcdefghijklmnopqrstuvwx"));
        Assert.Equal(PlaytestEntry.Forbidden, PlaytestRoomRules.Evaluate(open, OtherVip, null));
        Assert.Equal(PlaytestEntry.ClaimsInvite, PlaytestRoomRules.Evaluate(open, Friend, "AbCdEfGhIjKlMnOpQrStUvWx"));

        var claimed = Playtest(invited: Friend.Id);
        Assert.Equal(PlaytestEntry.Allowed, PlaytestRoomRules.Evaluate(claimed, Friend, null));
        Assert.Equal(PlaytestEntry.Forbidden, PlaytestRoomRules.Evaluate(claimed, Stranger, "AbCdEfGhIjKlMnOpQrStUvWx"));
        Assert.Equal(PlaytestEntry.Allowed, PlaytestRoomRules.Evaluate(claimed, Admin, null));
        Assert.Equal(PlaytestEntry.Allowed, PlaytestRoomRules.Evaluate(claimed, Author, null));
    }

    [Fact]
    public void AnEmptySecret_NeverMatches()
    {
        var broken = Playtest();
        broken.InviteToken = string.Empty;
        Assert.Equal(PlaytestEntry.Forbidden, PlaytestRoomRules.Evaluate(broken, Stranger, ""));
        Assert.Equal(PlaytestEntry.Forbidden, PlaytestRoomRules.Evaluate(broken, Stranger, null));
        Assert.False(PlaytestRoomRules.TokenMatches("", ""));
    }

    [Fact]
    public void InviteSecrets_AreLongRandomAndUrlSafe()
    {
        var tokens = Enumerable.Range(0, 200).Select(_ => PlaytestRoomRules.NewInviteToken()).ToList();
        Assert.All(tokens, token =>
        {
            Assert.Equal(PlaytestRoomRules.InviteTokenLength, token.Length);
            Assert.Matches("^[A-Za-z0-9_-]+$", token);
        });
        Assert.Equal(tokens.Count, tokens.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void TheLobbyShowsTheSecretOnlyWhileTheInviteIsFree_AndOrdinaryRoomsCarryNoPlaytestField()
    {
        var room = new GameRoom { Id = "r1", RoomCode = "ABC234", CaseId = "case-ai-draft", Playtest = Playtest() };
        var open = RoomResponse.From(room, "Bản nháp");
        Assert.Equal("AbCdEfGhIjKlMnOpQrStUvWx", open.Playtest!.InviteToken);
        Assert.False(open.Playtest.InviteClaimed);

        room.Playtest!.InvitedUserId = Friend.Id;
        var claimed = RoomResponse.From(room, "Bản nháp");
        Assert.True(claimed.Playtest!.InviteClaimed);
        Assert.Null(claimed.Playtest.InviteToken);
        Assert.Equal("6a0000000000000000000001", claimed.Playtest.DraftId);

        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var ordinary = JsonSerializer.Serialize(RoomResponse.From(new GameRoom { Id = "r2", RoomCode = "XYZ234" }, "Vụ"), web);
        Assert.DoesNotContain("playtest", ordinary, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("isPlaytest", JsonSerializer.Serialize(new GameResultResponse(), web));
        Assert.Contains("\"isPlaytest\":true", JsonSerializer.Serialize(new GameResultResponse { IsPlaytest = true }, web));
    }

    [Fact]
    public void ThePlaytestButton_IsForAdminsAndVips_AndJoiningCarriesTheInvite()
    {
        var controller = typeof(AdminAiCasesController).GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single();
        Assert.Equal(UserRole.Admin + "," + UserRole.Vip, controller.Roles);
        var action = typeof(AdminAiCasesController).GetMethod(nameof(AdminAiCasesController.Playtest))!;
        Assert.Equal("{draftId}/playtest", action.GetCustomAttributes(typeof(HttpPostAttribute), false).Cast<HttpPostAttribute>().Single().Template);
        // No narrower role on the action: the author check (VIP who ordered it) is the server's, in RoomService.
        Assert.Empty(action.GetCustomAttributes(typeof(AuthorizeAttribute), false));
        Assert.NotNull(typeof(JoinRoomRequest).GetProperty(nameof(JoinRoomRequest.InviteToken)));
    }
}
