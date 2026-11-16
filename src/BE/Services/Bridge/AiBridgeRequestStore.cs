using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Bridge;

/// <summary>Mongo access for <c>aiBridgeRequests</c>. Every transition is a single conditional update.</summary>
public sealed class AiBridgeRequestStore(MongoDbContext db, TimeProvider time)
{
    public IMongoCollection<AiBridgeRequest> Collection => db.AiBridgeRequests;

    private DateTime Now => time.GetUtcNow().UtcDateTime;

    public Task<AiBridgeRequest?> FindByKeyAsync(string requestKey, CancellationToken ct = default) =>
        Collection.Find(item => item.RequestKey == requestKey).FirstOrDefaultAsync(ct)!;

    public async Task<AiBridgeRequest?> GetAsync(string id, CancellationToken ct = default)
    {
        if (!ObjectId.TryParse(id, out _)) return null;
        return await Collection.Find(item => item.Id == id).FirstOrDefaultAsync(ct);
    }

    /// <summary>Inserts a PENDING request, or returns the one another run already stored under the same key.</summary>
    public async Task<AiBridgeRequest> InsertPendingAsync(AiBridgeRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Id)) request.Id = ObjectId.GenerateNewId().ToString();
        request.Status = AiBridgeStatuses.Pending;
        request.CreatedAt = request.UpdatedAt = Now;
        if (string.IsNullOrWhiteSpace(request.OriginalRequestKey)) request.OriginalRequestKey = request.RequestKey;
        try
        {
            await Collection.InsertOneAsync(request, cancellationToken: ct);
            return request;
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            return await FindByKeyAsync(request.RequestKey, ct)
                ?? throw new InvalidOperationException("A bridge request collided on its key but could not be read back.");
        }
    }

    /// <summary>Retires a request whose prompt no longer matches; its key is freed for the replacement.</summary>
    public async Task MarkStaleAsync(AiBridgeRequest request, CancellationToken ct = default)
    {
        await Collection.UpdateOneAsync(
            item => item.Id == request.Id && item.RequestKey == request.RequestKey,
            Builders<AiBridgeRequest>.Update
                .Set(item => item.Status, AiBridgeStatuses.Stale)
                .Set(item => item.RequestKey, $"{request.RequestKey}:stale:{request.Id}")
                .Set(item => item.LeaseExpiresAt, null)
                .Set(item => item.UpdatedAt, Now),
            cancellationToken: ct);
    }

    public async Task MarkAcceptedAsync(string id, CancellationToken ct = default)
    {
        await Collection.UpdateOneAsync(
            item => item.Id == id && item.Status == AiBridgeStatuses.Submitted,
            Builders<AiBridgeRequest>.Update
                .Set(item => item.Status, AiBridgeStatuses.Accepted)
                .Set(item => item.AcceptedAt, Now)
                .Set(item => item.UpdatedAt, Now),
            cancellationToken: ct);
    }

    /// <summary>True exactly once per request: the caller then records the answer in the draft history.</summary>
    public async Task<bool> ClaimAttemptRecordingAsync(string id, CancellationToken ct = default)
    {
        var result = await Collection.UpdateOneAsync(
            item => item.Id == id && !item.AttemptRecorded,
            Builders<AiBridgeRequest>.Update.Set(item => item.AttemptRecorded, true),
            cancellationToken: ct);
        return result.ModifiedCount > 0;
    }

    public async Task<List<AiBridgeRequest>> ListAsync(string? status, int limit, CancellationToken ct = default)
    {
        var now = Now;
        var filter = Builders<AiBridgeRequest>.Filter.Empty;
        if (!string.IsNullOrWhiteSpace(status))
        {
            var normalized = status.Trim().ToUpperInvariant();
            filter = normalized == AiBridgeStatuses.Pending
                // An expired lease is as good as pending: the request can be taken again.
                ? Builders<AiBridgeRequest>.Filter.Or(
                    Builders<AiBridgeRequest>.Filter.In(item => item.Status, [AiBridgeStatuses.Pending, AiBridgeStatuses.Rejected]),
                    Builders<AiBridgeRequest>.Filter.And(
                        Builders<AiBridgeRequest>.Filter.Eq(item => item.Status, AiBridgeStatuses.Taken),
                        Builders<AiBridgeRequest>.Filter.Lte(item => item.LeaseExpiresAt, now)))
                : Builders<AiBridgeRequest>.Filter.Eq(item => item.Status, normalized);
        }
        return await Collection.Find(filter)
            .SortBy(item => item.CreatedAt)
            .Limit(Math.Clamp(limit, 1, 500))
            .ToListAsync(ct);
    }

    public Task<List<AiBridgeRequest>> ListForOwnerAsync(string ownerType, string ownerId, CancellationToken ct = default) =>
        Collection.Find(item => item.OwnerType == ownerType && item.OwnerId == ownerId)
            .SortBy(item => item.CreatedAt)
            .ToListAsync(ct);

    /// <summary>Takes a request for <paramref name="leaseHours"/>. Null when it is not takeable (taken, answered, closed).</summary>
    public async Task<AiBridgeRequest?> TakeAsync(string id, int leaseHours, CancellationToken ct = default)
    {
        var now = Now;
        var takeable = Builders<AiBridgeRequest>.Filter.And(
            Builders<AiBridgeRequest>.Filter.Eq(item => item.Id, id),
            Builders<AiBridgeRequest>.Filter.Or(
                Builders<AiBridgeRequest>.Filter.In(item => item.Status, [AiBridgeStatuses.Pending, AiBridgeStatuses.Rejected]),
                Builders<AiBridgeRequest>.Filter.And(
                    Builders<AiBridgeRequest>.Filter.Eq(item => item.Status, AiBridgeStatuses.Taken),
                    Builders<AiBridgeRequest>.Filter.Lte(item => item.LeaseExpiresAt, now))));
        return await Collection.FindOneAndUpdateAsync(
            takeable,
            Builders<AiBridgeRequest>.Update
                .Set(item => item.Status, AiBridgeStatuses.Taken)
                .Set(item => item.TakenAt, now)
                .Set(item => item.LeaseExpiresAt, now.AddHours(Math.Clamp(leaseHours, 1, 24)))
                .Inc(item => item.TakeCount, 1)
                .Set(item => item.UpdatedAt, now),
            new FindOneAndUpdateOptions<AiBridgeRequest> { ReturnDocument = ReturnDocument.After },
            ct);
    }

    public async Task<AiBridgeRequest?> ReleaseAsync(string id, CancellationToken ct = default) =>
        await Collection.FindOneAndUpdateAsync(
            item => item.Id == id && item.Status == AiBridgeStatuses.Taken,
            Builders<AiBridgeRequest>.Update
                .Set(item => item.Status, AiBridgeStatuses.Pending)
                .Set(item => item.LeaseExpiresAt, null)
                .Set(item => item.UpdatedAt, Now),
            new FindOneAndUpdateOptions<AiBridgeRequest> { ReturnDocument = ReturnDocument.After },
            ct);

    /// <summary>Stores a schema-valid answer. Null when the request is no longer open.</summary>
    public async Task<AiBridgeRequest?> SubmitAsync(string id, string resultJson, CancellationToken ct = default) =>
        await Collection.FindOneAndUpdateAsync(
            Builders<AiBridgeRequest>.Filter.And(
                Builders<AiBridgeRequest>.Filter.Eq(item => item.Id, id),
                Builders<AiBridgeRequest>.Filter.In(item => item.Status, AiBridgeStatuses.Open)),
            Builders<AiBridgeRequest>.Update
                .Set(item => item.Status, AiBridgeStatuses.Submitted)
                .Set(item => item.ResultJson, resultJson)
                .Set(item => item.ResultSha256, AiBridgeSchemaValidator.Sha256(resultJson))
                .Set(item => item.Errors, new List<string>())
                .Set(item => item.SubmittedAt, Now)
                .Set(item => item.LeaseExpiresAt, null)
                .Inc(item => item.SubmitCount, 1)
                .Set(item => item.UpdatedAt, Now),
            new FindOneAndUpdateOptions<AiBridgeRequest> { ReturnDocument = ReturnDocument.After },
            ct);

    /// <summary>Records a refused answer. The request stays open so the bot can fix and resubmit.</summary>
    public async Task<AiBridgeRequest?> RejectAsync(string id, IReadOnlyList<string> errors, CancellationToken ct = default) =>
        await Collection.FindOneAndUpdateAsync(
            Builders<AiBridgeRequest>.Filter.And(
                Builders<AiBridgeRequest>.Filter.Eq(item => item.Id, id),
                Builders<AiBridgeRequest>.Filter.In(item => item.Status, AiBridgeStatuses.Open)),
            Builders<AiBridgeRequest>.Update
                .Set(item => item.Status, AiBridgeStatuses.Rejected)
                .Set(item => item.Errors, errors.Take(100).ToList())
                .Inc(item => item.SubmitCount, 1)
                .Set(item => item.UpdatedAt, Now),
            new FindOneAndUpdateOptions<AiBridgeRequest> { ReturnDocument = ReturnDocument.After },
            ct);

    /// <summary>Closes every request of an owner that the pipeline has not consumed (draft cancelled or rejected).</summary>
    public async Task<long> CancelOwnerAsync(string ownerType, string ownerId, CancellationToken ct = default)
    {
        var result = await Collection.UpdateManyAsync(
            Builders<AiBridgeRequest>.Filter.And(
                Builders<AiBridgeRequest>.Filter.Eq(item => item.OwnerType, ownerType),
                Builders<AiBridgeRequest>.Filter.Eq(item => item.OwnerId, ownerId),
                Builders<AiBridgeRequest>.Filter.In(item => item.Status,
                    [AiBridgeStatuses.Pending, AiBridgeStatuses.Taken, AiBridgeStatuses.Rejected, AiBridgeStatuses.Submitted])),
            Builders<AiBridgeRequest>.Update
                .Set(item => item.Status, AiBridgeStatuses.Cancelled)
                .Set(item => item.CancelledAt, Now)
                .Set(item => item.LeaseExpiresAt, null)
                .Set(item => item.UpdatedAt, Now),
            cancellationToken: ct);
        return result.ModifiedCount;
    }

    public static async Task EnsureIndexesAsync(IMongoCollection<AiBridgeRequest> collection, CancellationToken ct = default)
    {
        await collection.Indexes.CreateManyAsync(new[]
        {
            new CreateIndexModel<AiBridgeRequest>(
                Builders<AiBridgeRequest>.IndexKeys.Ascending(item => item.RequestKey),
                new CreateIndexOptions { Unique = true, Name = "ux_aiBridgeRequests_requestKey" }),
            new CreateIndexModel<AiBridgeRequest>(
                Builders<AiBridgeRequest>.IndexKeys.Ascending(item => item.Status).Ascending(item => item.CreatedAt),
                new CreateIndexOptions { Name = "ix_aiBridgeRequests_status_createdAt" }),
            new CreateIndexModel<AiBridgeRequest>(
                Builders<AiBridgeRequest>.IndexKeys
                    .Ascending(item => item.OwnerType)
                    .Ascending(item => item.OwnerId)
                    .Ascending(item => item.CreatedAt),
                new CreateIndexOptions { Name = "ix_aiBridgeRequests_owner_createdAt" })
        }, ct);
    }
}
