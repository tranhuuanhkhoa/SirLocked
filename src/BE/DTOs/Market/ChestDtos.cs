using System.ComponentModel.DataAnnotations;

namespace SirLocked.Api.DTOs.Market;

public sealed record ChestOddsDto(string Rarity, decimal Percent);

/// <summary>
/// Which chest drawing to use and the three colours of its light, as "r,g,b". ImageUrl and KeyImageUrl are the chest's
/// and its key's own pictures when an admin gave them some; without one, the template's drawing is used.
/// </summary>
public sealed record ChestLookDto(
    string Template, string Light, string Hi, string Core, string? ImageUrl = null, string? KeyImageUrl = null, ChestSceneDto? Scene = null)
{
    public static ChestLookDto Of(SirLocked.Api.Models.Catalog.CatalogChestLook look) =>
        new(look.Template, look.Light, look.Hi, look.Core, NullIfEmpty(look.ImageUrl), NullIfEmpty(look.KeyImageUrl),
            look.Scene is { } scene ? ChestSceneDto.Of(scene) : null);

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}

/// <summary>
/// An opening scene an admin made ("kiểu hòm"), sent with the look of every chest that uses it: the room, what drifts,
/// the colours, the stamp, and the pictures a chest of this style shows unless it has its own.
/// </summary>
public sealed record ChestSceneDto(
    string Id, string Name, string NameEn, string BackdropUrl, string Particles, string? ParticleUrl,
    string Accent, string Accent2, string StampText, string StampTextEn, string StampColor, string ChestImageUrl, string KeyImageUrl)
{
    public static ChestSceneDto Of(SirLocked.Api.Models.Catalog.CatalogChestStyle style) => new(
        style.Id, style.Name, style.NameEn, style.BackdropUrl, style.Particles, string.IsNullOrEmpty(style.ParticleUrl) ? null : style.ParticleUrl,
        style.Accent, style.Accent2, style.StampText, style.StampTextEn, style.StampColor, style.ChestImageUrl, style.KeyImageUrl);
}

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
    WalletDto Wallet,
    // False: the shop sells keys only (Chests:SellChests); chests come from rewards such as the weekly challenge.
    bool ChestsForSale = true);

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
