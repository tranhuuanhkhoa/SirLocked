using System.Text;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Vip;

/// <summary>
/// The VIP lane of VUAN-7: answers the pipeline's questions through the Claude API instead of the bridge queue.
/// <list type="bullet">
/// <item>Keys are the bridge's deterministic request keys, so a replayed run gets the answer it already paid for.</item>
/// <item>"Nhanh": one streamed Messages call per question. "Tiết kiệm": a Message Batch, the run parks like a bridge
/// question and <see cref="VipLaneWorker"/> resumes it when the batch ends.</item>
/// <item>The model follows <see cref="VipModelRouter"/>; every call's usage and cost goes to <c>aiVipUsage</c>.</item>
/// <item>Once the order's Claude spend reaches its cap the run stops (<see cref="VipLaneErrors.CostCapReached"/>) and
/// the reconciler refunds the order.</item>
/// </list>
/// </summary>
public sealed class ClaudeApiTextProvider : IAiTextProvider
{
    public const string ProviderName = "ClaudeApi";
    /// <summary>Room for adaptive thinking on top of the answer itself.</summary>
    public const int MinMaxTokens = 16_000;
    public const int MaxMaxTokens = 64_000;

    private readonly VipLaneStore _store;
    private readonly MongoDbContext _db;
    private readonly IClaudeApiClient _client;
    private readonly VipSettingsStore _settings;
    private readonly VipAnswerProcessor _answers;
    private readonly AiGenerationSettings _generation;
    private readonly AnthropicSettings _anthropic;
    private readonly ILogger<ClaudeApiTextProvider> _logger;
    private readonly Dictionary<string, int> _ordinals = new(StringComparer.Ordinal);

    public ClaudeApiTextProvider(
        VipLaneStore store,
        MongoDbContext db,
        IClaudeApiClient client,
        VipSettingsStore settings,
        VipAnswerProcessor answers,
        IOptions<AiGenerationSettings> generation,
        IOptions<AnthropicSettings> anthropic,
        ILogger<ClaudeApiTextProvider> logger)
    {
        _store = store;
        _db = db;
        _client = client;
        _settings = settings;
        _answers = answers;
        _generation = generation.Value;
        _anthropic = anthropic.Value;
        _logger = logger;
    }

