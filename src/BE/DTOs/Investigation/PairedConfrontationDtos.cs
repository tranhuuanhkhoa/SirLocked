using System.ComponentModel.DataAnnotations;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.DTOs.Investigation;

public sealed class StartPairedConfrontationRequest
{
    [Required]
    public string AttemptId { get; set; } = string.Empty;

    [Required]
    public string TestimonyFragmentId { get; set; } = string.Empty;
}

public sealed class EditPairedTestimonyRequest
{
    [Required]
    public string TestimonyFragmentId { get; set; } = string.Empty;

    [Range(1, int.MaxValue)]
    public int ExpectedRevision { get; set; }
}

public sealed class SubmitPairedEvidenceRequest
{
    [Required]
    public string EvidenceId { get; set; } = string.Empty;

    [Range(1, int.MaxValue)]
    public int ExpectedRevision { get; set; }
}

public sealed class PairedConfrontationRevisionRequest
{
    [Range(1, int.MaxValue)]
    public int ExpectedRevision { get; set; }
}

public sealed class PairedConfrontationCommandResponse
{
    public GameStateResponse State { get; set; } = new();
    public bool Changed { get; set; }
    public string AttemptId { get; set; } = string.Empty;
    public int Revision { get; set; }
    public PairedConfrontationStatus Status { get; set; }
    public bool IsTerminal { get; set; }
    public string? Feedback { get; set; }
    public List<SharedRevealDto> Reveals { get; set; } = new();
}
