using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs.Ai;

namespace SirLocked.Api.Services;

/// <summary>
/// Configuration-only admission checks. The server calls no AI provider: a draft can be created when the Claude
/// bridge has its key (or the mock/dry-run mode answers every step). No credential value is ever returned.
/// </summary>
internal static class AiCreationReadinessPolicy
{
    internal static List<AiCreationBlockerResponse> Evaluate(AiGenerationSettings generation, BridgeSettings bridge)
    {
        if (generation.BlocksAiCalls) return [];
        var blockers = new List<AiCreationBlockerResponse>();
        if (!bridge.IsConfigured)
            blockers.Add(new(
                "BRIDGE_NOT_CONFIGURED",
                "The Claude bridge key is not configured on the server yet, so no bot can take the order.",
                "ai.bridge.notConfigured",
                "Máy chủ chưa có khóa bridge của Claude nên chưa bot nào nhận được đơn. Đặt khóa bằng scripts/set-bridge-key.sh."));
        return blockers;
    }

    /// <summary>Uploads need Cloudinary (or local storage outside Production); this never blocks an order.</summary>
    internal static bool AssetStorageReady(CloudinarySettings storage, bool allowLocalAssetStorage) =>
        allowLocalAssetStorage
        || (storage.Enabled && !string.IsNullOrWhiteSpace(storage.CloudName)
            && !string.IsNullOrWhiteSpace(storage.ApiKey) && !string.IsNullOrWhiteSpace(storage.ApiSecret));
}