    public async Task<string> GenerateJsonAsync(AiTextRequest request, CancellationToken cancellationToken = default)
    {
        if (_generation.BlocksAiCalls)
            return request.MockResponseFactory?.Invoke() ?? AiCaseMockFactory.MockJsonResponse(request.Step, request.SchemaVersion);
        if (!_anthropic.IsConfigured)
            throw VipLaneErrors.Transient("Anthropic__ApiKey is not set; the VIP lane waits until it is.");

        var draft = await ResolveDraftAsync(request, cancellationToken)
            ?? throw VipLaneErrors.Stop(VipLaneErrors.NotHeld, "The VIP order behind this question no longer exists.");
        var billing = draft.VipBilling;
        // A cutscene of a delivered VIP case (written after the order was charged) still goes through the API lane.
        var cutscene = request.OwnerType == AiBridgeOwnerTypes.Cutscene;
        if (billing is null || !(billing.State == AiVipBillingStates.Held || cutscene && billing.State == AiVipBillingStates.Charged))
            throw VipLaneErrors.Stop(VipLaneErrors.NotHeld, "This VIP order has no coins held; it cannot spend on the Claude API.");
        // Cutscenes are answered synchronously: their continuation is not part of the draft's parked run.
        var useBatch = billing.Speed == VipSpeeds.Saver && !cutscene;

        var ordinalKey = string.Join('|', request.OwnerType, request.OwnerId, request.GenerationRunId, request.Step, request.AttemptNumber);
        var ordinal = _ordinals.GetValueOrDefault(ordinalKey);
        _ordinals[ordinalKey] = ordinal + 1;
        var requestKey = ClaudeBridgeTextProvider.BuildRequestKey(request, ordinal);
        var models = await _settings.GetModelsAsync(cancellationToken);
        var choice = VipModelRouter.Resolve(models, request.Step, request.AttemptNumber);
        var system = BuildSystem(request);
        var promptSha = AiBridgeSchemaValidator.PromptSha256(system + "\n\n" + request.Prompt + "\n\n" + string.Join('\n', request.ImageUrls));

        var call = await _store.FindByKeyAsync(requestKey, cancellationToken);
        if (call is not null && !string.Equals(call.PromptSha256, promptSha, StringComparison.Ordinal))
        {
            _logger.LogWarning("VIP call {CallId} for draft {DraftId} step {Step} is stale: the replayed prompt changed.",
                call.Id, draft.Id, request.Step);
            await _store.RetireStaleAsync(call, cancellationToken);
            call = null;
        }
        switch (call?.State)
        {
            case AiVipCallStates.Done:
                return call.ResultJson;
            case AiVipCallStates.BatchPending:
                throw new AiAwaitingClaudeException(call.Id, request.OwnerType, request.OwnerId, request.Step);
            case AiVipCallStates.Failed:
                throw VipLaneErrors.Invalid(VipLaneErrors.CallFailed, $"Step {request.Step} failed before: {call.Error}");
        }

        // Spend nothing more once the order reached its cost cap.
        if (billing.CostCapVnd > 0 && billing.SpentVnd >= billing.CostCapVnd)
            throw VipLaneErrors.Stop(VipLaneErrors.CostCapReached,
                $"The order's Claude spend ({billing.SpentVnd} VND) reached its cap ({billing.CostCapVnd} VND).");

        call ??= await _store.InsertPendingAsync(new AiVipCall
        {
            RequestKey = requestKey,
            OwnerType = request.OwnerType,
            OwnerId = request.OwnerId,
            DraftId = draft.Id,
            GenerationRunId = request.GenerationRunId,
            Step = request.Step,
            AttemptNumber = request.AttemptNumber,
            Model = choice.Model,
            Batch = useBatch,
            PromptSha256 = promptSha,
            SchemaJson = request.Schema.ToJsonString()
        }, cancellationToken);
        if (call.State == AiVipCallStates.Done) return call.ResultJson;
        if (call.State == AiVipCallStates.BatchPending)
            throw new AiAwaitingClaudeException(call.Id, request.OwnerType, request.OwnerId, request.Step);

        var apiCall = new ClaudeApiCall(choice.Model, system, request.Prompt, request.ImageUrls, MaxTokens(request), call.Id,
            request.Step, request.SchemaVersion, request.Schema.ToJsonString());
        if (useBatch)
        {
            var batchId = await VipLaneErrors.CallAsync(() => _client.CreateBatchAsync(apiCall, cancellationToken));
            await _store.SetBatchAsync(call.Id, batchId, choice.Model, cancellationToken);
            await MarkWorkStartedAsync(draft.Id, cancellationToken);
            _logger.LogInformation("VIP draft {DraftId} step {Step} sent as batch {BatchId} ({Model}).",
                draft.Id, request.Step, batchId, choice.Model);
            throw new AiAwaitingClaudeException(call.Id, request.OwnerType, request.OwnerId, request.Step);
        }

        await MarkWorkStartedAsync(draft.Id, cancellationToken);
        var answer = await VipLaneErrors.CallAsync(() => _client.CreateAsync(apiCall, cancellationToken));
        if (answer.StopReason == "max_tokens" && apiCall.MaxTokens < MaxMaxTokens)
        {
            // Cut off: record what it cost, then ask once more with the largest budget.
            await _answers.RecordAsync(draft, call, answer, batch: false, "cut-off", cancellationToken);
            apiCall = apiCall with { MaxTokens = MaxMaxTokens };
            answer = await VipLaneErrors.CallAsync(() => _client.CreateAsync(apiCall, cancellationToken));
        }
        return await _answers.AcceptAsync(draft, call, request.Schema.ToJsonString(), answer, batch: false, cancellationToken);
    }

    /// <summary>Instructions plus the step's JSON Schema: identical for every order of a step, so it is cached.</summary>
    public static string BuildSystem(AiTextRequest request)
    {
        var builder = new StringBuilder(request.Instructions.Trim());
        builder.AppendLine().AppendLine()
            .AppendLine("Your whole answer is one JSON object that validates against this JSON Schema (no markdown fences, no commentary):")
            .Append(request.Schema.ToJsonString());
        return builder.ToString();
    }

    public static int MaxTokens(AiTextRequest request) =>
        Math.Clamp(Math.Max(request.MaxOutputTokens * 3, MinMaxTokens), MinMaxTokens, MaxMaxTokens);

    private async Task<AiCaseDraft?> ResolveDraftAsync(AiTextRequest request, CancellationToken ct)
    {
        var draftId = request.OwnerId;
        if (request.OwnerType == AiBridgeOwnerTypes.Cutscene)
        {
            draftId = await _db.Cases.Find(item => item.CaseId == request.OwnerId)
                .Project(item => item.SourceAiDraftId)
                .FirstOrDefaultAsync(ct) ?? string.Empty;
        }
        if (string.IsNullOrWhiteSpace(draftId)) return null;
        return await _db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(ct);
    }

    private Task MarkWorkStartedAsync(string draftId, CancellationToken ct) =>
        _db.AiCaseDrafts.UpdateOneAsync(
            item => item.Id == draftId && item.VipBilling != null && !item.VipBilling.WorkStarted,
            Builders<AiCaseDraft>.Update.Set(item => item.VipBilling!.WorkStarted, true),
            cancellationToken: ct);
}
