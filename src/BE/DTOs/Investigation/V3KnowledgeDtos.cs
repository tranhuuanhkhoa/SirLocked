using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.DTOs.Investigation;

public sealed record GameStateVersionUpdateDto(string RoomId, long Version);

public class PrivateEvidenceDto
{
    public string ClueId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string SceneId { get; set; } = string.Empty;
    public string InventoryDescription { get; set; } = string.Empty;
    public string NarrativeMeaning { get; set; } = string.Empty;
    public string? PhotoUrl { get; set; }
}

public class PrivateTestimonyDto
{
    public string TestimonyFragmentId { get; set; } = string.Empty;
    public string DialogueId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public string CharacterName { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
}

public class DisclosedPairDto
{
    public string AttemptId { get; set; } = string.Empty;
    public int Revision { get; set; }
    public string Status { get; set; } = string.Empty;
    public PrivateEvidenceDto Evidence { get; set; } = new();
    public PrivateTestimonyDto Testimony { get; set; } = new();
    public string? Feedback { get; set; }
    public string? RevealTitle { get; set; }
    public List<SharedRevealDto> Reveals { get; set; } = new();
    public DateTime DisclosedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
}

public class SharedRevealDto
{
    public string ClueId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string NarrativeMeaning { get; set; } = string.Empty;
}

public class SharedKnowledgeDto
{
    public List<DisclosedPairDto> AttemptHistory { get; set; } = new();
    public List<DisclosedPairDto> ResolvedTruths { get; set; } = new();
}

public class PairedConfrontationViewDto
{
    public string AttemptId { get; set; } = string.Empty;
    public int Revision { get; set; }
    public PairedConfrontationStatus Status { get; set; }
    public PrivateEvidenceDto? Evidence { get; set; }
    public PrivateTestimonyDto? Testimony { get; set; }
    public bool PartnerHasProposed { get; set; }
    public bool ConfirmedByMe { get; set; }
    public bool PartnerConfirmed { get; set; }
    public bool PartnerConnected { get; set; }
    public bool CanEdit { get; set; }
    public bool CanConfirm { get; set; }
    public bool CanCancel { get; set; }
}
