using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace SirLocked.Api.DTOs.Payments;

public sealed record CreateTopUpRequest(
    [Required, RegularExpression("^[a-z0-9-]{1,32}$")] string PackageId,
    [Required, RegularExpression("^[A-Za-z0-9_-]{8,64}$")] string RequestId);

public sealed record PaymentOrderDto(long OrderCode, int Amount, long Coins, string Status,
    string CheckoutUrl, string QrCode, string AccountNumber, string AccountName, string BankBin,
    string Description, DateTime CreatedAt, DateTime ExpiresAt, DateTime? CreditedAt);

public sealed record PayOsWebhook(string Code, bool Success, JsonElement Data, string Signature);
