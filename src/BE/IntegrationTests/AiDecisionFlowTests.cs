using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// draft_ask: the bot asks the creator a question with options, the request leaves the bot's list until someone with
/// access to the draft answers in the browser, then it is PENDING again and the bot reads the answer when it takes it.
/// The VIP API lane is closed here (no Anthropic key), so a VIP order is free and goes to the bot like an ADMIN order.
/// </summary>
public sealed partial class AiBridgeWorkflowHostTests
{
    private const string OtherVipId = "507f1f77bcf86cd799439024";

    [Fact]
    public async Task Decision_Ask_Answer_Resume()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory(vipLaneOpen: false);
        await SeedUsersAsync(factory);
        using var vip = User(factory, VipId, UserRole.Vip);
        using var bot = Bot(factory);
        var (draftId, requestId, decisionId) = await AskAsync(factory, vip, bot);

        Assert.DoesNotContain(await PendingAsync(bot), item => item["requestId"]?.GetValue<string>() == requestId);
        var waiting = await GetData<AiDraftResponse>(vip, $"/api/admin/ai-cases/{draftId}");
        Assert.Equal(AiOrderStatuses.AwaitingDecision, waiting.OrderStatus);
        var open = Assert.Single(waiting.Decisions);
        Assert.Equal((decisionId, AiDecisionStatuses.Open, 2), (open.Id, open.Status, open.Options.Count));

        var answered = await Answer(vip, draftId, decisionId, "library");
        Assert.Equal(HttpStatusCode.OK, answered.StatusCode);
        Assert.Contains(await PendingAsync(bot), item => item["requestId"]?.GetValue<string>() == requestId);

