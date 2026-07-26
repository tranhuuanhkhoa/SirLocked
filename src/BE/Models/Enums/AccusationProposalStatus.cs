using System.Text.Json.Serialization;

namespace SirLocked.Api.Models.Enums;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum AccusationProposalStatus
{
    AwaitingConfirmation,
    Resolved,
    Cancelled
}
