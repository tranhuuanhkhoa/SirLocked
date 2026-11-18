using System.Text;
using Anthropic;
using Anthropic.Models.Beta;
using Anthropic.Models.Beta.Messages;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using BatchApi = Anthropic.Models.Beta.Messages.Batches;

namespace SirLocked.Api.Services.Vip;

/// <summary>
/// The Claude API through the official Anthropic C# SDK (docs: platform.claude.com/docs/en/build-with-claude/…;
/// Messages, Message Batches and prompt caching). The key comes from <c>Anthropic__ApiKey</c> only.
/// <list type="bullet">
/// <item>Synchronous calls stream and collect the answer, so long JSON answers never hit an HTTP timeout.</item>
/// <item>The system prompt (instructions + schema, the same for every order of a step) carries a cache breakpoint.</item>
/// <item>Sonnet and Opus calls opt into the server-side refusal fallback (<c>fallbacks: "default"</c>); Haiku has none.</item>
/// </list>
/// </summary>
public sealed class AnthropicSdkClient : IClaudeApiClient, IDisposable
{
    private const string FallbackBeta = "server-side-fallback-2026-07-01";
    private readonly AnthropicSettings _settings;
    private readonly Lazy<AnthropicClient> _client;

    public AnthropicSdkClient(IOptions<AnthropicSettings> settings)
    {
        _settings = settings.Value;
        _client = new Lazy<AnthropicClient>(() =>
        {
            if (!_settings.IsConfigured)
                throw new InvalidOperationException("Anthropic__ApiKey is not set; the VIP lane is not configured.");
            var timeout = TimeSpan.FromSeconds(Math.Clamp(_settings.RequestTimeoutSeconds, 30, 3600));
            return string.IsNullOrWhiteSpace(_settings.BaseUrl)
                ? new AnthropicClient { ApiKey = _settings.ApiKey, Timeout = timeout, MaxRetries = 2 }
                : new AnthropicClient { ApiKey = _settings.ApiKey, Timeout = timeout, MaxRetries = 2, BaseUrl = _settings.BaseUrl };
        });
    }

    public async Task<ClaudeApiAnswer> CreateAsync(ClaudeApiCall call, CancellationToken ct = default)
    {
        var text = new StringBuilder();
        string messageId = string.Empty, model = call.Model, stopReason = string.Empty;
        long input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
        await foreach (var streamEvent in _client.Value.Beta.Messages.CreateStreaming(BuildParams(call), ct))
        {
            if (streamEvent.TryPickStart(out var start))
            {
                messageId = start.Message.ID;
                model = start.Message.Model;
                input = start.Message.Usage.InputTokens;
                cacheRead = start.Message.Usage.CacheReadInputTokens ?? 0;
                cacheWrite = start.Message.Usage.CacheCreationInputTokens ?? 0;
            }
            else if (streamEvent.TryPickContentBlockDelta(out var delta) && delta.Delta.TryPickText(out var piece))
            {
                text.Append(piece.Text);
            }
            else if (streamEvent.TryPickDelta(out var messageDelta))
            {
                stopReason = messageDelta.Delta.StopReason?.ToString() ?? stopReason;
                // The final message_delta carries the cumulative usage.
                output = messageDelta.Usage.OutputTokens;
                if (messageDelta.Usage.InputTokens is { } totalInput) input = totalInput;
                if (messageDelta.Usage.CacheReadInputTokens is { } totalRead) cacheRead = totalRead;
                if (messageDelta.Usage.CacheCreationInputTokens is { } totalWrite) cacheWrite = totalWrite;
            }
        }
        return new ClaudeApiAnswer(text.ToString(), Normalize(stopReason),
            new ClaudeApiUsage(input, output, cacheRead, cacheWrite), model, messageId);
    }

    public async Task<string> CreateBatchAsync(ClaudeApiCall call, CancellationToken ct = default)
    {
        var request = new BatchApi.Params
        {
            Model = call.Model,
            MaxTokens = call.MaxTokens,
            System = SystemBlocks(call),
            Messages = UserMessages(call)
        };
        var create = new BatchApi.BatchCreateParams { Requests = [new BatchApi.Request { CustomID = call.CustomId, Params = request }] };
        if (UsesFallback(call))
            create = create with { Betas = [FallbackBeta], Requests = [new BatchApi.Request { CustomID = call.CustomId, Params = request with { Fallbacks = new Default() } }] };
        var batch = await _client.Value.Beta.Messages.Batches.Create(create, ct);
        return batch.ID;
    }

