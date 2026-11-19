using System.Security.Cryptography;
using System.Text;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>Who may enter a playtest room of an unpublished AI draft.</summary>
public enum PlaytestEntry
{
    /// <summary>An admin, the draft's author, or the player who already claimed the invite.</summary>
    Allowed,
    /// <summary>The invite is still free and this player holds its secret: joining binds the invite to them.</summary>
    ClaimsInvite,
    Forbidden
}

/// <summary>
/// Pure rules of the playtest room ("Chơi thử" on /admin/ai). A playtest is a private two-seat room of an imported,
/// unpublished AI draft. It never reaches the public room list, matchmaking, leaderboards or rewards: the case stays
/// DRAFT (so the catalogue and matchmaking never see it) and the finished game writes no <see cref="GameResult"/>.
/// </summary>
public static class PlaytestRoomRules
{
    public const string ForbiddenCode = "PLAYTEST_FORBIDDEN";
    public const string ForbiddenMessageKey = "room.playtest.forbidden";
    public const string ForbiddenMessage =
        "This room is a private playtest of an unpublished case. Only an admin, the draft's author and the invited player can join.";

    public const string NotImportedCode = "PLAYTEST_NOT_IMPORTED";
    public const string NotImportedMessageKey = "ai.playtest.notImported";

    /// <summary>Invite secrets are 24 URL-safe characters (144 random bits).</summary>
    public const int InviteTokenLength = 24;

    public static bool IsAdmin(CurrentUser user) =>
        string.Equals(user.Role, UserRole.Admin, StringComparison.OrdinalIgnoreCase);

    /// <summary>Only an admin or the user who ordered the draft can open a playtest of it.</summary>
    public static bool CanHost(CurrentUser user, AiCaseDraft draft) =>
        IsAdmin(user)
        || (!string.IsNullOrWhiteSpace(draft.CreatedByUserId) && string.Equals(draft.CreatedByUserId, user.Id, StringComparison.Ordinal));

    /// <summary>A draft can be playtested once the bot (or an admin) imported it as a case, until it is cancelled.</summary>
    public static bool IsPlaytestable(AiCaseDraft draft) =>
        !string.IsNullOrWhiteSpace(draft.ImportedCaseId) && draft.Status != AiDraftStatus.Cancelled;

    public static PlaytestEntry Evaluate(RoomPlaytest playtest, CurrentUser user, string? inviteToken)
    {
        if (IsAdmin(user)) return PlaytestEntry.Allowed;
        if (!string.IsNullOrWhiteSpace(playtest.AuthorUserId) && string.Equals(playtest.AuthorUserId, user.Id, StringComparison.Ordinal))
            return PlaytestEntry.Allowed;
        if (!string.IsNullOrWhiteSpace(playtest.InvitedUserId))
            return string.Equals(playtest.InvitedUserId, user.Id, StringComparison.Ordinal) ? PlaytestEntry.Allowed : PlaytestEntry.Forbidden;
        return TokenMatches(playtest.InviteToken, inviteToken) ? PlaytestEntry.ClaimsInvite : PlaytestEntry.Forbidden;
    }

    public static string NewInviteToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(InviteTokenLength * 3 / 4))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    /// <summary>Constant-time comparison; an empty secret never matches.</summary>
    public static bool TokenMatches(string expected, string? given)
    {
        if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(given)) return false;
        var a = Encoding.UTF8.GetBytes(expected);
        var b = Encoding.UTF8.GetBytes(given.Trim());
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    public static ApiException Forbidden() =>
        ApiException.Forbidden(ForbiddenMessage, ForbiddenCode, ForbiddenMessageKey);
}
