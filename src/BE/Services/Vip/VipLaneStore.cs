using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Vip;

/// <summary>The collections of the VIP lane: <c>aiVipCalls</c> (answers by request key) and <c>aiVipUsage</c> (cost).</summary>
public sealed class VipLaneStore(MongoDbContext db, TimeProvider? time = null)
{
    private readonly TimeProvider _time = time ?? TimeProvider.System;

    public IMongoCollection<AiVipCall> Calls => db.Database.GetCollection<AiVipCall>("aiVipCalls");
    public IMongoCollection<AiVipUsageRecord> Usage => db.Database.GetCollection<AiVipUsageRecord>("aiVipUsage");
    public IMongoCollection<AiCaseDraft> Drafts => db.AiCaseDrafts;
    public DateTime Now => _time.GetUtcNow().UtcDateTime;

    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await Calls.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<AiVipCall>(Builders<AiVipCall>.IndexKeys.Ascending(call => call.RequestKey),
                new CreateIndexOptions { Name = "ux_aiVipCalls_requestKey", Unique = true }),
            new CreateIndexModel<AiVipCall>(Builders<AiVipCall>.IndexKeys.Ascending(call => call.State).Ascending(call => call.UpdatedAt),
                new CreateIndexOptions { Name = "ix_aiVipCalls_state_updatedAt" }),
            new CreateIndexModel<AiVipCall>(Builders<AiVipCall>.IndexKeys.Ascending(call => call.DraftId),
                new CreateIndexOptions { Name = "ix_aiVipCalls_draftId" })
        }, ct);
        await Usage.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<AiVipUsageRecord>(Builders<AiVipUsageRecord>.IndexKeys.Ascending(item => item.DraftId).Ascending(item => item.At),
                new CreateIndexOptions { Name = "ix_aiVipUsage_draft_at" }),
            new CreateIndexModel<AiVipUsageRecord>(Builders<AiVipUsageRecord>.IndexKeys.Descending(item => item.At),
                new CreateIndexOptions { Name = "ix_aiVipUsage_at" })
        }, ct);
    }

    public Task<AiVipCall?> FindByKeyAsync(string requestKey, CancellationToken ct = default) =>
        Calls.Find(call => call.RequestKey == requestKey).FirstOrDefaultAsync(ct)!;

    public Task<AiVipCall?> GetAsync(string id, CancellationToken ct = default) =>
        Calls.Find(call => call.Id == id).FirstOrDefaultAsync(ct)!;

    /// <summary>Inserts a PENDING call; a concurrent insert of the same key returns the stored one.</summary>
    public async Task<AiVipCall> InsertPendingAsync(AiVipCall call, CancellationToken ct = default)
    {
        call.Id = string.IsNullOrWhiteSpace(call.Id) ? MongoDB.Bson.ObjectId.GenerateNewId().ToString() : call.Id;
        call.State = AiVipCallStates.Pending;
        call.CreatedAt = Now;
        call.UpdatedAt = call.CreatedAt;
        try
        {
            await Calls.InsertOneAsync(call, cancellationToken: ct);
            return call;
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            var stored = await FindByKeyAsync(call.RequestKey, ct);
            if (stored is null) throw;
            return stored;
        }
    }

    /// <summary>A replay asked something different: the old answer is set aside (its key freed) and kept for the record.</summary>
    public Task RetireStaleAsync(AiVipCall call, CancellationToken ct = default) =>
        Calls.UpdateOneAsync(item => item.Id == call.Id && item.RequestKey == call.RequestKey,
            Builders<AiVipCall>.Update
                .Set(item => item.State, AiVipCallStates.Stale)
                .Set(item => item.RequestKey, $"{call.RequestKey}:stale:{call.Id}")
                .Set(item => item.UpdatedAt, Now),
            cancellationToken: ct);

    public Task SetBatchAsync(string callId, string batchId, string model, CancellationToken ct = default) =>
        Calls.UpdateOneAsync(item => item.Id == callId && item.State == AiVipCallStates.Pending,
            Builders<AiVipCall>.Update
                .Set(item => item.State, AiVipCallStates.BatchPending)
                .Set(item => item.BatchId, batchId)
                .Set(item => item.Model, model)
                .Set(item => item.Batch, true)
                .Inc(item => item.BatchAttempts, 1)
                .Set(item => item.UpdatedAt, Now),
            cancellationToken: ct);

    public Task CompleteAsync(string callId, string resultJson, string model, CancellationToken ct = default) =>
        Calls.UpdateOneAsync(item => item.Id == callId && item.State != AiVipCallStates.Done,
            Builders<AiVipCall>.Update
                .Set(item => item.State, AiVipCallStates.Done)
                .Set(item => item.ResultJson, resultJson)
                .Set(item => item.Model, model)
                .Set(item => item.Error, string.Empty)
                .Set(item => item.AnsweredAt, Now)
                .Set(item => item.UpdatedAt, Now),
            cancellationToken: ct);

    public Task FailAsync(string callId, string error, CancellationToken ct = default) =>
        Calls.UpdateOneAsync(item => item.Id == callId && item.State != AiVipCallStates.Done,
            Builders<AiVipCall>.Update
                .Set(item => item.State, AiVipCallStates.Failed)
                .Set(item => item.Error, error.Length <= 1000 ? error : error[..1000])
                .Set(item => item.UpdatedAt, Now),
            cancellationToken: ct);

    /// <summary>A batch errored or expired once: send it again (the call stays PENDING without a batch).</summary>
    public Task ResetBatchAsync(string callId, string error, CancellationToken ct = default) =>
        Calls.UpdateOneAsync(item => item.Id == callId && item.State == AiVipCallStates.BatchPending,
            Builders<AiVipCall>.Update
                .Set(item => item.State, AiVipCallStates.Pending)
                .Set(item => item.BatchId, string.Empty)
                .Set(item => item.Error, error.Length <= 1000 ? error : error[..1000])
                .Set(item => item.UpdatedAt, Now),
            cancellationToken: ct);

    /// <summary>
    /// Records one call's usage and adds its cost to the draft's running total in the same pass. The usage id is the
    /// call id plus a suffix, so recording the same answer twice is impossible.
    /// </summary>
    public async Task<bool> RecordUsageAsync(AiVipUsageRecord usage, CancellationToken ct = default)
    {
        try
        {
            await Usage.InsertOneAsync(usage, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            return false;
        }
        await Drafts.UpdateOneAsync(draft => draft.Id == usage.DraftId && draft.VipBilling != null,
            Builders<AiCaseDraft>.Update
                .Inc(draft => draft.VipBilling!.SpentUsd, usage.CostUsd)
                .Inc(draft => draft.VipBilling!.SpentVnd, usage.CostVnd)
                .Inc(draft => draft.VipBilling!.Calls, 1)
                .Set(draft => draft.VipBilling!.WorkStarted, true),
            cancellationToken: ct);
        return true;
    }

    public Task<List<AiVipCall>> OpenBatchesAsync(int limit, CancellationToken ct = default) =>
        Calls.Find(call => call.State == AiVipCallStates.BatchPending).SortBy(call => call.UpdatedAt).Limit(limit).ToListAsync(ct);
}
