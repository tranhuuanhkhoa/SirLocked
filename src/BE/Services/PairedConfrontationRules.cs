using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Deterministic V3 domain transitions. This type performs no I/O; callers persist the
/// mutated gameplay state with the room's existing optimistic version check.
/// </summary>
public static class PairedConfrontationRules
{
    public const string StaleCode = "CONFRONTATION_STALE";
    public const string NotAvailableCode = "CONFRONTATION_NOT_AVAILABLE";
    public const string WrongRoleCode = "CONFRONTATION_WRONG_ROLE";

    public static PairedConfrontationTransition Start(
        GameplayState state,
        string attemptId,
        string challengeId,
        string testimonyFragmentId,
        string userId,
        string role,
        DateTime now)
    {
        RequireRole(role, PlayerRole.Interrogator);
        RequireValue(attemptId, nameof(attemptId));
        RequireValue(challengeId, nameof(challengeId));
        RequireValue(testimonyFragmentId, nameof(testimonyFragmentId));

        var terminal = FindTerminal(state, attemptId);
        if (terminal is not null)
        {
            return PairedConfrontationTransition.Unchanged(terminal.Status, terminal);
        }

        if (state.ActiveConfrontation is { } existing)
        {
            if (existing.AttemptId == attemptId
                && existing.ChallengeId == challengeId
                && existing.TestimonyFragmentId == testimonyFragmentId
                && existing.TestimonyProposedByUserId == userId)
            {
                return PairedConfrontationTransition.Unchanged(existing.Status, active: existing);
            }

            throw Violation(NotAvailableCode, "Another confrontation is already active.");
        }

        var active = new PairedConfrontationState
        {
            AttemptId = attemptId,
            ChallengeId = challengeId,
            TestimonyFragmentId = testimonyFragmentId,
            TestimonyProposedByUserId = userId,
            Revision = 1,
            Status = PairedConfrontationStatus.CollectingProposals,
            CreatedAt = now,
            UpdatedAt = now
        };
        state.ActiveConfrontation = active;
        return PairedConfrontationTransition.ChangedTo(active.Status, active: active);
    }

    public static PairedConfrontationTransition ProposeEvidence(
        GameplayState state,
        string attemptId,
        string evidenceId,
        string userId,
        string role,
        int expectedRevision,
        DateTime now)
    {
        RequireRole(role, PlayerRole.Investigator);
        RequireValue(evidenceId, nameof(evidenceId));
        var active = RequireActive(state, attemptId);

        if (active.EvidenceId == evidenceId && active.EvidenceProposedByUserId == userId)
        {
            return PairedConfrontationTransition.Unchanged(active.Status, active: active);
        }

        RequireRevision(active, expectedRevision);

        BeginNewRevision(active, now);
        active.EvidenceId = evidenceId;
        active.EvidenceProposedByUserId = userId;
        MoveToReviewWhenPaired(active, now);
        return PairedConfrontationTransition.ChangedTo(active.Status, active: active);
    }

    public static PairedConfrontationTransition ProposeTestimony(
        GameplayState state,
        string attemptId,
        string challengeId,
        string testimonyFragmentId,
        string userId,
        string role,
        int expectedRevision,
        DateTime now)
    {
        RequireRole(role, PlayerRole.Interrogator);
        RequireValue(challengeId, nameof(challengeId));
        RequireValue(testimonyFragmentId, nameof(testimonyFragmentId));
        var active = RequireActive(state, attemptId);

        if (active.ChallengeId == challengeId
            && active.TestimonyFragmentId == testimonyFragmentId
            && active.TestimonyProposedByUserId == userId)
        {
            return PairedConfrontationTransition.Unchanged(active.Status, active: active);
        }

        RequireRevision(active, expectedRevision);

        BeginNewRevision(active, now);
        active.ChallengeId = challengeId;
        active.TestimonyFragmentId = testimonyFragmentId;
        active.TestimonyProposedByUserId = userId;
        MoveToReviewWhenPaired(active, now);
        return PairedConfrontationTransition.ChangedTo(active.Status, active: active);
    }

