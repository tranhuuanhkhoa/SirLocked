using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using SirLocked.Api.WebAPI.Extensions;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// Opt-in probe that asks OpenAI to validate every strict schema this project sends. An unsupported
/// keyword is only reported as an <c>invalid_json_schema</c> HTTP error at request time, and finding
/// it through a real draft costs the whole seven-call truth pipeline first. Each probe here spends
/// one request capped at 16 output tokens.
/// </summary>
public sealed class OpenAiSchemaProbeTests
{
    private const string RunEnvironmentVariable = "SIRLOCKED_RUN_OPENAI_SCHEMA_PROBE";

    public static TheoryData<string> SchemaNames()
    {
        var data = new TheoryData<string>();
        foreach (var name in Schemas().Keys) data.Add(name);
        return data;
    }

    [Theory]
    [MemberData(nameof(SchemaNames))]
    public async Task StrictSchema_IsAcceptedByProvider(string schemaName)
    {
        if (!Enabled()) return;

        var settings = LoadSettings();
        var response = await PostSchemaAsync(settings, schemaName, Schemas()[schemaName]);

        Assert.DoesNotContain("invalid_json_schema", response, StringComparison.Ordinal);
        Assert.True(
            response.Contains("\"status\"", StringComparison.Ordinal),
            $"{schemaName} probe returned an unexpected payload: {Truncate(response)}");
    }

    private static bool Enabled() =>
        string.Equals(
            Environment.GetEnvironmentVariable(RunEnvironmentVariable),
            "true",
            StringComparison.OrdinalIgnoreCase);

    private static async Task<string> PostSchemaAsync(
        OpenAiSettings settings,
        string schemaName,
        JsonObject schema)
    {
        var provider = new ServiceCollection().AddHttpClient().BuildServiceProvider();
        var client = new AiOpenAiClient(
            provider.GetRequiredService<IHttpClientFactory>(),
            Options.Create(settings));
        var response = await client.PostStructuredJsonAsync(new
        {
            model = settings.LogicModel,
            instructions = "Schema validation probe. Return the shortest possible valid object.",
            input = "Probe.",
            text = new
            {
                format = new
                {
                    type = "json_schema",
                    name = schemaName,
                    description = "SirLocked strict schema probe.",
                    schema,
                    strict = true
                }
            },
            max_output_tokens = 16
        });
        return response.Body;
    }

    private static OpenAiSettings LoadSettings()
    {
        LoadRepoEnv();
        var apiKey = Environment.GetEnvironmentVariable("OpenAI__ApiKey")
                     ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY")
                     ?? string.Empty;
        Assert.False(
            string.IsNullOrWhiteSpace(apiKey),
            $"{RunEnvironmentVariable} is set but no OpenAI API key was found in the environment or repo .env.");
        return new OpenAiSettings
        {
            ApiKey = apiKey,
            BaseUrl = Environment.GetEnvironmentVariable("OpenAI__BaseUrl") ?? "https://api.openai.com/v1",
            LogicModel = Environment.GetEnvironmentVariable("OpenAI__LogicModel") ?? "gpt-5.6-sol",
            TimeoutSeconds = 120
        };
    }

    private static void LoadRepoEnv()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var depth = 0; dir is not null && depth < 10; depth++, dir = dir.Parent)
        {
            if (!File.Exists(Path.Combine(dir.FullName, "SirLocked.sln"))) continue;
            var envPath = Path.Combine(dir.FullName, ".env");
            if (File.Exists(envPath)) EnvFileLoader.Load(envPath);
            return;
        }
    }

    private static IReadOnlyDictionary<string, JsonObject> Schemas()
    {
        var budget = AiTruthGenerationBudget.Maximum;
        return new Dictionary<string, JsonObject>(StringComparer.Ordinal)
        {
            ["story_preview"] = AiStrictSchemaProvider.StoryPreviewSchema(),
            ["case_seed"] = AiStrictSchemaProvider.CaseSeedSchema(budget),
            ["core_truth"] = AiStrictSchemaProvider.CoreTruthSchema(budget),
            ["true_timeline"] = AiStrictSchemaProvider.TrueTimelineSchema(budget),
            ["opportunity_matrix"] = AiStrictSchemaProvider.OpportunityMatrixSchema(budget, budget.MaxSuspects),
            ["trace_ledger"] = AiStrictSchemaProvider.TraceLedgerSchema(budget),
            ["statement_ledger"] = AiStrictSchemaProvider.StatementLedgerSchema(budget),
            ["proof_graph"] = AiStrictSchemaProvider.ProofGraphSchema(budget),
            ["truth_feasibility_review"] = AiStrictSchemaProvider.CaseTruthFeasibilityReviewSchema(),
            ["v3_semantic_review"] = AiStrictSchemaProvider.V3SemanticReviewSchema(),
            ["gameplay_projection_content_v2"] = ProjectionContentSchema(
                AiGenerationPresets.NormalRandom,
                CaseMechanicsVersions.InvestigationV2,
                includeCrackTheLie: false),
            ["gameplay_projection_content_v3"] = ProjectionContentSchema(
                AiGenerationPresets.ShortDemo,
                CaseMechanicsVersions.InvestigationV3PairedConfrontation,
                includeCrackTheLie: true)
        };
    }

    private static JsonObject ProjectionContentSchema(
        string preset,
        int mechanicsVersion,
        bool includeCrackTheLie)
    {
        var truthService = new CaseTruthService();
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f0f",
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            Settings = new AiDraftSettings
            {
                StageCount = includeCrackTheLie ? 2 : 4,
                Difficulty = "medium",
                GenerationPreset = preset,
                MechanicsVersion = mechanicsVersion,
                IncludeCrackTheLie = includeCrackTheLie,
                Language = CaseLanguages.English
            }
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(
            AiCaseMockFactory.BuildMockTruthPackageJson(draft),
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        draft.CaseTruth = truth;
        draft.TruthHash = truthService.ComputeHash(truth);
        var plan = new GameplayProjectionPlanner(truthService).Build(draft, truth);
        return new ProjectionContentSchemaFactory().Build(plan);
    }

    private static string Truncate(string value) =>
        value.Length <= 600 ? value : value[..600];
}
