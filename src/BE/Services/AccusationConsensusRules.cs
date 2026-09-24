using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Deterministic transitions for the two-player final accusation. This type performs no I/O; callers
/// persist the mutated gameplay state with the room's existing optimistic version check.
/// Whether an accusation is <em>correct</em> is decided elsewhere and is not this type's business.
/// </summary>
public static class AccusationConsensusRules
{
    public const string StaleRevisionCode = "ACCUSATION_STALE_REVISION";
    public const string NotActiveCode = "ACCUSATION_NOT_ACTIVE";
    public const string AlreadyConfirmedCode = "ACCUSATION_ALREADY_CONFIRMED";
    public const string ConsensusRequiredCode = "ACCUSATION_CONSENSUS_REQUIRED";

    /// <summary>
    /// Consensus follows the mechanics version rather than a global switch: V3 cases are built around
    /// joint decisions, while published V1/V2 cases (and the API smoke run) keep the unilateral route.
    /// An explicit setting overrides the default for every version.
    /// </summary>
    public static bool RequiresConsensus(GameCase gameCase, bool? configured) =>
        configured ?? gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation;

    public static AccusationTransition Propose(
        GameCase gameCase,
        GameplayState state,
        string attemptId,
        string userId,
        string role,
        string playerSceneId,
        AccusationProposalContent content,
        IReadOnlyCollection<string> roomUserIds,
        DateTime now)
    {
        RequirePlayerRole(role);
        RequireValue(attemptId, nameof(attemptId));
        RequireValue(content.CulpritId, nameof(content.CulpritId));

        if (state.ActiveAccusation is { } existing)
        {
            // A lost response must not open a second proposal, so an identical retry from the same
            // author is answered with the proposal that is already standing.
            if (existing.ProposedByUserId == userId && Matches(existing, content))
            {
                return AccusationTransition.Unchanged(existing);
            }

            throw Violation(NotActiveCode, "A final accusation proposal is already open.");
        }

        // The same availability gate as the unilateral route; consensus never widens who may accuse.
        if (!GameRules.IsAccusationAvailable(gameCase, state, playerSceneId))
        {
            throw Violation(NotActiveCode, "The final accusation is not available yet.");
        }

        var active = new AccusationProposalState
        {
            AttemptId = attemptId,
            Status = AccusationProposalStatus.AwaitingConfirmation,
            Revision = 1,
            ProposedByUserId = userId,
            ProposedByRole = role,
            CreatedAt = now,
            UpdatedAt = now
        };
        Apply(active, content);
        // Authoring a proposal is a confirmation of it; the partner supplies the second one.
        active.Confirmations.Add(NewConfirmation(userId, role, active.Revision, now));
        state.ActiveAccusation = active;
        return Advance(state, active, roomUserIds);
    }

    public static AccusationTransition Amend(
        GameplayState state,
        string attemptId,
        string userId,
        string role,
        AccusationProposalContent content,
        int expectedRevision,
        IReadOnlyCollection<string> roomUserIds,
        DateTime now)
    {
        RequirePlayerRole(role);
        RequireValue(content.CulpritId, nameof(content.CulpritId));
        RequireAmendableTerminal(state, attemptId);
        var active = RequireActive(state, attemptId);
        RequireRevision(active, expectedRevision);

        if (Matches(active, content) && active.Confirmations.Any(confirmation =>
                confirmation.Revision == active.Revision && confirmation.UserId == userId))
        {
            return AccusationTransition.Unchanged(active);
        }

        // A changed proposal is a different decision: every earlier confirmation is void and the
        // author of the change becomes the only confirmer of the new revision.
        active.Revision++;
        active.Confirmations.Clear();
        Apply(active, content);
        active.Confirmations.Add(NewConfirmation(userId, role, active.Revision, now));
        active.UpdatedAt = now;
        return Advance(state, active, roomUserIds);
    }

    public static AccusationTransition Confirm(
        GameplayState state,
        string attemptId,
        string userId,
        string role,
        int expectedRevision,
        IReadOnlyCollection<string> roomUserIds,
        DateTime now)
    {
        RequirePlayerRole(role);
        if (FindTerminal(state, attemptId) is { } terminal)
        {
            return AccusationTransition.Unchanged(terminal: terminal);
        }

        var active = RequireActive(state, attemptId);
        RequireRevision(active, expectedRevision);

        // Confirming twice is a retry, not a rule break.
        if (active.Confirmations.Any(confirmation =>
                confirmation.Revision == active.Revision && confirmation.UserId == userId))
        {
            return AccusationTransition.Unchanged(active);
        }

        active.Confirmations.Add(NewConfirmation(userId, role, active.Revision, now));
        active.UpdatedAt = now;
        return Advance(state, active, roomUserIds);
    }

    public static AccusationTransition Cancel(
        GameplayState state,
        string attemptId,
        string userId,
        string role,
        int expectedRevision,
        DateTime now)
    {
        RequirePlayerRole(role);
        if (FindTerminal(state, attemptId) is { } terminal)
        {
            if (terminal.Status == AccusationProposalStatus.Resolved)
            {
                throw Violation(AlreadyConfirmedCode, "Both detectives already confirmed this accusation.");
            }
            return AccusationTransition.Unchanged(terminal: terminal);
        }

        var active = RequireActive(state, attemptId);
        RequireRevision(active, expectedRevision);
        active.Status = AccusationProposalStatus.Cancelled;
        active.UpdatedAt = now;
        state.AccusationAttempts.Add(active);
        state.ActiveAccusation = null;
        return AccusationTransition.ChangedTo(terminal: active);
    }