    public static PairedConfrontationTransition Confirm(
        GameplayState state,
        string attemptId,
        string userId,
        string role,
        int expectedRevision,
        bool isCorrect,
        IReadOnlyCollection<string> unlockClueIds,
        DateTime now)
    {
        RequirePlayerRole(role);
        var terminal = FindTerminal(state, attemptId);
        if (terminal is not null)
        {
            return PairedConfrontationTransition.Unchanged(terminal.Status, terminal);
        }

        var active = RequireActive(state, attemptId);
        RequireRevision(active, expectedRevision);
        if (active.Status is not (PairedConfrontationStatus.ReadyForReview
            or PairedConfrontationStatus.AwaitingSecondConfirmation))
        {
            throw Violation(NotAvailableCode, "The confrontation is not ready for confirmation.");
        }

        var currentConfirmations = active.Confirmations
            .Where(confirmation => confirmation.Revision == active.Revision)
            .ToList();
        if (currentConfirmations.Any(confirmation => confirmation.UserId == userId))
        {
            return PairedConfrontationTransition.Unchanged(active.Status, active: active);
        }
        if (currentConfirmations.Any(confirmation => confirmation.Role == role))
        {
            throw Violation(WrongRoleCode, "This role has already confirmed the active revision.");
        }

        active.Confirmations.Add(new PlayerConfrontationConfirmation
        {
            UserId = userId,
            Role = role,
            Revision = active.Revision,
            ConfirmedAt = now
        });
        active.UpdatedAt = now;

        currentConfirmations = active.Confirmations
            .Where(confirmation => confirmation.Revision == active.Revision)
            .ToList();
        if (currentConfirmations.Count < 2)
        {
            active.Status = PairedConfrontationStatus.AwaitingSecondConfirmation;
            return PairedConfrontationTransition.ChangedTo(active.Status, active: active);
        }

        var terminalStatus = isCorrect
            ? PairedConfrontationStatus.ResolvedCorrect
            : PairedConfrontationStatus.ResolvedIncorrect;
        var record = Archive(active, terminalStatus, now);
        state.PairedConfrontationAttempts.Add(record);
        state.ActiveConfrontation = null;

        if (isCorrect)
        {
            foreach (var clueId in unlockClueIds.Where(id => !state.UnlockedClueIds.Contains(id)))
            {
                state.UnlockedClueIds.Add(clueId);
            }
            if (!state.ResolvedConfrontationRecords.Any(existing => existing.ChallengeId == active.ChallengeId))
            {
                state.ResolvedConfrontationRecords.Add(new ResolvedConfrontationRecord
                {
                    ChallengeId = active.ChallengeId,
                    EvidenceId = active.EvidenceId!,
                    ResolvedByUserId = userId,
                    ResolvedByRole = role,
                    ResolvedAt = now
                });
            }
        }
        else
        {
            state.WrongEvidencePresentationCount++;
        }

        return PairedConfrontationTransition.ChangedTo(record.Status, terminal: record);
    }

    public static PairedConfrontationTransition Cancel(
        GameplayState state,
        string attemptId,
        string userId,
        string role,
        int expectedRevision,
        DateTime now)
    {
        RequirePlayerRole(role);
        var terminal = FindTerminal(state, attemptId);
        if (terminal is not null)
        {
            return PairedConfrontationTransition.Unchanged(terminal.Status, terminal);
        }

        var active = RequireActive(state, attemptId);
        RequireRevision(active, expectedRevision);
        var record = Archive(active, PairedConfrontationStatus.Cancelled, now);
        record.CancelledByUserId = userId;
        state.PairedConfrontationAttempts.Add(record);
        state.ActiveConfrontation = null;
        return PairedConfrontationTransition.ChangedTo(record.Status, terminal: record);
    }

    public static PairedConfrontationTransition CancelForAbandon(
        GameplayState state,
        string cancelledByUserId,
        DateTime now)
    {
        if (state.ActiveConfrontation is not { } active)
        {
            return PairedConfrontationTransition.Unchanged(PairedConfrontationStatus.Cancelled);
        }

        var record = Archive(active, PairedConfrontationStatus.Cancelled, now);
        record.CancelledByUserId = cancelledByUserId;
        state.PairedConfrontationAttempts.Add(record);
        state.ActiveConfrontation = null;
        return PairedConfrontationTransition.ChangedTo(record.Status, terminal: record);
    }

    public static bool BlocksProgression(GameplayState state) => state.ActiveConfrontation is not null;

