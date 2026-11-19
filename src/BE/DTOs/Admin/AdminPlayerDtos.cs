using SirLocked.Api.DTOs.Market;

namespace SirLocked.Api.DTOs.Admin;

// What the player admin answers with. Every field is listed by hand: nothing here is built from a User document, so a
// password hash or a token cannot arrive by accident. Tests/AdminPlayers/AdminPlayersRulesTests.cs keeps it that way.

public sealed record AdminPageDto<T>(IReadOnlyList<T> Items, int Page, int PageSize, long Total);

public sealed record AdminPlayerRowDto(
    string UserId,
    string FullName,
    string Email,
    string Role,
    string Status,
    bool IsEmailVerified,
    DateTime CreatedAt,
    int Level,
    long Balance,
    long Held,
    string Avatar,
    string? AvatarUrl);

public sealed record AdminPlayerAccountDto(
    string UserId,
    string FullName,
    string Email,
    string Role,
    string Status,
    bool IsEmailVerified,
    bool HasPassword,
    bool HasSession,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record AdminPlayerProgressDto(
    int Level,
    int Xp,
    int XpToNext,
    int MaxLevel,
    string Avatar,
    string? AvatarUrl,
    DateTime? AvatarUploadedAt);

/// <summary><see cref="HasAccount"/> is false for someone who never opened the market: reading must not hand out their starter grant.</summary>
public sealed record AdminPlayerWalletDto(
    bool HasAccount,
    long Balance,
    long Held,
    int SlotsUsed,
    int SlotCap,
    int ItemCount,
    int ReservedSlots);

public sealed record AdminPlayerLookDto(string? FrameDefId, string TitleDefId, string EntranceDefId);

public sealed record AdminPlayerItemDto(
    string ItemId,
    ItemDefDto Def,
    bool Locked,
    // LISTED, TRADE, OPENING or EXCHANGING; null when free.
    string? LockReason,
    string? ListingId,
    long? ListingPrice,
    bool Equipped,
    string Source,
    DateTime AcquiredAt,
    // Open offers that name this item. They lock nothing, yet they are why it cannot be revoked.
    IReadOnlyList<string> OpenTradeIds);

public sealed record AdminPlayerDetailDto(
    AdminPlayerAccountDto Account,
    AdminPlayerProgressDto Progress,
    AdminPlayerWalletDto Wallet,
    AdminPlayerLookDto Look,
    IReadOnlyList<AdminPlayerItemDto> Inventory);

public sealed record AdminGameRowDto(
    string ResultId,
    string RoomId,
    string CaseId,
    string CaseTitle,
    bool Success,
    string Ending,
    int Score,
    string Rank,
    DateTime At);

public sealed record AdminChestOpeningRowDto(
    string Id,
    string ChestDefId,
    string ChestName,
    ItemDefDto Reward,
    string State,
    DateTime At);

/// <summary>One sale seen from one player's side. <see cref="Side"/> is SOLD or BOUGHT.</summary>
public sealed record AdminPlayerSaleRowDto(
    string Id,
    string Side,
    ItemDefDto Def,
    string ItemId,
    long Price,
    long Fee,
    string OtherId,
    string OtherName,
    DateTime At);

public sealed record AdminTradeRowDto(
    string Id,
    string FromId,
    string FromName,
    string ToId,
    string ToName,
    IReadOnlyList<ItemDefDto> FromItems,
    IReadOnlyList<ItemDefDto> ToItems,
    long FromCoins,
    long ToCoins,
    string Message,
    string Status,
    string? FailReason,
    DateTime CreatedAt,
    DateTime? RespondedAt);

/// <summary>The answer to any journaled operation, the same when it is resent.</summary>
public sealed record AdminOperationResultDto(
    string OperationId,
    string Kind,
    string UserId,
    long Balance,
    long Held,
    int SlotsUsed,
    int Level,
    int Xp,
    string? ItemId,
    string? DefId,
    string? CancelledListingId,
    // What this operation's level granted, and what a lower level let the player keep.
    IReadOnlyList<string> GrantedRewardDefIds,
    IReadOnlyList<string> KeptRewardDefIds);

public sealed record AdminAvatarRowDto(
    string UserId,
    string FullName,
    string Email,
    string AvatarUrl,
    DateTime UploadedAt,
    bool Approved);

public sealed record AdminAvatarRemovalDto(string UserId, string Avatar, bool FileRemoved);

public sealed record AdminRoomPlayerDto(
    string UserId,
    string Username,
    string? Role,
    bool IsReady,
    bool IsConnected,
    DateTime? DisconnectedAt);

public sealed record AdminRoomRowDto(
    string RoomId,
    string RoomCode,
    string CaseId,
    string CaseTitle,
    string Status,
    string Visibility,
    string HostUserId,
    IReadOnlyList<AdminRoomPlayerDto> Players,
    DateTime CreatedAt,
    DateTime? StartedAt,
    DateTime LastActivityAt,
    bool LooksHung);

public sealed record AdminReviewRowDto(
    string Id,
    string CaseId,
    string CaseTitle,
    string UserId,
    string AuthorDisplay,
    int Rating,
    string ReviewText,
    bool ContainsSpoiler,
    string ResultLabel,
    bool Hidden,
    string? HiddenReason,
    DateTime? HiddenAt,
    DateTime CreatedAt,
    DateTime UpdatedAt);

// ----- requests -----

/// <summary>Reasons are checked by the service, so a missing one answers with the same code as a blank one.</summary>
public class AdminReasonRequest
{
    public string? Reason { get; set; }
}

public class AdminCoinsRequest : AdminReasonRequest
{
    /// <summary>Positive adds coins, negative takes them.</summary>
    public long Amount { get; set; }
    public string? IdempotencyKey { get; set; }
}

public class AdminGrantItemRequest : AdminReasonRequest
{
    public string? DefId { get; set; }
    public string? IdempotencyKey { get; set; }
}

public class AdminRevokeItemRequest : AdminReasonRequest
{
    public string? IdempotencyKey { get; set; }
}

public class AdminSetProgressRequest : AdminReasonRequest
{
    public int Level { get; set; }
    public int Xp { get; set; }
    public string? IdempotencyKey { get; set; }
}
