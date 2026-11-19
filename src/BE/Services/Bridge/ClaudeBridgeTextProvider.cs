using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Bridge;

/// <summary>
/// Answers pipeline questions from the Claude bridge queue instead of a paid API.
/// <list type="bullet">
/// <item>The request key is deterministic: owner, generation run, step, attempt and the call's ordinal among calls
/// with the same step and attempt in this execution. A replayed run therefore finds the answers it already has.</item>
/// <item>No answer yet: the question is stored as PENDING (idempotent by key) and the run parks with
/// <see cref="AiAwaitingClaudeException"/>.</item>
/// <item>A replay whose prompt differs from the stored one retires the old request as STALE, logs a warning on the
/// draft and asks again.</item>
/// <item>Mock and dry-run modes answer with the deterministic mock JSON and never touch the queue.</item>
/// </list>
/// </summary>
public sealed class ClaudeBridgeTextProvider : IAiTextProvider
{
    public const string ProviderName = "Claude";
    private readonly AiBridgeRequestStore _store;
    private readonly MongoDbContext _db;
    private readonly AiGenerationSettings _generation;
    private readonly BridgeSettings _bridge;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<ClaudeBridgeTextProvider> _logger;
    private readonly Dictionary<string, int> _ordinals = new(StringComparer.Ordinal);

    public ClaudeBridgeTextProvider(
        AiBridgeRequestStore store,
        MongoDbContext db,
        IOptions<AiGenerationSettings> generation,
        IOptions<BridgeSettings> bridge,
        IHostEnvironment environment,
        ILogger<ClaudeBridgeTextProvider> logger)
    {
        _store = store;
        _db = db;
        _generation = generation.Value;
        _bridge = bridge.Value;
        _environment = environment;
        _logger = logger;
    }

    public async Task<string> GenerateJsonAsync(AiTextRequest request, CancellationToken cancellationToken = default)
    {
        if (_generation.BlocksAiCalls)
            return request.MockResponseFactory?.Invoke() ?? AiCaseMockFactory.MockJsonResponse(request.Step, request.SchemaVersion);

        var ordinalKey = string.Join('|', request.OwnerType, request.OwnerId, request.GenerationRunId, request.Step, request.AttemptNumber);
        var ordinal = _ordinals.GetValueOrDefault(ordinalKey);
        _ordinals[ordinalKey] = ordinal + 1;
        var requestKey = BuildRequestKey(request, ordinal);
        var promptSha = AiBridgeSchemaValidator.PromptSha256(request.Prompt);

        var existing = await _store.FindByKeyAsync(requestKey, cancellationToken);
        if (existing is not null && !string.Equals(existing.PromptSha256, promptSha, StringComparison.Ordinal))
        {
            await _store.MarkStaleAsync(existing, cancellationToken);
            _logger.LogWarning(
                "Bridge request {RequestId} for {OwnerType} {OwnerId} step {Step} is stale: the replayed prompt changed.",
                existing.Id, request.OwnerType, request.OwnerId, request.Step);
            await LogAsync(request, "STALE",
                $"Prompt changed for step {request.Step}; request {existing.Id} was retired and Claude is asked again.");
            existing = null;
        }

        if (existing is not null)
            return await AnswerOrWaitAsync(existing, request, cancellationToken);

        var created = await _store.InsertPendingAsync(new AiBridgeRequest
        {
            OwnerType = request.OwnerType,
            OwnerId = request.OwnerId,
            RequestKey = requestKey,
            OriginalRequestKey = requestKey,
            GenerationRunId = request.GenerationRunId,
            Step = request.Step,
            AttemptNumber = request.AttemptNumber,
            CallOrdinal = ordinal,
            SchemaVersion = request.SchemaVersion,
            Kind = AiBridgeKinds.Json,
            Prompt = request.Prompt,
            Instructions = request.Instructions,
            SchemaJson = request.Schema.ToJsonString(),
            PromptSha256 = promptSha,
            MaxOutputTokens = request.MaxOutputTokens,
            MockResponseJson = MockAnswerForSmokeTests(request)
        }, cancellationToken);
        if (!string.Equals(created.PromptSha256, promptSha, StringComparison.Ordinal))
            throw new AiAwaitingClaudeException(created.Id, request.OwnerType, request.OwnerId, request.Step);
        if (AiBridgeStatuses.Answered.Contains(created.Status) || created.Status == AiBridgeStatuses.Cancelled)
            return await AnswerOrWaitAsync(created, request, cancellationToken);

        await LogAsync(request, "AWAITING_CLAUDE", $"Request {created.Id} queued for Claude.");
        throw new AiAwaitingClaudeException(created.Id, request.OwnerType, request.OwnerId, request.Step);
    }

