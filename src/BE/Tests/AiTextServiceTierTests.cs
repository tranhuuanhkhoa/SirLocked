using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiTextServiceTierTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("auto")]
    [InlineData("priority")]
    [InlineData("fast")]
    [InlineData("ultrafast")]
    [InlineData("flex")]
    public void StandardTierOverridesProjectAndCallerChoice_WithoutMutatingOriginal(string? tier)
    {
        var original = new JsonObject
        {
            ["model"] = "gpt-5.6-sol", ["input"] = "Điều tra chứng cứ", ["max_output_tokens"] = 28000,
            ["text"] = new JsonObject { ["format"] = new JsonObject { ["type"] = "json_schema",
                ["schema"] = new JsonObject { ["type"] = "object", ["additionalProperties"] = false } } }
        };
        if (tier is not null) original["service_tier"] = tier;
        var before = original.ToJsonString();
        var standard = AiTextRequestBudgetPolicy.WithStandardServiceTier(original);
        Assert.Equal("default", standard["service_tier"]!.GetValue<string>());
        Assert.Equal(before, original.ToJsonString());
        Assert.True(JsonNode.DeepEquals(original["text"], standard["text"]));
        Assert.Equal(original["input"]!.GetValue<string>(), standard["input"]!.GetValue<string>());
        Assert.Equal(28000, standard["max_output_tokens"]!.GetValue<int>());
        standard["text"]!["format"]!["schema"]!["type"] = "array";
        Assert.Equal(before, original.ToJsonString());
    }

    [Fact]
    public void SerializedByteLimitIncludesPinnedServiceTier()
    {
        var original = new { input = "Điều tra", text = new { schema = new string('x', 200) }, max_output_tokens = 28000 };
        var standard = AiTextRequestBudgetPolicy.WithStandardServiceTier(original);
        var originalLength = JsonSerializer.SerializeToUtf8Bytes(original).Length;
        var actualLength = JsonSerializer.SerializeToUtf8Bytes(standard).Length;
        Assert.True(actualLength > originalLength);
        Assert.Throws<ApiException>(() => AiTextRequestBudgetPolicy.EnsureWithinLimit(standard,
            new() { MaxTextRequestBytes = originalLength, MaxTextOutputTokens = 28000 }));
        AiTextRequestBudgetPolicy.EnsureWithinLimit(standard,
            new() { MaxTextRequestBytes = actualLength, MaxTextOutputTokens = 28000 });
    }

    [Fact]
    public async Task OverrideWithNoRoomForTier_IsRejectedBeforeAnyDatabaseOrProviderCall()
    {
        var payload = new { input = "A bounded case review.", max_output_tokens = 28000 };
        var service = Service(new() { MaxTextRequestBytes = JsonSerializer.SerializeToUtf8Bytes(payload).Length,
            MaxTextOutputTokens = 28000 });
        // Null infrastructure proves pinning and its byte check precede heartbeat,
        // reservation, logging and the provider, including the override path.
        var error = await Assert.ThrowsAsync<ApiException>(() => service.GenerateJsonWithOpenAiAsync(
            "draft", "Review", "brief", 28000, "schema", new JsonObject(), 1, payloadOverride: payload));
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
