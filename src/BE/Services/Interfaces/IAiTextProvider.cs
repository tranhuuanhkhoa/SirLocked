using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

/// <summary>One structured-JSON question the pipeline needs answered.</summary>
public sealed record AiTextRequest
{
    /// <summary><see cref="AiBridgeOwnerTypes"/>: a case draft or a cutscene.</summary>
    public string OwnerType { get; init; } = AiBridgeOwnerTypes.CaseDraft;
    /// <summary>The draft id, or the case id for a cutscene.</summary>
    public string OwnerId { get; init; } = string.Empty;
    public string Step { get; init; } = string.Empty;
    public string SchemaVersion { get; init; } = string.Empty;
    public JsonObject Schema { get; init; } = new();
    public string Instructions { get; init; } = string.Empty;
    public string Prompt { get; init; } = string.Empty;
    /// <summary>Length hint for the answer, in model output tokens.</summary>
    public int MaxOutputTokens { get; init; }
    public int AttemptNumber { get; init; } = 1;
    /// <summary>Stays the same while a parked operation waits for Claude and resumes.</summary>
    public string GenerationRunId { get; init; } = string.Empty;
    /// <summary>
    /// Images the step inspects (scene layout and verification). The bridge bot opens the URLs listed in the prompt;
    /// the Claude API lane sends them as image blocks.
    /// </summary>
    public IReadOnlyList<string> ImageUrls { get; init; } = [];
    /// <summary>Deterministic answer for mock/dry-run mode and the local smoke test.</summary>
    public Func<string>? MockResponseFactory { get; init; }
}

public interface IAiTextProvider
{
    /// <summary>
    /// Returns the JSON answer, or throws <see cref="AiAwaitingClaudeException"/> after queueing the question for the
    /// Claude bot. The caller's run is parked and replayed from its checkpoint once the bot answers.
    /// </summary>
    Task<string> GenerateJsonAsync(AiTextRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// Not an error: the pipeline asked Claude a question and must wait. Deliberately not an <c>ApiException</c>, so the
/// failure handlers of the pipeline never mark the draft invalid for it.
/// </summary>
public sealed class AiAwaitingClaudeException : Exception
{
    public AiAwaitingClaudeException(string requestId, string ownerType, string ownerId, string step)
        : base($"Waiting for Claude to answer '{step}'.")
    {
        RequestId = requestId;
        OwnerType = ownerType;
        OwnerId = ownerId;
        Step = step;
    }

    public string RequestId { get; }
    public string OwnerType { get; }
    public string OwnerId { get; }
    public string Step { get; }
}
