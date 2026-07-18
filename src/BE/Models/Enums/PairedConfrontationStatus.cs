using System.Text.Json.Serialization;

namespace SirLocked.Api.Models.Enums;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PairedConfrontationStatus
{
    CollectingProposals,
    ReadyForReview,
    AwaitingSecondConfirmation,
    ResolvedCorrect,
    ResolvedIncorrect,
    Cancelled
}
