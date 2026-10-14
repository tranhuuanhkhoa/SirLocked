using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>Opt-in real Mongo tests. Only ephemeral loopback sirlocked_it_* databases may be dropped.</summary>
public sealed class MongoAiUsageAccountingTests
{
    private const string UsageBody = "{\"id\":\"provider-id\",\"usage\":{\"input_tokens\":100000,\"output_tokens\":0}}";

    [Fact]
    public async Task VideoQuoteVersionIsDurableBeforeSubmissionAndSurvivesCallerMutation()
    {
        if (!Enabled()) return;
        await WithDatabase(async db =>
        {
            var accounting = Service(db);
            var video = await accounting.BeforeCallAsync("draft", "presentation:intro", "video", "video-model",
                reservationUsd: .5m, priceVersion: "video-quote-2026-09");
            var pending = await Events(db).Find(item => item.Id == video.Id).SingleAsync();
            Assert.Equal("PENDING", pending.State);
            Assert.Equal("video-quote-2026-09", pending.Lease.PriceVersion);
            video.PriceVersion = "caller-mutated-version";
            await accounting.RecordAsync(video, "{\"usage\":{\"cost_in_usd_ticks\":1000000000}}", 200);
            var settled = await Events(db).Find(item => item.Id == video.Id).SingleAsync();
            Assert.Equal("SETTLED", settled.State);
            Assert.Equal("video-quote-2026-09", settled.Lease.PriceVersion);
            Assert.Equal(.1m, settled.CostUsd);

            // Existing call sites that omit the optional quote retain the configured text version.
            var text = await accounting.BeforeCallAsync("draft", "preview", "text", "test");
            Assert.Equal("integration-test-only", (await Events(db).Find(item => item.Id == text.Id).SingleAsync()).Lease.PriceVersion);
        });
    }

    [Fact]
    public async Task ConcurrentReservationsNeverExceedGlobalBudget()
    {
        if (!Enabled()) return;
        await WithDatabase(async db =>
        {
            var accounting = Service(db, global: 1m);
            var outcomes = await Task.WhenAll(Enumerable.Range(0, 12).Select(async index =>
            {
                try { return await accounting.BeforeCallAsync($"draft-{index}", "preview", "text", "test"); }
                catch (ApiException exception) when (exception.StatusCode == 409) { return null; }
            }));
            Assert.Equal(3, outcomes.Count(lease => lease is not null));
            var ledger = await Ledger(db);
            Assert.Equal(.9m, ledger.ReservedUsd);
            Assert.Equal(0m, ledger.SpentUsd);
            Assert.Equal(3, ledger.CallReservations.Count);
        });
    }