    public async Task<ClaudeBatchOutcome> GetBatchOutcomeAsync(string batchId, string customId, CancellationToken ct = default)
    {
        var batch = await _client.Value.Beta.Messages.Batches.Retrieve(batchId, new BatchApi.BatchRetrieveParams(), ct);
        if (!string.Equals(batch.ProcessingStatus.ToString(), "ended", StringComparison.OrdinalIgnoreCase))
            return new ClaudeBatchOutcome(ClaudeBatchState.InProgress, null, string.Empty);

        await foreach (var item in _client.Value.Beta.Messages.Batches.ResultsStreaming(batchId, new BatchApi.BatchResultsParams(), ct))
        {
            if (!string.Equals(item.CustomID, customId, StringComparison.Ordinal)) continue;
            if (item.Result.TryPickSucceeded(out var succeeded))
            {
                var message = succeeded.Message;
                var text = new StringBuilder();
                foreach (var block in message.Content)
                    if (block.TryPickText(out var textBlock)) text.Append(textBlock.Text);
                var usage = new ClaudeApiUsage(
                    message.Usage.InputTokens,
                    message.Usage.OutputTokens,
                    message.Usage.CacheReadInputTokens ?? 0,
                    message.Usage.CacheCreationInputTokens ?? 0);
                return new ClaudeBatchOutcome(ClaudeBatchState.Succeeded,
                    new ClaudeApiAnswer(text.ToString(), Normalize(message.StopReason?.ToString()), usage, message.Model, message.ID),
                    string.Empty);
            }
            if (item.Result.TryPickErrored(out var errored))
                return new ClaudeBatchOutcome(ClaudeBatchState.Errored, null, Clip(errored.Error.ToString()));
            if (item.Result.TryPickExpired(out _))
                return new ClaudeBatchOutcome(ClaudeBatchState.Expired, null, "The batch request expired.");
            return new ClaudeBatchOutcome(ClaudeBatchState.Canceled, null, "The batch request was canceled.");
        }
        return new ClaudeBatchOutcome(ClaudeBatchState.Errored, null, "The batch ended without a result for this request.");
    }

    private static MessageCreateParams BuildParams(ClaudeApiCall call)
    {
        var parameters = new MessageCreateParams
        {
            Model = call.Model,
            MaxTokens = call.MaxTokens,
            System = SystemBlocks(call),
            Messages = UserMessages(call)
        };
        // Opt into the server-side refusal fallback by default (Sonnet 5.5, Opus 5.5); Haiku has none.
        return UsesFallback(call) ? parameters with { Betas = [FallbackBeta], Fallbacks = new Default() } : parameters;
    }

    private static bool UsesFallback(ClaudeApiCall call) => call.Model != VipModelIds.Haiku;

    /// <summary>Instructions and schema are the same for every order of a step: they carry the cache breakpoint.</summary>
    private static List<BetaTextBlockParam> SystemBlocks(ClaudeApiCall call) =>
    [
        new() { Text = call.System, CacheControl = new BetaCacheControlEphemeral() }
    ];

    private static List<BetaMessageParam> UserMessages(ClaudeApiCall call)
    {
        List<BetaContentBlockParam> content = [];
        foreach (var url in call.ImageUrls)
            content.Add(new BetaImageBlockParam { Source = new BetaUrlImageSource { Url = url } });
        content.Add(new BetaTextBlockParam { Text = call.Prompt });
        return [new BetaUserMessageParam { Content = content }];
    }

    private static string Normalize(string? stopReason) => (stopReason ?? string.Empty).Trim().ToLowerInvariant();

    private static string Clip(string value) => value.Length <= 500 ? value : value[..500];

    public void Dispose()
    {
        if (_client.IsValueCreated) _client.Value.Dispose();
    }
}