    public static string BuildRequestKey(AiTextRequest request, int ordinal) =>
        AiBridgeSchemaValidator.Sha256(string.Join('|',
            request.OwnerType, request.OwnerId, request.GenerationRunId, request.Step,
            request.AttemptNumber.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ordinal.ToString(System.Globalization.CultureInfo.InvariantCulture)));

    private async Task<string> AnswerOrWaitAsync(AiBridgeRequest stored, AiTextRequest request, CancellationToken ct)
    {
        if (stored.Status == AiBridgeStatuses.Cancelled)
            throw ApiException.Conflict(
                "The Claude request for this step was cancelled.",
                "AI_BRIDGE_REQUEST_CANCELLED",
                "ai.bridge.requestCancelled");
        if (!AiBridgeStatuses.Answered.Contains(stored.Status))
            throw new AiAwaitingClaudeException(stored.Id, request.OwnerType, request.OwnerId, request.Step);

        if (stored.Status == AiBridgeStatuses.Submitted) await _store.MarkAcceptedAsync(stored.Id, ct);
        if (request.OwnerType == AiBridgeOwnerTypes.CaseDraft && await _store.ClaimAttemptRecordingAsync(stored.Id, ct))
        {
            await RecordDraftAttemptAsync(request, stored, ct);
            await LogAsync(request, "CLAUDE_ANSWER", $"Request {stored.Id} answered by Claude.");
        }
        return stored.ResultJson;
    }

    private async Task RecordDraftAttemptAsync(AiTextRequest request, AiBridgeRequest stored, CancellationToken ct)
    {
        var attempt = new AiGenerationAttempt
        {
            Step = request.Step,
            AttemptNumber = request.AttemptNumber,
            ResponseId = stored.Id,
            Model = ProviderName,
            PromptVersion = request.SchemaVersion,
            SchemaVersion = request.SchemaVersion,
            Status = "SUCCESS",
            GenerationRunId = request.GenerationRunId,
            ResponseSha256 = stored.ResultSha256
        };
        await _db.AiCaseDrafts.UpdateOneAsync(
            draft => draft.Id == request.OwnerId,
            Builders<AiCaseDraft>.Update
                .Push(draft => draft.GenerationAttempts, attempt)
                .Set(draft => draft.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
    }

    private string? MockAnswerForSmokeTests(AiTextRequest request)
    {
        if (!_bridge.ExposeMockResponses || _environment.IsProduction()) return null;
        try
        {
            var mock = request.MockResponseFactory?.Invoke() ?? AiCaseMockFactory.MockJsonResponse(request.Step, request.SchemaVersion);
            var node = System.Text.Json.Nodes.JsonNode.Parse(AiBridgeSchemaValidator.StripMarkdownFences(mock));
            return AiBridgeSchemaValidator.PruneToSchema(node, request.Schema)?.ToJsonString() ?? mock;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogDebug(exception, "No mock answer could be prepared for bridge step {Step}.", request.Step);
            return null;
        }
    }

    private async Task LogAsync(AiTextRequest request, string status, string message)
    {
        try
        {
            await _db.AiGenerationLogs.InsertOneAsync(new AiGenerationLog
            {
                DraftId = request.OwnerType == AiBridgeOwnerTypes.CaseDraft ? request.OwnerId : $"cutscene:{request.OwnerId}",
                Provider = ProviderName,
                Step = request.Step,
                Status = status,
                Prompt = string.Empty,
                Response = message
            });
        }
        catch (MongoException exception)
        {
            _logger.LogWarning(exception, "Bridge log entry for step {Step} could not be written.", request.Step);
        }
    }
}
