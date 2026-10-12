using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>Persistent, single-provider-job orchestration. Never retries an ambiguous POST.</summary>
public sealed class PresentationVideoProcessor(
    IPresentationStore store, IPresentationVideoProvider provider, IPresentationMediaStorage media,
    IAiUsageAccounting accounting, IOptions<PresentationVideoSettings> options,
    IOptions<AiQuotaSettings> quota, IOptions<AiUsageSettings> usage)
{
    public async Task ProcessNextAsync(string owner, CancellationToken ct)
    {
        if (!await store.AcquireLeaseAsync(owner, DateTime.UtcNow, ct)) return;
        using var leaseLifetime = CancellationTokenSource.CreateLinkedTokenSource(ct);
        ct = leaseLifetime.Token;
        var heartbeat = RenewLeaseAsync(owner, leaseLifetime);
        try
        {
            foreach (var package in await store.GetPendingPackagesAsync(ct))
            {
                await PresentationService.EnsureJobsAsync(package, store, ct);
                foreach (var queuedClip in package.Clips.Where(clip => clip.JobId is not null))
                {
                    var storedJob = await store.GetJobAsync(queuedClip.JobId!, ct);
                    if (storedJob is not null && storedJob.Status != queuedClip.Status)
                        await SyncPackageAsync(storedJob, ct);
                }
            }
            var job = await store.NextJobAsync(DateTime.UtcNow, ct);
            if (job is null) return;
            var packageState = await store.GetPackageAsync(job.DraftId, ct);
            var clip = packageState?.Clips.FirstOrDefault(clip => clip.Id == job.ClipId && clip.JobId == job.Id);
            if (clip is null || packageState!.GenerationId != job.GenerationId)
            {
                job.Status = "CANCELLED";
                await store.SaveJobAsync(job, ct);
                return;
            }
            try
            {
                await ProcessAsync(job, clip, ct);
            }
            catch (PresentationJobConflictException) { /* Reload below; never overwrite a newer provider ID. */ }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception)
            {
                // Do not expose provider messages, prompts, credentials or signed media URLs.
                if (job.Status is "SUBMITTING" or "SUBMISSION_UNKNOWN")
                {
                    job.Status = "SUBMISSION_UNKNOWN";
                    job.ErrorCode = "PROVIDER_SUBMISSION_UNKNOWN";
                    await store.SaveJobAsync(job, ct);
                    if (job.UsageLease is not null)
                    {
                        try { await accounting.RecordAsync(job.UsageLease, null, null, ct); }
                        catch (Exception) when (!ct.IsCancellationRequested) { /* The reservation remains held for recovery. */ }
                    }
                }
                else if (job.Status is "PENDING" or "DOWNLOADING" or "SETTLING")
                {
                    job.NextPollAt = DateTime.UtcNow.AddSeconds(Math.Max(5, options.Value.PollSeconds));
                    job.ErrorCode = "MEDIA_RETRY_PENDING";
                }
                else
                {
                    job.Status = "FAILED";
                    job.ErrorCode = "MEDIA_GENERATION_FAILED";
                }
                await store.SaveJobAsync(job, ct);
            }
            await SyncPackageAsync(await store.GetJobAsync(job.Id, ct) ?? job, ct);
        }
        finally
        {
            leaseLifetime.Cancel();
            try { await heartbeat.WaitAsync(TimeSpan.FromSeconds(15)); }
            catch (OperationCanceledException) { }
            catch (TimeoutException) { }
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            try { await store.ReleaseLeaseAsync(owner, cleanup.Token); }
            catch (OperationCanceledException) when (cleanup.IsCancellationRequested) { }
        }
    }

    private async Task RenewLeaseAsync(string owner, CancellationTokenSource lifetime)
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(30), lifetime.Token);
                if (!await store.AcquireLeaseAsync(owner, DateTime.UtcNow, lifetime.Token))
                { lifetime.Cancel(); return; }
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception) { lifetime.Cancel(); }
    }

    private async Task ProcessAsync(PresentationVideoJob job, PresentationStoryboardClip clip, CancellationToken ct)
    {
        if (job.Status == "PREPARING")
        {
            // No provider call is allowed until the next atomic transition succeeds.
            var claim = job.SubmissionClaim;
            job.Status = "FAILED";
            job.ErrorCode = "GENERATION_INTERRUPTED_BEFORE_SUBMISSION";
            await store.TryTransitionJobAsync(job, "PREPARING", claim, ct);
            return;
        }
        if (job.Status == "SUBMITTING")
        {
            // A process died after durable intent but before durable provider ID. No automatic POST.
            job.Status = "SUBMISSION_UNKNOWN";
            job.ErrorCode = "PROVIDER_SUBMISSION_UNKNOWN";
            await store.SaveJobAsync(job, ct);
            if (job.UsageLease is not null) await accounting.RecordAsync(job.UsageLease, null, null, ct);
            return;
        }
        if (job.Status == "QUEUED")
        {
            if (clip.GenerateVideo && (!options.Value.Enabled || !options.Value.HasPricing
                || !quota.Value.Enabled || quota.Value.GlobalBudgetUsd <= 0 || usage.Value.MaxDraftUsd <= 0))
            {
                job.Status = "FAILED";
                job.ErrorCode = "VIDEO_BUDGET_CONFIGURATION_REQUIRED";
                await store.SaveJobAsync(job, ct);
                return;
            }
            if (clip.GenerateVideo && (job.PricingVersion != options.Value.PricingVersion
                || job.Model != options.Value.Model || job.Resolution != options.Value.Resolution
                || job.ReservedUsd != clip.DurationSeconds * options.Value.PricePerSecondUsd))
            {
                job.Status = "FAILED";
                job.ErrorCode = "VIDEO_QUOTE_EXPIRED";
                await store.SaveJobAsync(job, ct);
                return;
            }
            var previousClaim = job.SubmissionClaim;
            job.SubmissionClaim = Guid.NewGuid().ToString("N");
            job.Status = "PREPARING";
            if (!await store.TryTransitionJobAsync(job, "QUEUED", previousClaim, ct)) return;
            var source = await media.ReadSourceAsync(clip.SourceImageUrl, ct);
            if (await store.GetAssetAsync($"{job.Id}-poster", ct) is null)
                await store.SaveAssetAsync(await media.UploadPosterAsync(job, source, ct), ct);
            if (!clip.GenerateVideo)
            {
                job.Status = "READY";
                await store.SaveJobAsync(job, ct);
                return;
            }
            // The accounting lease is separate from the flat case reservation and survives polling.
            job.UsageLease ??= await accounting.BeforeCallAsync(job.DraftId, $"presentation:{job.ClipId}", "video", job.Model,
                ct, job.ReservedUsd, priceVersion: job.PricingVersion);
            job.Status = "SUBMITTING";
            if (!await store.TryTransitionJobAsync(job, "PREPARING", job.SubmissionClaim, ct)) return;
            var response = await provider.SubmitAsync(clip, $"data:{source.ContentType};base64,{Convert.ToBase64String(source.Bytes)}", job.Model, ct);
            if (response.Status == "unknown")
            {
                job.Status = "SUBMISSION_UNKNOWN";
                job.ErrorCode = "PROVIDER_SUBMISSION_UNKNOWN";
                await store.SaveJobAsync(job, ct);
                await accounting.RecordAsync(job.UsageLease, null, response.StatusCode, ct);
                return;
            }
            if (response.Status == "rejected")
            {
                job.Status = "SETTLING";
                job.ErrorCode = "PROVIDER_REJECTED";
                job.ProviderTerminalBody = response.Body;
                job.ProviderTerminalStatusCode = response.StatusCode;
                await store.SaveJobAsync(job, ct);
                await FinishFailureAsync(job, ct);
                return;
            }
            job.ProviderRequestId = response.RequestId;
            job.Status = "PENDING";
            job.NextPollAt = DateTime.UtcNow.AddSeconds(Math.Max(5, options.Value.PollSeconds));
            await store.SaveJobAsync(job, ct); // Persist the ID before any poll or storage work.
            return;
        }
        if (job.Status == "PENDING")
        {
            if (DateTime.UtcNow - job.CreatedAt > TimeSpan.FromMinutes(Math.Max(1, options.Value.JobTimeoutMinutes)))
            {
                // Timeouts with a known ID are recoverable by continuing this same job; never rePOST.
                job.Status = "SUBMISSION_UNKNOWN";
                job.ErrorCode = "PROVIDER_POLL_TIMEOUT";
                await store.SaveJobAsync(job, ct);
                if (job.UsageLease is not null) await accounting.RecordAsync(job.UsageLease, null, null, ct);
                return;
            }
            var response = await provider.PollAsync(job.ProviderRequestId!, ct);
            job.NextPollAt = DateTime.UtcNow.AddSeconds(Math.Max(5, options.Value.PollSeconds));
            if (response.Status == "done" && !string.IsNullOrWhiteSpace(response.VideoUrl))
            {
                job.ProviderVideoUrl = response.VideoUrl;
                job.ProviderTerminalBody = response.Body;
                job.ProviderTerminalStatusCode = response.StatusCode;
                job.Status = "DOWNLOADING";
                await store.SaveJobAsync(job, ct);
            }
            else if (response.Status is "failed" or "expired")
            {
                job.Status = "SETTLING";
                job.ErrorCode = response.Status == "expired" ? "PROVIDER_EXPIRED" : "PROVIDER_FAILED";
                job.ProviderTerminalBody = response.Body;
                job.ProviderTerminalStatusCode = response.StatusCode;
                await store.SaveJobAsync(job, ct);
                await FinishFailureAsync(job, ct);
                return;
            }
            else { await store.SaveJobAsync(job, ct); return; }
        }
        if (job.Status == "DOWNLOADING")
        {
            if (DateTime.UtcNow - job.CreatedAt > TimeSpan.FromMinutes(Math.Max(1, options.Value.JobTimeoutMinutes)))
            {
                job.Status = "SETTLING";
                job.ErrorCode = "MEDIA_STORAGE_TIMEOUT";
                await store.SaveJobAsync(job, ct);
                await FinishFailureAsync(job, ct);
                return;
            }
            if (await store.GetAssetAsync($"{job.Id}-video", ct) is null)
                await store.SaveAssetAsync(await media.UploadVideoAsync(job, job.ProviderVideoUrl!, ct), ct);
            if (job.UsageLease is not null) await accounting.RecordAsync(job.UsageLease, job.ProviderTerminalBody, 200, ct);
            job.Status = "READY";
            job.ErrorCode = null;
            job.ProviderVideoUrl = null;
            job.ProviderTerminalBody = null;
            await store.SaveJobAsync(job, ct);
        }
        if (job.Status == "SETTLING") await FinishFailureAsync(job, ct);
    }

    private async Task FinishFailureAsync(PresentationVideoJob job, CancellationToken ct)
    {
        if (job.UsageLease is not null) await accounting.RecordAsync(job.UsageLease, job.ProviderTerminalBody, job.ProviderTerminalStatusCode, ct);
        job.Status = "FAILED";
        job.ProviderTerminalBody = null;
        job.ProviderVideoUrl = null;
        await store.SaveJobAsync(job, ct);
    }

    private async Task SyncPackageAsync(PresentationVideoJob job, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var package = await store.GetPackageAsync(job.DraftId, ct);
            var clip = package?.Clips.FirstOrDefault(clip => clip.JobId == job.Id);
            if (clip is null) return;
            var poster = await store.GetAssetAsync($"{job.Id}-poster", ct);
            var video = await store.GetAssetAsync($"{job.Id}-video", ct);
            clip.PosterAssetId = poster?.Id;
            clip.VideoAssetId = video?.Id;
            clip.Status = job.Status == "FAILED" && poster is not null ? "FALLBACK_READY" : job.Status;
            clip.ErrorCode = job.ErrorCode;
            if (package!.Clips.All(clip => clip.Status is "READY" or "FALLBACK_READY" or "FAILED" or "SUBMISSION_UNKNOWN"))
                package.Status = package.Clips.Any(clip => clip.Status == "SUBMISSION_UNKNOWN") ? "NEEDS_RECOVERY" : "AWAITING_APPROVAL";
            if (await store.SavePackageAsync(package, package.Version, ct)) return;
        }
    }
}

public sealed class PresentationVideoWorker(IServiceScopeFactory scopes, IOptions<PresentationVideoSettings> settings,
    IOptions<OpenAiSettings> safety, ILogger<PresentationVideoWorker> logger) : BackgroundService
{
    private readonly string _owner = Guid.NewGuid().ToString("N");
    private bool _indexesReady;
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (settings.Value.Enabled && !safety.Value.BlocksAssetCalls && !safety.Value.MockAiResponses)
                {
                    using var scope = scopes.CreateScope();
                    if (!_indexesReady)
                    {
                        await scope.ServiceProvider.GetRequiredService<IPresentationStore>().EnsureIndexesAsync(stoppingToken);
                        _indexesReady = true;
                    }
                    await scope.ServiceProvider.GetRequiredService<PresentationVideoProcessor>().ProcessNextAsync(_owner, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { logger.LogWarning("Presentation worker will retry after {ErrorType}.", exception.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(2, settings.Value.PollSeconds)), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
