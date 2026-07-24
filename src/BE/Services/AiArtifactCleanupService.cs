using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class AiArtifactCleanupService : IAiArtifactCleanupService
{
    private static readonly HashSet<string> FailedStatuses = new(StringComparer.Ordinal)
    {
        AiDraftStatus.GeneratedInvalid,
        AiDraftStatus.CaseTruthInvalid
    };
    private readonly MongoDbContext _db;
    private readonly IWebHostEnvironment _environment;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<AiArtifactCleanupService> _logger;

    public AiArtifactCleanupService(
        MongoDbContext db,
        IWebHostEnvironment environment,
        TimeProvider timeProvider,
        ILogger<AiArtifactCleanupService> logger)
    {
        _db = db;
        _environment = environment;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    public async Task<AiArtifactCleanupReport> CleanupAsync(
        bool apply,
        int olderThanDays,
        CancellationToken cancellationToken = default)
    {
        olderThanDays = Math.Clamp(olderThanDays, 1, 3650);
        var cutoff = _timeProvider.GetUtcNow().UtcDateTime.AddDays(-olderThanDays);
        var drafts = await _db.AiCaseDrafts.Find(_ => true).ToListAsync(cancellationToken);
        var protectedPaths = drafts
            .Where(draft => !FailedStatuses.Contains(draft.Status))
            .SelectMany(ArtifactPaths)
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(Path.GetFullPath)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var generatedJsonRoot = Path.GetFullPath(Path.Combine(_environment.ContentRootPath, "GeneratedCaseJson"));
        var generatedAssetsRoot = Path.GetFullPath(Path.Combine(
            _environment.ContentRootPath, "..", "FE", "public", "assets", "ai-generated"));
        var report = new AiArtifactCleanupReport { Applied = apply, OlderThanDays = olderThanDays };
        var candidateDrafts = drafts
            .Where(draft => FailedStatuses.Contains(draft.Status)
                && draft.UpdatedAt <= cutoff
                && draft.QueueState is not (AiQueueStates.Pending or AiQueueStates.Running or AiQueueStates.RetryScheduled))
            .ToList();
        report.CandidateDraftCount = candidateDrafts.Count;

        foreach (var draft in candidateDrafts)
        {
            foreach (var rawPath in ArtifactPaths(draft).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(rawPath)) continue;
                var path = Path.GetFullPath(rawPath);
                if (protectedPaths.Any(protectedPath =>
                        string.Equals(protectedPath, path, StringComparison.OrdinalIgnoreCase)
                        || IsInside(protectedPath, path)
                        || IsInside(path, protectedPath))
                    || !IsInside(path, generatedJsonRoot) && !IsInside(path, generatedAssetsRoot))
                    continue;
                if (!Directory.Exists(path) && !File.Exists(path)) continue;

                var bytes = Directory.Exists(path)
                    ? Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories)
                        .Sum(file => new FileInfo(file).Length)
                    : new FileInfo(path).Length;
                var entry = new AiArtifactCleanupEntry
                {
                    DraftId = draft.Id,
                    Status = draft.Status,
                    ArtifactReference = RelativeReference(path, generatedJsonRoot, generatedAssetsRoot),
                    Bytes = bytes
                };
                if (apply)
                {
                    if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
                    else File.Delete(path);
                    entry.Deleted = true;
                    _logger.LogInformation("Deleted stale AI artifact {ArtifactPath} for draft {DraftId}.", path, draft.Id);
                }
                report.Entries.Add(entry);
                report.CandidateBytes += bytes;
            }
        }
        return report;
    }

    private static IEnumerable<string> ArtifactPaths(AiCaseDraft draft)
    {
        if (!string.IsNullOrWhiteSpace(draft.JsonFolderPath)) yield return draft.JsonFolderPath;
        else if (!string.IsNullOrWhiteSpace(draft.JsonFilePath)) yield return draft.JsonFilePath;
        if (!string.IsNullOrWhiteSpace(draft.AssetManifest.AssetRootPath)) yield return draft.AssetManifest.AssetRootPath;
    }

    private static bool IsInside(string path, string root)
    {
        var normalizedRoot = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        return path.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
    }

    private static string RelativeReference(string path, string jsonRoot, string assetsRoot)
    {
        if (IsInside(path, jsonRoot)) return $"GeneratedCaseJson/{Path.GetRelativePath(jsonRoot, path).Replace('\\', '/')}";
        return $"assets/ai-generated/{Path.GetRelativePath(assetsRoot, path).Replace('\\', '/')}";
    }
}
