using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiCreationReadinessTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void MockAndDryRunRemainUsableWithoutPaidConfiguration(bool dryRun)
    {
        var provider = new OpenAiSettings { AiDryRun = dryRun, MockAiResponses = !dryRun };
        Assert.Empty(AiCreationReadinessPolicy.Evaluate(provider, new(), new(), new()));
        Assert.True(Service(provider, new(), new(), new()).GetCapabilities().CanCreateDraft);
    }

    [Fact]
    public void AllConfigurationProblemsAreReturnedWithoutCredentialValues()
    {
        var blockers = AiCreationReadinessPolicy.Evaluate(new(), new(), new(), new());
        Assert.Equal(new[] { "AI_PROVIDER_UNCONFIGURED", "AI_QUOTA_UNCONFIGURED", "AI_ASSET_STORAGE_UNCONFIGURED", "AI_USAGE_PRICE_REQUIRED" },
            blockers.Select(blocker => blocker.Code));
        var storage = Storage();
        storage.Enabled = false;
        var capabilities = Service(Provider(), new(), storage, new()).GetCapabilities();
        var json = JsonSerializer.Serialize(capabilities);
        Assert.False(capabilities.CanCreateDraft);
        Assert.False(capabilities.CanCreateV3Draft);
        Assert.DoesNotContain("test-secret-sentinel", json);
        Assert.DoesNotContain("test-cloud-sentinel", json);
        Assert.All(capabilities.CreationBlockers, blocker => Assert.False(string.IsNullOrWhiteSpace(blocker.MessageKey)));
    }

    [Fact]
    public void FullyConfiguredGenerationIsReadyWithoutCallingProviderOrDatabase()
    {
        var capabilities = Service(Provider(), Quota(), Storage(), Prices()).GetCapabilities();
        Assert.True(capabilities.CanCreateDraft);
        Assert.True(capabilities.CanCreateV3Draft);
        Assert.Empty(capabilities.CreationBlockers);
    }

    [Theory]
    [InlineData("skip")]
    [InlineData("json")]
    [InlineData("validate")]
    public void DisabledAssetStepsDoNotRequireImagePricesOrStorage(string mode)
    {
        var provider = Provider();
        provider.SkipAssetGeneration = mode == "skip";
        provider.GenerateJsonOnly = mode == "json";
        provider.ValidateOnly = mode == "validate";
        var prices = Prices();
        prices.Models.Remove("image");
        prices.Models.Remove("cutout");
        Assert.Empty(AiCreationReadinessPolicy.Evaluate(provider, Quota(), new(), prices));
        provider.SkipAssetGeneration = provider.GenerateJsonOnly = provider.ValidateOnly = false;
        Assert.Equal(new[] { "AI_ASSET_STORAGE_UNCONFIGURED", "AI_USAGE_PRICE_REQUIRED" },
            AiCreationReadinessPolicy.Evaluate(provider, Quota(), new(), prices).Select(blocker => blocker.Code));
    }

    [Theory]
    [InlineData("logic")]
    [InlineData("review")]
    [InlineData("image")]
    [InlineData("cutout")]
    public void EveryEnabledGenerationModelNeedsAPrice(string model)
    {
        var prices = Prices();
        prices.Models.Remove(model);
        Assert.Equal("AI_USAGE_PRICE_REQUIRED", Assert.Single(AiCreationReadinessPolicy.Evaluate(Provider(), Quota(), Storage(), prices)).Code);
    }

    [Theory]
    [InlineData("reservation")]
    [InlineData("input")]
    [InlineData("image-output")]
    [InlineData("negative-cache")]
    [InlineData("version")]
    public void IncompleteAndInvalidPriceConfigurationIsBlocked(string missing)
    {
        var prices = Prices();
        if (missing == "reservation") prices.Models["logic"].ReservationUsd = 0;
        if (missing == "input") prices.Models["logic"].InputPerMillionUsd = null;
        if (missing == "image-output") prices.Models["image"].ImageOutputPerMillionUsd = null;
        if (missing == "negative-cache") prices.Models["review"].CachedInputPerMillionUsd = -1;
        if (missing == "version") prices.PriceVersion = "";
        Assert.Equal("AI_USAGE_PRICE_REQUIRED", Assert.Single(AiCreationReadinessPolicy.Evaluate(Provider(), Quota(), Storage(), prices)).Code);
    }

    [Fact]
    public void FallbackModelsUseTheSamePriceEntriesAsGeneration()
    {
        var provider = Provider();
        provider.SemanticReviewModel = " ";
        provider.CutoutImageModel = " ";
        var prices = Prices();
        prices.Models.Remove("review");
        prices.Models.Remove("cutout");
        Assert.Empty(AiCreationReadinessPolicy.Evaluate(provider, Quota(), Storage(), prices));
    }

    [Fact]
    public async Task MissingSeparateV3ReviewPriceDoesNotBlockOrdinaryCreation()
    {
        var prices = Prices();
        prices.Models.Remove("review");
        var service = Service(Provider(), Quota(), Storage(), prices);
        var capabilities = service.GetCapabilities();
        Assert.True(capabilities.CanCreateDraft);
        Assert.Empty(capabilities.CreationBlockers);
        Assert.False(capabilities.CanCreateV3Draft);
        Assert.Equal("AI_USAGE_PRICE_REQUIRED", Assert.Single(capabilities.V3CreationBlockers).Code);
        Assert.Empty(AiCreationReadinessPolicy.Evaluate(Provider(), Quota(), Storage(), prices, includeSemanticReview: false));

        var error = await Assert.ThrowsAsync<ApiException>(() => service.CreatePreviewAsync(
            new CurrentUser("user", "User", UserRole.Admin), new GenerateAiCaseRequest { IncludeCrackTheLie = true }));
        Assert.Contains("AI_USAGE_PRICE_REQUIRED", JsonSerializer.Serialize(error.Errors));
    }

    [Theory]
    [InlineData(false, "AI_QUOTA_UNCONFIGURED")]
    [InlineData(true, "AI_USAGE_PRICE_REQUIRED")]
    public async Task CreationRejectsBeforeHistoryDatabaseInsertOrProviderWork(bool configuredQuota, string expectedCode)
    {
        // Null database and a provider-accounting spy make any early side effect fail this test.
        var service = Service(Provider(), configuredQuota ? Quota() : new(), Storage(), new());
        var error = await Assert.ThrowsAsync<ApiException>(() => service.CreatePreviewAsync(
            new CurrentUser("user", "User", UserRole.Admin), new GenerateAiCaseRequest()));
        Assert.Equal(409, error.StatusCode);
        Assert.Contains(expectedCode, JsonSerializer.Serialize(error.Errors));
    }

    private static OpenAiSettings Provider() => new()
    {
        ApiKey = "test-secret-sentinel", LogicModel = "logic", SemanticReviewModel = "review", ImageModel = "image", CutoutImageModel = "cutout"
    };
    private static AiQuotaSettings Quota() => new() { Enabled = true, EstimatedCaseCostUsd = 1, GlobalBudgetUsd = 10 };
    private static CloudinarySettings Storage() => new()
    {
        Enabled = true, CloudName = "test-cloud-sentinel", ApiKey = "test-secret-sentinel", ApiSecret = "test-secret-sentinel"
    };
    private static AiUsageSettings Prices() => new()
    {
        PriceVersion = "test-only",
        Models = new[] { "logic", "review", "image", "cutout" }.ToDictionary(model => model, _ => new AiModelPrice
        {
            ReservationUsd = 1, InputPerMillionUsd = 1, OutputPerMillionUsd = 1,
            ImageInputPerMillionUsd = 1, ImageOutputPerMillionUsd = 1
        })
    };
    private static AiCaseService Service(OpenAiSettings provider, AiQuotaSettings quota, CloudinarySettings storage, AiUsageSettings prices) => new(
        db: null!, workflow: null!, caseService: null!, validator: null!, truthService: null!,
        projectionPlanner: null!, projectionSchemaFactory: null!, projectionCompiler: null!, projectionGraphValidator: null!,
        openAiClient: null!, exportService: null!, httpClientFactory: null!,
        settings: Options.Create(provider), quota: Options.Create(quota), cloudinary: Options.Create(storage),
        v3PresetSettings: Options.Create(new AiCaseV3PresetSettings { Enabled = true }),
        gameplayV3Settings: Options.Create(new GameplayV3Settings { Enabled = true }), env: null!, logger: NullLogger<AiCaseService>.Instance,
        usageAccounting: new NoCallsAccounting(), usageSettings: Options.Create(prices));

    private sealed class NoCallsAccounting : IAiUsageAccounting
    {
        public Task<AiCallLease> BeforeCallAsync(string draftId, string step, string kind, string model,
            CancellationToken cancellationToken = default, decimal? reservationUsd = null, string? priceVersion = null) =>
            throw new InvalidOperationException("Readiness must not reserve budget or call a provider.");
        public Task RecordAsync(AiCallLease lease, string? responseBody, int? statusCode, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Readiness must not record paid usage.");
    }
}
