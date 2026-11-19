using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Pure matchmaking rules: who may be paired, which roles they get, which cases fit and what
/// happens to each ticket when a match is declined or times out. MatchmakingService only adds the
/// atomic Mongo writes around these decisions.
/// </summary>
public static class MatchmakingRules
{
    public static readonly TimeSpan AcceptWindow = TimeSpan.FromSeconds(15);
    /// <summary>A SEARCHING ticket that nobody has polled for this long is dropped from the queue.</summary>
    public static readonly TimeSpan TicketHeartbeatTimeout = TimeSpan.FromSeconds(90);
    /// <summary>A FORMING match older than this was left behind by a crashed request and is unwound.</summary>
    public static readonly TimeSpan FormingTimeout = TimeSpan.FromSeconds(30);
    /// <summary>A CONFIRMED match whose room is still missing after this is finished by the worker.</summary>
    public static readonly TimeSpan ConfirmRetryDelay = TimeSpan.FromSeconds(5);
    /// <summary>How long a finished ticket keeps telling a client which room it ended in.</summary>
    public static readonly TimeSpan FinishedTicketVisibility = TimeSpan.FromMinutes(2);

    public const int ShortMaxMinutes = 20;
    public const int MediumMaxMinutes = 45;

    /// <summary>≤ 20 → SHORT, 21–45 → MEDIUM ("~35"), above 45 → LONG ("60+"). Unknown (0) counts as MEDIUM.</summary>
    public static string LengthBucket(int estimatedMinutes) => estimatedMinutes switch
    {
        <= 0 => MatchCaseLengths.Medium,
        <= ShortMaxMinutes => MatchCaseLengths.Short,
        <= MediumMaxMinutes => MatchCaseLengths.Medium,
        _ => MatchCaseLengths.Long
    };

    public static bool TryNormalizeMode(string? value, out string mode) =>
        TryPick(value, MatchModes.All, MatchModes.Quick, out mode);

    public static bool TryNormalizeRole(string? value, out string role) =>
        TryPick(value, MatchRolePreferences.All, MatchRolePreferences.Any, out role);

    public static bool TryNormalizeLength(string? value, out string length) =>
        TryPick(value, MatchCaseLengths.All, MatchCaseLengths.Medium, out length);

