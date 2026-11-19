namespace SirLocked.Api.Configurations;

/// <summary>
/// Safety switches for AI case generation (section <c>AiGeneration</c>). The server no longer calls any AI provider:
/// every text step is answered by the Claude bot through the bridge queue. These switches keep the deterministic
/// mock path for tests and the local demo, and still block assets/import where an operator asks for it.
/// </summary>
public class AiGenerationSettings
{
    /// <summary>Plans the calls but answers every step with mock JSON and never creates bridge requests.</summary>
    public bool AiDryRun { get; set; }
    /// <summary>Answers every step with deterministic mock JSON instead of waiting for Claude.</summary>
    public bool MockAiResponses { get; set; }
    public bool SkipAssetGeneration { get; set; }
    public bool DisableAutoPublish { get; set; }
    public bool GenerateJsonOnly { get; set; }
    public bool ValidateOnly { get; set; }
    public bool EnableBlindSolvabilityReview { get; set; }

    public bool BlocksAiCalls => AiDryRun || MockAiResponses;
    public bool BlocksAssetCalls => AiDryRun || SkipAssetGeneration || GenerateJsonOnly || ValidateOnly;
    public bool BlocksImportOrPublish => AiDryRun || DisableAutoPublish || ValidateOnly;
}

/// <summary>The bot-facing bridge API (section <c>Bridge</c>). The key only ever comes from <c>Bridge__Key</c>.</summary>
public class BridgeSettings
{
    public const int MinimumKeyLength = 32;

    public string Key { get; set; } = string.Empty;
    /// <summary>How long a taken request stays reserved for one bot session.</summary>
    public int LeaseHours { get; set; } = 2;
    /// <summary>Bridge calls allowed per minute per client address.</summary>
    public int RateLimitPerMinute { get; set; } = 240;
    /// <summary>Largest accepted upload for one image slot.</summary>
    public int MaxAssetBytes { get; set; } = 5 * 1024 * 1024;
    /// <summary>
    /// Development/Testing only: <c>take</c> also returns the deterministic mock answer so the smoke script can play the
    /// bot without Claude. Ignored in Production.
    /// </summary>
    public bool ExposeMockResponses { get; set; }
    /// <summary>
    /// Store uploaded images under <c>src/FE/public/assets/ai-generated/bridge</c> when Cloudinary is not configured.
    /// Ignored in Production, where uploads require Cloudinary.
    /// </summary>
    public bool AllowLocalAssetStorage { get; set; }
    /// <summary>Folder served as /assets for local storage; empty finds src/FE/public/assets above the API.</summary>
    public string LocalAssetRoot { get; set; } = string.Empty;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Key) && Key.Trim().Length >= MinimumKeyLength;
}
