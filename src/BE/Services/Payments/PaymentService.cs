using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Payments;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Models.Payments;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Payments;

public sealed class PaymentService(MarketStore store, MarketService market, IPayOsClient provider,
    IOptions<PayOsSettings> settings, ILogger<PaymentService> logger)
{
    private readonly PayOsSettings _settings = settings.Value;
    public IMongoCollection<PaymentOrder> Orders => store.Context.Database.GetCollection<PaymentOrder>("paymentOrders");
    public bool Enabled => _settings.Enabled;
    public IReadOnlyList<CoinPackage> Packages => _settings.Packages;
    private void RequireEnabled()
    {
        if (!Enabled) throw Error(503, "PAYMENTS_DISABLED", "Nạp xu hiện chưa được mở. Vui lòng quay lại sau.");
    }
    public static ApiException Error(int status, string code, string message) => new(status, message, new ApiErrorDetails(code, "payments." + code));

    // Same caller + request key always addresses the same Mongo _id and provider order, even after timeouts.
    public static long OrderCode(string userId, string requestId) =>
        (long)(BinaryPrimitives.ReadUInt64BigEndian(SHA256.HashData(Encoding.UTF8.GetBytes(userId + ":" + requestId)))
            % 8_000_000_000_000_000UL) + 1_000_000_000_000_000L;

    public async Task<PaymentOrderDto> CreateAsync(string userId, CreateTopUpRequest request, CancellationToken ct)
    {
        RequireEnabled();
        if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrEmpty(request.RequestId) || !MarketService.RequestIdPattern.IsMatch(request.RequestId))
            throw Error(400, "INVALID_REQUEST", "Mã yêu cầu không hợp lệ.");
        var code = OrderCode(userId, request.RequestId);
        var order = await Orders.Find(o => o.OrderCode == code).FirstOrDefaultAsync(ct);
        if (order is null)
        {
            var pack = Packages.FirstOrDefault(p => p.Id == request.PackageId)
                ?? throw Error(400, "INVALID_PACKAGE", "Gói nạp không tồn tại.");
            order = new PaymentOrder
            {
                OrderCode = code, UserId = userId, RequestId = request.RequestId, PackageId = pack.Id,
                Amount = pack.Amount, Coins = pack.Coins, Description = "SLNAPXU",
                ReturnUrl = _settings.FrontendUrl.TrimEnd('/') + "/payments/" + code,
                CreatedAt = store.Now, ExpiresAt = store.Now.AddMinutes(_settings.ExpiryMinutes), NextCheckAt = store.Now
            };
            await market.EnsureAccountAsync(userId, ct);
            try { await Orders.InsertOneAsync(order, cancellationToken: ct); }
            catch (MongoWriteException e) when (e.WriteError.Category == ServerErrorCategory.DuplicateKey)
            { order = await Orders.Find(o => o.OrderCode == code).FirstAsync(ct); }
        }
        if (order.UserId != userId || order.RequestId != request.RequestId || order.PackageId != request.PackageId)
            throw Error(409, "REQUEST_CONFLICT", "Mã yêu cầu đã được dùng cho một gói nạp khác.");
        if (order.Status == "CREATING")
        {
            try
            {
                // Resolve an unknown create result before issuing the same request again.
                var link = await provider.GetAsync(code, ct);
                if (link is null && order.ExpiresAt > store.Now) link = await provider.CreateAsync(order, ct);
                if (link is not null) await ApplyLinkAsync(order, link, ct);
                else if (order.ExpiresAt <= store.Now) await SetUnpaidStatusAsync(code, "EXPIRED", ct);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                // Retain the persisted order. Never turn an unknown result into a new charge.
                logger.LogWarning("payOS creation for order {OrderCode} needs reconciliation ({Type}).", code, e.GetType().Name);
            }
        }
        return ToDto(await OwnedAsync(userId, code, ct));
    }

    private async Task<PaymentOrder> OwnedAsync(string userId, long code, CancellationToken ct) =>
        await Orders.Find(o => o.OrderCode == code && o.UserId == userId).FirstOrDefaultAsync(ct)
        ?? throw Error(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn nạp.");

    public async Task<PaymentOrderDto> GetAsync(string userId, long code, CancellationToken ct)
    {
        var order = await OwnedAsync(userId, code, ct);
        if (Enabled && order.Status != "CREDITED") await ReconcileAsync(order, ct);
        return ToDto(await OwnedAsync(userId, code, ct));
    }

    public async Task<IReadOnlyList<PaymentOrderDto>> HistoryAsync(string userId, CancellationToken ct) =>
        (await Orders.Find(o => o.UserId == userId).SortByDescending(o => o.CreatedAt).Limit(50).ToListAsync(ct)).Select(ToDto).ToList();

    public async Task<PaymentOrderDto> CancelAsync(string userId, long code, CancellationToken ct)
    {
        RequireEnabled();
        var order = await OwnedAsync(userId, code, ct);
        if (order.Status is "CREATING" or "PENDING")
        {
            try { await ApplyLinkAsync(order, await provider.CancelAsync(code, ct), ct); }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            { throw Error(502, "PROVIDER_UNAVAILABLE", "Chưa xác nhận được việc hủy. Vui lòng kiểm tra lại trạng thái."); }
        }
        return ToDto(await OwnedAsync(userId, code, ct));
    }

    public async Task HandleWebhookAsync(PayOsWebhook webhook, CancellationToken ct)
    {
        RequireEnabled();
        if (!PayOsSignature.Verify(webhook.Data, webhook.Signature, _settings.ChecksumKey))
            throw Error(400, "INVALID_SIGNATURE", "Invalid webhook signature.");
        var data = webhook.Data;
        if (!data.TryGetProperty("orderCode", out var codeElement) || !codeElement.TryGetInt64(out var code))
            throw Error(400, "INVALID_WEBHOOK", "Missing order code.");
        // payOS sends a signed sample when registering a webhook. Unknown orders are acknowledged, never credited.
        var order = await Orders.Find(o => o.OrderCode == code).FirstOrDefaultAsync(ct);
        if (order is null) return;
        if (!data.TryGetProperty("code", out var resultCode) || resultCode.ValueKind != System.Text.Json.JsonValueKind.String
            || !data.TryGetProperty("currency", out var currency) || currency.ValueKind != System.Text.Json.JsonValueKind.String
            || !data.TryGetProperty("paymentLinkId", out var linkId) || linkId.ValueKind != System.Text.Json.JsonValueKind.String
            || !data.TryGetProperty("amount", out var amount) || amount.ValueKind != System.Text.Json.JsonValueKind.Number
            || !amount.TryGetInt64(out var transferred) || transferred <= 0)
            throw Error(400, "INVALID_WEBHOOK", "Incomplete webhook data.");
        if (resultCode.GetString() != "00") return;
        if (currency.GetString() != "VND"
            || (order.PaymentLinkId.Length > 0 && linkId.GetString() != order.PaymentLinkId))
            throw Error(400, "PAYMENT_MISMATCH", "Webhook does not match the order.");
        if (order.Status == "CREDITED") return;
        // Never credit based on a redirect or on one partial transfer. Verify total paid with the authenticated API.
        var link = await provider.GetAsync(code, ct) ?? throw Error(503, "PAYMENT_UNCONFIRMED", "Payment is not available yet.");
        if (linkId.GetString() != link.Id)
            throw Error(400, "PAYMENT_MISMATCH", "Payment link mismatch.");
        await ApplyLinkAsync(order, link, ct);
    }

    public static bool Matches(PaymentOrder order, PayOsLink link) => link.OrderCode == order.OrderCode
        && link.Amount == order.Amount && !string.IsNullOrEmpty(link.Id)
        && (string.IsNullOrEmpty(order.PaymentLinkId) || order.PaymentLinkId == link.Id);

    private async Task ApplyLinkAsync(PaymentOrder order, PayOsLink link, CancellationToken ct)
    {
        if (!Matches(order, link)) throw Error(409, "PAYMENT_MISMATCH", "Thông tin payOS không khớp đơn nạp.");
        var update = Builders<PaymentOrder>.Update.Set(o => o.PaymentLinkId, link.Id);
        if (link.CheckoutUrl.Length > 0)
        {
            if (!Uri.TryCreate(link.CheckoutUrl, UriKind.Absolute, out var url) || url.Scheme != "https"
                || !(url.Host == "pay.payos.vn" || url.Host.EndsWith(".payos.vn", StringComparison.Ordinal)))
                throw Error(502, "INVALID_CHECKOUT", "Địa chỉ thanh toán không hợp lệ.");
            update = update.Set(o => o.CheckoutUrl, link.CheckoutUrl).Set(o => o.QrCode, link.QrCode)
                .Set(o => o.AccountName, link.AccountName).Set(o => o.AccountNumber, link.AccountNumber)
                .Set(o => o.BankBin, link.Bin).Set(o => o.Description, link.Description.Length > 0 ? link.Description : order.Description);
        }
        // An interrupted create can be recovered from the provider ID even when its QR response was lost.
        else if (order.CheckoutUrl.Length == 0 && System.Text.RegularExpressions.Regex.IsMatch(link.Id, "^[a-fA-F0-9]{32}$"))
            update = update.Set(o => o.CheckoutUrl, "https://pay.payos.vn/web/" + link.Id);
        await Orders.UpdateOneAsync(o => o.OrderCode == order.OrderCode, update, cancellationToken: ct);
        if (link.Status == "PAID" && link.AmountPaid == order.Amount)
        {
            await Orders.UpdateOneAsync(o => o.OrderCode == order.OrderCode && o.Status != "CREDITED",
                Builders<PaymentOrder>.Update.Set(o => o.Status, "PAID").Set(o => o.PaidAt, store.Now), cancellationToken: ct);
            await CreditAsync(order, ct);
        }
        else if (link.AmountPaid > order.Amount || link.Status == "PAID")
            await SetUnpaidStatusAsync(order.OrderCode, "REVIEW", ct);
        else if (link.Status is "CANCELLED" or "EXPIRED")
            await SetUnpaidStatusAsync(order.OrderCode, link.Status, ct);
        else await SetUnpaidStatusAsync(order.OrderCode, "PENDING", ct);
    }

    private Task SetUnpaidStatusAsync(long code, string status, CancellationToken ct) => Orders.UpdateOneAsync(
        o => o.OrderCode == code && o.Status != "PAID" && o.Status != "CREDITED",
        Builders<PaymentOrder>.Update.Set(o => o.Status, status), cancellationToken: ct);

    private async Task CreditAsync(PaymentOrder order, CancellationToken ct)
    {
        await market.EnsureAccountAsync(order.UserId, ct);
        var filter = Builders<MarketAccount>.Filter.Eq(a => a.Id, order.UserId)
            & Builders<MarketAccount>.Filter.Not(Builders<MarketAccount>.Filter.AnyEq(a => a.PaidTopUpIds, order.OrderCode))
            & Builders<MarketAccount>.Filter.Lte(a => a.Balance, long.MaxValue - order.Coins);
        await store.Accounts.UpdateOneAsync(filter, Builders<MarketAccount>.Update.Inc(a => a.Balance, order.Coins)
            .AddToSet(a => a.PaidTopUpIds, order.OrderCode).Set(a => a.UpdatedAt, store.Now), cancellationToken: ct);
        // Receipt and balance share one atomic document write; recovery after any crash cannot mint twice.
        if (!await store.Accounts.Find(a => a.Id == order.UserId && a.PaidTopUpIds.Contains(order.OrderCode)).AnyAsync(ct))
            throw Error(503, "CREDIT_PENDING", "Đã nhận tiền, đang xử lý cộng xu.");
        await Orders.UpdateOneAsync(o => o.OrderCode == order.OrderCode && o.Status == "PAID",
            Builders<PaymentOrder>.Update.Set(o => o.Status, "CREDITED").Set(o => o.CreditedAt, store.Now), cancellationToken: ct);
    }

    private async Task ReconcileAsync(PaymentOrder order, CancellationToken ct)
    {
        if (order.Status == "PAID") { await CreditAsync(order, ct); return; }
        if (order.NextCheckAt > store.Now) return;
        var claimed = await Orders.UpdateOneAsync(o => o.OrderCode == order.OrderCode && o.NextCheckAt <= store.Now,
            Builders<PaymentOrder>.Update.Set(o => o.NextCheckAt, store.Now.AddSeconds(30)), cancellationToken: ct);
        if (claimed.ModifiedCount == 0) return;
        try
        {
            var link = await provider.GetAsync(order.OrderCode, ct);
            if (link is null && order.Status == "CREATING" && order.ExpiresAt > store.Now)
                link = await provider.CreateAsync(order, ct);
            if (link is not null) await ApplyLinkAsync(order, link, ct);
            else if (order.ExpiresAt <= store.Now) await SetUnpaidStatusAsync(order.OrderCode, "EXPIRED", ct);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        { logger.LogWarning("payOS reconciliation postponed for {OrderCode} ({Type}).", order.OrderCode, e.GetType().Name); }
    }

    public async Task RecoverAsync(CancellationToken ct)
    {
        if (!Enabled) return;
        var recent = store.Now.AddDays(-7);
        var orders = await Orders.Find(o => o.Status == "PAID" || (o.Status != "CREDITED" && o.CreatedAt > recent && o.NextCheckAt <= store.Now))
            .SortBy(o => o.NextCheckAt).Limit(30).ToListAsync(ct);
        foreach (var order in orders)
        {
            try { await ReconcileAsync(order, ct); }
            catch (Exception e) when (e is not OperationCanceledException)
            { logger.LogError("Payment recovery failed for {OrderCode} ({Type}).", order.OrderCode, e.GetType().Name); }
        }
    }

    public static PaymentOrderDto ToDto(PaymentOrder o) => new(o.OrderCode, o.Amount, o.Coins, o.Status,
        o.CheckoutUrl, o.QrCode, o.AccountNumber, o.AccountName, o.BankBin, o.Description, o.CreatedAt, o.ExpiresAt, o.CreditedAt);
}
