using System.ComponentModel.DataAnnotations;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.DTOs.Admin;

/// <summary>The errors body of a refused admin write: a stable code, and each broken rule with a message to show as is.</summary>
public sealed record AdminChestsErrorDetails(string Code, IReadOnlyList<CatalogRuleViolation> Violations);

// ----- items -----

public sealed record AdminItemChestDto(string Id, string Name);

public sealed record AdminItemDto(
    string Id,
    string Category,
    string Rarity,
    string Name,
    string NameEn,
    // What the form edits. Empty on a cosmetic that writes its description from the chest pools.
    string Description,
    string DescriptionEn,
    // What players read.
    string DisplayDescription,
    string DisplayDescriptionEn,
    long ReferencePrice,
    bool Tradable,
    bool Retired,
    int SortOrder,
    int Version,
    string? IconKey,
    ItemVisual Visual,
    long Circulating,
    IReadOnlyList<AdminItemChestDto> Chests,
    // False for cosmetics, chests and keys: each has its own page.
    bool Editable,
    bool Deletable);

public sealed record AdminItemListDto(IReadOnlyList<AdminItemDto> Items, string NextCurioId, IReadOnlyList<string> Problems);

public class AdminItemCreateRequest
{
    public string? Name { get; set; }
    public string? NameEn { get; set; }
    public string? Description { get; set; }
    public string? DescriptionEn { get; set; }
    public string? Rarity { get; set; }
    public long ReferencePrice { get; set; }
    public bool Tradable { get; set; } = true;
    public string? IconKey { get; set; }
    public string? ImageUrl { get; set; }
}

public sealed class AdminItemUpdateRequest : AdminItemCreateRequest
{
    public int ExpectedVersion { get; set; }

    [StringLength(500)]
    public string? Reason { get; set; }
}

public sealed class AdminItemRetireRequest
{
    public bool Retired { get; set; }

    [StringLength(500)]
    public string? Reason { get; set; }
}

public sealed class AdminDeleteItemRequest
{
    [StringLength(500)]
    public string? Reason { get; set; }
}

// ----- chests -----

public sealed record AdminChestRowDto(
    string Id,
    string KeyDefId,
    string Name,
    string NameEn,
    string Subtitle,
    string KeyName,
    string IconKey,
    string KeyIconKey,
    ChestLookDto? Look,
    long ChestPrice,
    long KeyPrice,
    bool Active,
    int SortOrder,
    int Version,
    long OpensLast7Days,
    decimal ExpectedValue,
    long Cost,
    int PoolCount);

public sealed record AdminChestListDto(IReadOnlyList<AdminChestRowDto> Chests, IReadOnlyList<string> Problems);

public sealed record AdminPoolItemDto(ItemDefDto Def, bool Retired, decimal RatePercent);

public sealed record AdminChestDetailDto(
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
    ChestLookDto Look,
    long ChestPrice,
    long KeyPrice,
    bool Active,
    int SortOrder,
    int Version,
    IReadOnlyDictionary<string, int> DropWeights,
    IReadOnlyList<AdminPoolItemDto> Pool,
    decimal ExpectedValue,
    long Cost,
    IReadOnlyList<string> Problems);

public sealed class AdminChestLookRequest
{
    public string? Template { get; set; }
    public string? Light { get; set; }
    public string? Hi { get; set; }
    public string? Core { get; set; }
}

/// <summary>Everything a save replaces. Nothing is applied partly: the whole draft passes the rules or nothing changes.</summary>
public sealed class AdminChestDraftRequest
{
    public string? Name { get; set; }
    public string? NameEn { get; set; }
    public string? Subtitle { get; set; }
    public string? SubtitleEn { get; set; }
    public string? KeyName { get; set; }
    public string? KeyNameEn { get; set; }
    public long ChestPrice { get; set; }
    public long KeyPrice { get; set; }
    public bool Active { get; set; }
    public int SortOrder { get; set; }
    public AdminChestLookRequest? Look { get; set; }
    public Dictionary<string, int>? DropWeights { get; set; }
    public List<string>? Pool { get; set; }
    public int ExpectedVersion { get; set; }

    [StringLength(500)]
    public string? Reason { get; set; }
}

public sealed record AdminChestCheckDto(
    IReadOnlyList<CatalogRuleViolation> Violations,
    decimal ExpectedValue,
    long Cost,
    long TotalWeight,
    IReadOnlyDictionary<string, decimal> Rates,
    AdminChestDiff Diff);

public sealed class AdminChestCloneRequest
{
    public string? Name { get; set; }
    public string? NameEn { get; set; }

    [StringLength(500)]
    public string? Reason { get; set; }
}

public sealed class AdminChestRestoreRequest
{
    public int ExpectedVersion { get; set; }

    [StringLength(500)]
    public string? Reason { get; set; }
}

public sealed record AdminChestVersionDto(
    int Version,
    string Action,
    DateTime At,
    string? AdminName,
    string? Reason,
    bool Current,
    long ChestPrice,
    long KeyPrice,
    IReadOnlyDictionary<string, int> DropWeights,
    int PoolCount,
    // Compared with the version before it. Empty on the oldest one.
    AdminChestDiff Diff);

// ----- statistics and tools -----

public sealed record AdminChestRateDto(string Rarity, long Count, decimal ActualPercent, decimal ConfiguredPercent);

public sealed record AdminChestTopItemDto(ItemDefDto Def, long Count);

public sealed record AdminChestRareDropDto(ItemDefDto Def, string PlayerId, string PlayerName, DateTime At);

public sealed record AdminChestStatsDto(
    string ChestId,
    int Days,
    long Opens,
    long CoinsFromChests,
    long CoinsFromKeys,
    IReadOnlyList<AdminChestRateDto> Rates,
    IReadOnlyList<AdminChestTopItemDto> TopItems,
    IReadOnlyList<AdminChestRareDropDto> RareDrops);

public sealed record AdminOpeningRowDto(
    string Id,
    DateTime At,
    string PlayerId,
    string PlayerName,
    string ChestId,
    string ChestName,
    ItemDefDto Item,
    string State);

public sealed record AdminOpeningPageDto(IReadOnlyList<AdminOpeningRowDto> Items, int Page, int PageSize, long Total);

public sealed record AdminPlayerRefDto(string Id, string FullName, string Email);

public sealed class AdminChestGrantRequest
{
    [StringLength(64)]
    public string? UserId { get; set; }

    [StringLength(64)]
    public string? ChestId { get; set; }

    [Range(0, 12)]
    public int Chests { get; set; }

    [Range(0, 12)]
    public int Keys { get; set; }

    [StringLength(500)]
    public string? Reason { get; set; }

    /// <summary>One per grant on the page, so resending after a lost answer does not give everything twice.</summary>
    [StringLength(64)]
    public string? RequestId { get; set; }
}