    private static void BeginNewRevision(PairedConfrontationState active, DateTime now)
    {
        active.Revision++;
        active.Confirmations.Clear();
        active.Status = PairedConfrontationStatus.CollectingProposals;
        active.UpdatedAt = now;
    }

    private static void MoveToReviewWhenPaired(PairedConfrontationState active, DateTime now)
    {
        if (string.IsNullOrWhiteSpace(active.EvidenceId)
            || string.IsNullOrWhiteSpace(active.TestimonyFragmentId))
        {
            active.Status = PairedConfrontationStatus.CollectingProposals;
            return;
        }

        if (!active.Disclosures.Any(disclosure => disclosure.Revision == active.Revision))
        {
            active.Disclosures.Add(new PairedConfrontationDisclosureRecord
            {
                Revision = active.Revision,
                EvidenceId = active.EvidenceId,
                TestimonyFragmentId = active.TestimonyFragmentId,
                DisclosedAt = now
            });
        }
        active.Status = PairedConfrontationStatus.ReadyForReview;
    }

    private static PairedConfrontationAttemptRecord Archive(
        PairedConfrontationState active,
        PairedConfrontationStatus status,
        DateTime now) => new()
    {
        AttemptId = active.AttemptId,
        ChallengeId = active.ChallengeId,
        Status = status,
        FinalRevision = active.Revision,
        TestimonyFragmentId = active.TestimonyFragmentId,
        EvidenceId = active.EvidenceId,
        Confirmations = active.Confirmations.Select(Clone).ToList(),
        Disclosures = active.Disclosures.Select(Clone).ToList(),
        CreatedAt = active.CreatedAt,
        ResolvedAt = now
    };

    private static PlayerConfrontationConfirmation Clone(PlayerConfrontationConfirmation value) => new()
    {
        UserId = value.UserId,
        Role = value.Role,
        Revision = value.Revision,
        ConfirmedAt = value.ConfirmedAt
    };

    private static PairedConfrontationDisclosureRecord Clone(PairedConfrontationDisclosureRecord value) => new()
    {
        Revision = value.Revision,
        EvidenceId = value.EvidenceId,
        TestimonyFragmentId = value.TestimonyFragmentId,
        DisclosedAt = value.DisclosedAt
    };

    private static PairedConfrontationState RequireActive(GameplayState state, string attemptId)
    {
        var active = state.ActiveConfrontation;
        if (active is null || active.AttemptId != attemptId)
        {
            throw Violation(NotAvailableCode, "The confrontation is not available.");
        }
        return active;
    }

    private static PairedConfrontationAttemptRecord? FindTerminal(GameplayState state, string attemptId) =>
        state.PairedConfrontationAttempts.LastOrDefault(record => record.AttemptId == attemptId);

    private static void RequireRevision(PairedConfrontationState active, int expectedRevision)
    {
        if (active.Revision != expectedRevision)
        {
            throw Violation(StaleCode, "The confrontation changed; refresh and try again.");
        }
    }

    private static void RequireRole(string actual, string required)
    {
        if (actual != required)
        {
            throw Violation(WrongRoleCode, "This role cannot perform that confrontation action.");
        }
    }

    private static void RequirePlayerRole(string role)
    {
        if (!PlayerRole.IsValid(role))
        {
            throw Violation(WrongRoleCode, "A valid room role is required.");
        }
    }

    private static void RequireValue(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("A non-empty value is required.", name);
        }
    }

    private static PairedConfrontationRuleException Violation(string code, string message) => new(code, message);
}

public sealed record PairedConfrontationTransition(
    bool Changed,
    PairedConfrontationStatus Status,
    PairedConfrontationState? Active,
    PairedConfrontationAttemptRecord? Terminal)
{
    public static PairedConfrontationTransition ChangedTo(
        PairedConfrontationStatus status,
        PairedConfrontationState? active = null,
        PairedConfrontationAttemptRecord? terminal = null) =>
        new(true, status, active, terminal);

    public static PairedConfrontationTransition Unchanged(
        PairedConfrontationStatus status,
        PairedConfrontationAttemptRecord? terminal = null,
        PairedConfrontationState? active = null) =>
        new(false, status, active, terminal);
}

public sealed class PairedConfrontationRuleException : Exception
{
    public PairedConfrontationRuleException(string code, string message) : base(message) => Code = code;

    public string Code { get; }
}