    public static bool TryNormalizeLanguage(string? value, out string language)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            language = CaseLanguages.Vietnamese;
            return true;
        }
        language = CaseLanguages.Normalize(trimmed);
        return CaseLanguages.All.Contains(trimmed);
    }

    private static bool TryPick(string? value, IReadOnlyList<string> allowed, string fallback, out string picked)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            picked = fallback;
            return true;
        }
        picked = trimmed.ToUpperInvariant();
        return allowed.Contains(picked);
    }

    /// <summary>Role preferences a partner may hold so that both players end up with different roles.</summary>
    public static IReadOnlyList<string> CompatiblePartnerRoles(string preferredRole) => preferredRole switch
    {
        MatchRolePreferences.Investigator => [MatchRolePreferences.Interrogator, MatchRolePreferences.Any],
        MatchRolePreferences.Interrogator => [MatchRolePreferences.Investigator, MatchRolePreferences.Any],
        _ => MatchRolePreferences.All
    };

    public static bool AreCompatible(MatchTicket a, MatchTicket b) =>
        a.Id != b.Id
        && a.UserId != b.UserId
        && a.Status == MatchTicketStatuses.Searching
        && b.Status == MatchTicketStatuses.Searching
        && a.Mode == b.Mode
        && a.Language == b.Language
        && a.CaseLength == b.CaseLength
        && CompatiblePartnerRoles(a.PreferredRole).Contains(b.PreferredRole);

    /// <summary>
    /// Honors every explicit preference. Two "any" players are split at random; one "any" player
    /// takes whatever the other did not ask for. Throws for incompatible preferences.
    /// </summary>
    public static (string RoleA, string RoleB) AssignRoles(string preferenceA, string preferenceB, bool coinFlip)
    {
        if (!CompatiblePartnerRoles(preferenceA).Contains(preferenceB))
            throw new InvalidOperationException("Both players asked for the same role.");
        if (preferenceA != MatchRolePreferences.Any) return (preferenceA, Other(preferenceA));
        if (preferenceB != MatchRolePreferences.Any) return (Other(preferenceB), preferenceB);
        return coinFlip
            ? (PlayerRole.Investigator, PlayerRole.Interrogator)
            : (PlayerRole.Interrogator, PlayerRole.Investigator);
    }

    public static string Other(string role) =>
        role == PlayerRole.Investigator ? PlayerRole.Interrogator : PlayerRole.Investigator;

    public static bool CaseFits(CaseSummaryResponse summary, string language, string caseLength) =>
        summary.Status == CaseStatus.Published
        && summary.StageCount > 0
        && CaseLanguages.Normalize(summary.Language) == language
        && LengthBucket(summary.EstimatedMinutes) == caseLength;

    public static IReadOnlyList<CaseSummaryResponse> FittingCases(
        IEnumerable<CaseSummaryResponse> published, string language, string caseLength) =>
        published.Where(summary => CaseFits(summary, language, caseLength)).ToList();

    /// <summary>
    /// Like <see cref="FittingCases"/> but widens the search when nothing fits, so a small catalogue (today:
    /// Vietnamese pixel cases only) never leaves a length/language combination with no match at all.
    /// Order: exact fit, then the requested language at any length, then the requested length in any
    /// language, then every playable case.
    /// </summary>
    public static IReadOnlyList<CaseSummaryResponse> FittingCasesRelaxed(
        IEnumerable<CaseSummaryResponse> published, string language, string caseLength)
    {
        var playable = published.Where(summary => summary.Status == CaseStatus.Published && summary.StageCount > 0).ToList();
        var exact = FittingCases(playable, language, caseLength);
        if (exact.Count > 0) return exact;
        var sameLanguage = playable.Where(summary => CaseLanguages.Normalize(summary.Language) == language).ToList();
        if (sameLanguage.Count > 0) return sameLanguage;
        var sameLength = playable.Where(summary => LengthBucket(summary.EstimatedMinutes) == caseLength).ToList();
        return sameLength.Count > 0 ? sameLength : playable;
    }

    /// <summary>The ticket whose id sorts first is always claimed first, so two requests pairing the same
    /// two tickets from opposite ends cannot each hold one and both give up.</summary>
    public static (MatchTicket First, MatchTicket Second) ClaimOrder(MatchTicket a, MatchTicket b) =>
        string.CompareOrdinal(a.Id, b.Id) <= 0 ? (a, b) : (b, a);

    public static bool IsPendingExpired(MatchProposal match, DateTime now) =>
        match.Status == MatchStatuses.Pending && now >= match.ExpiresAt && !AllAccepted(match);

    public static bool AllAccepted(MatchProposal match) =>
        match.Players.Count == RoomService.MaxPlayers && match.Players.All(player => player.Accepted);

    public static bool IsTicketStale(MatchTicket ticket, DateTime now) =>
        ticket.Status == MatchTicketStatuses.Searching && now - ticket.LastSeenAt >= TicketHeartbeatTimeout;

    /// <summary>After a decline the decliner leaves the queue and the partner keeps searching.</summary>
    public static TicketOutcome OutcomeOnDecline(MatchPlayer player, string declinedByUserId) =>
        player.UserId == declinedByUserId ? TicketOutcome.Cancel : TicketOutcome.Requeue;

    /// <summary>On timeout whoever accepted keeps searching; whoever did not is taken out of the queue.</summary>
    public static TicketOutcome OutcomeOnExpiry(MatchPlayer player) =>
        player.Accepted ? TicketOutcome.Requeue : TicketOutcome.Expire;

    /// <summary>The player who has waited longest hosts the room.</summary>
    public static MatchPlayer PickHost(MatchProposal match, IReadOnlyDictionary<string, DateTime> searchStartedByTicket) =>
        match.Players
            .OrderBy(player => searchStartedByTicket.TryGetValue(player.TicketId, out var started) ? started : DateTime.MaxValue)
            .ThenBy(player => player.TicketId, StringComparer.Ordinal)
            .First();
}

public enum TicketOutcome
{
    Requeue,
    Cancel,
    Expire
}
