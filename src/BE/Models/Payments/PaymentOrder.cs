using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models.Payments;

public sealed class PaymentOrder
{
    [BsonId] public long OrderCode { get; set; }
    public string UserId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string PackageId { get; set; } = "";
    public int Amount { get; set; }
    public long Coins { get; set; }
    public string Status { get; set; } = "CREATING";
    public string Description { get; set; } = "";
    public string ReturnUrl { get; set; } = "";
    public string PaymentLinkId { get; set; } = "";
    public string CheckoutUrl { get; set; } = "";
    public string QrCode { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string AccountName { get; set; } = "";
    public string BankBin { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime NextCheckAt { get; set; }
    public DateTime? PaidAt { get; set; }
    public DateTime? CreditedAt { get; set; }
}
