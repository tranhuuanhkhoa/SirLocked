using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Vip;

/// <summary>A VIP's quote for one order, shown on the order form before anything is held.</summary>
public sealed record VipQuote(
    string Preset,
    string Speed,
    int PixelLabCap,
    long PriceXu,
    long BasePriceXu,
    long ExtraPixelLabXu,
    long Balance,
    long BonusBalance,
    /// <summary>The most bonus coins this order may use (0 unless the settings allow a share).</summary>
    long MaxFromBonus,
    bool CanAfford,
    bool LaneConfigured,
    int EstimatedMinutes,
    /// <summary>False while VIP orders use library pictures and variants only (no extra PixelLab pictures for sale).</summary>
    bool PixelLabEnabled = false);

/// <summary>
/// Coins of VIP orders (VUAN-7 part C): the price is held when the order is placed and settled exactly once from the
/// draft's state, so it stays right across retries, concurrent requests and server restarts:
/// <list type="bullet">
/// <item>rejected by Yen, failed (terminal error, or any error left unretried for a day), cost cap, or cancelled before
/// work started: everything goes back;</item>
/// <item>cancelled by the VIP after work started: the unused part goes back (used = Claude spend + planned PixelLab);</item>
/// <item>delivered (the order reached SUBMITTED, the case imported): the held coins are spent.</item>
/// </list>
/// ADMIN orders are never billed. Operation keys: <c>vip-hold:&lt;draftId&gt;</c> and <c>vip-settle:&lt;draftId&gt;</c>.
/// </summary>
public sealed class VipBillingService(
    MongoDbContext db,
    CoinWalletService wallet,
    VipSettingsStore settings,
    IOptions<AnthropicSettings> anthropic,
    ILogger<VipBillingService> logger,
    TimeProvider? time = null)
{
    /// <summary>A failed order that nobody retried for this long is refunded and closed.</summary>
    public static readonly TimeSpan FailedOrderGrace = TimeSpan.FromHours(24);
    /// <summary>A hold still HOLDING after this long was interrupted; the reconciler finishes it.</summary>
    public static readonly TimeSpan InterruptedHoldAge = TimeSpan.FromMinutes(2);

    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private DateTime Now => _time.GetUtcNow().UtcDateTime;

    public bool LaneConfigured => anthropic.Value.IsConfigured;

    public static string HoldKey(string draftId) => $"vip-hold:{draftId}";
    public static string SettleKey(string draftId) => $"vip-settle:{draftId}";

    public async Task<VipQuote> QuoteAsync(string userId, string? preset, string? speed, int pixelLabCap, CancellationToken ct = default)
    {
        var pricing = await settings.GetPricingAsync(ct);
        var normalizedSpeed = VipSpeeds.Normalize(speed);
        // Without PixelLab for VIP orders there is nothing extra to buy: the cap stays at the included 30.
        var cap = pricing.PixelLabEnabled
            ? Math.Clamp(pixelLabCap <= 0 ? AiCaseOrder.VipPixelLabCap : pixelLabCap, AiCaseOrder.VipPixelLabCap,
                Math.Max(pricing.VipMaxPixelLabCap, AiCaseOrder.VipPixelLabCap))
            : AiCaseOrder.VipPixelLabCap;
        var price = Price(pricing, preset, normalizedSpeed, cap);
        var account = await db.Database.GetCollection<MarketAccount>("marketAccounts")
            .Find(item => item.Id == userId).FirstOrDefaultAsync(ct);
        var balance = account?.Balance ?? 0;
        var bonus = account?.BonusBalance ?? 0;
        var maxFromBonus = Math.Min(bonus, MaxBonusPart(pricing, price.Total));
        return new VipQuote(
            AiGenerationPresets.Normalize(preset), normalizedSpeed, cap, price.Total, price.Base, price.Extra,
            balance, bonus, maxFromBonus,
            CanAfford: balance + maxFromBonus >= price.Total,
            LaneConfigured: LaneConfigured,
            EstimatedMinutes: normalizedSpeed == VipSpeeds.Saver ? 24 * 60 : 90,
            PixelLabEnabled: pricing.PixelLabEnabled);
    }

    /// <summary>
    /// The billing a new VIP order starts with. Refuses an order the VIP lane cannot run (no API key) or the VIP cannot
    /// pay, before the draft exists, so nothing is held for an order that never starts.
    /// </summary>
    public async Task<AiVipBilling> PrepareAsync(string userId, string? preset, AiCaseOrder order, CancellationToken ct = default)
    {
        if (!LaneConfigured)
            throw new ApiException(409, "VIP orders are not open yet: the Claude API key is not configured on the server.",
                new ApiErrorDetails(VipLaneErrors.NotConfigured, "ai.vip." + VipLaneErrors.NotConfigured));
        var pricing = await settings.GetPricingAsync(ct);
        // The VIP's cap is 30 plus what they explicitly bought, never the order's own PixelLabCap field.
        var quote = await QuoteAsync(userId, preset, order.Speed, AiCaseOrder.VipPixelLabCap + Math.Max(0, order.VipExtraPixelLab), ct);
        if (!quote.CanAfford) throw Insufficient(quote.PriceXu, quote.Balance);
        var entry = pricing.PresetPrice(quote.Preset);
        var estimated = (quote.Speed == VipSpeeds.Saver ? entry.SaverCostVnd : entry.FastCostVnd)
                        + (quote.PixelLabCap - AiCaseOrder.VipPixelLabCap) * pricing.PixelLabVndPerGeneration;
        var fromBonus = Math.Min(quote.MaxFromBonus, quote.PriceXu);
        return new AiVipBilling
        {
            Speed = quote.Speed,
            Preset = quote.Preset,
            PixelLabCap = quote.PixelLabCap,
            PriceXu = quote.PriceXu,
            HeldFromBonus = fromBonus,
            HeldFromBalance = quote.PriceXu - fromBonus,
            State = AiVipBillingStates.Holding,
            EstimatedCostVnd = estimated,
            CostCapVnd = (long)Math.Ceiling(estimated * pricing.CostCapMultiplier),
            UsdToVnd = pricing.UsdToVnd,
            VndPerXu = pricing.VndPerXu,
            PixelLabVndPerGeneration = pricing.PixelLabVndPerGeneration,
            HeldAt = Now,
            EstimatedReadyAt = Now + (quote.Speed == VipSpeeds.Saver ? TimeSpan.FromHours(24) : TimeSpan.FromMinutes(90))
        };
    }

    /// <summary>Holds the price of a freshly inserted order. False when the coins were spent in the meantime.</summary>
    public async Task<bool> HoldAsync(AiCaseDraft draft, CancellationToken ct = default)
    {
        var billing = draft.VipBilling ?? throw new InvalidOperationException("Not a VIP order.");
        if (billing.State != AiVipBillingStates.Holding) return billing.State == AiVipBillingStates.Held;
        var held = await wallet.HoldAsync(draft.CreatedByUserId, HoldKey(draft.Id), billing.HeldFromBalance, billing.HeldFromBonus,
            WalletLedgerKinds.VipHold, draft.Id, ct);
        if (held.Succeeded)
        {
            await SetStateAsync(draft.Id, AiVipBillingStates.Holding, AiVipBillingStates.Held, null, ct);
            return true;
        }
        await SetStateAsync(draft.Id, AiVipBillingStates.Holding, AiVipBillingStates.NotHeld, null, ct);
        await CloseOrderAsync(draft.Id, VipLaneErrors.InsufficientCoins, "Not enough coins when the order was placed.", ct);
        return false;
    }

    public static ApiException Insufficient(long price, long balance) =>
        new(409, $"This order costs {price} coins; you have {balance}. Top up coins first.",
            new { code = VipLaneErrors.InsufficientCoins, messageKey = "ai.vip." + VipLaneErrors.InsufficientCoins, priceXu = price, balance });

    // ------------------------------------------------------------------ settlement

    public sealed record Settlement(string Outcome, long RefundXu, long ChargeXu, string Reason);

    /// <summary>Decides what the draft's state means for its coins (null = nothing to settle yet).</summary>
    public static Settlement? Decide(AiCaseDraft draft, DateTime now)
    {
        var billing = draft.VipBilling;
        if (billing is null || billing.State != AiVipBillingStates.Held) return null;
        var price = billing.PriceXu;

        if (draft.OrderStatus == AiOrderStatuses.Rejected)
            return new Settlement(AiVipBillingStates.Refunded, price, 0, "REJECTED");
        if (draft.OrderStatus == AiOrderStatuses.Submitted
            || draft.Status is AiDraftStatus.Imported or AiDraftStatus.Published)
            return new Settlement(AiVipBillingStates.Charged, 0, price, "DELIVERED");
        if (draft.Status == AiDraftStatus.Cancelled || draft.OrderStatus == AiOrderStatuses.Cancelled)
        {
            var byOwner = string.Equals(draft.CancelledByUserId, draft.CreatedByUserId, StringComparison.Ordinal);
            if (!byOwner || !billing.WorkStarted) return new Settlement(AiVipBillingStates.Refunded, price, 0, byOwner ? "CANCELLED_EARLY" : "CANCELLED_BY_ADMIN");
            var used = Math.Min(price, UsedXu(draft));
            return used >= price
                ? new Settlement(AiVipBillingStates.Charged, 0, price, "CANCELLED_ALL_USED")
                : new Settlement(AiVipBillingStates.PartiallyRefunded, price - used, used, "CANCELLED_AFTER_START");
        }
        var idle = draft.QueueState is AiQueueStates.None or "" && !string.IsNullOrWhiteSpace(draft.LastGenerationErrorCode);
        if (idle && VipLaneErrors.Terminal.Contains(draft.LastGenerationErrorCode))
            return new Settlement(AiVipBillingStates.Refunded, price, 0, draft.LastGenerationErrorCode);
        if (idle && now - draft.UpdatedAt >= FailedOrderGrace)
            return new Settlement(AiVipBillingStates.Refunded, price, 0, "FAILED:" + draft.LastGenerationErrorCode);
        return null;
    }

    /// <summary>What a VIP order used so far, in coins: Claude spend plus the PixelLab generations of its plan.</summary>
    public static long UsedXu(AiCaseDraft draft)
    {
        var billing = draft.VipBilling!;
        var pixelLabVnd = (draft.AssetPlan?.EstimatedGenerations ?? 0) * Math.Max(0, billing.PixelLabVndPerGeneration);
        return VipModelRouter.ToXu(billing.SpentVnd + pixelLabVnd, billing.VndPerXu <= 0 ? 10 : billing.VndPerXu);
    }

    /// <summary>Settles one order if its state calls for it. Safe to call any number of times, from anywhere.</summary>
    public async Task<string?> SettleAsync(string draftId, CancellationToken ct = default)
    {
        var draft = await db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(ct);
        if (draft?.VipBilling is null) return null;
        if (draft.VipBilling.State == AiVipBillingStates.Holding && Now - draft.VipBilling.HeldAt >= InterruptedHoldAge)
        {
            await FinishInterruptedHoldAsync(draft, ct);
            draft = await db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(ct);
            if (draft?.VipBilling is null) return null;
        }
        var decision = Decide(draft, Now);
        if (decision is null) return null;
        var billing = draft.VipBilling;
        // Refund in proportion: bonus coins go back to bonus, ordinary to ordinary; the spent part is taken from ordinary first.
        var refundBonus = Math.Min(billing.HeldFromBonus, decision.RefundXu);
        var refundBalance = Math.Min(billing.HeldFromBalance, decision.RefundXu - refundBonus);
        if (decision.RefundXu > 0 && decision.ChargeXu > 0)
        {
            // Partial: charge ordinary coins first, so a VIP who used bonus coins gets bonus coins back.
            var chargeFromBalance = Math.Min(billing.HeldFromBalance, decision.ChargeXu);
            refundBalance = billing.HeldFromBalance - chargeFromBalance;
            refundBonus = billing.HeldFromBonus - (decision.ChargeXu - chargeFromBalance);
        }
        var kind = decision.Outcome == AiVipBillingStates.Charged ? WalletLedgerKinds.VipCharge : WalletLedgerKinds.VipRefund;
        var settled = await wallet.SettleHoldAsync(draft.CreatedByUserId, SettleKey(draft.Id),
            billing.HeldFromBalance, billing.HeldFromBonus, refundBalance, refundBonus, kind, draft.Id, decision.Reason, ct);
        if (!settled.Succeeded)
        {
            logger.LogError("VIP order {DraftId} could not be settled ({Outcome}); the escrow is smaller than the hold.",
                draft.Id, decision.Outcome);
            return null;
        }
        await db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draft.Id && item.VipBilling != null && item.VipBilling.State == AiVipBillingStates.Held,
            Builders<AiCaseDraft>.Update
                .Set(item => item.VipBilling!.State, decision.Outcome)
                .Set(item => item.VipBilling!.RefundedXu, refundBalance + refundBonus)
                .Set(item => item.VipBilling!.ChargedXu, billing.PriceXu - refundBalance - refundBonus)
                .Set(item => item.VipBilling!.SettleReason, decision.Reason)
                .Set(item => item.VipBilling!.SettledAt, Now),
            cancellationToken: ct);
        if (decision.Outcome == AiVipBillingStates.Refunded && decision.Reason != "REJECTED" && !decision.Reason.StartsWith("CANCELLED", StringComparison.Ordinal))
            await CloseOrderAsync(draft.Id, decision.Reason, "Refunded: " + decision.Reason, ct);
        logger.LogInformation("VIP order {DraftId} settled: {Outcome} ({Reason}), refund {Refund} xu.",
            draft.Id, decision.Outcome, decision.Reason, refundBalance + refundBonus);
        return decision.Outcome;
    }

    /// <summary>Settles every VIP order whose state calls for it. The reconciler runs this on a timer.</summary>
    public async Task<int> ReconcileAsync(int limit = 100, CancellationToken ct = default)
    {
        var open = await db.AiCaseDrafts
            .Find(item => item.VipBilling != null
                          && (item.VipBilling.State == AiVipBillingStates.Held || item.VipBilling.State == AiVipBillingStates.Holding))
            .SortBy(item => item.UpdatedAt)
            .Limit(limit)
            .Project(item => item.Id)
            .ToListAsync(ct);
        var settled = 0;
        foreach (var id in open)
        {
            try
            {
                if (await SettleAsync(id, ct) is not null) settled++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(exception, "VIP order {DraftId} could not be reconciled.", id);
            }
        }
        return settled;
    }

    // ------------------------------------------------------------------ helpers

    private sealed record PriceParts(long Base, long Extra, long Total);

    private static PriceParts Price(VipPricingSettings pricing, string? preset, string speed, int cap)
    {
        var entry = pricing.PresetPrice(AiGenerationPresets.Normalize(preset));
        var basePrice = speed == VipSpeeds.Saver ? entry.SaverXu : entry.FastXu;
        var extra = Math.Max(0, cap - AiCaseOrder.VipPixelLabCap) * pricing.ExtraPixelLabGenerationXu;
        return new PriceParts(basePrice, extra, basePrice + extra);
    }

    private static long MaxBonusPart(VipPricingSettings pricing, long price) =>
        (long)Math.Floor(price * Math.Clamp(pricing.MaxBonusShare, 0m, 0.3m));

    private async Task FinishInterruptedHoldAsync(AiCaseDraft draft, CancellationToken ct)
    {
        var entry = await wallet.FindEntryAsync(HoldKey(draft.Id), ct);
        if (entry?.State == WalletLedgerStates.Applied)
        {
            await SetStateAsync(draft.Id, AiVipBillingStates.Holding, AiVipBillingStates.Held, null, ct);
            return;
        }
        // The hold never applied (or is half done): retry it once; the operation key keeps it single.
        await HoldAsync(draft, ct);
    }

    private Task SetStateAsync(string draftId, string from, string to, string? reason, CancellationToken ct) =>
        db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draftId && item.VipBilling != null && item.VipBilling.State == from,
            Builders<AiCaseDraft>.Update
                .Set(item => item.VipBilling!.State, to)
                .Set(item => item.VipBilling!.SettleReason, reason ?? string.Empty),
            cancellationToken: ct);

    /// <summary>Ends an order that will not continue: cancelled draft, CANCELLED order, open bridge questions cancelled.</summary>
    private async Task CloseOrderAsync(string draftId, string code, string reason, CancellationToken ct)
    {
        var now = Now;
        await db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draftId && item.Status != AiDraftStatus.Cancelled
                    && item.Status != AiDraftStatus.Imported && item.Status != AiDraftStatus.Published,
            Builders<AiCaseDraft>.Update
                .Set(item => item.Status, AiDraftStatus.Cancelled)
                .Set(item => item.QueueState, AiQueueStates.Cancelled)
                .Set(item => item.QueuedOperation, AiQueuedOperations.None)
                .Set(item => item.NextAttemptAt, null)
                .Set(item => item.ClaudeWait, null)
                .Set(item => item.LastGenerationErrorCode, code)
                .Set(item => item.OrderStatus, AiOrderStatuses.Cancelled)
                .Push(item => item.OrderStatusHistory, new AiOrderStatusChange
                {
                    Status = AiOrderStatuses.Cancelled, At = now, ByUserId = "system", Reason = reason
                })
                .Set(item => item.CancelledAt, now)
                .Set(item => item.CancelledByUserId, "system")
                .Set(item => item.WeeklyQuotaKey, null)
                .Set(item => item.ActiveQuotaKey, null)
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, now),
            cancellationToken: ct);
        await new Bridge.AiBridgeRequestStore(db, _time).CancelOwnerAsync(AiBridgeOwnerTypes.CaseDraft, draftId);
    }
}
