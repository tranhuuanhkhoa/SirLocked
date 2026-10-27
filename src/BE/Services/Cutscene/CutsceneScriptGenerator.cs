using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Cutscene;

public sealed record CutsceneGenerationResult(MotionComicScript Script, string ScriptJson, string Model, bool Mock, bool Repaired);

/// <summary>
/// Asks the model for a motion-comic script from the public case data only, validates it, and lets the model fix it
/// at most once. Spend goes through the same accounting and size limits as case generation.
/// </summary>
public sealed class CutsceneScriptGenerator(
    IAiOpenAiClient client,
    IAiUsageAccounting? usageAccounting,
    IOptions<OpenAiSettings> openAi,
    IOptions<AiUsageSettings> usage,
    IOptions<CutsceneSettings> cutscene,
    ILogger<CutsceneScriptGenerator> logger)
{
    internal static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task<CutsceneGenerationResult> GenerateAsync(GameCase gameCase, CancellationToken ct = default)
    {
        var settings = openAi.Value;
        var mock = settings.BlocksAiCalls;
        var model = string.IsNullOrWhiteSpace(cutscene.Value.Model) ? settings.LogicModel : cutscene.Value.Model.Trim();
        if (!mock && !settings.HasApiKey) throw ApiException.Conflict("OpenAI is not configured for cutscene generation.");

        var basePrompt = CutscenePrompt.Build(CutsceneInputBuilder.BuildJson(gameCase), gameCase.CaseId);
        var json = await RequestAsync(gameCase, basePrompt, "CutsceneScript", model, mock, ct);
        var (script, issues) = ParseAndValidate(json, gameCase);
        var repaired = false;
        if (issues.Count > 0)
        {
            logger.LogInformation("Cutscene script for {CaseId} needs one repair: {Count} issue(s).", gameCase.CaseId, issues.Count);
            repaired = true;
            json = await RequestAsync(gameCase, CutscenePrompt.BuildRepair(basePrompt, json, issues), "CutsceneScriptRepair", model, mock, ct);
            (script, issues) = ParseAndValidate(json, gameCase);
        }
        if (issues.Count > 0 || script is null)
            throw ApiException.Unprocessable("The generated cutscene did not pass validation and was not saved.",
                issues.Select(issue => $"{issue.Path}: {issue.Message}").ToList());
        return new CutsceneGenerationResult(script, JsonSerializer.Serialize(script, JsonOptions), mock ? "mock" : model, mock, repaired);
    }

    public static (MotionComicScript? Script, List<CutsceneIssue> Issues) ParseAndValidate(string json, GameCase gameCase)
    {
        MotionComicScript? script;
        try { script = JsonSerializer.Deserialize<MotionComicScript>(json, JsonOptions); }
        catch (JsonException) { return (null, new List<CutsceneIssue> { new("$", "The response is not valid script JSON.") }); }
        return (script, CutsceneScriptValidator.Validate(script, gameCase));
    }

    private async Task<string> RequestAsync(GameCase gameCase, string prompt, string step, string model, bool mock, CancellationToken ct)
    {
        if (mock)
        {
            // Mock mode never reaches the provider: the first attempt is a deterministic valid script.
            return JsonSerializer.Serialize(CutsceneMockScriptFactory.Create(gameCase), JsonOptions);
        }

        object payload = new
        {
            model,
            instructions = CutscenePrompt.Instructions,
            input = prompt,
            text = new
            {
                format = new
                {
                    type = "json_schema",
                    name = CutscenePrompt.SchemaName,
                    description = "Motion-comic intro script for a SirLocked pixel case.",
                    schema = CutscenePrompt.Schema(),
                    strict = true
                }
            },
            max_output_tokens = Math.Clamp(cutscene.Value.MaxOutputTokens, 1000, 16000)
        };
        var tiered = AiTextRequestBudgetPolicy.WithStandardServiceTier(payload);
        AiTextRequestBudgetPolicy.EnsureWithinLimit(tiered, usage.Value);

        var draftId = "cutscene:" + gameCase.CaseId;
        var lease = usageAccounting is null ? null : await usageAccounting.BeforeCallAsync(draftId, step, "text", model, ct);
        AiProviderHttpResponse? response = null;
        try
        {
            response = await client.PostStructuredJsonAsync(tiered, ct);
        }
        finally
        {
            if (lease is not null && usageAccounting is not null)
            {
                // Accounting must complete even if the caller cancelled: the provider may already have billed.
                using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                try { await usageAccounting.RecordAsync(lease, response?.Body, response?.StatusCode, cleanup.Token); }
                catch (Exception exception) { logger.LogError(exception, "Cutscene usage reconciliation pending for call {CallId}.", lease.Id); }
            }
        }

        if (!response.IsSuccess)
        {
            logger.LogWarning("Cutscene request failed with HTTP {Status}.", response.StatusCode);
            throw response.StatusCode is >= 400 and < 500 and not 408 and not 429
                ? ApiException.Unprocessable($"OpenAI rejected the cutscene request with HTTP {response.StatusCode}.")
                : ApiException.BadGateway($"OpenAI request failed with HTTP {response.StatusCode}.");
        }
        var envelope = AiCaseService.ExtractOpenAiTextEnvelope(response.Body);
        if (envelope.Status.Equals("incomplete", StringComparison.OrdinalIgnoreCase))
            throw ApiException.Unprocessable($"OpenAI response was incomplete: {envelope.IncompleteReason}.");
        if (!string.IsNullOrWhiteSpace(envelope.Refusal)) throw ApiException.Unprocessable("OpenAI refused the cutscene request.");
        if (string.IsNullOrWhiteSpace(envelope.Content)) throw ApiException.Unprocessable("OpenAI returned no structured JSON output.");
        return envelope.Content;
    }
}
