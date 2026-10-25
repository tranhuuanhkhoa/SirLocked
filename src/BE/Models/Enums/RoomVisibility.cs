namespace SirLocked.Api.Models.Enums;

/// <summary>
/// Who can find a room. PRIVATE rooms are reachable only through their code or invite link;
/// PUBLIC rooms are additionally listed on GET /api/rooms/public. Documents written before this
/// field existed have no value and deserialize to the PRIVATE default.
/// </summary>
public static class RoomVisibility
{
    public const string Public = "PUBLIC";
    public const string Private = "PRIVATE";

    /// <summary>Null/blank means "not chosen" and becomes PRIVATE; anything else must be a known value.</summary>
    public static bool TryNormalize(string? value, out string visibility)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            visibility = Private;
            return true;
        }
        visibility = trimmed.ToUpperInvariant();
        return visibility is Public or Private;
    }
}
