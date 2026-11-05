using System.Text.Json;
using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.DTOs.Admin;

/// <summary>How an admin-made cosmetic is drawn. See docs/admin-cosmetics.md for the templates and their parameters.</summary>
public sealed record AdminCosmeticVisualRequest(string? ImageUrl, string? Template, JsonElement? Params);

public sealed record AdminCosmeticCreateRequest(
    string? Category,
    string? Name,
    string? NameEn,
    string? Description,
    string? DescriptionEn,
    string? Rarity,
    bool Tradable,
    long? ReferencePrice,
    AdminCosmeticVisualRequest? Visual,
    string? Reason);

/// <summary>A cosmetic that ships with the game keeps its drawing code, so <see cref="Visual"/> is ignored for it.</summary>
public sealed record AdminCosmeticUpdateRequest(
    int? ExpectedVersion,
    string? Name,
    string? NameEn,
    string? Description,
    string? DescriptionEn,
    string? Rarity,
    bool Tradable,
    long? ReferencePrice,
    AdminCosmeticVisualRequest? Visual,
    string? Reason);

/// <summary>Mode is level, achievement, default or admin. Chests are managed on the chest pages.</summary>
public sealed record AdminCosmeticAcquisitionRequest(string? Mode, int? Level, string? Metric, int? Target, string? Reason);

public sealed record AdminCosmeticRetireRequest(bool Retired, string? Reason);

public sealed record AdminCosmeticGrantRequest(string? UserId, string? Reason);

public sealed record AdminXpSettingsRequest(long RareXp, long EpicXp, string? Reason);

public sealed record AdminCosmeticChestDto(string Id, string Name, bool Active);

public sealed record AdminCosmeticAcquisitionDto(
    string Mode,
    int? Level,
    string? Metric,
    int? Target,
    IReadOnlyList<AdminCosmeticChestDto> Chests);

public sealed record AdminCosmeticDto(
    string Id,
    string Category,
    string Rarity,
    string Name,
    string NameEn,
    /// <summary>What the admin typed: empty means the text is written from the chest pools.</summary>
    string Description,
    string DescriptionEn,
    /// <summary>What players read.</summary>
    string DisplayDescription,
    long ReferencePrice,
    bool Tradable,
    bool Retired,
    int SortOrder,
    int Version,
    DateTime UpdatedAt,
    string? UpdatedBy,
    ItemVisual Visual,
    long Owners,
    AdminCosmeticAcquisitionDto Acquisition);

public sealed record CosmeticDefaultsDto(string? Frame, string Title, string Entrance);

public sealed record AdminCosmeticsPageDto(
    IReadOnlyList<AdminCosmeticDto> Items,
    IReadOnlyList<string> Metrics,
    long RareXp,
    long EpicXp,
    int MaxLevel,
    CosmeticDefaultsDto Defaults,
    IReadOnlyList<string> Problems);

public sealed record AdminCosmeticPlayerDto(string Id, string FullName, string Email, int Level);

public sealed record AdminCosmeticGrantResultDto(string UserId, string DefId, int SlotsUsed, int SlotCap);

public sealed record AdminXpSettingsDto(long RareXp, long EpicXp);

/// <summary>One cosmetic as a player's page needs it to draw and explain it, retired ones included: owners still wear them.</summary>
public sealed record CosmeticCatalogEntryDto(
    string Id,
    string Category,
    string Rarity,
    string Name,
    string NameEn,
    string Description,
    string DescriptionEn,
    bool Tradable,
    bool Retired,
    int SortOrder,
    ItemVisual? Visual,
    int? Level,
    string? Metric,
    int? Target,
    bool AchievementCountable,
    IReadOnlyList<string> Chests,
    int ActiveChestCount);

public sealed record CosmeticCatalogDto(
    IReadOnlyList<CosmeticCatalogEntryDto> Items,
    CosmeticDefaultsDto Defaults,
    long RareXp,
    long EpicXp);
