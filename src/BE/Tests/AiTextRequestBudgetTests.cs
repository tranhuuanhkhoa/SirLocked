using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiTextRequestBudgetTests
{
    [Fact]
    public void ZeroCapsLeaveExistingRequestsUnchanged() =>
        AiTextRequestBudgetPolicy.EnsureWithinLimit(new { input = new string('x', 110000) }, new());

    [Fact]
    public void RequestByteBoundaryIncludesUnicodeAndSchema()
    {
        var payload = new { input = "Điều tra", text = new { schema = new string('x', 2000) }, max_output_tokens = 28000 };
        var serializedBytes = JsonSerializer.SerializeToUtf8Bytes(payload).Length;
        AiTextRequestBudgetPolicy.EnsureWithinLimit(payload,
            new() { MaxTextRequestBytes = serializedBytes, MaxTextOutputTokens = 28000 });
        AssertLimit(() => AiTextRequestBudgetPolicy.EnsureWithinLimit(payload,
            new() { MaxTextRequestBytes = serializedBytes - 1, MaxTextOutputTokens = 28000 }));
    }

    [Theory]
    [InlineData(28000)]
    [InlineData(27000)]
    public void OutputBoundaryAndLargestTruthRetryAreAccepted(int output) =>
        AiTextRequestBudgetPolicy.EnsureWithinLimit(new { max_output_tokens = output }, new() { MaxTextOutputTokens = 28000 });

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"max_output_tokens\":null}")]
    [InlineData("{\"max_output_tokens\":\"28000\"}")]
    [InlineData("{\"max_output_tokens\":0}")]
    [InlineData("{\"max_output_tokens\":-1}")]
    [InlineData("{\"max_output_tokens\":28001}")]
    [InlineData("{\"max_output_tokens\":2147483648}")]
    public void MissingInvalidOrOversizedOutputCannotEvadeTheCap(string json) =>
        AssertLimit(() => AiTextRequestBudgetPolicy.EnsureWithinLimit(JsonNode.Parse(json)!, new() { MaxTextOutputTokens = 28000 }));

    [Theory]
    [InlineData(-1, 0)]
    [InlineData(0, -1)]
    public void NegativeConfigurationDoesNotSilentlyDisableTheGuard(int bytes, int output) =>
        AssertLimit(() => AiTextRequestBudgetPolicy.EnsureWithinLimit(new { },
            new() { MaxTextRequestBytes = bytes, MaxTextOutputTokens = output }));

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task GenerationRejectsBeforeHeartbeatReservationOrProvider(bool overridePayload)
    {
        // Null dependencies prove denial precedes the database heartbeat, planned-call log and transport.
        var service = Service(new() { MaxTextRequestBytes = 1000, MaxTextOutputTokens = 28000 });
        var schema = new JsonObject { ["description"] = new string('x', overridePayload ? 1 : 1000) };
        var error = await Assert.ThrowsAsync<ApiException>(() => service.GenerateJsonWithOpenAiAsync(
            "draft", "GenerateJson", "brief", 2500, "schema", schema, 1,
            payloadOverride: overridePayload ? new { max_output_tokens = 28001, input = "brief" } : null));
        Assert.Equal(409, error.StatusCode);
        Assert.Contains("AI_REQUEST_BUDGET_LIMIT", JsonSerializer.Serialize(error.Errors));
    }

    private static void AssertLimit(Action action)
    {
        var error = Assert.Throws<ApiException>(action);
        Assert.Equal(409, error.StatusCode);
        Assert.Contains("AI_REQUEST_BUDGET_LIMIT", JsonSerializer.Serialize(error.Errors));
    }

    private static AiCaseService Service(AiUsageSettings usage) => new(
        db: null!, workflow: null!, caseService: null!, validator: null!, truthService: null!,
        projectionPlanner: null!, projectionSchemaFactory: null!, projectionCompiler: null!, projectionGraphValidator: null!,
        openAiClient: null!, exportService: null!, httpClientFactory: null!,
        settings: Options.Create(new OpenAiSettings()), quota: Options.Create(new AiQuotaSettings()),
        cloudinary: Options.Create(new CloudinarySettings()), v3PresetSettings: Options.Create(new AiCaseV3PresetSettings()),
        gameplayV3Settings: Options.Create(new GameplayV3Settings()), env: null!, logger: NullLogger<AiCaseService>.Instance,
        usageSettings: Options.Create(usage));
}
