using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public interface IPresentationStore
{
    Task EnsureIndexesAsync(CancellationToken ct = default) => Task.CompletedTask;
    Task<PresentationPackage?> GetPackageAsync(string draftId, CancellationToken ct = default);
    Task<bool> SavePackageAsync(PresentationPackage package, long expectedVersion, CancellationToken ct = default);
    Task InsertJobAsync(PresentationVideoJob job, CancellationToken ct = default);
    Task SaveJobAsync(PresentationVideoJob job, CancellationToken ct = default);
    Task<bool> TryTransitionJobAsync(PresentationVideoJob job, string expectedStatus, string? expectedClaim, CancellationToken ct = default);
    Task<PresentationVideoJob?> NextJobAsync(DateTime now, CancellationToken ct = default);
    Task<PresentationVideoJob?> GetJobAsync(string jobId, CancellationToken ct = default);
    Task<List<PresentationPackage>> GetPendingPackagesAsync(CancellationToken ct = default);
    Task SaveAssetAsync(PresentationMediaAsset asset, CancellationToken ct = default);
    Task<PresentationMediaAsset?> GetAssetAsync(string assetId, CancellationToken ct = default);
    Task<bool> AcquireLeaseAsync(string owner, DateTime now, CancellationToken ct = default);
    Task ReleaseLeaseAsync(string owner, CancellationToken ct = default);
}

