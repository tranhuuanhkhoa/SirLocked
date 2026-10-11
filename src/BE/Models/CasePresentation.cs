using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

/// <summary>Optional, approved presentation content. Asset IDs never contain provider URLs.</summary>
public class CasePresentation
{
    public string Version { get; set; } = "1";
    public string PackageId { get; set; } = string.Empty;
    public List<PresentationClip> Clips { get; set; } = new();
}

public class CharacterVisualPresentation
{
    public CharacterSpriteSheet? SpriteSheet { get; set; }
}
public class CharacterSpriteSheet
{
    public string Url { get; set; } = string.Empty;
    public int FrameWidth { get; set; }
    public int FrameHeight { get; set; }
    public int FrameCount { get; set; }
    public int Fps { get; set; } = 4;
    public List<int> IdleFrames { get; set; } = new();
    public double AnchorX { get; set; } = .5;
    public double AnchorY { get; set; } = 1;
}

public class PresentationClip
{
    public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = "INTRO";
    public string? TargetId { get; set; }
    public string Caption { get; set; } = string.Empty;
    public string Speaker { get; set; } = string.Empty;
    public string? PosterAssetId { get; set; }
    public string? VideoAssetId { get; set; }
    public int DurationSeconds { get; set; } = 4;
}

public class PresentationPackage
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string OwnerUserId { get; set; } = string.Empty;
    public string CaseFingerprint { get; set; } = string.Empty;
    public long Version { get; set; } = 1;
    public string Status { get; set; } = "DRAFT";
    public string GenerationId { get; set; } = string.Empty;
    public List<string> GenerationClipIds { get; set; } = new();
    public decimal ApprovedBudgetUsd { get; set; }
    public string PricingVersion { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public decimal PricePerSecondUsd { get; set; }
    public string Resolution { get; set; } = "480p";
    public List<PresentationStoryboardClip> Clips { get; set; } = new();
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class PresentationStoryboardClip : PresentationClip
{
    public string SourceImageUrl { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public bool GenerateVideo { get; set; } = true;
    public string Status { get; set; } = "DRAFT";
    public string? JobId { get; set; }
    public bool Approved { get; set; }
    public string? ErrorCode { get; set; }
}

public class PresentationVideoJob
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public long Revision { get; set; }
    public string DraftId { get; set; } = string.Empty;
    public string GenerationId { get; set; } = string.Empty;
    public string ClipId { get; set; } = string.Empty;
    public string Status { get; set; } = "QUEUED";
    public string? SubmissionClaim { get; set; }
    public string Model { get; set; } = string.Empty;
    public string Resolution { get; set; } = "480p";
    public string PricingVersion { get; set; } = string.Empty;
    public decimal ReservedUsd { get; set; }
    public AiCallLease? UsageLease { get; set; }
    public string? ProviderRequestId { get; set; }
    public string? ProviderVideoUrl { get; set; }
    public string? ProviderTerminalBody { get; set; }
    public int? ProviderTerminalStatusCode { get; set; }
    public string? ErrorCode { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime NextPollAt { get; set; } = DateTime.UtcNow;
}

public class PresentationMediaAsset
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string DraftId { get; set; } = string.Empty;
    public string JobId { get; set; } = string.Empty;
    public string PublicId { get; set; } = string.Empty;
    public string ResourceType { get; set; } = "video";
    public string Format { get; set; } = "mp4";
    public string ContentType { get; set; } = "video/mp4";
    public long Bytes { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public double? DurationSeconds { get; set; }
    public string Sha256 { get; set; } = string.Empty;
    public string ApprovalStatus { get; set; } = "AWAITING_APPROVAL";
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}

public class PresentationWorkerLease
{
    [BsonId] public string Id { get; set; } = "video-worker";
    public string Owner { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
}