    /// <summary>
    /// The single exit from a mutating command: the proposal either stays open for the partner or,
    /// once the whole room has confirmed the revision on the table, becomes terminal in this same
    /// transition so no caller can observe "agreed but not yet resolved".
    /// </summary>
    private static AccusationTransition Advance(
        GameplayState state,
        AccusationProposalState active,
        IReadOnlyCollection<string> roomUserIds)
    {
        if (!HasFullConsensus(active, roomUserIds))
        {
            return AccusationTransition.ChangedTo(active);
        }

        active.Status = AccusationProposalStatus.Resolved;
        state.AccusationAttempts.Add(active);
        state.ActiveAccusation = null;
        return AccusationTransition.ChangedTo(terminal: active, shouldResolve: true);
    }

    /// <summary>
    /// The team agrees only when every player in the room has confirmed the revision on the table.
    /// A room that is not a full pair can never resolve this way, which is the whole point.
    /// </summary>
    private static bool HasFullConsensus(AccusationProposalState active, IReadOnlyCollection<string> roomUserIds) =>
        roomUserIds.Count > 1
        && roomUserIds.All(userId => active.Confirmations.Any(confirmation =>
            confirmation.Revision == active.Revision && confirmation.UserId == userId));

    private static void Apply(AccusationProposalState active, AccusationProposalContent content)
    {
        active.CulpritId = content.CulpritId;
        active.MotiveId = content.MotiveId;
        active.MethodId = content.MethodId;
        active.EvidenceIds = content.EvidenceIds.ToList();
        active.EvidenceLinks = content.EvidenceLinks
            .Select(link => new SelectedEvidenceLink { ClaimType = link.ClaimType, EvidenceId = link.EvidenceId })
            .ToList();
    }

    private static bool Matches(AccusationProposalState active, AccusationProposalContent content) =>
        active.CulpritId == content.CulpritId
        && active.MotiveId == content.MotiveId
        && active.MethodId == content.MethodId
        && active.EvidenceIds.SequenceEqual(content.EvidenceIds, StringComparer.Ordinal)
        && active.EvidenceLinks.Count == content.EvidenceLinks.Count
        && active.EvidenceLinks.Zip(content.EvidenceLinks).All(pair =>
            pair.First.ClaimType == pair.Second.ClaimType && pair.First.EvidenceId == pair.Second.EvidenceId);

    private static PlayerConfrontationConfirmation NewConfirmation(
        string userId,
        string role,
        int revision,
        DateTime now) => new()
    {
        UserId = userId,
        Role = role,
        Revision = revision,
        ConfirmedAt = now
    };

    private static AccusationProposalState RequireActive(GameplayState state, string attemptId)
    {
        var active = state.ActiveAccusation;
        if (active is null || active.AttemptId != attemptId)
        {
            throw Violation(NotActiveCode, "This accusation proposal is not the active one.");
        }
        return active;
    }

    private static void RequireAmendableTerminal(GameplayState state, string attemptId)
    {
        if (FindTerminal(state, attemptId) is not { } terminal) return;
        if (terminal.Status == AccusationProposalStatus.Resolved)
        {
            throw Violation(AlreadyConfirmedCode, "Both detectives already confirmed this accusation.");
        }
        throw Violation(NotActiveCode, "This accusation proposal is not the active one.");
    }

    private static AccusationProposalState? FindTerminal(GameplayState state, string attemptId) =>
        state.AccusationAttempts.LastOrDefault(record => record.AttemptId == attemptId);

    private static void RequireRevision(AccusationProposalState active, int expectedRevision)
    {
        if (active.Revision != expectedRevision)
        {
            throw Violation(StaleRevisionCode, "The proposal changed; review it again before confirming.");
        }
    }

    private static void RequirePlayerRole(string role)
    {
        if (!PlayerRole.IsValid(role))
        {
            throw Violation(NotActiveCode, "A valid room role is required.");
        }
    }

    private static void RequireValue(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("A non-empty value is required.", name);
        }
    }

    private static AccusationRuleException Violation(string code, string message) => new(code, message);
}

/// <summary>The reviewable body of one accusation proposal, independent of who authored it.</summary>
public sealed record AccusationProposalContent(
    string CulpritId,
    string? MotiveId,
    string? MethodId,
    IReadOnlyList<string> EvidenceIds,
    IReadOnlyList<SelectedEvidenceLink> EvidenceLinks);

public sealed record AccusationTransition(
    bool Changed,
    AccusationProposalState? Active,
    AccusationProposalState? Terminal,
    bool ShouldResolve)
{
    public static AccusationTransition ChangedTo(
        AccusationProposalState? active = null,
        bool shouldResolve = false,
        AccusationProposalState? terminal = null) =>
        new(true, active, terminal, shouldResolve);

    public static AccusationTransition Unchanged(
        AccusationProposalState? active = null,
        AccusationProposalState? terminal = null) =>
        new(false, active, terminal, false);
}

public sealed class AccusationRuleException : Exception
{
    public AccusationRuleException(string code, string message) : base(message) => Code = code;

    public string Code { get; }
}
