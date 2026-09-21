namespace SirLocked.Api.Services.Interfaces;

public interface IAiArtifactCleanupService
{
    Task<AiArtifactCleanupReport> CleanupAsync(
        bool apply,
        int olderThanDays,
        CancellationToken cancellationToken = default);
}

public sealed class AiArtifactCleanupReport
{
    public bool Applied { get; set; }
    public int OlderThanDays { get; set; }
    public int CandidateDraftCount { get; set; }
    public long CandidateBytes { get; set; }
    public List<AiArtifactCleanupEntry> Entries { get; set; } = new();
}

public sealed class AiArtifactCleanupEntry
{
    public string DraftId { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string ArtifactReference { get; set; } = string.Empty;
    public long Bytes { get; set; }
    public bool Deleted { get; set; }
}
