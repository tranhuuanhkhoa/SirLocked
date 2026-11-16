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
    public async Task RealAdmission_LegacyAndSecondSlotOccupied_AcceptsThirdAndPreservesDailyLimit()
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
            // ADMIN orders go straight to Claude and have no weekly slot.
            Assert.Equal(AiOrderStatuses.QueuedForClaude, stored.OrderStatus);
            Assert.Equal(AiQueueStates.Pending, stored.QueueState);
            Assert.Null(stored.WeeklyQuotaKey);
            Assert.Equal(3, await db.AiCaseDrafts.CountDocumentsAsync(item => item.CreatedByUserId == owner && item.ActiveQuotaKey != null));

            var replay = await service.CreatePreviewAsync(user, request, "third-idempotent");
            Assert.Equal(admitted.DraftId, replay.DraftId);
            var fourth = await Assert.ThrowsAsync<ApiException>(() => service.CreatePreviewAsync(user, request, "fourth"));
            Assert.Equal("AI_ACTIVE_DRAFT_LIMIT", Assert.IsType<ApiErrorDetails>(fourth.Errors).Code);

            await service.CancelDraftAsync(user, second.Id);
            var daily = await Assert.ThrowsAsync<ApiException>(() => service.CreatePreviewAsync(user, request, "same-day"));
            Assert.Equal("AI_DAILY_LIMIT", Assert.IsType<ApiErrorDetails>(daily.Errors).Code);

            await service.CancelDraftAsync(user, admitted.DraftId);
            await service.CancelDraftAsync(user, admitted.DraftId);
            stored = await db.AiCaseDrafts.Find(item => item.Id == admitted.DraftId).SingleAsync();
            Assert.Null(stored.ActiveQuotaKey);
            Assert.NotNull(stored.DailyQuotaKey); // Cancellation frees active capacity, not today's creation count.
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

    [Fact]
    public async Task VipOrder_WaitsForApproval_ForcesFullReviewAndCap_AndCreatesNoBridgeRequest()
    {
        await WithDatabase(async db =>
        {
            var vip = new CurrentUser(ObjectId.GenerateNewId().ToString(), "VIP", UserRole.Vip);
            var provider = new RejectProviderCalls();
            var service = CreateService(db, provider, quota: false);
            var draft = await service.CreatePreviewAsync(vip, new GenerateAiCaseRequest
            {
                GenerationPreset = AiGenerationPresets.ShortDemo,
                Order = new AiCaseOrder
                {
                    World = "taisho_japan", ReviewMode = AiCaseReviewModes.Fast, PixelLabCap = 100,
                    SuspectCount = 5, Weather = "rain", TimeOfDay = "night"
                }
            }, "vip-order-1");

            Assert.Equal(AiOrderStatuses.AwaitingOwnerApproval, draft.OrderStatus);
            Assert.Equal(AiQueueStates.None, draft.QueueState);
            Assert.Equal(AiCaseReviewModes.Full, draft.Order!.ReviewMode); // VIPs never get fast review
            Assert.Equal(AiCaseOrder.VipPixelLabCap, draft.Order.PixelLabCap); // nor more than 30 generations
            Assert.Equal(AiCaseWorlds.TaishoJapan, draft.Order.World);
            Assert.Equal("RAIN", draft.Order.Weather);
            Assert.Equal("NIGHT", draft.Order.TimeOfDay);
            Assert.Equal(5, draft.Order.SuspectCount);
            Assert.Single(draft.OrderStatusHistory);
            Assert.Equal(0, await db.AiBridgeRequests.CountDocumentsAsync(FilterDefinition<AiBridgeRequest>.Empty));
            var stored = await db.AiCaseDrafts.Find(item => item.Id == draft.DraftId).SingleAsync();
            Assert.Null(stored.NextAttemptAt); // nothing the worker could claim
            Assert.Equal(0, provider.Calls);

            var forbidden = await Assert.ThrowsAsync<ApiException>(() => service.ApproveOrderAsync(vip, draft.DraftId));
            Assert.Equal(403, forbidden.StatusCode);
            var continued = await Assert.ThrowsAsync<ApiException>(() => service.ContinueDraftAsync(vip, draft.DraftId));
            Assert.Equal("AI_ORDER_AWAITING_APPROVAL", Assert.IsType<ApiErrorDetails>(continued.Errors).Code);

            var admin = new CurrentUser(ObjectId.GenerateNewId().ToString(), "Admin", UserRole.Admin);
            var approved = await service.ApproveOrderAsync(admin, draft.DraftId);
            Assert.Equal(AiOrderStatuses.QueuedForClaude, approved.OrderStatus);
            Assert.Equal(AiQueueStates.Pending, approved.QueueState);
            Assert.Equal(admin.Id, approved.OrderStatusHistory.Last().ByUserId);
            Assert.Equal(AiOrderStatuses.QueuedForClaude, (await service.ApproveOrderAsync(admin, draft.DraftId)).OrderStatus); // harmless repeat
            var rejectApproved = await Assert.ThrowsAsync<ApiException>(() => service.RejectOrderAsync(admin, draft.DraftId, "late"));
            Assert.Equal(409, rejectApproved.StatusCode);
        });
    }

    [Fact]
    public async Task VipWeeklyLimit_DefaultsToTwo_RejectionFreesTheSlot_AndAdminCanRaiseIt()
    {
        await WithDatabase(async db =>
        {
            var vip = new CurrentUser(ObjectId.GenerateNewId().ToString(), "VIP", UserRole.Vip);
            var admin = new CurrentUser(ObjectId.GenerateNewId().ToString(), "Admin", UserRole.Admin);
            var service = CreateService(db, new RejectProviderCalls(), quota: false);
            var request = new GenerateAiCaseRequest { GenerationPreset = AiGenerationPresets.ShortDemo };

            Assert.Equal(AiCaseSettingsStore.DefaultVipWeeklyOrderLimit, (await new AiCaseSettingsStore(db).GetAsync()).VipWeeklyOrderLimit);
            var fresh = await service.GetOrderQuotaAsync(vip);
            Assert.Equal((false, 2, 0, 2), (fresh.Unlimited, fresh.WeeklyLimit, fresh.UsedThisWeek, fresh.Remaining));
            Assert.Equal(AiCaseService.VietnamQuotaWeek(DateTime.UtcNow), fresh.WeekStart);
            var adminQuota = await service.GetOrderQuotaAsync(admin);
            Assert.True(adminQuota.Unlimited);
            var first = await service.CreatePreviewAsync(vip, request, "week-1");
            await service.CreatePreviewAsync(vip, request, "week-2");
            var spent = await service.GetOrderQuotaAsync(vip);
            Assert.Equal((2, 0), (spent.UsedThisWeek, spent.Remaining));
            var third = await Assert.ThrowsAsync<ApiException>(() => service.CreatePreviewAsync(vip, request, "week-3"));
            Assert.Equal("AI_WEEKLY_LIMIT", Assert.IsType<ApiErrorDetails>(third.Errors).Code);
            // Replaying an accepted order is not a new order.
            Assert.Equal(first.DraftId, (await service.CreatePreviewAsync(vip, request, "week-1")).DraftId);

            var missingReason = await Assert.ThrowsAsync<ApiException>(() => service.RejectOrderAsync(admin, first.DraftId, "  "));
            Assert.Equal(400, missingReason.StatusCode);
            var rejected = await service.RejectOrderAsync(admin, first.DraftId, "Ý tưởng trùng vụ tuần trước.");
            Assert.Equal(AiOrderStatuses.Rejected, rejected.OrderStatus);
            Assert.Equal(AiDraftStatus.Cancelled, rejected.Status);
            Assert.Equal("Ý tưởng trùng vụ tuần trước.", rejected.OrderRejectReason);
            var change = rejected.OrderStatusHistory.Last();
            Assert.Equal((AiOrderStatuses.Rejected, admin.Id), (change.Status, change.ByUserId));
            Assert.Null((await db.AiCaseDrafts.Find(item => item.Id == first.DraftId).SingleAsync()).WeeklyQuotaKey);
            Assert.Equal(1, (await service.GetOrderQuotaAsync(vip)).Remaining);

            await service.CreatePreviewAsync(vip, request, "week-3"); // the rejected order's slot is free again
            var fourth = await Assert.ThrowsAsync<ApiException>(() => service.CreatePreviewAsync(vip, request, "week-4"));
            Assert.Equal("AI_WEEKLY_LIMIT", Assert.IsType<ApiErrorDetails>(fourth.Errors).Code);

            await new AiCaseSettingsStore(db).SaveAsync(3, admin.Id);
            await service.CreatePreviewAsync(vip, request, "week-4");
            Assert.Equal(3, await db.AiCaseDrafts.CountDocumentsAsync(item => item.CreatedByUserId == vip.Id && item.WeeklyQuotaKey != null));
            await Assert.ThrowsAsync<ApiException>(() => new AiCaseSettingsStore(db).SaveAsync(-1, admin.Id));
        });
    }

    [Fact]
    public async Task VipWeeklySlots_HoldUnderConcurrentOrders()
    {
        await WithDatabase(async db =>
        {
            var vip = new CurrentUser(ObjectId.GenerateNewId().ToString(), "VIP", UserRole.Vip);
            var service = CreateService(db, new RejectProviderCalls(), quota: false);
            var attempts = Enumerable.Range(1, 6).Select(async index =>
            {
                try
                {
                    await CreateService(db, new RejectProviderCalls(), quota: false).CreatePreviewAsync(
                        vip, new GenerateAiCaseRequest { GenerationPreset = AiGenerationPresets.ShortDemo }, $"race-{index}");
                    return true;
                }
                catch (ApiException error) when (error.Errors is ApiErrorDetails { Code: "AI_WEEKLY_LIMIT" })
                {
                    return false;
                }
            }).ToArray();
            var outcomes = await Task.WhenAll(attempts);
            Assert.Equal(AiCaseSettingsStore.DefaultVipWeeklyOrderLimit, outcomes.Count(admitted => admitted));
            Assert.Equal(AiCaseSettingsStore.DefaultVipWeeklyOrderLimit,
                await db.AiCaseDrafts.CountDocumentsAsync(item => item.CreatedByUserId == vip.Id));
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

    private static AiCaseService CreateService(MongoDbContext db, IAiTextProvider provider, bool quota = true) => new(
        db: db, workflow: null!, caseService: null!, validator: null!, truthService: null!,
        projectionPlanner: null!, projectionSchemaFactory: null!, projectionCompiler: null!, projectionGraphValidator: null!,
        textProvider: provider, exportService: null!, httpClientFactory: null!,
        settings: Options.Create(new AiGenerationSettings { GenerateJsonOnly = true }),
        quota: Options.Create(new AiQuotaSettings
        {
            Enabled = quota, MaxActiveDraftsPerUser = 3, MaxCasesPerUserPerDay = quota ? 1 : 100
        }),
        cloudinary: Options.Create(new CloudinarySettings()),
        v3PresetSettings: Options.Create(new AiCaseV3PresetSettings { Enabled = true }),
        gameplayV3Settings: Options.Create(new GameplayV3Settings { Enabled = true }),
        env: null!, logger: NullLogger<AiCaseService>.Instance,
        bridgeSettings: Options.Create(new BridgeSettings { Key = "integration-bridge-key-0123456789abcdef" }));

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

    private sealed class RejectProviderCalls : IAiTextProvider
    {
        public int Calls { get; private set; }
        public Task<string> GenerateJsonAsync(AiTextRequest request, CancellationToken cancellationToken = default)
        {
            Calls++;
            throw new InvalidOperationException("Admission must not ask Claude anything.");
        }
    }
}
