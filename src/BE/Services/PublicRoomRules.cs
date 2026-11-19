using System.Globalization;
using MongoDB.Driver;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// What the public room table shows. A waiting room is listed while a seat is free and someone is
/// still there (a connected player, or a room created moments ago before its lobby connected);
/// a public game in progress stays listed as full so players can see what is being played.
/// </summary>
public static class PublicRoomRules
{
    /// <summary>A freshly created room is listed before its host's lobby connects to the hub.</summary>
    public static readonly TimeSpan NewRoomGrace = TimeSpan.FromMinutes(2);
    /// <summary>Rooms read from Mongo before language/search filtering in memory.</summary>
    public const int ScanLimit = 300;
    public const int MaxQueryLength = 64;

    public static FilterDefinition<GameRoom> ListingFilter(DateTime now)
    {
        var f = Builders<GameRoom>.Filter;
        var waitingWithSeat = f.And(
            f.Eq(r => r.Status, RoomStatus.Waiting),
            f.SizeLt(r => r.Players, RoomService.MaxPlayers),
            f.Or(
                f.ElemMatch(r => r.Players, p => p.IsConnected),
                f.Gte(r => r.CreatedAt, now - NewRoomGrace)));
        return f.And(
            f.Eq(r => r.Visibility, RoomVisibility.Public),
            // A playtest of an unpublished draft is private by construction; never list one even if it were public.
            f.Eq(r => r.Playtest, null),
            f.Or(waitingWithSeat, f.Eq(r => r.Status, RoomStatus.InProgress)));
    }

    /// <summary>Null = every language. Returns false for a value that is neither vi, en nor ALL.</summary>
    public static bool TryParseLanguage(string? value, out string? language)
    {
        var trimmed = value?.Trim();
        language = null;
        if (string.IsNullOrEmpty(trimmed) || string.Equals(trimmed, "ALL", StringComparison.OrdinalIgnoreCase)) return true;
        if (!CaseLanguages.All.Contains(trimmed)) return false;
        language = CaseLanguages.Normalize(trimmed);
        return true;
    }

    public static bool IsJoinable(GameRoom room) =>
        room.Status == RoomStatus.Waiting && room.Players.Count < RoomService.MaxPlayers;

    /// <summary>Accent- and case-insensitive containment, so "dem khoa so" finds "Đêm khóa sổ".</summary>
    public static bool MatchesSearch(PublicRoomResponse row, string? query)
    {
        var needle = Fold(query);
        if (needle.Length == 0) return true;
        return Fold(row.RoomCode).Contains(needle, StringComparison.Ordinal)
            || Fold(row.CaseTitle).Contains(needle, StringComparison.Ordinal)
            || Fold(row.HostUsername).Contains(needle, StringComparison.Ordinal);
    }

    public static IReadOnlyList<PublicRoomResponse> Apply(
        IEnumerable<PublicRoomResponse> rows, string? language, bool openOnly, string? query, int limit) =>
        rows.Where(row => language is null || row.Language == language)
            .Where(row => !openOnly || row.IsJoinable)
            .Where(row => MatchesSearch(row, query))
            // Joinable rooms first (oldest waiting host first), then games in progress (newest first).
            .OrderByDescending(row => row.IsJoinable)
            .ThenBy(row => row.IsJoinable ? row.CreatedAt.Ticks : -row.CreatedAt.Ticks)
            .ThenBy(row => row.RoomCode, StringComparer.Ordinal)
            .Take(Math.Clamp(limit, 1, 100))
            .ToList();

    internal static string Fold(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var decomposed = value.Trim().Replace('đ', 'd').Replace('Đ', 'D').Normalize(System.Text.NormalizationForm.FormD);
        var builder = new System.Text.StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                builder.Append(char.ToLowerInvariant(ch));
        }
        return builder.ToString();
    }
}
