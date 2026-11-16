using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Cutscene;

public sealed record CutsceneGenerationResult(MotionComicScript Script, string ScriptJson, string Model, bool Mock, bool Repaired);

/// <summary>
/// Asks Claude (through the bridge queue, owner type CUTSCENE) for a motion-comic script built from the public case
/// data only, validates it, and lets Claude fix it at most once. Without an answer yet the call throws
/// <see cref="AiAwaitingClaudeException"/>; the same run id finds the answer once the bot submits it.
/// </summary>
public sealed class CutsceneScriptGenerator(
    IAiTextProvider provider,
    IOptions<AiGenerationSettings> generation,
    IOptions<CutsceneSettings> cutscene,
    ILogger<CutsceneScriptGenerator> logger)
{
    internal static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task<CutsceneGenerationResult> GenerateAsync(GameCase gameCase, string generationRunId, CancellationToken ct = default)
    {
        var mock = generation.Value.BlocksAiCalls;
        var basePrompt = CutscenePrompt.Build(CutsceneInputBuilder.BuildJson(gameCase), gameCase.CaseId);
        var json = await RequestAsync(gameCase, basePrompt, "CutsceneScript", 1, generationRunId, ct);
        var (script, issues) = ParseAndValidate(json, gameCase);
        var repaired = false;
        if (issues.Count > 0)
        {
            logger.LogInformation("Cutscene script for {CaseId} needs one repair: {Count} issue(s).", gameCase.CaseId, issues.Count);
            repaired = true;
            json = await RequestAsync(gameCase, CutscenePrompt.BuildRepair(basePrompt, json, issues), "CutsceneScriptRepair", 2,
                generationRunId, ct);
            (script, issues) = ParseAndValidate(json, gameCase);
        }
        if (issues.Count > 0 || script is null)
            throw ApiException.Unprocessable("The generated cutscene did not pass validation and was not saved.",
                issues.Select(issue => $"{issue.Path}: {issue.Message}").ToList());
        return new CutsceneGenerationResult(script, JsonSerializer.Serialize(script, JsonOptions),
            mock ? "mock" : ClaudeBridgeTextProvider.ProviderName, mock, repaired);
    }

    public static (MotionComicScript? Script, List<CutsceneIssue> Issues) ParseAndValidate(string json, GameCase gameCase)
    {
        MotionComicScript? script;
        try { script = JsonSerializer.Deserialize<MotionComicScript>(AiBridgeSchemaValidator.StripMarkdownFences(json), JsonOptions); }
        catch (JsonException) { return (null, new List<CutsceneIssue> { new("$", "The response is not valid script JSON.") }); }
        return (script, CutsceneScriptValidator.Validate(script, gameCase));
    }

    private Task<string> RequestAsync(
        GameCase gameCase, string prompt, string step, int attempt, string generationRunId, CancellationToken ct) =>
        provider.GenerateJsonAsync(new AiTextRequest
        {
            OwnerType = AiBridgeOwnerTypes.Cutscene,
            OwnerId = gameCase.CaseId,
            Step = step,
            SchemaVersion = CutscenePrompt.SchemaName,
            Schema = CutscenePrompt.Schema(),
            Instructions = CutscenePrompt.Instructions,
            Prompt = prompt,
            MaxOutputTokens = Math.Clamp(cutscene.Value.MaxOutputTokens, 1000, 16000),
            AttemptNumber = attempt,
            GenerationRunId = generationRunId,
            // Mock mode never reaches the bridge: the first attempt is a deterministic valid script.
            MockResponseFactory = () => JsonSerializer.Serialize(CutsceneMockScriptFactory.Create(gameCase), JsonOptions)
        }, ct);
}
