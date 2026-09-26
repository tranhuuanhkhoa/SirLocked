using System.Security.Cryptography;
using System.Text;
using SirLocked.Api.Configurations;

namespace SirLocked.Api.Services;

/// <summary>
/// Turns raw identifiers into the only shape telemetry is allowed to store. The user hash is
/// salted with the room on purpose: the same person in two rooms yields two unrelated hashes,
/// so stored events cannot be stitched into a cross-session profile.
/// </summary>
public sealed class PlaytestPseudonymizer
{
    public const int PseudonymLength = 22;

    private readonly byte[] _key;

    public PlaytestPseudonymizer(string key)
    {
        if (!PlaytestSettings.IsPseudonymKeyValid(key))
        {
            throw new ArgumentException(
                $"Playtest__PseudonymKey must be at least {PlaytestSettings.MinimumPseudonymKeyLength} characters long.",
                nameof(key));
        }
        _key = Encoding.UTF8.GetBytes(key);
    }

    public string SessionPseudonym(string roomId) => Hash(roomId);

    public string UserHash(string roomId, string userId) => Hash($"{roomId}|{userId}");

    private string Hash(string value)
    {
        var digest = HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes(value));
        return ToBase64Url(digest)[..PseudonymLength];
    }

    private static string ToBase64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
