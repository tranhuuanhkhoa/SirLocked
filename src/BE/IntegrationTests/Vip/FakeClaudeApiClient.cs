using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Vip;

namespace SirLocked.IntegrationTests.Vip;

/// <summary>
/// A stand-in for the Claude API: records every call and answers with the pipeline's deterministic mock JSON (pruned
/// to the step's schema, like the bridge's mock answers). Never reaches Anthropic and needs no key.
/// </summary>
public sealed class FakeClaudeApiClient : IClaudeApiClient
{
    private readonly ConcurrentDictionary<string, ClaudeApiCall> _batches = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, ClaudeBatchOutcome> _batchOutcomes = new(StringComparer.Ordinal);

    public ConcurrentQueue<ClaudeApiCall> Calls { get; } = new();
    public ConcurrentQueue<ClaudeApiCall> BatchCalls { get; } = new();
    /// <summary>Replaces the default answer (step-aware mock JSON).</summary>
    public Func<ClaudeApiCall, ClaudeApiAnswer>? Answer { get; set; }
    public ClaudeApiUsage Usage { get; set; } = new(10_000, 2_000, 5_000, 1_000);

    public Task<ClaudeApiAnswer> CreateAsync(ClaudeApiCall call, CancellationToken ct = default)
    {
        Calls.Enqueue(call);
        return Task.FromResult((Answer ?? DefaultAnswer)(call));
    }

    public Task<string> CreateBatchAsync(ClaudeApiCall call, CancellationToken ct = default)
    {
        BatchCalls.Enqueue(call);
        var id = $"msgbatch_fake_{Guid.NewGuid():N}";
        _batches[id] = call;
        return Task.FromResult(id);
    }

    public Task<ClaudeBatchOutcome> GetBatchOutcomeAsync(string batchId, string customId, CancellationToken ct = default) =>
        Task.FromResult(_batchOutcomes.TryGetValue(batchId, out var outcome)
            ? outcome
            : new ClaudeBatchOutcome(ClaudeBatchState.InProgress, null, string.Empty));

    /// <summary>Ends every open batch with a successful mock answer (or the given outcome).</summary>
    public int EndBatches(Func<ClaudeApiCall, ClaudeBatchOutcome>? outcome = null)
    {
        var ended = 0;
        foreach (var (id, call) in _batches)
        {
            if (_batchOutcomes.ContainsKey(id)) continue;
            _batchOutcomes[id] = outcome?.Invoke(call)
                ?? new ClaudeBatchOutcome(ClaudeBatchState.Succeeded, (Answer ?? DefaultAnswer)(call), string.Empty);
            ended++;
        }
        return ended;
    }

    public ClaudeApiAnswer DefaultAnswer(ClaudeApiCall call) =>
        new(MockJson(call), "end_turn", Usage, call.Model, $"msg_fake_{Guid.NewGuid():N}");

    public static string MockJson(ClaudeApiCall call)
    {
        if (call.Step.StartsWith(VipModelRouter.BriefStep, StringComparison.Ordinal))
            return """{"summary":"Một vụ nhỏ","victim":"Chủ tiệm","setting":"Phố Hàng Đường","suspects":[],"mustInclude":[],"avoid":[],"tone":"ấm áp","contentOk":true,"contentIssues":[]}""";
        if (call.Step.StartsWith(VipModelRouter.JsonRepairStep, StringComparison.Ordinal))
        {
            // The repair prompt ends with the JSON to repair; give it back unchanged (tests set Answer to break it).
            var start = call.Prompt.IndexOf("JSON TO REPAIR:", StringComparison.Ordinal);
            return start < 0 ? "{}" : call.Prompt[(start + "JSON TO REPAIR:".Length)..].Trim();
        }
        var mock = AiCaseMockFactory.MockJsonResponse(call.Step, call.SchemaVersion);
        if (string.IsNullOrWhiteSpace(call.SchemaJson)) return mock;
        var node = JsonNode.Parse(AiBridgeSchemaValidator.StripMarkdownFences(mock));
        return AiBridgeSchemaValidator.PruneToSchema(node, JsonNode.Parse(call.SchemaJson))?.ToJsonString() ?? mock;
    }
}
