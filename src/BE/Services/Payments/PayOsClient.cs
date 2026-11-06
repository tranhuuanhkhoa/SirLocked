using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Payments;

namespace SirLocked.Api.Services.Payments;

public sealed record PayOsLink(long OrderCode, int Amount, long AmountPaid, string Id, string Status,
    string CheckoutUrl = "", string QrCode = "", string AccountNumber = "", string AccountName = "", string Bin = "", string Description = "");

public interface IPayOsClient
{
    Task<PayOsLink> CreateAsync(PaymentOrder order, CancellationToken ct);
    Task<PayOsLink?> GetAsync(long orderCode, CancellationToken ct);
    Task<PayOsLink> CancelAsync(long orderCode, CancellationToken ct);
}

public sealed class PayOsClient(HttpClient http, IOptions<PayOsSettings> options) : IPayOsClient
{
    private readonly PayOsSettings _settings = options.Value;

    public async Task<PayOsLink> CreateAsync(PaymentOrder order, CancellationToken ct)
    {
        var signed = JsonSerializer.SerializeToElement(new { amount = order.Amount, cancelUrl = order.ReturnUrl,
            description = order.Description, orderCode = order.OrderCode, returnUrl = order.ReturnUrl });
        var data = await SendAsync(HttpMethod.Post, "v2/payment-requests", new
        {
            orderCode = order.OrderCode, amount = order.Amount, description = order.Description,
            returnUrl = order.ReturnUrl, cancelUrl = order.ReturnUrl,
            expiredAt = new DateTimeOffset(order.ExpiresAt).ToUnixTimeSeconds(),
            signature = PayOsSignature.Sign(signed, _settings.ChecksumKey)
        }, ct);
        return Read(data!.Value, true);
    }

    public async Task<PayOsLink?> GetAsync(long orderCode, CancellationToken ct)
    {
        var data = await SendAsync(HttpMethod.Get, $"v2/payment-requests/{orderCode}", null, ct, allowMissing: true);
        return data is null ? null : Read(data.Value, false);
    }

    public async Task<PayOsLink> CancelAsync(long orderCode, CancellationToken ct) => Read((await SendAsync(
        HttpMethod.Post, $"v2/payment-requests/{orderCode}/cancel", new { cancellationReason = "Cancelled by customer" }, ct))!.Value, false);

    private async Task<JsonElement?> SendAsync(HttpMethod method, string path, object? body, CancellationToken ct, bool allowMissing = false)
    {
        using var request = new HttpRequestMessage(method, "https://api-merchant.payos.vn/" + path);
        request.Headers.Add("x-client-id", _settings.ClientId);
        request.Headers.Add("x-api-key", _settings.ApiKey);
        if (body is not null) request.Content = JsonContent.Create(body);
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var root = json.RootElement;
        var code = root.GetProperty("code").GetString();
        if (allowMissing && code == "101") return null; // payOS: payment link not found.
        if (code != "00") throw new HttpRequestException("payOS rejected the request (" + code + ").");
        var data = root.GetProperty("data");
        if (!PayOsSignature.Verify(data, root.GetProperty("signature").GetString(), _settings.ChecksumKey))
            throw new HttpRequestException("Invalid payOS response signature.");
        return data.Clone();
    }

    private static string Text(JsonElement data, string key) => data.TryGetProperty(key, out var value) ? value.GetString() ?? "" : "";
    private static PayOsLink Read(JsonElement data, bool created) => new(
        data.GetProperty("orderCode").GetInt64(), data.GetProperty("amount").GetInt32(),
        data.TryGetProperty("amountPaid", out var paid) ? paid.GetInt64() : 0,
        Text(data, created ? "paymentLinkId" : "id"), Text(data, "status"),
        Text(data, "checkoutUrl"), Text(data, "qrCode"), Text(data, "accountNumber"),
        Text(data, "accountName"), Text(data, "bin"), Text(data, "description"));
}
