using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Vip;
using Xunit;

namespace SirLocked.IntegrationTests.Vip;

/// <summary>
/// The VIP lane of VUAN-7 against a real MongoDB and a fake Claude client (no Anthropic call, no key): the right model
/// per step, Opus only on the third try, usage recorded once, replays never paid twice, JSON repaired once by the light
/// model, refusals and the cost cap stopping the order, and "Tiết kiệm" batches parking and resuming the run.
/// Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoVipLaneTests
{
    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static readonly JsonObject Schema = new()
    {
        ["type"] = "object",
        ["additionalProperties"] = false,
        ["required"] = new JsonArray("title", "count"),
        ["properties"] = new JsonObject
        {
            ["title"] = new JsonObject { ["type"] = "string" },
            ["count"] = new JsonObject { ["type"] = "integer" }
        }
    };

    private static AiTextRequest Request(string draftId, string step = "GenerateFullCaseJson", int attempt = 1, string run = "run-1") => new()
    {
        OwnerType = AiBridgeOwnerTypes.CaseDraft,
        OwnerId = draftId,
        Step = step,
        SchemaVersion = "test-v1",
        Schema = Schema,
        Instructions = "Return JSON.",
        Prompt = "Write the thing.",
        MaxOutputTokens = 4000,
        AttemptNumber = attempt,
        GenerationRunId = run
    };

    private static ClaudeApiAnswer Valid(ClaudeApiCall call) =>
        new("""{"title":"Ấm men lam","count":3}""", "end_turn", new ClaudeApiUsage(10_000, 2_000, 5_000, 1_000), call.Model, "msg_1");

    [Fact]
    public async Task Fast_AnswersThroughTheApi_RecordsUsageOnce_AndAReplayIsNotPaidTwice()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var draft = await env.HeldDraftAsync();

        var first = await env.Provider().GenerateJsonAsync(Request(draft.Id));
        var replay = await env.Provider().GenerateJsonAsync(Request(draft.Id));

        Assert.Equal("""{"title":"Ấm men lam","count":3}""", first);
        Assert.Equal(first, replay);
        var call = Assert.Single(env.Claude.Calls);
        Assert.Equal(VipModelIds.Sonnet, call.Model);
        Assert.Contains("JSON Schema", call.System);
        var usage = Assert.Single(await env.Lane.Usage.Find(item => item.DraftId == draft.Id).ToListAsync());
        // Sonnet 5.5: 10k input x 2 + 2k output x 10 + 5k cache read x 0.10 + 1k cache write x 2.5 = 0.04300 USD.
        Assert.Equal(0.0430m, usage.CostUsd);
        Assert.Equal((long)Math.Ceiling(0.0430m * 26_500m), usage.CostVnd);
        Assert.False(usage.Batch);
        var stored = await env.DraftAsync(draft.Id);
        Assert.Equal(0.0430m, stored.VipBilling!.SpentUsd);
        Assert.Equal(1, stored.VipBilling.Calls);
        Assert.True(stored.VipBilling.WorkStarted);
    }

    [Theory]
    [InlineData("VipBrief", 1, VipModelIds.Haiku)]
    [InlineData("CreateStoryPreview", 1, VipModelIds.Sonnet)]
    [InlineData("GenerateCaseTruth", 2, VipModelIds.Sonnet)]
    [InlineData("GenerateCaseTruth", 3, VipModelIds.Opus)]
    [InlineData("PlanScenePlacement:scene-1", 4, VipModelIds.Opus)]
    public async Task EachStep_UsesItsModel_AndOnlyTheThirdTryUsesOpus(string step, int attempt, string model)
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var draft = await env.HeldDraftAsync();

        await env.Provider().GenerateJsonAsync(Request(draft.Id, step, attempt));

        Assert.Equal(model, Assert.Single(env.Claude.Calls).Model);
    }

    [Fact]
    public void Router_FollowsAdminOverrides_ButTheRescueStillTakesTheThirdTry()
    {
        var settings = new VipModelSettings { StepOverrides = new() { ["PlanScenePlacement"] = VipModelIds.Opus, ["Plan"] = VipModelIds.Haiku } };
        Assert.Equal(VipModelIds.Opus, VipModelRouter.Resolve(settings, "PlanScenePlacement:scene-2", 1).Model); // longest prefix
        Assert.Equal(VipModelIds.Haiku, VipModelRouter.Resolve(settings, "PlanOther", 1).Model);
        Assert.Equal(VipModelIds.Opus, VipModelRouter.Resolve(settings, "PlanOther", 3).Model);
        Assert.Equal(VipModelIds.Haiku, VipModelRouter.Resolve(settings, "VipJsonRepair", 5).Model); // light work stays light
        Assert.Equal(0.0215m, VipModelRouter.CostUsd(settings.TokenPrice(VipModelIds.Sonnet), new ClaudeApiUsage(10_000, 2_000, 5_000, 1_000), batch: true));
        Assert.Equal(200, VipModelRouter.ToXu(1_991, 10));
    }

    [Fact]
    public async Task AnAnswerThatBreaksTheSchema_IsRepairedOnceByTheLightModel()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = call => call.Step == VipModelRouter.JsonRepairStep
            ? new ClaudeApiAnswer("""{"title":"Đã sửa","count":2}""", "end_turn", new ClaudeApiUsage(500, 100, 0, 0), call.Model, "m2")
            : new ClaudeApiAnswer("```json" + Environment.NewLine + "{\"title\":\"Thiếu số\"}" + Environment.NewLine + "```",
                "end_turn", new ClaudeApiUsage(1000, 200, 0, 0), call.Model, "m1");
        var draft = await env.HeldDraftAsync();

        var json = await env.Provider().GenerateJsonAsync(Request(draft.Id));

        Assert.Equal("""{"title":"Đã sửa","count":2}""", json);
        Assert.Equal(new[] { VipModelIds.Sonnet, VipModelIds.Haiku }, env.Claude.Calls.Select(call => call.Model));
        Assert.Equal(2, await env.Lane.Usage.CountDocumentsAsync(item => item.DraftId == draft.Id));
    }

    [Fact]
    public async Task AnAnswerThatStaysBroken_FailsTheStep_AndTheReplayDoesNotCallAgain()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = call => new ClaudeApiAnswer("""{"title":1}""", "end_turn", ClaudeApiUsage.Zero, call.Model, "m");
        var draft = await env.HeldDraftAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Provider().GenerateJsonAsync(Request(draft.Id)));
        Assert.Equal(VipLaneErrors.InvalidJson, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
        var calls = env.Claude.Calls.Count;
        var replay = await Assert.ThrowsAsync<ApiException>(() => env.Provider().GenerateJsonAsync(Request(draft.Id)));
        Assert.Equal(VipLaneErrors.CallFailed, Assert.IsType<ApiErrorDetails>(replay.Errors).Code);
        Assert.Equal(calls, env.Claude.Calls.Count);
    }

    [Fact]
    public async Task ARefusal_StopsTheOrder()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = call => new ClaudeApiAnswer(string.Empty, "refusal", ClaudeApiUsage.Zero, call.Model, "m");
        var draft = await env.HeldDraftAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Provider().GenerateJsonAsync(Request(draft.Id)));

        Assert.Equal(409, error.StatusCode);
        Assert.Equal(VipLaneErrors.Refused, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
        Assert.Contains(VipLaneErrors.Refused, VipLaneErrors.Terminal);
    }

    [Fact]
    public async Task ACutOffAnswer_IsAskedAgainWithTheLargestBudget()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = call => call.MaxTokens < ClaudeApiTextProvider.MaxMaxTokens
            ? new ClaudeApiAnswer("""{"title":""", "max_tokens", new ClaudeApiUsage(100, 16_000, 0, 0), call.Model, "m1")
            : Valid(call);
        var draft = await env.HeldDraftAsync();

        var json = await env.Provider().GenerateJsonAsync(Request(draft.Id));

        Assert.Contains("Ấm men lam", json);
        Assert.Equal(new[] { ClaudeApiTextProvider.MinMaxTokens, ClaudeApiTextProvider.MaxMaxTokens }, env.Claude.Calls.Select(call => call.MaxTokens));
        Assert.Equal(2, await env.Lane.Usage.CountDocumentsAsync(item => item.DraftId == draft.Id)); // the cut-off one was paid too
    }

    [Fact]
    public async Task TheCostCap_StopsTheOrderBeforeAnotherCall()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var draft = await env.HeldDraftAsync();
        await env.Db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draft.Id,
            Builders<AiCaseDraft>.Update.Set(item => item.VipBilling!.SpentVnd, draft.VipBilling!.CostCapVnd));

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Provider().GenerateJsonAsync(Request(draft.Id)));

        Assert.Equal(VipLaneErrors.CostCapReached, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
        Assert.Empty(env.Claude.Calls);
    }

    [Fact]
    public async Task AnOrderWithoutHeldCoins_NeverSpendsOnTheApi()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var draft = await env.HeldDraftAsync();
        await env.Db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draft.Id,
            Builders<AiCaseDraft>.Update.Set(item => item.VipBilling!.State, AiVipBillingStates.Refunded));

        var error = await Assert.ThrowsAsync<ApiException>(() => env.Provider().GenerateJsonAsync(Request(draft.Id)));

        Assert.Equal(VipLaneErrors.NotHeld, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
        Assert.Empty(env.Claude.Calls);
    }

    [Fact]
    public async Task Saver_SendsABatch_ParksTheRun_AndTheWorkerResumesItWithTheAnswer()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var draft = await env.HeldDraftAsync(VipSpeeds.Saver);

        var wait = await Assert.ThrowsAsync<AiAwaitingClaudeException>(() => env.Provider().GenerateJsonAsync(Request(draft.Id)));
        // The coordinator parks the run like a bridge question.
        await env.ParkAsync(draft.Id, wait.RequestId);
        var call = await env.Lane.GetAsync(wait.RequestId);
        Assert.Equal(AiVipCallStates.BatchPending, call!.State);
        Assert.Single(env.Claude.BatchCalls);
        Assert.Empty(env.Claude.Calls);

        Assert.Equal(0, await VipLaneWorker.PollBatchesAsync(env.Services, default)); // still running
        env.Claude.EndBatches();
        Assert.Equal(1, await VipLaneWorker.PollBatchesAsync(env.Services, default));

        var resumed = await env.DraftAsync(draft.Id);
        Assert.Equal(AiQueueStates.Pending, resumed.QueueState);
        Assert.Null(resumed.ClaudeWait);
        var json = await env.Provider().GenerateJsonAsync(Request(draft.Id)); // the replay
        Assert.Contains("Ấm men lam", json);
        Assert.Empty(env.Claude.Calls);
        var usage = Assert.Single(await env.Lane.Usage.Find(item => item.DraftId == draft.Id).ToListAsync());
        Assert.True(usage.Batch);
        Assert.Equal(0.0215m, usage.CostUsd); // half price
    }

    [Fact]
    public async Task AFailedBatch_IsSentOnceMore_ThenTheStepFails()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var draft = await env.HeldDraftAsync(VipSpeeds.Saver);

        for (var round = 1; round <= 2; round++)
        {
            var wait = await Assert.ThrowsAsync<AiAwaitingClaudeException>(() => env.Provider().GenerateJsonAsync(Request(draft.Id)));
            await env.ParkAsync(draft.Id, wait.RequestId);
            env.Claude.EndBatches(_ => new ClaudeBatchOutcome(ClaudeBatchState.Expired, null, "expired"));
            Assert.Equal(1, await VipLaneWorker.PollBatchesAsync(env.Services, default));
        }

        Assert.Equal(2, env.Claude.BatchCalls.Count);
        var error = await Assert.ThrowsAsync<ApiException>(() => env.Provider().GenerateJsonAsync(Request(draft.Id)));
        Assert.Equal(VipLaneErrors.CallFailed, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
    }

    [Fact]
    public async Task ARunParkedOnAnAnsweredBatch_IsResumedByTheSweep()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var draft = await env.HeldDraftAsync(VipSpeeds.Saver);
        var wait = await Assert.ThrowsAsync<AiAwaitingClaudeException>(() => env.Provider().GenerateJsonAsync(Request(draft.Id)));
        // The answer is stored, then the server stops before resuming the draft.
        env.Claude.EndBatches();
        await VipLaneWorker.PollBatchesAsync(env.Services, default);
        await env.ParkAsync(draft.Id, wait.RequestId);

        Assert.Equal(1, await VipLaneWorker.ResumeParkedAsync(env.Services, default));
        Assert.Equal(AiQueueStates.Pending, (await env.DraftAsync(draft.Id)).QueueState);
    }

    [Fact]
    public async Task TheRouter_SendsVipDraftsToTheApi_AndAdminDraftsToTheBot()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var vip = await env.HeldDraftAsync();
        var admin = new AiCaseDraft { Id = ObjectId.GenerateNewId().ToString(), CreatedByUserId = "admin", CreatedByRole = UserRole.Admin };
        await env.Db.AiCaseDrafts.InsertOneAsync(admin);
        var router = env.Router();

        Assert.Contains("Ấm men lam", await router.GenerateJsonAsync(Request(vip.Id)));
        await Assert.ThrowsAsync<AiAwaitingClaudeException>(() => router.GenerateJsonAsync(Request(admin.Id)));

        Assert.Single(env.Claude.Calls);
        Assert.Equal(1, await env.Db.AiBridgeRequests.CountDocumentsAsync(item => item.OwnerId == admin.Id));
        Assert.Equal(0, await env.Db.AiBridgeRequests.CountDocumentsAsync(item => item.OwnerId == vip.Id));
    }

    [Fact]
    public async Task ACutsceneOfADeliveredVipCase_StillUsesTheApi_Synchronously()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var draft = await env.HeldDraftAsync(VipSpeeds.Saver);
        await env.Db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draft.Id,
            Builders<AiCaseDraft>.Update.Set(item => item.VipBilling!.State, AiVipBillingStates.Charged));
        await env.Db.Cases.InsertOneAsync(new GameCase { Id = ObjectId.GenerateNewId().ToString(), CaseId = "case-vip-1", SourceAiDraftId = draft.Id });

        var json = await env.Router().GenerateJsonAsync(Request("case-vip-1") with { OwnerType = AiBridgeOwnerTypes.Cutscene, Step = "CutsceneScript" });

        Assert.Contains("Ấm men lam", json);
        Assert.Single(env.Claude.Calls);
        Assert.Empty(env.Claude.BatchCalls);
    }

    [Fact]
    public async Task TheAdminReport_ShowsRealCostByModel_PriceTaken_AndProfit()
    {
        if (!Enabled) return;
        await using var env = await VipEnv.CreateAsync();
        env.Claude.Answer = Valid;
        var draft = await env.HeldDraftAsync();
        await env.Provider().GenerateJsonAsync(Request(draft.Id, "VipBrief"));
        await env.Provider().GenerateJsonAsync(Request(draft.Id, "GenerateCaseTruth"));
        await env.Db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draft.Id, Builders<AiCaseDraft>.Update
            .Set(item => item.Status, AiDraftStatus.ReadyToPublish).Set(item => item.OrderStatus, AiOrderStatuses.Submitted));
        await env.Billing.SettleAsync(draft.Id);

        var report = await new VipReportService(env.Db, env.Settings).BuildAsync(30);

        var order = Assert.Single(report.Orders);
        Assert.Equal((AiVipBillingStates.Charged, 8_000L, 80_000L), (order.BillingState, order.ChargedXu, order.EarnedVnd));
        Assert.Equal(new[] { VipModelIds.Sonnet, VipModelIds.Haiku }, order.Models.Select(item => item.Model));
        Assert.Equal(order.EarnedVnd - order.SpentVnd - order.PixelLabVnd, order.ProfitVnd);
        Assert.True(order.SpentVnd > 0);
        var average = Assert.Single(report.Averages);
        Assert.Equal((AiGenerationPresets.NormalRandom, VipSpeeds.Fast, 1), (average.Preset, average.Speed, average.Orders));
    }

    // ------------------------------------------------------------------ environment

    internal sealed class VipEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private VipEnv(MongoDbSettings settings)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Lane = new VipLaneStore(Db);
            Settings = new VipSettingsStore(Db);
            Store = new MarketStore(Db);
            Market = new MarketService(Store, NullLogger<MarketService>.Instance);
            Wallet = new CoinWalletService(Store, Market, NullLogger<CoinWalletService>.Instance);
            Billing = new VipBillingService(Db, Wallet, Settings, Options.Create(Anthropic), NullLogger<VipBillingService>.Instance);
            var services = new ServiceCollection();
            services.AddSingleton(Db);
            services.AddSingleton(Lane);
            services.AddSingleton<IClaudeApiClient>(Claude);
            services.AddSingleton(new VipAnswerProcessor(Lane, Claude, Settings));
            services.AddSingleton<IAiDraftWorkflowCoordinator>(new AiDraftWorkflowCoordinator(Db, TimeProvider.System));
            services.AddSingleton<ILogger<VipLaneWorker>>(NullLogger<VipLaneWorker>.Instance);
            Services = services.BuildServiceProvider();
        }

        public static readonly AnthropicSettings Anthropic = new() { ApiKey = "test-key-never-sent" };
        public MongoDbContext Db { get; }
        public VipLaneStore Lane { get; }
        public VipSettingsStore Settings { get; }
        public MarketStore Store { get; }
        public MarketService Market { get; }
        public CoinWalletService Wallet { get; }
        public VipBillingService Billing { get; }
        public FakeClaudeApiClient Claude { get; } = new();
        public IServiceProvider Services { get; }

        /// <summary>A fresh provider, like one request scope of the server (its call ordinals start at zero).</summary>
        public ClaudeApiTextProvider Provider() => new(Lane, Db, Claude, Settings, new VipAnswerProcessor(Lane, Claude, Settings),
            Options.Create(new AiGenerationSettings()), Options.Create(Anthropic), NullLogger<ClaudeApiTextProvider>.Instance);

        public AiTextProviderRouter Router() => new(
            new ClaudeBridgeTextProvider(new AiBridgeRequestStore(Db, TimeProvider.System), Db,
                Options.Create(new AiGenerationSettings()), Options.Create(new BridgeSettings()),
                new TestHostEnvironment(), NullLogger<ClaudeBridgeTextProvider>.Instance),
            Provider(), Db);

        public static async Task<VipEnv> CreateAsync()
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_vip_{Guid.NewGuid():N}"
            };
            if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
                || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                    server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
                throw new InvalidOperationException("VIP lane integration tests need a loopback MongoDB and a temporary database.");
            var env = new VipEnv(settings);
            await env.Db.PingAsync();
            await env.Lane.EnsureIndexesAsync();
            await env.Store.EnsureIndexesAsync();
            return env;
        }

        public async Task<string> VipAsync(long coins = 100_000, long bonus = 0)
        {
            var id = ObjectId.GenerateNewId().ToString();
            await Market.EnsureAccountAsync(id);
            await Store.Accounts.UpdateOneAsync(account => account.Id == id,
                Builders<MarketAccount>.Update.Set(account => account.Balance, coins).Set(account => account.BonusBalance, bonus));
            return id;
        }

        /// <summary>A VIP order whose price is held, the way <c>CreatePreviewAsync</c> leaves it.</summary>
        public async Task<AiCaseDraft> HeldDraftAsync(string speed = VipSpeeds.Fast, string? userId = null,
            string preset = AiGenerationPresets.NormalRandom, int extraPixelLab = 0)
        {
            userId ??= await VipAsync();
            var order = new AiCaseOrder { Speed = speed, PixelLabCap = AiCaseOrder.VipPixelLabCap + extraPixelLab, VipExtraPixelLab = extraPixelLab };
            var draft = new AiCaseDraft
            {
                Id = ObjectId.GenerateNewId().ToString(),
                CreatedByUserId = userId,
                CreatedByRole = UserRole.Vip,
                Lane = AiDraftLanes.VipApi,
                Order = order,
                OrderStatus = AiOrderStatuses.QueuedForClaude,
                Status = AiDraftStatus.GeneratingStory,
                VipBilling = await Billing.PrepareAsync(userId, preset, order),
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            await Db.AiCaseDrafts.InsertOneAsync(draft);
            Assert.True(await Billing.HoldAsync(draft));
            return await DraftAsync(draft.Id);
        }

        public Task<AiCaseDraft> DraftAsync(string id) => Db.AiCaseDrafts.Find(item => item.Id == id).SingleAsync();

        public Task ParkAsync(string draftId, string requestId) =>
            Db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draftId,
                Builders<AiCaseDraft>.Update
                    .Set(item => item.QueueState, AiQueueStates.AwaitingClaude)
                    .Set(item => item.ClaudeWait, new AiClaudeWait { RequestId = requestId, Step = "test", Since = DateTime.UtcNow }));

        public async Task<MarketAccount> AccountAsync(string userId) => await Store.Accounts.Find(a => a.Id == userId).SingleAsync();

        public async ValueTask DisposeAsync()
        {
            if (Services is IDisposable disposable) disposable.Dispose();
            await _client.DropDatabaseAsync(_database);
        }
    }

    private sealed class TestHostEnvironment : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "SirLocked.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
