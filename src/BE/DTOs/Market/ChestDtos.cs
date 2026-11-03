using System.ComponentModel.DataAnnotations;

namespace SirLocked.Api.DTOs.Market;

public sealed record ChestOddsDto(string Rarity, decimal Percent);

public sealed record ChestDto(
    string Id,
    string KeyDefId,
    string Name,
    string NameEn,
    string Subtitle,
    string SubtitleEn,
    string KeyName,
    string KeyNameEn,
    string IconKey,
    string KeyIconKey,
    long ChestPrice,
    long KeyPrice,
    // Free copies only: one listed on the market or inside a trade cannot be used.
    int ChestCount,
    int KeyCount,
    IReadOnlyList<ItemDefDto> Contents);

public sealed record ChestListDto(
    IReadOnlyList<ChestDto> Chests,
    IReadOnlyList<ChestOddsDto> Odds,
    WalletDto Wallet);

public sealed record ChestOpenResultDto(
    string ChestId,
    string ItemId,
    ItemDefDto Item,
    int ChestCount,
    int KeyCount,
    WalletDto Wallet);

public sealed record ChestPurchaseResultDto(
    string ChestId,
    string ItemId,
    ItemDefDto Item,
    int ChestCount,
    int KeyCount,
    WalletDto Wallet);

// ----- requests -----

public class ChestOperationRequest
{
    [Required, StringLength(64, MinimumLength = 8)]
    public string IdempotencyKey { get; set; } = string.Empty;
}

public class ChestAdminGrantRequest
{
    [Required, StringLength(64, MinimumLength = 1)]
    public string UserId { get; set; } = string.Empty;

    [Required, StringLength(64, MinimumLength = 1)]
    public string ChestId { get; set; } = string.Empty;

    [Range(0, 12)]
    public int Chests { get; set; }

    [Range(0, 12)]
    public int Keys { get; set; }
}
