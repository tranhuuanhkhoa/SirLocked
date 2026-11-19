using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Json.Schema;

namespace SirLocked.Api.Services.Bridge;

/// <summary>
/// The server-side replacement for OpenAI's strict structured outputs: every answer the bot submits is checked against
/// the exact JSON Schema of its step before it reaches the pipeline (JsonSchema.Net, draft 2020-12 semantics).
/// </summary>
public static partial class AiBridgeSchemaValidator
{
    private const int MaxErrors = 60;
    private static readonly ConcurrentDictionary<string, JsonSchema> Cache = new(StringComparer.Ordinal);

    /// <summary>Returns "path: reason" lines; empty means the answer matches the schema.</summary>
    public static List<string> Validate(string schemaJson, string answerJson)
    {
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(StripMarkdownFences(answerJson));
        }
        catch (JsonException exception)
        {
            return [$"$: the answer is not valid JSON ({exception.Message})"];
        }
        if (node is not JsonObject)
            return ["$: the answer must be exactly one JSON object"];
        if (string.IsNullOrWhiteSpace(schemaJson)) return [];

        JsonSchema schema;
        try
        {
            schema = Cache.GetOrAdd(Sha256(schemaJson), _ => JsonSchema.FromText(schemaJson));
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or ArgumentException)
        {
            return [$"$: the stored step schema could not be loaded ({exception.Message})"];
        }

        var results = schema.Evaluate(node, new EvaluationOptions
        {
            OutputFormat = OutputFormat.List,
            RequireFormatValidation = false
        });
        if (results.IsValid) return [];

        var errors = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var detail in results.Details.Prepend(results))
        {
            if (detail.Errors is not { Count: > 0 } detailErrors) continue;
            var path = ToPath(detail.InstanceLocation.ToString());
            foreach (var (keyword, message) in detailErrors)
            {
                var line = $"{path}: {message} ({keyword})";
                if (!seen.Add(line)) continue;
                errors.Add(line);
                if (errors.Count >= MaxErrors)
                {
                    errors.Add("...: more errors were omitted; fix these first.");
                    return errors;
                }
            }
        }
        return errors.Count == 0 ? ["$: the answer does not match the step schema"] : errors;
    }

    /// <summary>
    /// Removes properties a closed schema does not allow (for example server-owned timestamps a mock object carries),
    /// so a development mock answer has the exact shape a real answer must have.
    /// </summary>
    public static JsonNode? PruneToSchema(JsonNode? node, JsonNode? schema)
    {
        if (node is null || schema is not JsonObject rule) return node;
        if (node is JsonObject obj && rule["properties"] is JsonObject properties)
        {
            var closed = rule["additionalProperties"] is JsonValue value && value.TryGetValue<bool>(out var allowed) && !allowed;
            foreach (var name in obj.Select(pair => pair.Key).ToList())
            {
                if (properties[name] is JsonNode child) PruneToSchema(obj[name], child);
                else if (closed) obj.Remove(name);
            }
        }
        else if (node is JsonArray array && rule["items"] is JsonNode items)
        {
            foreach (var element in array) PruneToSchema(element, items);
        }
        return node;
    }

    /// <summary>Accepts an answer wrapped in a Markdown code fence, as a model sometimes returns it.</summary>
    public static string StripMarkdownFences(string text)
    {
        var trimmed = (text ?? string.Empty).Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal)) return trimmed;
        var firstNewline = trimmed.IndexOf('\n');
        if (firstNewline >= 0) trimmed = trimmed[(firstNewline + 1)..];
        var lastFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
        if (lastFence >= 0) trimmed = trimmed[..lastFence];
        return trimmed.Trim();
    }

    /// <summary>JSON Pointer "/stages/0/title" to "$.stages[0].title".</summary>
    internal static string ToPath(string pointer)
    {
        if (string.IsNullOrEmpty(pointer) || pointer == "/" || pointer == "#") return "$";
        var builder = new StringBuilder("$");
        foreach (var raw in pointer.TrimStart('#').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            var segment = raw.Replace("~1", "/").Replace("~0", "~");
            if (int.TryParse(segment, out var index)) builder.Append('[').Append(index).Append(']');
            else builder.Append('.').Append(segment);
        }
        return builder.ToString();
    }

    /// <summary>
    /// Hash of a prompt for the stale check. ISO timestamps of "...At" properties (for example a case's createdAt,
    /// which defaults to "now" when a JSON checkpoint is re-read) are not content, so they never make a replay stale.
    /// </summary>
    public static string PromptSha256(string prompt) => Sha256(VolatileTimestamp().Replace(prompt ?? string.Empty, "$1\"\""));

    public static string Sha256(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty))).ToLowerInvariant();

    [GeneratedRegex("(\"[A-Za-z]*At\"\\s*:\\s*)\"\\d{4}-\\d{2}-\\d{2}T[0-9:.]+(?:Z|[+-]\\d{2}:\\d{2})?\"")]
    private static partial Regex VolatileTimestamp();
}
