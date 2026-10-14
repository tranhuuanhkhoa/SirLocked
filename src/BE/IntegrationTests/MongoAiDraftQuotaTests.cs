using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class MongoAiDraftQuotaTests
{
    [Fact]
    public async Task RealAdmission_LegacyAndSecondSlotOccupied_AcceptsThirdAndPreservesDailyLimitAndRefund()
    {
        await WithDatabase(async db =>
        {
            var owner = ObjectId.GenerateNewId().ToString();
            var user = new CurrentUser(owner, "Quota integration", UserRole.Admin);
            var first = Draft(owner, 1);
            var second = Draft(owner, 2);
            await db.AiCaseDrafts.InsertManyAsync(new[] { first, second });
            var provider = new RejectProviderCalls();
            var service = CreateService(db, provider);
            var request = new GenerateAiCaseRequest { GenerationPreset = AiGenerationPresets.ShortDemo };

            var admitted = await service.CreatePreviewAsync(user, request, "third-idempotent");
            var stored = await db.AiCaseDrafts.Find(item => item.Id == admitted.DraftId).SingleAsync();
            Assert.Equal($"{owner}:active:3", stored.ActiveQuotaKey);
            Assert.Equal(1m, stored.ReservedBudgetUsd);
            Assert.Equal(1m, (await db.AiBudgetLedger.Find(item => item.Id == AiBudgetLedger.GlobalId).SingleAsync()).ReservedUsd);
            Assert.Equal(3, await db.AiCaseDrafts.CountDocumentsAsync(item => item.CreatedByUserId == owner && item.ActiveQuotaKey != null));

            var replay = await service.CreatePreviewAsync(user, request, "third-idempotent");
            Assert.Equal(admitted.DraftId, replay.DraftId);
            var fourth = await Assert.ThrowsAsync<ApiException>(() => service.CreatePreviewAsync(user, request, "fourth"));
            Assert.Equal("AI_ACTIVE_DRAFT_LIMIT", Assert.IsType<ApiErrorDetails>(fourth.Errors).Code);

            await service.CancelDraftAsync(user, second.Id);
            var daily = await Assert.ThrowsAsync<ApiException>(() => service.CreatePreviewAsync(user, request, "same-day"));
            Assert.Equal("AI_DAILY_LIMIT", Assert.IsType<ApiErrorDetails>(daily.Errors).Code);
            Assert.Equal(1m, (await db.AiBudgetLedger.Find(item => item.Id == AiBudgetLedger.GlobalId).SingleAsync()).ReservedUsd);

            await service.CancelDraftAsync(user, admitted.DraftId);
            await service.CancelDraftAsync(user, admitted.DraftId);
            stored = await db.AiCaseDrafts.Find(item => item.Id == admitted.DraftId).SingleAsync();
            Assert.Null(stored.ActiveQuotaKey);
            Assert.NotNull(stored.DailyQuotaKey); // Cancellation frees active capacity, not today's creation count.
            Assert.Equal(0m, (await db.AiBudgetLedger.Find(item => item.Id == AiBudgetLedger.GlobalId).SingleAsync()).ReservedUsd);
            Assert.Equal(0, provider.Calls);
        });
    }

    [Fact]
    public async Task ConcurrentMongoClaims_AdmitExactlyThreeAndNeverCreateFourthSlot()
    {
        await WithDatabase(async db =>
        {
            var owner = ObjectId.GenerateNewId().ToString();
            var start = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var releases = 0;
            var claims = Enumerable.Range(1, 8).Select(async number =>
            {
                var candidate = Draft(owner, number);
                candidate.ActiveQuotaKey = null;
                await start.Task;
                try
                {
                    await AiDraftQuotaSlots.InsertAsync(candidate, 3, async item =>
                    {
                        try
                        {
                            await db.AiCaseDrafts.InsertOneAsync(item);
                            return AiDraftInsertCollision.None;
                        }
                        catch (MongoWriteException error) when (error.WriteError.Category == ServerErrorCategory.DuplicateKey)
                        {
                            return AiDraftQuotaSlots.ClassifyDuplicate(error.WriteError.Details, error.WriteError.Message);
                        }
                    }, () => Task.FromResult<AiCaseDraft?>(null),
                        () => { Interlocked.Increment(ref releases); return Task.CompletedTask; });
                    return true;
                }
                catch (ApiException error)
                {
                    Assert.Equal("AI_ACTIVE_DRAFT_LIMIT", Assert.IsType<ApiErrorDetails>(error.Errors).Code);
                    return false;
                }
            }).ToArray();
            start.SetResult(true);
            var outcomes = await Task.WhenAll(claims);
            Assert.Equal(3, outcomes.Count(admitted => admitted));
            Assert.Equal(5, releases);
            var records = await db.AiCaseDrafts.Find(item => item.CreatedByUserId == owner).ToListAsync();
            Assert.Equal(3, records.Count);
            Assert.Equal(new[] { owner, $"{owner}:active:2", $"{owner}:active:3" },
                records.Select(item => item.ActiveQuotaKey).Order(StringComparer.Ordinal));
        });
    }

    private static AiCaseDraft Draft(string owner, int slot)
    {
        // Distinct historical creation days keep the daily index out of the active-slot concurrency probe.
        var day = DateTime.UtcNow.AddHours(7).AddDays(-slot).ToString("yyyy-MM-dd");
        return new AiCaseDraft
        {
            Id = ObjectId.GenerateNewId().ToString(), CreatedByUserId = owner, CreatedByRole = UserRole.Admin,
            Status = AiDraftStatus.StoryAwaitingApproval, QuotaDay = day,
            ActiveQuotaKey = AiDraftQuotaSlots.ActiveKey(owner, slot), DailyQuotaKey = $"{owner}:{day}"
        };
    }

    private static AiCaseService CreateService(MongoDbContext db, IAiOpenAiClient provider) => new(
        db: db, workflow: null!, caseService: null!, validator: null!, truthService: null!,
        projectionPlanner: null!, projectionSchemaFactory: null!, projectionCompiler: null!, projectionGraphValidator: null!,
        openAiClient: provider, exportService: null!, httpClientFactory: null!,
        settings: Options.Create(new OpenAiSettings { ApiKey = "integration-placeholder-never-used", GenerateJsonOnly = true }),
        quota: Options.Create(new AiQuotaSettings
        {
            Enabled = true, MaxActiveDraftsPerUser = 3, MaxCasesPerUserPerDay = 1,
            EstimatedCaseCostUsd = 1m, GlobalBudgetUsd = 10m
        }),
        cloudinary: Options.Create(new CloudinarySettings()),
        v3PresetSettings: Options.Create(new AiCaseV3PresetSettings { Enabled = true }),
        gameplayV3Settings: Options.Create(new GameplayV3Settings { Enabled = true }),
        env: null!, logger: NullLogger<AiCaseService>.Instance);

    private static async Task WithDatabase(Func<MongoDbContext, Task> check)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase)) return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_aiquota_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var client = new MongoClient(settings.ConnectionString);
        var db = new MongoDbContext(Options.Create(settings));
        try
        {
            await db.EnsureIndexesAsync();
            await check(db);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }

    private sealed class RejectProviderCalls : IAiOpenAiClient
    {
        public int Calls { get; private set; }
        public Task<AiProviderHttpResponse> PostStructuredJsonAsync(object payload, CancellationToken cancellationToken = default)
        {
            Calls++;
            throw new InvalidOperationException("Admission must not call the paid provider.");
        }
    }
}
