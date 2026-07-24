using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class AiCaseWorkflowHostTests
{
    [Fact]
    public async Task VipDraftList_ReturnsOnlyOwnedDraftsAfterReload()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"),
                "true",
                StringComparison.OrdinalIgnoreCase))
            return;

        await using var factory = new AiWorkflowFactory();
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-UserId", "vip-owner");
        client.DefaultRequestHeaders.Add("X-Test-Role", UserRole.Vip);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await db.AiCaseDrafts.InsertManyAsync(
        [
            new AiCaseDraft
            {
                Id = MongoDB.Bson.ObjectId.GenerateNewId().ToString(),
                CreatedByUserId = "vip-owner",
                CreatedByRole = UserRole.Vip,
                Status = AiDraftStatus.StoryAwaitingApproval
            },
            new AiCaseDraft
            {
                Id = MongoDB.Bson.ObjectId.GenerateNewId().ToString(),
                CreatedByUserId = "different-owner",
                CreatedByRole = UserRole.Vip,
                Status = AiDraftStatus.StoryAwaitingApproval
            }
        ]);

        var envelope = await client.GetFromJsonAsync<ApiResponse<List<AiDraftResponse>>>(
            "/api/admin/ai-cases");

        Assert.Single(envelope!.Data!);
        Assert.Equal("vip-owner", envelope.Data![0].CreatedByUserId);
    }

    [Fact]
    public async Task ArtifactCleanup_DefaultDryRunDoesNotChangeFilesystem()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"),
                "true",
                StringComparison.OrdinalIgnoreCase))
            return;

        await using var factory = new AiWorkflowFactory();
        var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var environment = scope.ServiceProvider.GetRequiredService<IWebHostEnvironment>();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        var folder = Path.Combine(
            environment.ContentRootPath,
            "GeneratedCaseJson",
            $"cleanup-it-{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        var marker = Path.Combine(folder, "case.json");
        await File.WriteAllTextAsync(marker, "{}");
        try
        {
            await db.AiCaseDrafts.InsertOneAsync(new AiCaseDraft
            {
                Id = MongoDB.Bson.ObjectId.GenerateNewId().ToString(),
                Status = AiDraftStatus.GeneratedInvalid,
                JsonFolderPath = folder,
                UpdatedAt = DateTime.UtcNow.AddDays(-31)
            });

            var response = await client.PostAsync(
                "/api/admin/ai-cases/artifacts/cleanup?olderThanDays=30",
                null);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.True(File.Exists(marker));
        }
        finally
        {
            if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
        }
    }

    [Fact]
    public async Task MockHttpFlow_ReturnsAcceptedAndAdvancesBeyondPreviewWithoutLiveOpenAi()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"),
                "true",
                StringComparison.OrdinalIgnoreCase))
            return;

        await using var factory = new AiWorkflowFactory();
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false
        });
        var create = await client.PostAsJsonAsync("/api/admin/ai-cases", new GenerateAiCaseRequest
        {
            Prompt = "A compact locked-room archive mystery.",
            StageCount = 2,
            Difficulty = "easy",
            GenerationPreset = AiGenerationPresets.ShortDemo,
            Language = "en"
        });
        Assert.Equal(HttpStatusCode.Accepted, create.StatusCode);
        var queued = (await create.Content.ReadFromJsonAsync<ApiResponse<AiDraftResponse>>())!.Data!;
        Assert.Equal(AiQueueStates.Pending, queued.QueueState);

        var story = await PollAsync(client, queued.DraftId, AiDraftStatus.StoryAwaitingApproval);
        Assert.NotNull(story.StoryPreview);
        Assert.Equal(AiQueueStates.None, story.QueueState);

        var approveStory = await client.PostAsync($"/api/admin/ai-cases/{queued.DraftId}/approve", null);
        Assert.Equal(HttpStatusCode.Accepted, approveStory.StatusCode);
        var truth = await PollAsync(
            client,
            queued.DraftId,
            AiDraftStatus.CaseTruthAwaitingApproval,
            AiDraftStatus.CaseTruthInvalid);
        Assert.Equal(AiDraftStatus.CaseTruthAwaitingApproval, truth.Status);
        Assert.NotNull(truth.CaseTruth);
        Assert.True(truth.CaseTruth!.TraceLedger.Count <= 10);

        var approveTruth = await client.PostAsync($"/api/admin/ai-cases/{queued.DraftId}/approve-truth", null);
        Assert.Equal(HttpStatusCode.Accepted, approveTruth.StatusCode);
        var fullLogic = await PollAsync(
            client,
            queued.DraftId,
            AiDraftStatus.FullLogicAwaitingApproval,
            AiDraftStatus.GeneratedInvalid);
        Assert.Equal(AiDraftStatus.FullLogicAwaitingApproval, fullLogic.Status);

        var approveFullLogic = await client.PostAsync(
            $"/api/admin/ai-cases/{queued.DraftId}/approve-full-logic",
            null);
        Assert.Equal(HttpStatusCode.Accepted, approveFullLogic.StatusCode);
        var layout = await PollAsync(
            client,
            queued.DraftId,
            AiDraftStatus.SceneLayoutAwaitingApproval,
            AiDraftStatus.GeneratedInvalid);
        Assert.Equal(AiDraftStatus.SceneLayoutAwaitingApproval, layout.Status);

        var approveLayout = await client.PostAsync(
            $"/api/admin/ai-cases/{queued.DraftId}/approve-scene-layout",
            null);
        Assert.Equal(HttpStatusCode.Accepted, approveLayout.StatusCode);
        var ready = await PollAsync(
            client,
            queued.DraftId,
            AiDraftStatus.ReadyToPublish,
            AiDraftStatus.GeneratedInvalid);
        Assert.Equal(AiDraftStatus.ReadyToPublish, ready.Status);

        var publish = await client.PostAsync(
            $"/api/admin/ai-cases/{queued.DraftId}/publish?overwrite=true",
            null);
        Assert.Equal(HttpStatusCode.OK, publish.StatusCode);
        Assert.Equal(0, factory.OpenAiClient.CallCount);
    }

    private static async Task<AiDraftResponse> PollAsync(
        HttpClient client,
        string draftId,
        params string[] terminalStatuses)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            var envelope = await client.GetFromJsonAsync<ApiResponse<AiDraftResponse>>(
                $"/api/admin/ai-cases/{draftId}");
            var draft = envelope!.Data!;
            if (terminalStatuses.Contains(draft.Status, StringComparer.Ordinal)
                && draft.QueueState == AiQueueStates.None)
                return draft;
            await Task.Delay(100);
        }
        throw new TimeoutException($"Draft {draftId} did not reach {string.Join('/', terminalStatuses)}.");
    }

    private sealed class AiWorkflowFactory : WebApplicationFactory<Program>
    {
        private readonly string _connectionString =
            Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
            ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000";
        private readonly string _databaseName = $"sirlocked_it_{Guid.NewGuid():N}";
        public FakeOpenAiClient OpenAiClient { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, configuration) =>
            {
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["MongoDb:ConnectionString"] = _connectionString,
                    ["MongoDb:DatabaseName"] = _databaseName,
                    ["MOCK_AI_RESPONSES"] = "true",
                    ["SKIP_ASSET_GENERATION"] = "true",
                    ["Jwt:Secret"] = "integration-test-secret-with-at-least-32-characters"
                });
            });
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton(OpenAiClient);
                services.AddScoped<IAiOpenAiClient>(provider => provider.GetRequiredService<FakeOpenAiClient>());
                services.AddAuthentication(options =>
                    {
                        options.DefaultAuthenticateScheme = TestAuthHandler.SchemeName;
                        options.DefaultChallengeScheme = TestAuthHandler.SchemeName;
                    })
                    .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(
                        TestAuthHandler.SchemeName,
                        _ => { });
            });
        }

        public override async ValueTask DisposeAsync()
        {
            await base.DisposeAsync();
            await new MongoClient(_connectionString).DropDatabaseAsync(_databaseName);
        }
    }

    private sealed class FakeOpenAiClient : IAiOpenAiClient
    {
        public int CallCount { get; private set; }

        public Task<AiProviderHttpResponse> PostStructuredJsonAsync(
            object payload,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            throw new InvalidOperationException("Live OpenAI transport must not be used by integration tests.");
        }
    }

    private sealed class TestAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public const string SchemeName = "IntegrationTest";

        public TestAuthHandler(
            IOptionsMonitor<AuthenticationSchemeOptions> options,
            ILoggerFactory logger,
            UrlEncoder encoder)
            : base(options, logger, encoder)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var userId = Request.Headers["X-Test-UserId"].FirstOrDefault() ?? "integration-admin";
            var role = Request.Headers["X-Test-Role"].FirstOrDefault() ?? UserRole.Admin;
            var identity = new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId),
                    new Claim(ClaimTypes.Name, "Integration Admin"),
                    new Claim(ClaimTypes.Role, role)
                ],
                SchemeName);
            return Task.FromResult(AuthenticateResult.Success(
                new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
        }
    }
}
