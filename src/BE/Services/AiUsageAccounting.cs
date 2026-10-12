using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class AiUsageAccounting(
    MongoDbContext db, IOptions<AiQuotaSettings> quotaOptions, IOptions<AiUsageSettings> usageOptions)
    : IAiUsageAccounting, IAiRecordedUsageReconciler
{
    private readonly AiQuotaSettings _quota = quotaOptions.Value;
    private readonly AiUsageSettings _usage = usageOptions.Value;
    private IMongoCollection<AiUsageEvent> Events => db.Database.GetCollection<AiUsageEvent>("aiUsageEvents");
    internal static string DraftKey(string draftId) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(draftId))).ToLowerInvariant();

    public async Task<AiCallLease> BeforeCallAsync(string draftId, string step, string kind, string model,
        CancellationToken cancellationToken = default, decimal? reservationUsd = null, string? priceVersion = null)
    {
        if (!_quota.Enabled)
            throw ApiException.Conflict("Enable and configure AI quota before paid generation.",
                "AI_QUOTA_UNCONFIGURED", "ai.quota.unconfigured");
        _usage.Models.TryGetValue(model, out var configuredPrice);
        var price = configuredPrice is null ? null : new AiModelPrice
        {
            InputPerMillionUsd = configuredPrice.InputPerMillionUsd,
            CachedInputPerMillionUsd = configuredPrice.CachedInputPerMillionUsd,
            OutputPerMillionUsd = configuredPrice.OutputPerMillionUsd,
            ImageInputPerMillionUsd = configuredPrice.ImageInputPerMillionUsd,
            ImageOutputPerMillionUsd = configuredPrice.ImageOutputPerMillionUsd,
            CacheWritePerMillionUsd = configuredPrice.CacheWritePerMillionUsd,
            ReservationUsd = configuredPrice.ReservationUsd
        };
        var reservation = reservationUsd ?? price?.ReservationUsd ?? 0m;
        if (_quota.GlobalBudgetUsd <= 0 || reservation <= 0
            || (kind != "video" && (price?.InputPerMillionUsd is null || price.OutputPerMillionUsd is null
                || string.IsNullOrWhiteSpace(_usage.PriceVersion)))
            || (kind == "image" && (price?.ImageInputPerMillionUsd is null || price.ImageOutputPerMillionUsd is null))
            || price?.InputPerMillionUsd < 0 || price?.OutputPerMillionUsd < 0
            || price?.CachedInputPerMillionUsd < 0 || price?.CacheWritePerMillionUsd < 0
            || price?.ImageInputPerMillionUsd < 0 || price?.ImageOutputPerMillionUsd < 0)
            throw ApiException.Conflict("Configure a conservative per-call reservation before paid generation.",
                "AI_USAGE_PRICE_REQUIRED", "ai.usage.priceRequired");
        // Complete any known usage saved just before a process crash, before admitting more spend.
        await ReconcileRecordedAsync(draftId, cancellationToken);
        var lease = new AiCallLease
        {
            DraftId = draftId, Step = step, Kind = kind, Model = model,
            ReservedUsd = reservation,
            // A provider-specific quote (for example a video package) supplies its
            // version before persistence; later caller mutations are never authoritative.
            PriceVersion = priceVersion ?? _usage.PriceVersion, Price = price
        };
        await Events.InsertOneAsync(new AiUsageEvent { Id = lease.Id, Lease = lease }, cancellationToken: cancellationToken);
        try
        {
            await db.AiBudgetLedger.UpdateOneAsync(x => x.Id == AiBudgetLedger.GlobalId,
                Builders<AiBudgetLedger>.Update.SetOnInsert(x => x.LimitUsd, _quota.GlobalBudgetUsd)
                    .SetOnInsert(x => x.ReservedUsd, 0m).SetOnInsert(x => x.SpentUsd, 0m),
                new UpdateOptions { IsUpsert = true }, cancellationToken);
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey) { }
        var key = DraftKey(draftId);
        static BsonDocument Value(string path) => new("$ifNull", new BsonArray { "$" + path, 0 });
        var tests = new BsonArray
        {
            new BsonDocument("$eq", new BsonArray { "$limitUsd", BsonDecimal128.Create(_quota.GlobalBudgetUsd) }),
            new BsonDocument("$lte", new BsonArray
            {
                new BsonDocument("$add", new BsonArray { Value("reservedUsd"), Value("spentUsd"), BsonDecimal128.Create(reservation) }),
                BsonDecimal128.Create(_quota.GlobalBudgetUsd)
            })
        };
        if (_usage.MaxDraftUsd > 0m)
            tests.Add(new BsonDocument("$lte", new BsonArray
            {
                new BsonDocument("$add", new BsonArray { Value($"draftUsage.{key}.reservedUsd"), Value($"draftUsage.{key}.spentUsd"), BsonDecimal128.Create(reservation) }),
                BsonDecimal128.Create(_usage.MaxDraftUsd)
            }));
        var filter = new BsonDocumentFilterDefinition<AiBudgetLedger>(new BsonDocument
        {
            { "_id", AiBudgetLedger.GlobalId }, { "$expr", new BsonDocument("$and", tests) }
        });
        var update = Builders<AiBudgetLedger>.Update.Inc(x => x.ReservedUsd, reservation)
            .Inc($"draftUsage.{key}.reservedUsd", reservation)
            .Set($"callReservations.{lease.Id}", reservation).Set(x => x.UpdatedAt, DateTime.UtcNow);
        var result = await db.AiBudgetLedger.UpdateOneAsync(filter, update, cancellationToken: cancellationToken);
        if (result.MatchedCount != 0) return lease;
        await Events.UpdateOneAsync(x => x.Id == lease.Id, Builders<AiUsageEvent>.Update.Set(x => x.State, "DENIED"), cancellationToken: cancellationToken);
        throw ApiException.Conflict("The remaining AI budget cannot cover this request.",
            "AI_GLOBAL_BUDGET_EXHAUSTED", "ai.quota.budgetExhausted");
    }

    /// <summary>Recover known costs after a process crash. Unknown costs are deliberately retained.</summary>
    public async Task<int> ReconcileRecordedAsync(string? draftId = null, CancellationToken cancellationToken = default)
    {
        var filter = Builders<AiUsageEvent>.Filter.Eq(item => item.State, "RECORDED");
        if (draftId is not null) filter &= Builders<AiUsageEvent>.Filter.Eq(item => item.Lease.DraftId, draftId);
        var pending = await Events.Find(filter).SortBy(item => item.UpdatedAt).Limit(200).ToListAsync(cancellationToken);
        foreach (var item in pending) await SettleAsync(item, cancellationToken);
        return pending.Count;
    }

    public async Task RecordAsync(AiCallLease lease, string? responseBody, int? statusCode,
        CancellationToken cancellationToken = default)
    {
        var stored = await Events.Find(x => x.Id == lease.Id).FirstOrDefaultAsync(cancellationToken)
            ?? throw ApiException.Conflict("The AI usage reservation was not found.", "AI_USAGE_LEASE_MISSING", "ai.usage.leaseMissing");
        if (stored.State == "DENIED")
            throw ApiException.Conflict("This AI usage reservation was denied.", "AI_USAGE_LEASE_DENIED", "ai.usage.leaseDenied");
        // Use the durable price/reservation snapshot, never a modified caller-owned lease.
        var parsed = AiUsageParser.Parse(stored.Lease, responseBody, statusCode);
        // The first priced response wins. An UNKNOWN timeout can later be reconciled by a
        // terminal provider response, but cannot overwrite known or already-settled usage.
        var canRecord = Builders<AiUsageEvent>.Filter.Eq(x => x.Id, lease.Id)
            & (parsed.State == "RECORDED"
                ? Builders<AiUsageEvent>.Filter.In(x => x.State, ["PENDING", "UNKNOWN"])
                : Builders<AiUsageEvent>.Filter.Eq(x => x.State, "PENDING"));
        var result = await Events.ReplaceOneAsync(canRecord, parsed,
            cancellationToken: cancellationToken);
        if (result.MatchedCount == 0)
            parsed = await Events.Find(x => x.Id == lease.Id).FirstOrDefaultAsync(cancellationToken) ?? parsed;
        if (parsed.State == "RECORDED") await SettleAsync(parsed, cancellationToken);
    }

    private async Task SettleAsync(AiUsageEvent usage, CancellationToken ct)
    {
        if (usage.CostUsd is not decimal cost) return;
        var lease = usage.Lease;
        if (lease.ReservedUsd > 0)
        {
            var key = DraftKey(lease.DraftId);
            // This one atomic mutation is the exactly-once boundary, without requiring replica-set transactions.
            var settled = await db.AiBudgetLedger.UpdateOneAsync(
                Builders<AiBudgetLedger>.Filter.Eq(x => x.Id, AiBudgetLedger.GlobalId)
                & Builders<AiBudgetLedger>.Filter.Eq($"callReservations.{lease.Id}", lease.ReservedUsd)
                & Builders<AiBudgetLedger>.Filter.Gte(x => x.ReservedUsd, lease.ReservedUsd),
                Builders<AiBudgetLedger>.Update.Unset($"callReservations.{lease.Id}")
                    .Inc(x => x.ReservedUsd, -lease.ReservedUsd).Inc(x => x.SpentUsd, cost)
                    .Inc($"draftUsage.{key}.reservedUsd", -lease.ReservedUsd)
                    .Inc($"draftUsage.{key}.spentUsd", cost).Set(x => x.UpdatedAt, DateTime.UtcNow),
                cancellationToken: ct);
            if (settled.MatchedCount == 0)
            {
                var ledger = await db.AiBudgetLedger.Find(x => x.Id == AiBudgetLedger.GlobalId).FirstOrDefaultAsync(ct);
                if (ledger is null || ledger.CallReservations.ContainsKey(lease.Id))
                    throw ApiException.Conflict("AI usage requires reservation reconciliation.",
                        "AI_USAGE_RECONCILIATION_REQUIRED", "ai.usage.reconciliationRequired");
                // No reservation means an earlier atomic settlement already committed, possibly
                // just before its process died without updating the event's status below.
            }
        }
        await Events.UpdateOneAsync(x => x.Id == usage.Id && x.State == "RECORDED",
            Builders<AiUsageEvent>.Update.Set(x => x.State, "SETTLED"), cancellationToken: ct);
    }
}

