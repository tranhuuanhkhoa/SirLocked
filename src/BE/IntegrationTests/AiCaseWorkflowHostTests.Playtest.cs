using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Bson;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>VUAN-6B part C over HTTP: the "Chơi thử" endpoint, the invite join and the playtest-only case reads.</summary>
public sealed partial class AiCaseWorkflowHostTests
{
    [Fact]
    public async Task PlaytestHttp_TheAuthorOpensARoom_TheInviteLetsOnePlayerIn_StrangersAndOtherVipsAreRefused()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase))
            return;

        await using var factory = new AiWorkflowFactory { DisableBackgroundWorkers = true };
        var vip = ObjectId.GenerateNewId().ToString();
        var otherVip = ObjectId.GenerateNewId().ToString();
        var friend = ObjectId.GenerateNewId().ToString();
        var stranger = ObjectId.GenerateNewId().ToString();
        var draftId = ObjectId.GenerateNewId().ToString();
        const string caseId = "case-ai-playtest-http-vi";
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
            await InsertActiveUserAsync(db, vip, UserRole.Vip);
            await InsertActiveUserAsync(db, otherVip, UserRole.Vip);
            await InsertActiveUserAsync(db, friend, UserRole.Player);
            await InsertActiveUserAsync(db, stranger, UserRole.Player);
            await db.Cases.InsertOneAsync(new GameCase
            {
                CaseId = caseId, Title = "Bản nháp chơi thử", Status = CaseStatus.Draft, Language = CaseLanguages.Vietnamese,
                SourceAiDraftId = draftId,
                Stages = [new CaseStage { StageId = "stage-1", Order = 1, Scenes = [new CaseScene { SceneId = "scene-1", Title = "Tiệm" }] }]
            });
            await db.AiCaseDrafts.InsertOneAsync(new AiCaseDraft
            {
                Id = draftId, Status = AiDraftStatus.Imported, ImportedCaseId = caseId, CaseId = caseId,
                CreatedByUserId = vip, CreatedByRole = UserRole.Vip, OrderStatus = AiOrderStatuses.Submitted
            });
        }
        HttpClient As(string userId, string role)
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Test-UserId", userId);
            client.DefaultRequestHeaders.Add("X-Test-Role", role);
            return client;
        }
        using var author = As(vip, UserRole.Vip);
        using var other = As(otherVip, UserRole.Vip);
        using var invited = As(friend, UserRole.Player);
        using var outsider = As(stranger, UserRole.Player);
        var route = $"/api/admin/ai-cases/{draftId}/playtest";

        // A plain player cannot reach the AI desk at all; another VIP reaches it but not this draft.
        using (var player = await outsider.PostAsync(route, null)) Assert.Equal(HttpStatusCode.Forbidden, player.StatusCode);
        using (var refused = await other.PostAsync(route, null))
        {
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            Assert.Equal(PlaytestRoomRules.ForbiddenCode, await ErrorCodeAsync(refused));
        }

        using var opened = await author.PostAsync(route, null);
        Assert.Equal(HttpStatusCode.OK, opened.StatusCode);
        var room = (await opened.Content.ReadFromJsonAsync<ApiResponse<RoomResponse>>())!.Data!;
        Assert.Equal(caseId, room.CaseId);
        Assert.Equal(RoomVisibility.Private, room.Visibility);
        var token = room.Playtest!.InviteToken!;

        // The room code alone: refused with a stable code. The invite link: in.
        using (var noInvite = await outsider.PostAsJsonAsync("/api/rooms/join", new { roomCode = room.RoomCode }))
        {
            Assert.Equal(HttpStatusCode.Forbidden, noInvite.StatusCode);
            Assert.Equal(PlaytestRoomRules.ForbiddenCode, await ErrorCodeAsync(noInvite));
        }
        using (var join = await invited.PostAsJsonAsync("/api/rooms/join", new { roomCode = room.RoomCode, inviteToken = token }))
        {
            Assert.Equal(HttpStatusCode.OK, join.StatusCode);
            var lobby = (await join.Content.ReadFromJsonAsync<ApiResponse<RoomResponse>>())!.Data!;
            Assert.True(lobby.Playtest!.InviteClaimed);
            Assert.Null(lobby.Playtest.InviteToken);
        }
        using (var reused = await outsider.PostAsJsonAsync("/api/rooms/join", new { roomCode = room.RoomCode, inviteToken = token }))
            Assert.Equal(HttpStatusCode.Forbidden, reused.StatusCode);

        // The unpublished case reads like a published one only for a member, and only through the playtest room.
        Assert.Equal(HttpStatusCode.NotFound, (await invited.GetAsync($"/api/cases/{caseId}")).StatusCode);
        using (var detail = await invited.GetAsync($"/api/cases/{caseId}?roomId={room.RoomId}"))
        {
            Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
            Assert.Equal(caseId, (await detail.Content.ReadFromJsonAsync<ApiResponse<CasePublicDetailResponse>>())!.Data!.CaseId);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/cases/{caseId}?roomId={room.RoomId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await invited.GetAsync($"/api/cases/{caseId}/intro-cutscene?roomId={room.RoomId}")).StatusCode);

        // Nowhere public: not in the published list, not in the public room table.
        var published = (await outsider.GetFromJsonAsync<ApiResponse<List<CaseSummaryResponse>>>("/api/cases/published"))!.Data!;
        Assert.DoesNotContain(published, summary => summary.CaseId == caseId);
        var publicRooms = (await outsider.GetFromJsonAsync<ApiResponse<List<PublicRoomResponse>>>("/api/rooms/public"))!.Data!;
        Assert.DoesNotContain(publicRooms, row => row.RoomId == room.RoomId);
    }

    private static async Task<string?> ErrorCodeAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Object
            && errors.TryGetProperty("code", out var code) ? code.GetString() : null;
    }
}
