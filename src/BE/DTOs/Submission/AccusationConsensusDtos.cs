using System.ComponentModel.DataAnnotations;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.DTOs.Submission;

/// <summary>An amend restates the whole proposal plus the revision its author actually reviewed.</summary>
public sealed class AmendAccusationRequest : AccuseRequest
{
    [Range(1, int.MaxValue)]
    public int ExpectedRevision { get; set; }
}

public sealed class AccusationRevisionRequest
{
    [Range(1, int.MaxValue)]
    public int ExpectedRevision { get; set; }
}

public class AccusationEvidenceLinkDto
{
    public string ClaimType { get; set; } = string.Empty;

    /// <summary>Null for a viewer who has not earned this clue; the claim itself is still shown.</summary>
    public string? EvidenceId { get; set; } = string.Empty;

    /// <summary>Set when the projection withheld <see cref="EvidenceId"/> from this caller.</summary>
    public bool IsUndisclosed { get; set; }
}

/// <summary>
/// The proposal both detectives review. Its shape — culprit, motive, method, one claim per slot — is
/// shared knowledge on purpose: this is the step where the pair looks at one decision together. The
/// evidence ids behind each claim are still subject to the V3 knowledge boundary, so a clue only the
/// proposer discovered reaches the partner as an undisclosed claim rather than as a semantic id.
/// </summary>
public class AccusationProposalDto
{
    public string AttemptId { get; set; } = string.Empty;
    public AccusationProposalStatus Status { get; set; }
    public int Revision { get; set; }
    public string ProposedByUserId { get; set; } = string.Empty;
    public string ProposedByRole { get; set; } = string.Empty;
    public string CulpritId { get; set; } = string.Empty;
    public string? MotiveId { get; set; }
    public string? MethodId { get; set; }
    public List<string> EvidenceIds { get; set; } = new();
    public List<AccusationEvidenceLinkDto> EvidenceLinks { get; set; } = new();
    /// <summary>Only confirmations bound to <see cref="Revision"/>; an amend voids the earlier ones.</summary>
    public List<string> ConfirmedUserIds { get; set; } = new();
    public DateTime UpdatedAt { get; set; }

    /// <summary>Returns null when no proposal is standing, so callers never repeat the null check.</summary>
    public static AccusationProposalDto? From(AccusationProposalState? proposal) => proposal is null ? null : new()
    {
        AttemptId = proposal.AttemptId,
        Status = proposal.Status,
        Revision = proposal.Revision,
        ProposedByUserId = proposal.ProposedByUserId,
        ProposedByRole = proposal.ProposedByRole,
        CulpritId = proposal.CulpritId,
        MotiveId = proposal.MotiveId,
        MethodId = proposal.MethodId,
        EvidenceIds = proposal.EvidenceIds.ToList(),
        EvidenceLinks = proposal.EvidenceLinks
            .Select(link => new AccusationEvidenceLinkDto { ClaimType = link.ClaimType, EvidenceId = link.EvidenceId })
            .ToList(),
        ConfirmedUserIds = proposal.Confirmations
            .Where(confirmation => confirmation.Revision == proposal.Revision)
            .Select(confirmation => confirmation.UserId)
            .Distinct()
            .ToList(),
        UpdatedAt = proposal.UpdatedAt
    };
}

public sealed class AccusationCommandResponse
{
    public GameStateResponse State { get; set; } = new();
    public bool Changed { get; set; }
    /// <summary>The proposal this command acted on, whether it is still open or has become terminal.</summary>
    public AccusationProposalDto? Accusation { get; set; }
    /// <summary>Non-null only on the command that completed the case.</summary>
    public GameResultResponse? Result { get; set; }
}
