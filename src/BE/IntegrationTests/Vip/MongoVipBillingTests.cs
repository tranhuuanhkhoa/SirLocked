using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Vip;
using Xunit;

namespace SirLocked.IntegrationTests.Vip;

/// <summary>
/// Coins of VIP orders (VUAN-7 part C) against a real MongoDB: the price is held once, then settled exactly once by
/// whatever the order became (rejected, delivered, cancelled before or after work started, failed, capped), even when
/// settlement runs many times at once or after a restart. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoVipBillingTests
{
    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static Task SetAsync(MongoVipLaneTests.VipEnv env, string draftId, UpdateDefinition<AiCaseDraft> update) =>
        env.Db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draftId, update);

    [Theory]
    [InlineData(AiGenerationPresets.ShortDemo, VipSpeeds.Fast, 0, 5_000)]
    [InlineData(AiGenerationPresets.NormalRandom, VipSpeeds.Fast, 0, 8_000)]
    [InlineData(AiGenerationPresets.PuzzleHeavy, VipSpeeds.Fast, 0, 9_500)]
    [InlineData(AiGenerationPresets.FullFeature, VipSpeeds.Fast, 0, 14_000)]
    [InlineData(AiGenerationPresets.NormalRandom, VipSpeeds.Saver, 0, 4_500)]
    [InlineData(AiGenerationPresets.FullFeature, VipSpeeds.Saver, 30, 7_950)]
    public async Task ThePrice_FollowsPresetSpeedAndExtraGenerations(string preset, string speed, int extra, long price)
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        if (extra > 0)
        {
            // Extra PixelLab pictures are only sold once PixelLab is on for VIP orders.
            var pricing = await env.Settings.GetPricingAsync();
            pricing.PixelLabEnabled = true;
            await env.Settings.SavePricingAsync(pricing, "admin");
        }
        var vip = await env.VipAsync(50_000);

        var quote = await env.Billing.QuoteAsync(vip, preset, speed, 30 + extra);
        var draft = await env.HeldDraftAsync(speed, vip, preset, extra);

        Assert.Equal(price, quote.PriceXu);
        Assert.Equal(price, draft.VipBilling!.PriceXu);
        Assert.Equal(AiVipBillingStates.Held, draft.VipBilling.State);
        Assert.Equal(50_000 - price, (await env.AccountAsync(vip)).Balance);
        Assert.Equal(price, (await env.AccountAsync(vip)).Held);
        Assert.Equal(2 * draft.VipBilling.EstimatedCostVnd, draft.VipBilling.CostCapVnd);
    }

    [Fact]
    public async Task WhilePixelLabIsOffForVipOrders_NoExtraPicturesAreSold()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(50_000);

        var quote = await env.Billing.QuoteAsync(vip, AiGenerationPresets.FullFeature, VipSpeeds.Saver, 60);
        var draft = await env.HeldDraftAsync(VipSpeeds.Saver, vip, AiGenerationPresets.FullFeature, 30);

        Assert.False(quote.PixelLabEnabled);
        Assert.Equal((30, 7_500L, 0L), (quote.PixelLabCap, quote.PriceXu, quote.ExtraPixelLabXu));
        Assert.Equal(7_500, draft.VipBilling!.PriceXu);
    }

    [Fact]
    public async Task WithoutAnApiKey_NoOrderIsTaken_AndNothingIsHeld()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(50_000);
        var closed = new VipBillingService(env.Db, env.Wallet, env.Settings, Options.Create(new AnthropicSettings()),
            NullLogger<VipBillingService>.Instance);

        var error = await Assert.ThrowsAsync<ApiException>(() => closed.PrepareAsync(vip, AiGenerationPresets.ShortDemo, new AiCaseOrder()));

        Assert.Equal(VipLaneErrors.NotConfigured, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
        Assert.Equal(50_000, (await env.AccountAsync(vip)).Balance);
        Assert.Equal(0, await env.Store.WalletLedger.CountDocumentsAsync(FilterDefinition<WalletLedgerEntry>.Empty));
    }

    [Fact]
    public async Task NotEnoughCoins_IsRefusedByTheServer_AndBonusCoinsDoNotCountByDefault()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(4_999, bonus: 100_000);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            env.Billing.PrepareAsync(vip, AiGenerationPresets.ShortDemo, new AiCaseOrder()));

        Assert.Equal(409, error.StatusCode);
        Assert.Contains(VipLaneErrors.InsufficientCoins, System.Text.Json.JsonSerializer.Serialize(error.Errors));
    }

    [Fact]
    public async Task BonusCoins_PayAtMostTheAllowedShare_AndGoBackToBonusOnRefund()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var pricing = await env.Settings.GetPricingAsync();
        pricing.MaxBonusShare = 0.3m;
        await env.Settings.SavePricingAsync(pricing, "admin");
        var vip = await env.VipAsync(6_000, bonus: 10_000);

        var draft = await env.HeldDraftAsync(VipSpeeds.Fast, vip, AiGenerationPresets.NormalRandom);
        Assert.Equal((5_600L, 2_400L), (draft.VipBilling!.HeldFromBalance, draft.VipBilling.HeldFromBonus)); // 30% of 8.000
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update.Set(item => item.OrderStatus, AiOrderStatuses.Rejected));
        await env.Billing.SettleAsync(draft.Id);

        var account = await env.AccountAsync(vip);
        Assert.Equal((6_000L, 10_000L, 0L, 0L), (account.Balance, account.BonusBalance, account.Held, account.BonusHeld));
    }

    [Fact]
    public async Task Rejected_RefundsEverything_OnceEvenWhenSettledManyTimesAtOnce()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(20_000);
        var draft = await env.HeldDraftAsync(userId: vip);
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update.Set(item => item.OrderStatus, AiOrderStatuses.Rejected));

        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() => env.Billing.SettleAsync(draft.Id))));
        await env.Billing.ReconcileAsync();

        var account = await env.AccountAsync(vip);
        Assert.Equal((20_000L, 0L), (account.Balance, account.Held));
        var stored = await env.DraftAsync(draft.Id);
        Assert.Equal((AiVipBillingStates.Refunded, 8_000L, 0L), (stored.VipBilling!.State, stored.VipBilling.RefundedXu, stored.VipBilling.ChargedXu));
        Assert.Equal(1, await env.Store.WalletLedger.CountDocumentsAsync(entry => entry.Id == VipBillingService.SettleKey(draft.Id)));
    }

    [Fact]
    public async Task Delivered_SpendsTheHeldCoins()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(20_000);
        var draft = await env.HeldDraftAsync(userId: vip);
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update
            .Set(item => item.Status, AiDraftStatus.ReadyToPublish).Set(item => item.OrderStatus, AiOrderStatuses.Submitted));

        Assert.Equal(AiVipBillingStates.Charged, await env.Billing.SettleAsync(draft.Id));

        var account = await env.AccountAsync(vip);
        Assert.Equal((12_000L, 0L), (account.Balance, account.Held));
        Assert.Equal(8_000, (await env.DraftAsync(draft.Id)).VipBilling!.ChargedXu);
    }

    [Fact]
    public async Task CancelledByTheVip_BeforeWorkStarted_RefundsEverything()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(20_000);
        var draft = await env.HeldDraftAsync(userId: vip);
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update
            .Set(item => item.Status, AiDraftStatus.Cancelled).Set(item => item.CancelledByUserId, vip));

        Assert.Equal(AiVipBillingStates.Refunded, await env.Billing.SettleAsync(draft.Id));
        Assert.Equal(20_000, (await env.AccountAsync(vip)).Balance);
    }

    [Fact]
    public async Task CancelledByTheVip_AfterWorkStarted_RefundsTheUnusedPart()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(20_000);
        var draft = await env.HeldDraftAsync(userId: vip);
        // 25.000 VND of Claude spend = 2.500 xu used.
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update
            .Set(item => item.VipBilling!.WorkStarted, true).Set(item => item.VipBilling!.SpentVnd, 25_000)
            .Set(item => item.Status, AiDraftStatus.Cancelled).Set(item => item.CancelledByUserId, vip));

        Assert.Equal(AiVipBillingStates.PartiallyRefunded, await env.Billing.SettleAsync(draft.Id));

        var account = await env.AccountAsync(vip);
        Assert.Equal((17_500L, 0L), (account.Balance, account.Held));
        var stored = await env.DraftAsync(draft.Id);
        Assert.Equal((5_500L, 2_500L), (stored.VipBilling!.RefundedXu, stored.VipBilling.ChargedXu));
    }

    [Fact]
    public async Task CancelledByAnAdmin_RefundsEverything_EvenAfterWorkStarted()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(20_000);
        var draft = await env.HeldDraftAsync(userId: vip);
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update
            .Set(item => item.VipBilling!.WorkStarted, true).Set(item => item.VipBilling!.SpentVnd, 25_000)
            .Set(item => item.Status, AiDraftStatus.Cancelled).Set(item => item.CancelledByUserId, "an-admin"));

        Assert.Equal(AiVipBillingStates.Refunded, await env.Billing.SettleAsync(draft.Id));
        Assert.Equal(20_000, (await env.AccountAsync(vip)).Balance);
    }

    [Theory]
    [InlineData(VipLaneErrors.CostCapReached)]
    [InlineData(VipLaneErrors.ContentRejected)]
    [InlineData(VipLaneErrors.Refused)]
    public async Task ATerminalFailure_RefundsEverythingAtOnce_AndClosesTheOrder(string code)
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(20_000);
        var draft = await env.HeldDraftAsync(userId: vip);
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update
            .Set(item => item.QueueState, AiQueueStates.None).Set(item => item.LastGenerationErrorCode, code)
            .Set(item => item.VipBilling!.WorkStarted, true).Set(item => item.VipBilling!.SpentVnd, 120_000));

        Assert.Equal(AiVipBillingStates.Refunded, await env.Billing.SettleAsync(draft.Id));

        Assert.Equal(20_000, (await env.AccountAsync(vip)).Balance);
        var stored = await env.DraftAsync(draft.Id);
        Assert.Equal((AiDraftStatus.Cancelled, AiOrderStatuses.Cancelled), (stored.Status, stored.OrderStatus));
    }

    [Fact]
    public async Task AnOrdinaryFailure_WaitsADayForAnAdminRetry_ThenRefunds()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(20_000);
        var draft = await env.HeldDraftAsync(userId: vip);
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update
            .Set(item => item.QueueState, AiQueueStates.None).Set(item => item.LastGenerationErrorCode, "AI_GENERATION_FAILED"));

        Assert.Null(await env.Billing.SettleAsync(draft.Id)); // fresh: an admin may still retry it
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update.Set(item => item.UpdatedAt, DateTime.UtcNow.AddHours(-25)));
        Assert.Equal(AiVipBillingStates.Refunded, await env.Billing.SettleAsync(draft.Id));
        Assert.Equal(20_000, (await env.AccountAsync(vip)).Balance);
    }

    [Fact]
    public async Task AnOrderStillRunning_IsNotSettled()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(20_000);
        var draft = await env.HeldDraftAsync(userId: vip);
        await SetAsync(env, draft.Id, Builders<AiCaseDraft>.Update.Set(item => item.QueueState, AiQueueStates.AwaitingClaude));

        Assert.Null(await env.Billing.SettleAsync(draft.Id));
        Assert.Equal(0, await env.Billing.ReconcileAsync());
        Assert.Equal(8_000, (await env.AccountAsync(vip)).Held);
    }

    [Fact]
    public async Task AHoldInterruptedByARestart_IsFinishedByTheReconciler()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(20_000);
        var order = new AiCaseOrder();
        var billing = await env.Billing.PrepareAsync(vip, AiGenerationPresets.NormalRandom, order);
        billing.HeldAt = DateTime.UtcNow.AddMinutes(-10);
        var draft = new AiCaseDraft
        {
            Id = MongoDB.Bson.ObjectId.GenerateNewId().ToString(), CreatedByUserId = vip, Lane = AiDraftLanes.VipApi,
            Order = order, VipBilling = billing, OrderStatus = AiOrderStatuses.AwaitingOwnerApproval, UpdatedAt = DateTime.UtcNow
        };
        await env.Db.AiCaseDrafts.InsertOneAsync(draft);
        // The wallet was charged, then the server stopped before the order recorded it.
        await env.Wallet.HoldAsync(vip, VipBillingService.HoldKey(draft.Id), billing.HeldFromBalance, 0, WalletLedgerKinds.VipHold, draft.Id);

        await env.Billing.ReconcileAsync();

        Assert.Equal(AiVipBillingStates.Held, (await env.DraftAsync(draft.Id)).VipBilling!.State);
        var account = await env.AccountAsync(vip);
        Assert.Equal((12_000L, 8_000L), (account.Balance, account.Held)); // held once, not twice
    }

    [Fact]
    public async Task TwoOrdersAtOnce_CannotHoldTheSameCoins()
    {
        if (!Enabled) return;
        await using var env = await MongoVipLaneTests.VipEnv.CreateAsync();
        var vip = await env.VipAsync(10_000);
        var drafts = new List<AiCaseDraft>();
        foreach (var _ in Enumerable.Range(0, 2))
        {
            var order = new AiCaseOrder();
            var draft = new AiCaseDraft
            {
                Id = MongoDB.Bson.ObjectId.GenerateNewId().ToString(), CreatedByUserId = vip, Lane = AiDraftLanes.VipApi,
                Order = order, VipBilling = await env.Billing.PrepareAsync(vip, AiGenerationPresets.NormalRandom, order),
                UpdatedAt = DateTime.UtcNow
            };
            await env.Db.AiCaseDrafts.InsertOneAsync(draft);
            drafts.Add(draft);
        }

        var held = await Task.WhenAll(drafts.Select(draft => Task.Run(() => env.Billing.HoldAsync(draft))));

        Assert.Equal(1, held.Count(ok => ok));
        var account = await env.AccountAsync(vip);
        Assert.Equal((2_000L, 8_000L), (account.Balance, account.Held));
        var states = (await env.Db.AiCaseDrafts.Find(item => item.CreatedByUserId == vip).ToListAsync()).Select(item => item.VipBilling!.State).Order().ToList();
        Assert.Equal(new[] { AiVipBillingStates.Held, AiVipBillingStates.NotHeld }, states);
    }
}
