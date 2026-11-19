using SirLocked.Api.DTOs;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>Stable error codes of the player admin. Messages are Vietnamese and shown to the admin as they are.</summary>
public static class AdminPlayerErrors
{
    public const string ReasonRequired = "ADMIN_REASON_REQUIRED";
    public const string CoinsInvalid = "ADMIN_COINS_INVALID";
    public const string CoinsInsufficient = "ADMIN_COINS_INSUFFICIENT";
    public const string ProgressInvalid = "ADMIN_PROGRESS_INVALID";
    public const string InProgress = "ADMIN_OPERATION_IN_PROGRESS";
    public const string PlayerNotFound = "ADMIN_PLAYER_NOT_FOUND";
    public const string UnknownDef = "ADMIN_ITEM_DEF_UNKNOWN";
    public const string InventoryFull = "ADMIN_INVENTORY_FULL";
    public const string ItemNotFound = "ADMIN_ITEM_NOT_FOUND";
    public const string ItemInTrade = "ADMIN_ITEM_IN_TRADE";
    public const string ItemBusy = "ADMIN_ITEM_BUSY";
    public const string ItemEarned = "ADMIN_ITEM_EARNED";
    public const string NoAvatar = "ADMIN_AVATAR_NONE";
    public const string SelfAction = "ADMIN_SELF_ACTION";
    public const string BadQuery = "ADMIN_QUERY_INVALID";
    public const string RoomChanged = "ADMIN_ROOM_CHANGED";
    public const string RoomNotFound = "ADMIN_ROOM_NOT_FOUND";
    public const string ReviewNotFound = "ADMIN_REVIEW_NOT_FOUND";
    public const string ReviewUnchanged = "ADMIN_REVIEW_UNCHANGED";
}

public static class AdminPlayerStatusFilter
{
    public const string Active = "ACTIVE";
    public const string Locked = "LOCKED";
    public const string Unverified = "UNVERIFIED";
}

public static class AdminPlayerSorts
{
    public const string Created = "created";
    public const string Level = "level";
    public const string Coins = "coins";
}

/// <summary>Pure rules of the player admin: no I/O, so they are unit-testable.</summary>
public static class AdminPlayersRules
{
    public const int MinReasonLength = 3;
    public const int MaxReasonLength = 500;
    public const int MaxSearchLength = 100;
    public const int DefaultPageSize = 25;
    public const int MaxPageSize = 100;
    /// <summary>One operation moves at most this many coins, as a single trade can: a typo must not mint a fortune.</summary>
    public const long MaxCoinAdjustment = 1_000_000;

    internal static ApiException Error(int status, string code, string message) =>
        new(status, message, new ApiErrorDetails(code, "admin." + code));

    /// <summary>A dangerous action always says why, on the server too.</summary>
    public static string NormalizeReason(string? reason)
    {
        var text = (reason ?? string.Empty).Trim();
        if (text.Length < MinReasonLength || text.Length > MaxReasonLength)
            throw Error(400, AdminPlayerErrors.ReasonRequired, $"Hãy nhập lý do, từ {MinReasonLength} đến {MaxReasonLength} ký tự.");
        return text;
    }

    public static void ValidateCoinAmount(long amount)
    {
        if (amount == 0 || amount > MaxCoinAdjustment || amount < -MaxCoinAdjustment)
            throw Error(400, AdminPlayerErrors.CoinsInvalid, $"Số xu phải khác 0 và không quá {MaxCoinAdjustment:N0} mỗi lần.");
    }

    public static void ValidateProgress(int level, int xp)
    {
        if (level < 1 || level > ProgressRules.MaxLevel)
            throw Error(400, AdminPlayerErrors.ProgressInvalid, $"Cấp phải từ 1 đến {ProgressRules.MaxLevel}.");
        var cap = level >= ProgressRules.MaxLevel ? 0 : ProgressRules.XpToNext(level) - 1;
        if (xp < 0 || xp > cap)
            throw Error(400, AdminPlayerErrors.ProgressInvalid, $"Ở cấp {level}, KN phải từ 0 đến {cap}.");
    }

    /// <summary>The journal id of one operation. Resending the same key finds the same journal.</summary>
    public static string OperationId(string adminId, string? idempotencyKey)
    {
        if (string.IsNullOrEmpty(idempotencyKey) || !MarketService.RequestIdPattern.IsMatch(idempotencyKey))
            throw MarketService.Error(400, MarketErrors.InvalidRequestId, "idempotencyKey must be 8-64 letters, digits, '-' or '_'.");
        return $"{adminId}:{idempotencyKey}";
    }

    public static (int Page, int PageSize) Paging(int page, int pageSize) =>
        (Math.Max(1, page), pageSize < 1 ? DefaultPageSize : Math.Min(pageSize, MaxPageSize));

    /// <summary>
    /// What a player keeps above their level after being lowered. Nothing is taken back, so the admin is told instead.
    /// A reward also owed at or below the level is not a leftover, wherever else it appears.
    /// </summary>
    public static IReadOnlyList<string> RewardsAbove(int level, IEnumerable<LevelReward> rewards, IEnumerable<string> ownedDefIds)
    {
        var all = rewards.ToList();
        var owned = ownedDefIds.ToHashSet(StringComparer.Ordinal);
        var stillOwed = all.Where(reward => reward.Level <= level).Select(reward => reward.DefId).ToHashSet(StringComparer.Ordinal);
        return all
            .Where(reward => reward.Level > level && owned.Contains(reward.DefId) && !stillOwed.Contains(reward.DefId))
            .OrderBy(reward => reward.Level)
            .Select(reward => reward.DefId)
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    public static string CleanSearch(string? search)
    {
        var text = (search ?? string.Empty).Trim();
        if (text.Length > MaxSearchLength)
            throw Error(400, AdminPlayerErrors.BadQuery, $"Từ khóa tìm kiếm tối đa {MaxSearchLength} ký tự.");
        return text;
    }
}
