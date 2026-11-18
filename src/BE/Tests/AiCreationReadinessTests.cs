using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// Creation is ready when the Claude bridge has its key, or when mock/dry-run answers every step. The checks read
/// configuration only and never echo a credential.
/// </summary>
public sealed class AiCreationReadinessTests
{
    private const string KeySentinel = "bridge-key-sentinel-0123456789abcdef0123456789";

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void MockAndDryRunRemainUsableWithoutABridgeKey(bool dryRun)
    {
        var generation = new AiGenerationSettings { AiDryRun = dryRun, MockAiResponses = !dryRun };
        Assert.Empty(AiCreationReadinessPolicy.Evaluate(generation, new BridgeSettings()));
        Assert.True(Service(generation, new BridgeSettings()).GetCapabilities().CanCreateDraft);
    }

    [Fact]
    public void MissingBridgeKey_IsTheOnlyBlocker_InEnglishAndVietnamese_WithoutCredentialValues()
    {
        var blocker = Assert.Single(AiCreationReadinessPolicy.Evaluate(new AiGenerationSettings(), new BridgeSettings()));
        Assert.Equal("BRIDGE_NOT_CONFIGURED", blocker.Code);
        Assert.Equal("ai.bridge.notConfigured", blocker.MessageKey);
        Assert.False(string.IsNullOrWhiteSpace(blocker.Message));
        Assert.Contains("khóa", blocker.MessageVi);

        var capabilities = Service(new AiGenerationSettings(), new BridgeSettings { Key = "short" }).GetCapabilities();
        Assert.False(capabilities.CanCreateDraft);
        Assert.False(capabilities.CanCreateV3Draft);
        Assert.DoesNotContain("short", JsonSerializer.Serialize(capabilities.CreationBlockers));
    }

    [Fact]
    public void ConfiguredBridgeKey_IsReady_AndNeverAppearsInTheCapabilities()
    {
        var capabilities = Service(new AiGenerationSettings(), new BridgeSettings { Key = KeySentinel }).GetCapabilities();
        Assert.True(capabilities.CanCreateDraft);
        Assert.True(capabilities.CanCreateV3Draft);
        Assert.Empty(capabilities.CreationBlockers);
        Assert.DoesNotContain(KeySentinel, JsonSerializer.Serialize(capabilities));
    }

    [Fact]
    public void Capabilities_ListTheThreeDifficultyLevels()
    {
        var levels = Service(new AiGenerationSettings(), new BridgeSettings { Key = KeySentinel }).GetCapabilities().DifficultyProfiles;
        Assert.Equal(new[] { "easy", "medium", "hard" }, levels.Select(level => level.Difficulty));
        Assert.Equal(5, levels[2].Suspects);
        Assert.Equal(40, levels[2].PlayMinutes.Min);
        Assert.Equal(300, levels[2].PixelLab.NewWorld.Min);
        Assert.Equal(150, levels[2].PixelLab.LibraryWorld.Max);
        Assert.Equal(2, levels[0].Puzzles.Max);
    }

    [Fact]
    public void MissingCloudinary_DoesNotBlockAnOrder()
    {
        // Images are uploaded at the end of the workflow; storage is reported but never blocks the order.
        Assert.Empty(AiCreationReadinessPolicy.Evaluate(new AiGenerationSettings(), new BridgeSettings { Key = KeySentinel }));
        Assert.False(AiCreationReadinessPolicy.AssetStorageReady(new CloudinarySettings(), allowLocalAssetStorage: false));
        Assert.True(AiCreationReadinessPolicy.AssetStorageReady(new CloudinarySettings(), allowLocalAssetStorage: true));
        Assert.True(AiCreationReadinessPolicy.AssetStorageReady(new CloudinarySettings
        {
            Enabled = true, CloudName = "cloud", ApiKey = "key", ApiSecret = "secret"
        }, allowLocalAssetStorage: false));
    }

    [Fact]
    public async Task CreationWithoutABridgeKey_IsRejectedBeforeAnyDatabaseOrQueueWork()
    {
        // A null database and a null provider make any early side effect fail this test.
        var service = Service(new AiGenerationSettings(), new BridgeSettings());
        var error = await Assert.ThrowsAsync<ApiException>(() => service.CreatePreviewAsync(
            new CurrentUser("user", "User", UserRole.Admin), new GenerateAiCaseRequest()));
        Assert.Equal(409, error.StatusCode);
        Assert.Contains("BRIDGE_NOT_CONFIGURED", JsonSerializer.Serialize(error.Errors));
    }

    private static AiCaseService Service(AiGenerationSettings generation, BridgeSettings bridge) => new(
        db: null!, workflow: null!, caseService: null!, validator: null!, truthService: null!,
        projectionPlanner: null!, projectionSchemaFactory: null!, projectionCompiler: null!, projectionGraphValidator: null!,
        textProvider: null!, exportService: null!, httpClientFactory: null!,
        settings: Options.Create(generation), quota: Options.Create(new AiQuotaSettings()), cloudinary: Options.Create(new CloudinarySettings()),
        v3PresetSettings: Options.Create(new AiCaseV3PresetSettings { Enabled = true }),
        gameplayV3Settings: Options.Create(new GameplayV3Settings { Enabled = true }), env: null!, logger: NullLogger<AiCaseService>.Instance,
        bridgeSettings: Options.Create(bridge));
}
