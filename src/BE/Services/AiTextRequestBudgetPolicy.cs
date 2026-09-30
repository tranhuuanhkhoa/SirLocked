using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;

namespace SirLocked.Api.Services;

internal static class AiTextRequestBudgetPolicy
{
    internal static JsonObject WithStandardServiceTier(object payload)
    {
        // Text accounting uses the Standard price table. An omitted tier means
        // "auto" at the provider and can inherit a more expensive project tier.
        // Serialize into a fresh tree so caller-owned overrides remain unchanged.
        var copy = JsonSerializer.SerializeToNode(payload) as JsonObject ?? throw LimitExceeded();
        copy["service_tier"] = "default";
        return copy;
    }

    internal static void EnsureWithinLimit(object payload, AiUsageSettings settings)
    {
        if (settings.MaxTextRequestBytes < 0 || settings.MaxTextOutputTokens < 0) throw LimitExceeded();
        if (settings.MaxTextRequestBytes <= 0 && settings.MaxTextOutputTokens <= 0) return;
        // Use the same serializer as AiOpenAiClient, including instructions, input and JSON schema.
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
        if (settings.MaxTextRequestBytes > 0 && bytes.Length > settings.MaxTextRequestBytes)
            throw LimitExceeded();
        if (settings.MaxTextOutputTokens > 0)
        {
            using var document = JsonDocument.Parse(bytes);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("max_output_tokens", out var output)
                || output.ValueKind != JsonValueKind.Number
                || !output.TryGetInt32(out var tokens) || tokens <= 0 || tokens > settings.MaxTextOutputTokens)
                throw LimitExceeded();
        }
    }

    private static ApiException LimitExceeded() => ApiException.Conflict(
        "This text request exceeds the configured AI trial size or output limit. No provider call was sent.",
        "AI_REQUEST_BUDGET_LIMIT", "ai.usage.requestBudgetLimit");
}
