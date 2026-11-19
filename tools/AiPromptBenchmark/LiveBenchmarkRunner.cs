using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SirLocked.Api.Models;

internal static class LiveBenchmarkRunner
{
    private static readonly string CorpusHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        "short/normal/full|en/vi|V2/V3|unknown-evidence-id|duplicate-claim-proof|missing-claim-proof|causal-reference-mismatch"))).ToLowerInvariant();
    private static readonly (string Language, string Preset, bool V3)[] Corpus =
    [
        ("vi", AiGenerationPresets.ShortDemo, false), ("vi", AiGenerationPresets.ShortDemo, true),
        ("en", AiGenerationPresets.ShortDemo, false), ("en", AiGenerationPresets.ShortDemo, true),
        ("vi", AiGenerationPresets.NormalRandom, false), ("vi", AiGenerationPresets.NormalRandom, true),
        ("en", AiGenerationPresets.NormalRandom, false), ("en", AiGenerationPresets.NormalRandom, true),
        ("vi", AiGenerationPresets.FullFeature, false), ("vi", AiGenerationPresets.FullFeature, true),
        ("en", AiGenerationPresets.FullFeature, false), ("en", AiGenerationPresets.FullFeature, true)
    ];

    public static object Blocked(string mode, decimal maxUsd, string reason) => new
    {
        schemaVersion = "ai-case-benchmark-v1",
        mode,
            model = "configured-baseline",
            promptVersion = AiGenerationSchemaVersions.Prompt,
            validatorVersion = "blind-review-validator-v1",
            compilerVersion = "projection-compiler-current",
            corpusHash = CorpusHash,
        status = "BLOCKED",
        budgetUsd = maxUsd,
        completed = 0,
        total = Corpus.Length,
        reason,
        calls = 0,
        knownCostUsd = (decimal?)null,
        unknownCalls = 0,
        samples = Array.Empty<object>()
    };

    public static async Task<object> RunAsync(Uri baseUri, string token, decimal maxUsd, decimal reserveUsd,
        string? statePath, bool resume)
    {
        using var client = new HttpClient { BaseAddress = baseUri, Timeout = TimeSpan.FromMinutes(15) };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var runId = $"benchmark-{Guid.NewGuid():N}";
        var samples = new List<Dictionary<string, object?>>();
        decimal knownCost = 0m;
        decimal pendingReservation = 0m;
        var unknownCalls = 0;
        if (resume && !string.IsNullOrWhiteSpace(statePath) && File.Exists(statePath))
        {
            using var state = JsonDocument.Parse(await File.ReadAllTextAsync(statePath));
            if (state.RootElement.TryGetProperty("runId", out var previousRunId)
                && previousRunId.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(previousRunId.GetString()))
                runId = previousRunId.GetString()!;
            if (state.RootElement.TryGetProperty("knownCostUsd", out var priorCost)
                && priorCost.ValueKind == JsonValueKind.Number)
                knownCost = priorCost.GetDecimal();
            if (state.RootElement.TryGetProperty("pendingReservationUsd", out var priorPending)
                && priorPending.ValueKind == JsonValueKind.Number)
                pendingReservation = priorPending.GetDecimal();
            if (state.RootElement.TryGetProperty("unknownCalls", out var priorUnknown)
                && priorUnknown.ValueKind == JsonValueKind.Number)
                unknownCalls = priorUnknown.GetInt32();
            if (state.RootElement.TryGetProperty("samples", out var previous))
                foreach (var item in previous.EnumerateArray())
                    if (item.TryGetProperty("completed", out var completed) && completed.GetBoolean())
                        samples.Add(new Dictionary<string, object?> { ["fixture"] = item.GetProperty("fixture").GetString(), ["completed"] = true });
        }

        var started = Stopwatch.StartNew();
        var stoppedForBudget = false;
        client.DefaultRequestHeaders.TryAddWithoutValidation("X-SirLocked-Benchmark-Run-Id", runId);
        foreach (var fixture in Corpus)
        {
            var fixtureId = $"{fixture.Language}-{fixture.Preset}-{(fixture.V3 ? "v3" : "v2")}";
            if (samples.Any(item => string.Equals(item["fixture"]?.ToString(), fixtureId, StringComparison.Ordinal))) continue;
            if (knownCost + pendingReservation + reserveUsd > maxUsd)
            {
                stoppedForBudget = true;
                break;
            }
            var sampleStarted = Stopwatch.StartNew();
            var sample = new Dictionary<string, object?> { ["fixture"] = fixtureId, ["completed"] = false };
            try
            {
                var create = await PostAsync(client, "/api/admin/ai-cases", new
                {
                    prompt = $"Benchmark run {runId}, fixture {fixtureId}. Use the server-selected truth and keep all IDs neutral.",
                    stageCount = fixture.Preset == AiGenerationPresets.ShortDemo ? 2 : fixture.Preset == AiGenerationPresets.FullFeature ? 6 : 4,
                    difficulty = fixture.Preset == AiGenerationPresets.FullFeature ? "hard" : "medium",
                    generationPreset = fixture.Preset,
                    language = fixture.Language,
                    includeCrackTheLie = fixture.V3,
                    caseType = AiCaseTypes.Random
                }, new("Idempotency-Key", $"{runId}-{fixtureId}"));
                var draftId = create.GetProperty("data").GetProperty("draftId").GetString()!;
                await WaitForStatusAsync(client, draftId, "STORY_AWAITING_APPROVAL");
                await PostAsync(client, $"/api/admin/ai-cases/{draftId}/approve", null);
                await WaitForAnyAsync(client, draftId, ["CASE_TRUTH_AWAITING_APPROVAL", "CASE_TRUTH_INVALID"]);
                var truth = await GetAsync(client, $"/api/admin/ai-cases/{draftId}");
                if (truth.GetProperty("data").GetProperty("status").GetString() == "CASE_TRUTH_INVALID") throw new InvalidOperationException("truth validation failed");
                await PostAsync(client, $"/api/admin/ai-cases/{draftId}/approve-truth", null);
                var final = await WaitForAnyAsync(client, draftId, ["FULL_LOGIC_AWAITING_APPROVAL", "GENERATED_INVALID"]);
                var usage = await GetAsync(client, $"/api/admin/ai-cases/{draftId}/usage");
                var usageData = usage.GetProperty("data");
                knownCost += usageData.GetProperty("knownCostUsd").GetDecimal();
                unknownCalls += usageData.GetProperty("unknownCalls").GetInt32();
                pendingReservation += usageData.TryGetProperty("reservedUsd", out var reserved)
                    && reserved.ValueKind == JsonValueKind.Number ? reserved.GetDecimal() : reserveUsd;
                sample["completed"] = final.GetProperty("data").GetProperty("status").GetString() == "FULL_LOGIC_AWAITING_APPROVAL";
                sample["status"] = final.GetProperty("data").GetProperty("status").GetString();
                sample["draftId"] = draftId;
                sample["knownCostUsd"] = usageData.GetProperty("knownCostUsd").GetDecimal();
                sample["calls"] = usageData.GetProperty("calls").GetInt32();
                if (usageData.TryGetProperty("events", out var events) && events.ValueKind == JsonValueKind.Array)
                {
                    sample["retries"] = events.EnumerateArray().Count(eventItem =>
                        eventItem.TryGetProperty("step", out var step)
                        && (step.GetString()?.Contains("Retry", StringComparison.OrdinalIgnoreCase) == true));
                    sample["repairs"] = events.EnumerateArray().Count(eventItem =>
                        eventItem.TryGetProperty("step", out var step)
                        && (step.GetString()?.Contains("Repair", StringComparison.OrdinalIgnoreCase) == true));
                }
            }
            catch (Exception exception)
            {
                sample["error"] = exception.Message;
                // Without a usage response the request may still have executed. Keep
                // a full per-call reservation and stop before admitting another call.
                pendingReservation += reserveUsd;
                stoppedForBudget = true;
            }
            sample["latencyMs"] = sampleStarted.ElapsedMilliseconds;
            samples.Add(sample);
            if (knownCost + pendingReservation >= maxUsd)
            {
                stoppedForBudget = true;
                break;
            }
        }
        started.Stop();
        var completedCount = samples.Count(item => item.TryGetValue("completed", out var value) && value is true);
        return new
        {
            schemaVersion = "ai-case-benchmark-v1",
            mode = resume ? "resume" : "live",
            runId,
            model = "configured-baseline",
            promptVersion = AiGenerationSchemaVersions.Prompt,
            validatorVersion = "blind-review-validator-v1",
            compilerVersion = "projection-compiler-current",
            corpusHash = CorpusHash,
            status = stoppedForBudget || knownCost + pendingReservation >= maxUsd
                ? "BUDGET_EXHAUSTED" : "COMPLETED_CORPUS_OR_PROVIDER_STOP",
            budgetUsd = maxUsd,
            completed = completedCount,
            total = Corpus.Length,
            reserveUsdPerCall = reserveUsd,
            calls = samples.Sum(item => item.TryGetValue("calls", out var value) && value is int count ? count : 0),
            knownCostUsd = knownCost,
            pendingReservationUsd = pendingReservation,
            unknownCostUsd = (unknownCalls > 0 || pendingReservation > 0m) ? (decimal?)null : 0m,
            costPerAcceptedCaseUsd = completedCount == 0 || unknownCalls > 0 || pendingReservation > 0m
                ? (decimal?)null : knownCost / completedCount,
            unknownCalls,
            retries = samples.Sum(item => item.TryGetValue("retries", out var value) && value is int count ? count : 0),
            repairs = samples.Sum(item => item.TryGetValue("repairs", out var value) && value is int count ? count : 0),
            latencyMs = started.ElapsedMilliseconds,
            samples
        };
    }

    public static string ToMarkdown(object report)
    {
        var json = JsonSerializer.Serialize(report, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var mode = root.TryGetProperty("mode", out var modeNode) ? modeNode.GetString() : "unknown";
        var status = root.TryGetProperty("status", out var statusNode) ? statusNode.GetString() : "unknown";
        var completed = root.TryGetProperty("completed", out var completedNode) ? completedNode.GetInt32() : 0;
        var total = root.TryGetProperty("total", out var totalNode) ? totalNode.GetInt32() : 0;
        var knownCost = root.TryGetProperty("knownCostUsd", out var cost) && cost.ValueKind != JsonValueKind.Null
            ? cost.ToString() : "unknown";
        return $"# AI case benchmark\n\n- Mode: `{mode}`\n- Status: `{status}`\n- Completed: {completed}/{total}\n- Known cost USD: {knownCost}\n\nRaw details are in the adjacent JSON report.\n";
    }

    private static async Task<JsonElement> GetAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static async Task<JsonElement> PostAsync(HttpClient client, string path, object? body, KeyValuePair<string, string>? header = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        if (header is not null) request.Headers.TryAddWithoutValidation(header.Value.Key, header.Value.Value);
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static async Task WaitForStatusAsync(HttpClient client, string draftId, string status)
    {
        await WaitForAnyAsync(client, draftId, [status]);
    }

    private static async Task<JsonElement> WaitForAnyAsync(HttpClient client, string draftId, string[] statuses)
    {
        for (var attempt = 0; attempt < 180; attempt++)
        {
            var draft = await GetAsync(client, $"/api/admin/ai-cases/{draftId}");
            var current = draft.GetProperty("data").GetProperty("status").GetString();
            if (current is not null && statuses.Contains(current, StringComparer.Ordinal)) return draft;
            await Task.Delay(TimeSpan.FromSeconds(2));
        }
        throw new TimeoutException($"Timed out waiting for draft {draftId}.");
    }
}
