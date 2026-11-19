using Anthropic.Exceptions;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;

namespace SirLocked.Api.Services.Vip;

/// <summary>Error codes of the VIP lane. Terminal ones end the order and refund it at once.</summary>
public static class VipLaneErrors
{
    public const string NotConfigured = "VIP_LANE_NOT_CONFIGURED";
    public const string NotHeld = "VIP_ORDER_NOT_HELD";
    public const string CostCapReached = "VIP_COST_CAP_REACHED";
    public const string ContentRejected = "VIP_CONTENT_REJECTED";
    public const string Refused = "VIP_API_REFUSED";
    public const string Truncated = "VIP_API_TRUNCATED";
    public const string InvalidJson = "VIP_API_INVALID_JSON";
    public const string Rejected = "VIP_API_REJECTED";
    public const string SpendLimit = "VIP_API_SPEND_LIMIT";
    public const string Busy = "VIP_API_BUSY";
    public const string CallFailed = "VIP_API_CALL_FAILED";
    public const string PixelLabCap = "VIP_PIXELLAB_CAP";
    public const string InsufficientCoins = "VIP_INSUFFICIENT_COINS";

    /// <summary>Codes after which the order cannot continue: refunded without waiting for an admin retry.</summary>
    public static readonly IReadOnlySet<string> Terminal = new HashSet<string>(StringComparer.Ordinal)
    {
        CostCapReached, ContentRejected, Refused, Rejected, SpendLimit, NotHeld, PixelLabCap
    };

    public static ApiException Stop(string code, string message) =>
        new(409, message, new ApiErrorDetails(code, "ai.vip." + code));

    /// <summary>Not retried by the worker (a 4xx), but an admin may still retry the draft.</summary>
    public static ApiException Invalid(string code, string message) =>
        new(422, message, new ApiErrorDetails(code, "ai.vip." + code));

    /// <summary>Retried by the worker with backoff (5xx).</summary>
    public static ApiException Transient(string message) =>
        new(503, message, new ApiErrorDetails(Busy, "ai.vip." + Busy));

    /// <summary>
    /// Runs one Claude API request and turns SDK failures into the pipeline's error model: rate limits, overload,
    /// 5xx and network errors are transient; spend limits and other 4xx stop the order. Never logs the request body.
    /// </summary>
    public static async Task<T> CallAsync<T>(Func<Task<T>> call)
    {
        try
        {
            return await call();
        }
        // Spend limits answer 429 too: catch them before the rate limit, they do not pass by waiting.
        catch (Anthropic.Models.AnthropicEnforcedSpendLimitReachedException)
        {
            throw Stop(SpendLimit, "The Claude Console spend limit is reached; raise it before VIP orders can continue.");
        }
        catch (AnthropicRateLimitException exception)
        {
            throw Transient($"The Claude API is rate limited ({exception.GetType().Name}).");
        }
        catch (Anthropic5xxException exception)
        {
            throw Transient($"The Claude API failed ({exception.GetType().Name}).");
        }
        catch (AnthropicIOException exception)
        {
            throw Transient($"The Claude API could not be reached ({exception.GetType().Name}).");
        }
        catch (Anthropic4xxException exception)
        {
            throw Stop(Rejected, $"The Claude API refused the request ({exception.GetType().Name}).");
        }
    }
}

/// <summary>
/// Turns a model answer into the JSON the pipeline expects, for synchronous and batch calls alike: records its usage
/// and cost, refuses refusals and cut-off answers, checks the step's JSON Schema (the same check the bridge applies to
/// the bot) and lets the light model repair the format once.
/// </summary>
public sealed class VipAnswerProcessor(VipLaneStore store, IClaudeApiClient client, VipSettingsStore settings)
{
    public const int RepairMaxTokens = 32_000;

