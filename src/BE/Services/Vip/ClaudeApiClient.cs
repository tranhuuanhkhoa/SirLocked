namespace SirLocked.Api.Services.Vip;

/// <summary>One question for the Claude API: a cached system prompt, the step prompt and optional images.</summary>
public sealed record ClaudeApiCall(
    string Model,
    string System,
    string Prompt,
    IReadOnlyList<string> ImageUrls,
    int MaxTokens,
    /// <summary>The batch custom id (the <c>aiVipCalls</c> id); ignored by synchronous calls.</summary>
    string CustomId,
    /// <summary>Metadata for logs and test doubles; never sent to the API.</summary>
    string Step = "",
    string SchemaVersion = "",
    string SchemaJson = "");

public sealed record ClaudeApiUsage(long InputTokens, long OutputTokens, long CacheReadTokens, long CacheWriteTokens)
{
    public static readonly ClaudeApiUsage Zero = new(0, 0, 0, 0);
}

/// <summary>The model's answer: its text, why it stopped, what it cost in tokens.</summary>
public sealed record ClaudeApiAnswer(string Text, string StopReason, ClaudeApiUsage Usage, string Model, string MessageId);

public enum ClaudeBatchState
{
    InProgress,
    Succeeded,
    Errored,
    Canceled,
    Expired
}

public sealed record ClaudeBatchOutcome(ClaudeBatchState State, ClaudeApiAnswer? Answer, string Error);

/// <summary>
/// The Claude API as the VIP lane needs it. The real implementation is <see cref="AnthropicSdkClient"/>; tests use a
/// fake and never reach Anthropic.
/// </summary>
public interface IClaudeApiClient
{
    /// <summary>"Nhanh": one Messages API call (streamed, so long answers do not hit HTTP timeouts).</summary>
    Task<ClaudeApiAnswer> CreateAsync(ClaudeApiCall call, CancellationToken ct = default);

    /// <summary>"Tiết kiệm": submits a one-request Message Batch and returns its id.</summary>
    Task<string> CreateBatchAsync(ClaudeApiCall call, CancellationToken ct = default);

    /// <summary>Reads a batch: still running, or the outcome of the request with <paramref name="customId"/>.</summary>
    Task<ClaudeBatchOutcome> GetBatchOutcomeAsync(string batchId, string customId, CancellationToken ct = default);
}

/// <summary>Raised for an answer the lane cannot use (refusal, cut off at max tokens, empty).</summary>
public sealed class ClaudeApiAnswerException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
