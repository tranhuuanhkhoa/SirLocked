using System.ComponentModel.DataAnnotations;

namespace SirLocked.Api.DTOs.Market;

public sealed record ChestOddsDto(string Rarity, decimal Percent);

/// <summary>Which chest drawing to use and the three colours of its light, as "r,g,b".</summary>
public sealed record ChestLookDto(string Template, string Light, string Hi, string Core);

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
    IReadOnlyList<ItemDefDto> Contents,
    ChestLookDto? Look = null,
    // This chest's own table. Each chest has one.
    IReadOnlyList<ChestOddsDto>? Odds = null,
    // False: the shop no longer sells it or its key. Copies already held still open.
    bool Active = true);

public sealed record ChestListDto(
    IReadOnlyList<ChestDto> Chests,
    // The first chest's table, for clients that have not moved to ChestDto.Odds.
    IReadOnlyList<ChestOddsDto> Odds,
    // Chests switched off that this detective still holds a chest or key of, so they can still be opened.
    IReadOnlyList<ChestDto> OffSale,
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

    /// <summary>The price the page showed. If the shop's price has moved since, the purchase is refused instead of charging a surprise.</summary>
    public long? ExpectedPrice { get; set; }
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