    public async Task<string> AcceptAsync(
        AiCaseDraft draft, AiVipCall call, string schemaJson, ClaudeApiAnswer answer, bool batch, CancellationToken ct)
    {
        await RecordAsync(draft, call, answer, batch, "answer", ct);
        if (answer.StopReason == "refusal")
        {
            await store.FailAsync(call.Id, "The model declined to answer (refusal).", ct);
            throw VipLaneErrors.Stop(VipLaneErrors.Refused, $"The model declined to write step {call.Step}.");
        }
        if (answer.StopReason == "max_tokens")
        {
            await store.FailAsync(call.Id, "The answer was cut off at max_tokens.", ct);
            throw VipLaneErrors.Invalid(VipLaneErrors.Truncated, $"The answer to step {call.Step} was cut off.");
        }

        var json = AiBridgeSchemaValidator.StripMarkdownFences(answer.Text);
        var errors = AiBridgeSchemaValidator.Validate(schemaJson, json);
        if (errors.Count == 0)
        {
            await store.CompleteAsync(call.Id, json, answer.Model, ct);
            return json;
        }

        // One format repair by the light model ("sửa lỗi định dạng JSON"); it may not change the content.
        var models = await settings.GetModelsAsync(ct);
        var repairModel = VipModelRouter.Resolve(models, VipModelRouter.JsonRepairStep, 1).Model;
        var repair = await VipLaneErrors.CallAsync(() => client.CreateAsync(new ClaudeApiCall(
            repairModel,
            "You repair JSON documents so they validate against a JSON Schema. Keep every value and its meaning; change only "
            + "the structure, types and missing required fields. Return exactly one valid JSON object, no markdown fences.\n\n"
            + "JSON SCHEMA:\n" + schemaJson,
            "VALIDATION ERRORS:\n- " + string.Join("\n- ", errors.Take(40)) + "\n\nJSON TO REPAIR:\n" + json,
            [],
            RepairMaxTokens,
            call.Id + ":repair",
            VipModelRouter.JsonRepairStep,
            string.Empty,
            schemaJson), ct));
        await RecordAsync(draft, call, repair, batch: false, "repair", ct);
        var repaired = AiBridgeSchemaValidator.StripMarkdownFences(repair.Text);
        var repairErrors = repair.StopReason is "refusal" or "max_tokens"
            ? new List<string> { $"repair stopped: {repair.StopReason}" }
            : AiBridgeSchemaValidator.Validate(schemaJson, repaired);
        if (repairErrors.Count == 0)
        {
            await store.CompleteAsync(call.Id, repaired, answer.Model, ct);
            return repaired;
        }
        await store.FailAsync(call.Id, "Schema errors: " + string.Join(" | ", errors.Take(10)), ct);
        throw VipLaneErrors.Invalid(VipLaneErrors.InvalidJson,
            $"The answer to step {call.Step} did not match its schema: {string.Join(" | ", errors.Take(5))}");
    }

    /// <summary>One usage row per answer (id = call id + suffix, so it is recorded once) and the draft's running cost.</summary>
    public async Task RecordAsync(AiCaseDraft draft, AiVipCall call, ClaudeApiAnswer answer, bool batch, string suffix, CancellationToken ct)
    {
        var models = await settings.GetModelsAsync(ct);
        var model = string.IsNullOrWhiteSpace(answer.Model) ? call.Model : answer.Model;
        var usd = VipModelRouter.CostUsd(models.TokenPrice(model), answer.Usage, batch);
        var rate = draft.VipBilling?.UsdToVnd is > 0 ? draft.VipBilling.UsdToVnd : (await settings.GetPricingAsync(ct)).UsdToVnd;
        await store.RecordUsageAsync(new AiVipUsageRecord
        {
            Id = $"{call.Id}:{suffix}",
            DraftId = draft.Id,
            CallId = call.Id,
            Step = call.Step,
            Model = model,
            Speed = draft.VipBilling?.Speed ?? string.Empty,
            Preset = draft.VipBilling?.Preset ?? string.Empty,
            InputTokens = answer.Usage.InputTokens,
            OutputTokens = answer.Usage.OutputTokens,
            CacheReadTokens = answer.Usage.CacheReadTokens,
            CacheWriteTokens = answer.Usage.CacheWriteTokens,
            Batch = batch,
            CostUsd = usd,
            CostVnd = VipModelRouter.ToVnd(usd, rate),
            StopReason = answer.StopReason,
            At = store.Now
        }, ct);
    }
}