    [Fact]
    public async Task DuplicateSettlementUsesDurableLeaseAndChargesExactlyOnce()
    {
        if (!Enabled()) return;
        await WithDatabase(async db =>
        {
            var accounting = Service(db);
            var lease = await accounting.BeforeCallAsync("draft", "preview", "text", "test");
            lease.ReservedUsd = 999;
            lease.Price!.InputPerMillionUsd = 999;
            await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => accounting.RecordAsync(lease, UsageBody, 200)));
            var ledger = await Ledger(db);
            Assert.Equal(.1m, ledger.SpentUsd);
            Assert.Equal(0m, ledger.ReservedUsd);
            Assert.Empty(ledger.CallReservations);
            var usage = await Events(db).Find(x => x.Id == lease.Id).SingleAsync();
            Assert.Equal("SETTLED", usage.State);
            Assert.Equal(.3m, usage.Lease.ReservedUsd);
            Assert.Equal(.1m, usage.CostUsd);
        });
    }

    [Fact]
    public async Task UnknownResponseHoldsReservationUntilSameCallCanBeReconciled()
    {
        if (!Enabled()) return;
        await WithDatabase(async db =>
        {
            var accounting = Service(db);
            var lease = await accounting.BeforeCallAsync("draft", "video-or-timeout", "text", "test");
            await accounting.RecordAsync(lease, null, null);
            Assert.Equal(0, await accounting.ReconcileRecordedAsync());
            Assert.Equal(.3m, (await Ledger(db)).ReservedUsd);
            Assert.Equal("UNKNOWN", (await Events(db).Find(x => x.Id == lease.Id).SingleAsync()).State);
            await accounting.RecordAsync(lease, UsageBody, 200);
            await accounting.RecordAsync(lease, null, null);
            Assert.Equal(0m, (await Ledger(db)).ReservedUsd);
            Assert.Equal(.1m, (await Ledger(db)).SpentUsd);
            Assert.Equal("SETTLED", (await Events(db).Find(x => x.Id == lease.Id).SingleAsync()).State);
        });
    }

    [Fact]
    public async Task RecordedCrashCheckpointReconcilesAndMissingFinalEventMarkerDoesNotChargeAgain()
    {
        if (!Enabled()) return;
        await WithDatabase(async db =>
        {
            var accounting = Service(db);
            var lease = await accounting.BeforeCallAsync("draft", "preview", "text", "test");
            await Events(db).ReplaceOneAsync(x => x.Id == lease.Id, AiUsageParser.Parse(lease, UsageBody, 200));
            await accounting.BeforeCallAsync("draft", "next", "text", "test");
            Assert.Equal(.1m, (await Ledger(db)).SpentUsd);
            // Simulate death after the atomic ledger mutation but before marking the event settled.
            await Events(db).UpdateOneAsync(x => x.Id == lease.Id, Builders<AiUsageEvent>.Update.Set(x => x.State, "RECORDED"));
            await accounting.BeforeCallAsync("draft", "third", "text", "test");
            Assert.Equal(.1m, (await Ledger(db)).SpentUsd);
            Assert.Equal(.6m, (await Ledger(db)).ReservedUsd);
            Assert.Equal("SETTLED", (await Events(db).Find(x => x.Id == lease.Id).SingleAsync()).State);
        });
    }

    [Fact]
    public async Task PerDraftBudgetBlocksFurtherCallsAndRetainsActualOverage()
    {
        if (!Enabled()) return;
        await WithDatabase(async db =>
        {
            var accounting = Service(db, maxDraft: .5m);
            var lease = await accounting.BeforeCallAsync("draft", "preview", "text", "test");
            await Assert.ThrowsAsync<ApiException>(() => accounting.BeforeCallAsync("draft", "second", "text", "test"));
            await accounting.RecordAsync(lease, "{\"usage\":{\"input_tokens\":700000,\"output_tokens\":0}}", 200);
            Assert.Equal(.7m, (await Ledger(db)).SpentUsd);
            await Assert.ThrowsAsync<ApiException>(() => accounting.BeforeCallAsync("draft", "third", "text", "test"));
            Assert.NotNull(await accounting.BeforeCallAsync("different-draft", "preview", "text", "test"));
        });
    }

    private static AiUsageAccounting Service(MongoDbContext db, decimal global = 2m, decimal maxDraft = 0m) => new(db,
        Options.Create(new AiQuotaSettings { Enabled = true, GlobalBudgetUsd = global }),
        Options.Create(new AiUsageSettings
        {
            PriceVersion = "integration-test-only", MaxDraftUsd = maxDraft,
            Models = new() { ["test"] = new AiModelPrice { InputPerMillionUsd = 1, OutputPerMillionUsd = 1, ReservationUsd = .3m } }
        }));

    private static IMongoCollection<AiUsageEvent> Events(MongoDbContext db) => db.Database.GetCollection<AiUsageEvent>("aiUsageEvents");
    private static Task<AiBudgetLedger> Ledger(MongoDbContext db) => db.AiBudgetLedger.Find(x => x.Id == AiBudgetLedger.GlobalId).SingleAsync();
    private static bool Enabled() => string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static async Task WithDatabase(Func<MongoDbContext, Task> test)
    {
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_aiusage_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        await db.PingAsync();
        try { await test(db); }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await new MongoClient(settings.ConnectionString).DropDatabaseAsync(settings.DatabaseName);
        }
    }
}
