using System.Globalization;
using System.Text;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;

namespace SirLocked.Api.Services.TeamComms;

/// <summary>
/// Who may chat and talk in a match, and what a chat line or a voice signal may contain. Chat and voice are only for the
/// two detectives of a running match: not the solo tutorial, not a lobby, not a finished room.
/// </summary>
public static class TeamCommsRules
{
    public const int MaxChatLength = 300;
    public const int HistoryLimit = 80;
    /// <summary>An SDP offer or answer for one audio track is a few kilobytes; this leaves room and still stops abuse.</summary>
    public const int MaxSdpLength = 20_000;
    public const int MaxCandidateLength = 1_024;
    public const int MaxSdpMidLength = 64;

    public static readonly IReadOnlySet<string> SignalKinds = new HashSet<string>(StringComparer.Ordinal) { "offer", "answer", "candidate" };

    public static RoomPlayer? MemberOf(GameRoom? room, string? userId) =>
        string.IsNullOrEmpty(userId) ? null : room?.Players.FirstOrDefault(player => player.UserId == userId);

    /// <summary>A running two-player match that <paramref name="userId"/> plays in.</summary>
    public static bool CanTalk(GameRoom? room, string? userId) =>
        room is not null
        && room.Status == RoomStatus.InProgress
        && !TutorialRules.IsTutorialRoom(room)
        && MemberOf(room, userId) is not null;

    /// <summary>
    /// The text that is stored and shown, or null when nothing is left to send. Control characters go (a line break stays),
    /// spaces at the ends go, and more than two line breaks in a row become two.
    /// </summary>
    public static string? NormalizeText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var builder = new StringBuilder(text.Length);
        var breaks = 0;
        foreach (var c in text.Replace("\r\n", "\n").Replace('\r', '\n'))
        {
            if (c == '\t')
            {
                breaks = 0;
                builder.Append(' ');
                continue;
            }
            if (c == '\n')
            {
                if (++breaks <= 2) builder.Append(c);
                continue;
            }
            if (char.IsControl(c) || c is '\u200B' or '\u2028' or '\u2029' or '\uFEFF') continue;
            breaks = 0;
            builder.Append(c);
        }
        var normalized = builder.ToString().Trim();
        return normalized.Length == 0 ? null : normalized;
    }

    /// <summary>Length in characters as a person counts them, so an emoji counts once.</summary>
    public static int VisibleLength(string text) => new StringInfo(text).LengthInTextElements;

    public static bool IsValidSignal(VoiceSignalMessage? signal)
    {
        if (signal is null || signal.Kind is null || !SignalKinds.Contains(signal.Kind)) return false;
        if (signal.Kind == "candidate")
        {
            return signal.Candidate is { Length: <= MaxCandidateLength }
                && (signal.SdpMid is null || signal.SdpMid.Length <= MaxSdpMidLength)
                && (signal.SdpMLineIndex is null || signal.SdpMLineIndex is >= 0 and <= 16);
        }
        return !string.IsNullOrWhiteSpace(signal.Sdp) && signal.Sdp.Length <= MaxSdpLength;
    }
}

/// <summary>What one browser sends the other to set up the voice connection (WebRTC offer, answer or ICE candidate).</summary>
public sealed class VoiceSignalMessage
{
    public string? Kind { get; set; }
    public string? Sdp { get; set; }
    public string? Candidate { get; set; }
    public string? SdpMid { get; set; }
    public int? SdpMLineIndex { get; set; }
}

public sealed record TeamChatMessageDto(string Id, string RoomId, string UserId, string Username, string? Role, string Text, DateTime SentAt)
{
    public static TeamChatMessageDto From(TeamChatMessage message) =>
        new(message.Id, message.RoomId, message.UserId, message.Username, message.Role, message.Text, message.SentAt);
}

public sealed class SendTeamChatRequest
{
    public string? Text { get; set; }
}

public sealed record VoicePeerDto(string UserId, bool MicOn);

public sealed record VoiceJoinResult(IReadOnlyList<VoicePeerDto> Peers);