public sealed class MongoPresentationStore(MongoDbContext db) : IPresentationStore
{
    private IMongoCollection<PresentationPackage> Packages => db.Database.GetCollection<PresentationPackage>("presentationPackages");
    private IMongoCollection<PresentationVideoJob> Jobs => db.Database.GetCollection<PresentationVideoJob>("presentationVideoJobs");
    private IMongoCollection<PresentationMediaAsset> Assets => db.Database.GetCollection<PresentationMediaAsset>("presentationMediaAssets");
    private IMongoCollection<PresentationWorkerLease> Leases => db.Database.GetCollection<PresentationWorkerLease>("presentationWorkerLeases");
    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await Jobs.Indexes.CreateManyAsync([
            new(Builders<PresentationVideoJob>.IndexKeys.Ascending(job => job.Status).Ascending(job => job.CreatedAt)),
            new(Builders<PresentationVideoJob>.IndexKeys.Ascending(job => job.DraftId).Ascending(job => job.GenerationId))
        ], ct);
        await Packages.Indexes.CreateOneAsync(new CreateIndexModel<PresentationPackage>(Builders<PresentationPackage>.IndexKeys.Ascending(package => package.Status)), cancellationToken: ct);
        await Assets.Indexes.CreateOneAsync(new CreateIndexModel<PresentationMediaAsset>(Builders<PresentationMediaAsset>.IndexKeys.Ascending(asset => asset.DraftId)), cancellationToken: ct);
    }
    public Task<PresentationPackage?> GetPackageAsync(string draftId, CancellationToken ct = default) =>
        Packages.Find(package => package.Id == draftId).FirstOrDefaultAsync(ct)!;
    public async Task<bool> SavePackageAsync(PresentationPackage package, long expectedVersion, CancellationToken ct = default)
    {
        package.UpdatedAt = DateTime.UtcNow;
        package.Version = expectedVersion + 1;
        if (expectedVersion == 0)
        {
            try { await Packages.InsertOneAsync(package, cancellationToken: ct); return true; }
            catch (MongoWriteException e) when (e.WriteError.Category == ServerErrorCategory.DuplicateKey) { return false; }
        }
        var result = await Packages.ReplaceOneAsync(current => current.Id == package.Id && current.Version == expectedVersion, package, cancellationToken: ct);
        return result.ModifiedCount == 1;
    }
    public async Task InsertJobAsync(PresentationVideoJob job, CancellationToken ct = default)
    {
        try { await Jobs.InsertOneAsync(job, cancellationToken: ct); }
        catch (MongoWriteException e) when (e.WriteError.Category == ServerErrorCategory.DuplicateKey) { }
    }
    public async Task SaveJobAsync(PresentationVideoJob job, CancellationToken ct = default)
    {
        job.UpdatedAt = DateTime.UtcNow;
        var expectedRevision = job.Revision;
        job.Revision++;
        var result = await Jobs.ReplaceOneAsync(current => current.Id == job.Id && current.Revision == expectedRevision, job, cancellationToken: ct);
        if (result.ModifiedCount != 1)
        {
            job.Revision = expectedRevision;
            throw new PresentationJobConflictException();
        }
    }
    public async Task<bool> TryTransitionJobAsync(PresentationVideoJob job, string expectedStatus, string? expectedClaim, CancellationToken ct = default)
    {
        job.UpdatedAt = DateTime.UtcNow;
        var expectedRevision = job.Revision;
        job.Revision++;
        var result = await Jobs.ReplaceOneAsync(current => current.Id == job.Id && current.Status == expectedStatus
            && current.SubmissionClaim == expectedClaim && current.Revision == expectedRevision, job, cancellationToken: ct);
        if (result.ModifiedCount != 1) job.Revision = expectedRevision;
        return result.ModifiedCount == 1;
    }
    public Task<PresentationVideoJob?> GetJobAsync(string jobId, CancellationToken ct = default) => Jobs.Find(job => job.Id == jobId).FirstOrDefaultAsync(ct)!;
    public Task<List<PresentationPackage>> GetPendingPackagesAsync(CancellationToken ct = default) =>
        Packages.Find(package => package.Status == "GENERATING").ToListAsync(ct);
    public async Task<PresentationVideoJob?> NextJobAsync(DateTime now, CancellationToken ct = default)
    {
        // One provider job at a time across app instances. Unknown submissions block new spend.
        var active = await Jobs.Find(job => job.Status == "PREPARING" || job.Status == "SUBMITTING" || job.Status == "PENDING" || job.Status == "DOWNLOADING" || job.Status == "SETTLING" || job.Status == "SUBMISSION_UNKNOWN")
            .SortBy(job => job.CreatedAt).FirstOrDefaultAsync(ct);
        if (active is not null) return active.Status != "SUBMISSION_UNKNOWN" && active.NextPollAt <= now ? active : null;
        return await Jobs.Find(job => job.Status == "QUEUED" && job.NextPollAt <= now).SortBy(job => job.CreatedAt).FirstOrDefaultAsync(ct);
    }
    public Task SaveAssetAsync(PresentationMediaAsset asset, CancellationToken ct = default) =>
        Assets.ReplaceOneAsync(current => current.Id == asset.Id, asset, new ReplaceOptions { IsUpsert = true }, ct);
    public Task<PresentationMediaAsset?> GetAssetAsync(string assetId, CancellationToken ct = default) => Assets.Find(asset => asset.Id == assetId).FirstOrDefaultAsync(ct)!;
    public async Task<bool> AcquireLeaseAsync(string owner, DateTime now, CancellationToken ct = default)
    {
        try
        {
            var acquired = await Leases.FindOneAndUpdateAsync(lease => lease.Id == "video-worker" && (lease.ExpiresAt < now || lease.Owner == owner),
                Builders<PresentationWorkerLease>.Update.Set(lease => lease.Owner, owner).Set(lease => lease.ExpiresAt, now.AddMinutes(5)),
                new FindOneAndUpdateOptions<PresentationWorkerLease> { IsUpsert = true, ReturnDocument = ReturnDocument.After }, ct);
            return acquired?.Owner == owner;
        }
        catch (MongoCommandException e) when (e.Code == 11000) { return false; }
        catch (MongoWriteException e) when (e.WriteError.Category == ServerErrorCategory.DuplicateKey) { return false; }
    }
    public Task ReleaseLeaseAsync(string owner, CancellationToken ct = default) =>
        Leases.DeleteOneAsync(lease => lease.Id == "video-worker" && lease.Owner == owner, ct);
}

public sealed class PresentationJobConflictException : Exception
{
    public PresentationJobConflictException() : base("The presentation job was advanced by another worker.") { }
}