/// <summary>Only provider counters and explicit prices are used; missing usage is not zero.</summary>
public static class AiUsageParser
{
    public static AiUsageEvent Parse(AiCallLease lease, string? body, int? statusCode)
    {
        var item = new AiUsageEvent
        {
            Id = lease.Id, Lease = lease, StatusCode = statusCode, State = "UNKNOWN",
            LatencyMs = Math.Max(0, (long)(DateTime.UtcNow - lease.StartedAt).TotalMilliseconds)
        };
        if (string.IsNullOrWhiteSpace(body)) return item;
        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return item;
            item.ResponseId = root.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String ? id.GetString() ?? "" : "";
            if (!root.TryGetProperty("usage", out var usage) || usage.ValueKind != JsonValueKind.Object) return item;
            if (!ValidCounters(usage)) return item;
            item.InputTokens = Count(usage, "input_tokens") ?? Count(usage, "prompt_tokens");
            item.OutputTokens = Count(usage, "output_tokens") ?? Count(usage, "completion_tokens");
            item.CachedInputTokens = Detail(usage, "input_tokens_details", "cached_tokens") ?? Detail(usage, "prompt_tokens_details", "cached_tokens");
            item.CacheWriteTokens = Detail(usage, "input_tokens_details", "cache_write_tokens");
            item.ReasoningTokens = Detail(usage, "output_tokens_details", "reasoning_tokens") ?? Detail(usage, "completion_tokens_details", "reasoning_tokens");
            item.ImageInputTokens = Detail(usage, "input_tokens_details", "image_tokens");
            item.ImageOutputTokens = Detail(usage, "output_tokens_details", "image_tokens");
            if (lease.Kind == "video" && usage.TryGetProperty("cost_in_usd_ticks", out var ticks)
                && ticks.ValueKind == JsonValueKind.Number && ticks.TryGetDecimal(out var value) && value >= 0)
            {
                item.CostUsd = value / 10_000_000_000m;
                item.CostSource = "PROVIDER";
            }
            else if (Calculate(item, lease.Price) is decimal calculated)
            {
                item.CostUsd = calculated;
                item.CostSource = "USAGE_AND_PRICE_TABLE";
            }
            if (item.CostUsd.HasValue) item.State = "RECORDED";
        }
        catch (Exception exception) when (exception is JsonException or OverflowException)
        { /* Malformed or unrepresentable provider counters remain explicitly unknown. */ }
        return item;
    }

    private static long? Count(JsonElement value, string key) => value.TryGetProperty(key, out var node)
        && node.ValueKind == JsonValueKind.Number && node.TryGetInt64(out var count) && count >= 0 ? count : null;
    private static long? Detail(JsonElement value, string key, string field) => value.TryGetProperty(key, out var node)
        && node.ValueKind == JsonValueKind.Object ? Count(node, field) : null;

    private static bool ValidCounters(JsonElement usage)
    {
        foreach (var key in new[] { "input_tokens", "prompt_tokens", "output_tokens", "completion_tokens" })
            if (usage.TryGetProperty(key, out _) && Count(usage, key) is null) return false;
        foreach (var key in new[] { "input_tokens_details", "prompt_tokens_details", "output_tokens_details", "completion_tokens_details" })
        {
            if (!usage.TryGetProperty(key, out var details)) continue;
            if (details.ValueKind != JsonValueKind.Object) return false;
            foreach (var field in new[] { "cached_tokens", "cache_write_tokens", "reasoning_tokens", "image_tokens", "text_tokens" })
                if (details.TryGetProperty(field, out _) && Count(details, field) is null) return false;
            // Audio has a different price schedule; no audio-price contract exists here yet.
            if (details.TryGetProperty("audio_tokens", out _) && Count(details, "audio_tokens") is not 0) return false;
        }
        return true;
    }

    public static decimal? Calculate(AiUsageEvent usage, AiModelPrice? price)
    {
        if (price?.InputPerMillionUsd is not decimal inputRate || price.OutputPerMillionUsd is not decimal outputRate
            || usage.InputTokens is not long input || usage.OutputTokens is not long output) return null;
        if (input < 0 || output < 0 || inputRate < 0 || outputRate < 0
            || price.CachedInputPerMillionUsd < 0 || price.CacheWritePerMillionUsd < 0
            || price.ImageInputPerMillionUsd < 0 || price.ImageOutputPerMillionUsd < 0) return null;
        var cached = usage.CachedInputTokens ?? 0;
        var written = usage.CacheWriteTokens ?? 0;
        var imageInput = usage.ImageInputTokens ?? 0;
        var imageOutput = usage.ImageOutputTokens ?? (usage.Lease.Kind == "image" ? output : 0);
        if (cached < 0 || written < 0 || imageInput < 0 || imageOutput < 0
            || usage.ReasoningTokens < 0 || usage.ReasoningTokens > output) return null;
        if ((decimal)cached + written + imageInput > input || imageOutput > output) return null;
        // Cached tokens can include image tokens. Without a modality-specific cached breakdown,
        // treating the counters as disjoint could silently undercharge; retain the reservation.
        if (cached > 0 && imageInput > 0 || written > 0 && imageInput > 0) return null;
        if (usage.Lease.Kind == "image" && usage.ImageInputTokens is null) return null;
        if (cached > 0 && price.CachedInputPerMillionUsd is null
            || written > 0 && price.CacheWritePerMillionUsd is null
            || imageInput > 0 && price.ImageInputPerMillionUsd is null
            || imageOutput > 0 && price.ImageOutputPerMillionUsd is null) return null;
        // Reasoning tokens are already included in output_tokens; never add them a second time.
        return ((input - cached - written - imageInput) * inputRate
            + cached * (price.CachedInputPerMillionUsd ?? 0)
            + written * (price.CacheWritePerMillionUsd ?? 0)
            + imageInput * (price.ImageInputPerMillionUsd ?? 0)
            + (output - imageOutput) * outputRate
            + imageOutput * (price.ImageOutputPerMillionUsd ?? 0)) / 1_000_000m;
    }
}