        var taken = await TakeAsync(bot, requestId);
        var decision = Assert.Single(taken["decisions"]!.AsArray())!.AsObject();
        Assert.Equal(("asset-budget", "library", "Dùng thư viện"),
            (decision["key"]!.GetValue<string>(), decision["chosenOptionId"]!.GetValue<string>(), decision["chosen"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Decision_Ask_WithoutTake_Is409()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory(vipLaneOpen: false);
        await SeedUsersAsync(factory);
        using var admin = User(factory, AdminId, UserRole.Admin);
        using var bot = Bot(factory);
        var draftId = await CreateAsync(factory, admin, AiCaseReviewModes.Full);
        var requestId = await WaitForRequestAsync(bot, draftId);

        var response = await bot.PostAsJsonAsync($"/api/bridge/requests/{requestId}/ask", Question());
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("BRIDGE_REQUEST_NOT_TAKEN", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Decision_SecondAnswer_Is409_AndResumesOnce()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory(vipLaneOpen: false);
        await SeedUsersAsync(factory);
        using var vip = User(factory, VipId, UserRole.Vip);
        using var admin = User(factory, AdminId, UserRole.Admin);
        using var bot = Bot(factory);
        var (draftId, requestId, decisionId) = await AskAsync(factory, vip, bot);

        var both = await Task.WhenAll(Answer(vip, draftId, decisionId, "draw"), Answer(admin, draftId, decisionId, "library"));
        Assert.Single(both, response => response.StatusCode == HttpStatusCode.OK);
        var loser = Assert.Single(both, response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.Contains("AI_DECISION_CLOSED", await loser.Content.ReadAsStringAsync());

        var draft = await GetData<AiDraftResponse>(admin, $"/api/admin/ai-cases/{draftId}");
        Assert.Equal(AiDecisionStatuses.Answered, Assert.Single(draft.Decisions).Status);
        Assert.Single(await PendingAsync(bot), item => item["requestId"]?.GetValue<string>() == requestId);
    }

    [Fact]
    public async Task Decision_OtherVip_Is403_AdminCanAnswer()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory(vipLaneOpen: false);
        await SeedUsersAsync(factory);
        await SeedUserAsync(factory, OtherVipId, UserRole.Vip);
        using var vip = User(factory, VipId, UserRole.Vip);
        using var otherVip = User(factory, OtherVipId, UserRole.Vip);
        using var admin = User(factory, AdminId, UserRole.Admin);
        using var bot = Bot(factory);
        var (draftId, _, decisionId) = await AskAsync(factory, vip, bot);

        Assert.Equal(HttpStatusCode.Forbidden, (await Answer(otherVip, draftId, decisionId, "draw")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Answer(admin, draftId, decisionId, "draw")).StatusCode);
    }

    [Fact]
    public async Task Decision_UnknownOption_Is400()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory(vipLaneOpen: false);
        await SeedUsersAsync(factory);
        using var vip = User(factory, VipId, UserRole.Vip);
        using var bot = Bot(factory);
        var (draftId, _, decisionId) = await AskAsync(factory, vip, bot);
        Assert.Equal(HttpStatusCode.BadRequest, (await Answer(vip, draftId, decisionId, "nope")).StatusCode);
    }

    [Fact]
    public async Task Decision_CancelWhileWaiting_ClosesEverything()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory(vipLaneOpen: false);
        await SeedUsersAsync(factory);
        using var vip = User(factory, VipId, UserRole.Vip);
        using var bot = Bot(factory);
        var (draftId, requestId, decisionId) = await AskAsync(factory, vip, bot);

        Assert.Equal(HttpStatusCode.OK, (await vip.PostAsync($"/api/admin/ai-cases/{draftId}/cancel", null)).StatusCode);
        var draft = await GetData<AiDraftResponse>(vip, $"/api/admin/ai-cases/{draftId}");
        Assert.Equal(AiDecisionStatuses.Cancelled, Assert.Single(draft.Decisions).Status);
        var requests = await GetData<List<JsonObject>>(bot, "/api/bridge/requests?status=CANCELLED");
        Assert.Contains(requests, item => item["requestId"]?.GetValue<string>() == requestId);

        var late = await Answer(vip, draftId, decisionId, "draw");
        Assert.Equal(HttpStatusCode.Conflict, late.StatusCode);
        Assert.Contains("AI_DECISION_CLOSED", await late.Content.ReadAsStringAsync());
    }

    private static object Question() => new
    {
        key = "asset-budget",
        question = "Màn này cần 180 lượt PixelLab. Làm sao?",
        options = new object[]
        {
            new { id = "draw", label = "Vẽ mới", detail = "Đúng ý đơn", generations = 180 },
            new { id = "library", label = "Dùng thư viện", detail = "Tiết kiệm", generations = 25 }
        }
    };

    /// <summary>A VIP orders, the bot takes the first request and asks the question. Returns the ids.</summary>
    private static async Task<(string DraftId, string RequestId, string DecisionId)> AskAsync(BridgeFactory factory, HttpClient owner, HttpClient bot)
    {
        // An autopilot (AUTO) order never asks: the bot picks itself. Questions are for a draft under FULL review.
        var draftId = await CreateAsync(factory, owner, AiCaseReviewModes.Full);
        var requestId = await WaitForRequestAsync(bot, draftId);
        await TakeAsync(bot, requestId);
        var asked = await bot.PostAsJsonAsync($"/api/bridge/requests/{requestId}/ask", Question());
        Assert.True(asked.IsSuccessStatusCode, await asked.Content.ReadAsStringAsync());
        var body = (await asked.Content.ReadFromJsonAsync<ApiResponse<JsonObject>>(Web))!.Data!;
        Assert.Equal("AWAITING_DECISION", body["status"]!.GetValue<string>());
        return (draftId, requestId, body["decisionId"]!.GetValue<string>());
    }

    private static async Task SeedUserAsync(BridgeFactory factory, string id, string role)
    {
        using var scope = factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<SirLocked.Api.DataAccess.MongoDbContext>().Users.InsertOneAsync(new User
        {
            Id = id, FullName = role, Email = $"{id}@bridge.test", Role = role, Status = UserStatus.Active, IsEmailVerified = true
        });
    }

    private static Task<HttpResponseMessage> Answer(HttpClient client, string draftId, string decisionId, string optionId) =>
        client.PostAsJsonAsync($"/api/admin/ai-cases/{draftId}/decisions/{decisionId}", new { optionId });
}
