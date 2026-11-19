using System.ComponentModel.DataAnnotations;

namespace SirLocked.Api.DTOs.Market;

/// <summary>What others see of a detective. Always built on the server, never from what a client sent.</summary>
public sealed record PlayerCosmeticsDto(
    int Level,
    string Avatar,
    string? AvatarUrl,
    string? FrameDefId,
    string TitleDefId,
    string EntranceDefId,
    // The detective outfits ("skin") this player wears, Sherlock's first; empty for the normal look.
    IReadOnlyList<string>? SkinDefIds = null);

public sealed record ExchangeableItemDto(string ItemId, ItemDefDto Def, long Xp);

public sealed record OwnedCosmeticDto(string ItemId, string DefId, string Category, string Source, bool Locked, bool Equipped);

public sealed record AchievementProgressDto(string TitleDefId, bool Countable, int Count, int Target, bool Earned);

public sealed record ProgressDto(
    int Level,
    int Xp,
    int XpToNext,
    int MaxLevel,
    bool IsMaxLevel,
    string Avatar,
    string? AvatarUrl,
    bool CanUploadAvatar,
    string? FrameDefId,
    string TitleDefId,
    string EntranceDefId,
    IReadOnlyList<ExchangeableItemDto> Exchangeable,
    IReadOnlyList<OwnedCosmeticDto> Owned,
    IReadOnlyList<AchievementProgressDto> Achievements);

public sealed record ExchangeResultDto(
    int Level,
    int Xp,
    int XpToNext,
    bool IsMaxLevel,
    long XpGained,
    IReadOnlyList<string> NewFrameDefIds,
    IReadOnlyList<string> NewTitleDefIds,
    WalletDto Wallet);

/// <summary>SignalR PlayerEntrance: everything a client needs to play this arrival.</summary>
public sealed record PlayerEntranceDto(
    string RoomId,
    string UserId,
    string Username,
    int Level,
    string Avatar,
    string? AvatarUrl,
    string? FrameDefId,
    string TitleDefId,
    string EntranceDefId);

// ----- requests -----

public class ProgressExchangeRequest
{
    [Required, MaxLength(ProgressRequestLimits.MaxItems)]
    public List<string> ItemIds { get; set; } = new();

    [Required, StringLength(64, MinimumLength = 8)]
    public string IdempotencyKey { get; set; } = string.Empty;
}

public class SetAvatarRequest
{
    [Required, StringLength(16)]
    public string Avatar { get; set; } = string.Empty;
}

public static class ProgressRequestLimits
{
    public const int MaxItems = 32;
}
