using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Màn tân thủ (newcomer tutorial). A new account picks "Kỳ cựu" (veteran) or "Nhập môn" (beginner); a beginner
/// must finish the tutorial case before creating, joining or matching into a normal room. The tutorial is a solo
/// room (one player, <see cref="GameRoom.Mode"/> = <see cref="RoomMode"/>) that plays one bundled open co-op case.
/// The single detective may switch between the two roles, so every two-player rule keeps its normal shape, except
/// that a solo room needs one confirmation instead of two for a confrontation or an accusation.
/// </summary>
public static class TutorialRules
{
    public const string CaseId = "case-pixel-tan-thu-vi";
    public const string CaseFile = CaseId + ".json";
    public const string RoomMode = "TUTORIAL";

    public const string PathVeteran = "VETERAN";
    public const string PathBeginner = "BEGINNER";

    public const string RequiredCode = "TUTORIAL_REQUIRED";
    public const string RequiredMessageKey = "tutorial.required";
    public const string NotTutorialRoomCode = "TUTORIAL_ROOM_ONLY";
    public const string PathAlreadyChosenCode = "TUTORIAL_PATH_CHOSEN";

    /// <summary>
    /// Accounts created before the feature shipped are never asked; they count as veterans. Accounts created from
    /// this moment on pick a path once.
    /// </summary>
    public static readonly DateTime LaunchUtc = new(2026, 11, 17, 0, 0, 0, DateTimeKind.Utc);

    public static bool IsTutorialRoom(GameRoom? room) =>
        room is not null && string.Equals(room.Mode, RoomMode, StringComparison.Ordinal);

    public static bool IsTutorialCase(string? caseId) => string.Equals(caseId, CaseId, StringComparison.Ordinal);

    /// <summary>Players whose confirmation a confrontation or an accusation needs (one in a solo tutorial room).</summary>
    public static int RequiredConfirmations(GameRoom? room) => IsTutorialRoom(room) ? 1 : 2;

    /// <summary>The path the account effectively follows: older accounts without a choice are veterans.</summary>
    public static string? EffectivePath(User user) =>
        user.ExperiencePath ?? (user.CreatedAt < LaunchUtc ? PathVeteran : null);

    public static bool NeedsChoice(User user) => EffectivePath(user) is null;

    /// <summary>A beginner who has not finished the tutorial may not enter normal rooms yet. Admins are exempt.</summary>
    public static bool IsRequired(User user) =>
        user.Role != UserRole.Admin
        && string.Equals(user.ExperiencePath, PathBeginner, StringComparison.Ordinal)
        && user.TutorialCompletedAt is null;

    public static bool TryNormalizePath(string? value, out string path)
    {
        path = (value ?? string.Empty).Trim().ToUpperInvariant();
        return path is PathVeteran or PathBeginner;
    }

    public static ApiException Required() => ApiException.Forbidden(
        "Hãy chơi xong màn tân thủ trước khi vào phòng chơi thật.", RequiredCode, RequiredMessageKey);

    /// <summary>Throws when the account still owes the tutorial. Room creation, joining and matchmaking call this.</summary>
    public static void EnsureNotRequired(User? account)
    {
        if (account is not null && IsRequired(account)) throw Required();
    }
}
