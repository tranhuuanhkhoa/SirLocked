using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace SirLocked.Api.DTOs.Investigation;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum UiPlaytestEventType
{
    ReconnectRestored,
    PrivateNotebookOpened,
    PrivateNotebookClosed,
    ConfrontationOverlayOpened,
    ProposalSelectionDwell,
    WaitingStarted,
    WaitingEnded,
    RevealDisplayed,
    RevealDismissed
}

public sealed class RecordUiPlaytestEventRequest
{
    [Required]
    public UiPlaytestEventType? EventType { get; set; }

    public string? AttemptId { get; set; }

    [Range(0, int.MaxValue)]
    public int? Revision { get; set; }

    [Range(0, 3_600_000)]
    public long? DurationMs { get; set; }

    [Range(0, 10_000)]
    public int? Count { get; set; }
}
