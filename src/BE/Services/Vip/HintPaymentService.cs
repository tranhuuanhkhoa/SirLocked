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

/// <summary>How the player wants to pay for a paid hint level: "XU" or "AD" (with the ticket of a watched ad).</summary>
public sealed record HintPayment(string? PayWith, string? AdTicketId)
{
    public static readonly HintPayment None = new(null, null);
}

/// <summary>
/// Paid hints (VUAN-7 part G): level 1 is free; level 2 costs a rewarded ad (when ads are on) or coins; level 3 costs
/// coins. Each paid level also takes a share of the case score. The first detective of a room to open a level pays for
/// it, the partner sees it for free, and opening it again never charges twice. Tutorial and playtest rooms are free.
/// Coins are spent bonus-first; every paid hint is recorded as revenue of its case (author share, admin report).
/// </summary>
public sealed class HintPaymentService(
    MongoDbContext db,
    CoinWalletService wallet,
    VipSettingsStore settings,
    IOptions<AdsSettings> ads,
    TimeProvider? time = null)
{
    public const string PaymentRequired = "HINT_PAYMENT_REQUIRED";
    public const string InsufficientCoins = "HINT_INSUFFICIENT_COINS";
    public const string AdNotAvailable = "HINT_AD_NOT_AVAILABLE";
    public const string AdNotFinished = "HINT_AD_NOT_FINISHED";
    public const string PurchaseInProgress = "HINT_PURCHASE_IN_PROGRESS";
    public const string AdsDisabled = "ADS_DISABLED";
    /// <summary>An ad shorter than this cannot have been watched; the ticket stays ISSUED.</summary>
    public static readonly TimeSpan MinimumAdSeconds = TimeSpan.FromSeconds(5);

    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private DateTime Now => _time.GetUtcNow().UtcDateTime;

    public IMongoCollection<HintPurchase> Purchases => db.Database.GetCollection<HintPurchase>("hintPurchases");
    public IMongoCollection<AdTicket> AdTickets => db.Database.GetCollection<AdTicket>("adTickets");
    public IMongoCollection<CaseRevenueEvent> Revenue => db.Database.GetCollection<CaseRevenueEvent>("caseRevenue");

    public bool AdsActive => ads.Value.IsActive;

    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await AdTickets.Indexes.CreateOneAsync(new CreateIndexModel<AdTicket>(
            Builders<AdTicket>.IndexKeys.Ascending(ticket => ticket.UserId).Descending(ticket => ticket.IssuedAt),
            new CreateIndexOptions { Name = "ix_adTickets_user_issuedAt" }), cancellationToken: ct);
        await Revenue.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<CaseRevenueEvent>(Builders<CaseRevenueEvent>.IndexKeys.Ascending(item => item.CaseId).Descending(item => item.At),
                new CreateIndexOptions { Name = "ix_caseRevenue_case_at" }),
            new CreateIndexModel<CaseRevenueEvent>(Builders<CaseRevenueEvent>.IndexKeys.Ascending(item => item.ShareBatchId).Ascending(item => item.At),
                new CreateIndexOptions { Name = "ix_caseRevenue_shareBatch_at" })
        }, ct);
    }

    /// <summary>
    /// Decides what opening <paramref name="hintKey"/> (level <paramref name="tier"/>) costs this player and charges it.
    /// Throws 402 <see cref="PaymentRequired"/> when a paid level comes without a payment choice.
    /// </summary>
    public async Task<HintUsageRecord> AuthorizeAsync(
        CurrentUser user, GameRoom room, string hintKey, int tier, HintPayment payment, CancellationToken ct = default)
    {
        var prices = await settings.GetHintsAsync(ct);
        var penalty = tier switch { <= 1 => 0, 2 => prices.Level2PenaltyPercent, _ => prices.Level3PenaltyPercent };
        HintUsageRecord Usage(string paidWith, long price) => new()
        {
            HintKey = hintKey, Tier = tier, PaidWith = paidWith, PriceXu = price, PenaltyPercent = penalty, UserId = user.Id, At = Now
        };
        if (tier <= 1 || TutorialRules.IsTutorialRoom(room) || room.Playtest is not null)
            return Usage(HintPaidWith.Free, 0);

        var purchaseId = $"{room.Id}:{hintKey}";
        var existing = await Purchases.Find(item => item.Id == purchaseId).FirstOrDefaultAsync(ct);
        if (existing?.State == HintPurchaseStates.Done) return FromPurchase(existing, user.Id);
        if (existing is not null && existing.UserId != user.Id)
            throw new ApiException(409, "Your partner is paying for this hint right now.",
                new ApiErrorDetails(PurchaseInProgress, "game.hint.purchaseInProgress"));

        if (tier == 2 && prices.VipFreeLevel2 && string.Equals(user.Role, UserRole.Vip, StringComparison.OrdinalIgnoreCase))
            return FromPurchase(await RecordAsync(purchaseId, room, user, hintKey, tier, HintPaidWith.VipFree, 0, penalty, ct), user.Id);

        var price = tier == 2 ? prices.Level2Xu : prices.Level3Xu;
        var payWith = (payment.PayWith ?? string.Empty).Trim().ToUpperInvariant();
        if (payWith is not (HintPaidWith.Coins or HintPaidWith.Ad))
            throw new ApiException(402, $"Hint level {tier} is paid.", new
            {
                code = PaymentRequired,
                messageKey = "game.hint.paymentRequired",
                tier,
                priceXu = price,
                adAvailable = tier == 2 && AdsActive,
                penaltyPercent = penalty
            });

        if (payWith == HintPaidWith.Ad)
        {
            if (tier != 2 || !AdsActive)
                throw ApiException.BadRequest("A rewarded ad can only open a level-2 hint, and only when ads are on.",
                    new ApiErrorDetails(AdNotAvailable, "game.hint.adNotAvailable"));
            var now = Now;
            var ticket = await AdTickets.FindOneAndUpdateAsync(
                item => item.Id == payment.AdTicketId && item.UserId == user.Id && item.RoomId == room.Id
                        && item.State == AdTicketStates.Viewed && item.ExpiresAt > now,
                Builders<AdTicket>.Update
                    .Set(item => item.State, AdTicketStates.Used)
                    .Set(item => item.UsedAt, now)
                    .Set(item => item.UsedForHintKey, hintKey),
                cancellationToken: ct);
            if (ticket is null)
                throw ApiException.Conflict("The ad was not watched to the end. Watch it again or pay with coins.",
                    AdNotFinished, "game.hint.adNotFinished");
            var purchase = await RecordAsync(purchaseId, room, user, hintKey, tier, HintPaidWith.Ad, 0, penalty, ct);
            await RevenueAsync(purchase, CaseRevenueKinds.AdView, 0, prices.AdRevenueVndPerView, ct);
            return FromPurchase(purchase, user.Id);
        }

        if (price <= 0)
            return FromPurchase(await RecordAsync(purchaseId, room, user, hintKey, tier, HintPaidWith.Coins, 0, penalty, ct), user.Id);

        // Coins: claim the purchase first (so the partner cannot pay too), then spend, then confirm.
        var pending = await ClaimAsync(purchaseId, room, user, hintKey, tier, price, penalty, ct);
        if (pending.State == HintPurchaseStates.Done) return FromPurchase(pending, user.Id);
        var spend = await wallet.SpendPreferBonusAsync(user.Id, $"hint:{purchaseId}", price, WalletLedgerKinds.HintPurchase, room.Id, hintKey, ct);
        if (!spend.Succeeded)
        {
            await Purchases.DeleteOneAsync(item => item.Id == purchaseId && item.State == HintPurchaseStates.Pending && item.UserId == user.Id, ct);
            throw new ApiException(409, $"This hint costs {price} coins.",
                new { code = InsufficientCoins, messageKey = "game.hint.insufficientCoins", priceXu = price });
        }
        var done = await Purchases.FindOneAndUpdateAsync(
            item => item.Id == purchaseId,
            Builders<HintPurchase>.Update.Set(item => item.State, HintPurchaseStates.Done).Set(item => item.UpdatedAt, Now),
            new FindOneAndUpdateOptions<HintPurchase> { ReturnDocument = ReturnDocument.After }, ct) ?? pending;
        await RevenueAsync(done, CaseRevenueKinds.HintCoins, price, 0, ct);
        return FromPurchase(done, user.Id);
    }

    public async Task<AdTicket> IssueAdTicketAsync(CurrentUser user, GameRoom room, CancellationToken ct = default)
    {
        if (!AdsActive)
            throw ApiException.Conflict("Rewarded ads are not on.", AdsDisabled, "game.ads.disabled");
        var now = Now;
        var ticket = new AdTicket
        {
            Id = MongoDB.Bson.ObjectId.GenerateNewId().ToString(),
            UserId = user.Id,
            RoomId = room.Id,
            IssuedAt = now,
            ExpiresAt = now + TimeSpan.FromSeconds(Math.Clamp(ads.Value.TicketTtlSeconds, 60, 3600))
        };
        await AdTickets.InsertOneAsync(ticket, cancellationToken: ct);
        return ticket;
    }

    /// <summary>The ad SDK reported the ad watched to the end (its <c>adViewed</c> callback).</summary>
    public async Task<AdTicket> MarkViewedAsync(CurrentUser user, string roomId, string ticketId, CancellationToken ct = default)
    {
        var now = Now;
        var earliest = now - MinimumAdSeconds;
        var ticket = await AdTickets.FindOneAndUpdateAsync(
            item => item.Id == ticketId && item.UserId == user.Id && item.RoomId == roomId
                    && item.State == AdTicketStates.Issued && item.ExpiresAt > now && item.IssuedAt <= earliest,
            Builders<AdTicket>.Update.Set(item => item.State, AdTicketStates.Viewed).Set(item => item.ViewedAt, now),
            new FindOneAndUpdateOptions<AdTicket> { ReturnDocument = ReturnDocument.After }, ct);
        return ticket ?? throw ApiException.Conflict("This ad ticket cannot be confirmed (unknown, expired or too quick).",
            AdNotFinished, "game.hint.adNotFinished");
    }

    // ------------------------------------------------------------------ helpers

    private static HintUsageRecord FromPurchase(HintPurchase purchase, string userId) => new()
    {
        HintKey = purchase.HintKey,
        Tier = purchase.Tier,
        // The partner of the payer opens it for free.
        PaidWith = purchase.UserId == userId ? purchase.PaidWith : HintPaidWith.Free,
        PriceXu = purchase.UserId == userId ? purchase.PriceXu : 0,
        PenaltyPercent = purchase.PenaltyPercent,
        UserId = userId,
        At = purchase.UpdatedAt
    };

    private async Task<HintPurchase> ClaimAsync(
        string id, GameRoom room, CurrentUser user, string hintKey, int tier, long price, int penalty, CancellationToken ct)
    {
        try
        {
            var purchase = NewPurchase(id, room, user, hintKey, tier, HintPaidWith.Coins, price, penalty, HintPurchaseStates.Pending);
            await Purchases.InsertOneAsync(purchase, cancellationToken: ct);
            return purchase;
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            var stored = await Purchases.Find(item => item.Id == id).FirstAsync(ct);
            if (stored.State != HintPurchaseStates.Done && stored.UserId != user.Id)
                throw new ApiException(409, "Your partner is paying for this hint right now.",
                    new ApiErrorDetails(PurchaseInProgress, "game.hint.purchaseInProgress"));
            return stored;
        }
    }

    private async Task<HintPurchase> RecordAsync(
        string id, GameRoom room, CurrentUser user, string hintKey, int tier, string paidWith, long price, int penalty, CancellationToken ct)
    {
        try
        {
            var purchase = NewPurchase(id, room, user, hintKey, tier, paidWith, price, penalty, HintPurchaseStates.Done);
            await Purchases.InsertOneAsync(purchase, cancellationToken: ct);
            return purchase;
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            return await Purchases.Find(item => item.Id == id).FirstAsync(ct);
        }
    }

    private HintPurchase NewPurchase(
        string id, GameRoom room, CurrentUser user, string hintKey, int tier, string paidWith, long price, int penalty, string state) => new()
    {
        Id = id, RoomId = room.Id, CaseId = room.CaseId, UserId = user.Id, HintKey = hintKey, Tier = tier,
        PaidWith = paidWith, PriceXu = price, PenaltyPercent = penalty, State = state, CreatedAt = Now, UpdatedAt = Now
    };

    private async Task RevenueAsync(HintPurchase purchase, string kind, long xu, long vnd, CancellationToken ct)
    {
        try
        {
            await Revenue.InsertOneAsync(new CaseRevenueEvent
            {
                Id = purchase.Id, CaseId = purchase.CaseId, RoomId = purchase.RoomId, UserId = purchase.UserId,
                Kind = kind, Xu = xu, Vnd = vnd, At = Now
            }, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Recorded by an earlier attempt.
        }
    }
}
