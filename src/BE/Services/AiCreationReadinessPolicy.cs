using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs.Ai;

namespace SirLocked.Api.Services;

/// <summary>Configuration-only admission checks. No provider calls, reservations or credential values.</summary>
internal static class AiCreationReadinessPolicy
{
    internal static List<AiCreationBlockerResponse> Evaluate(
        OpenAiSettings provider, AiQuotaSettings quota, CloudinarySettings storage,
        AiUsageSettings usage, bool requiresUsagePrices = true, bool includeSemanticReview = true)
    {
        if (provider.BlocksAiCalls) return [];
        var blockers = new List<AiCreationBlockerResponse>();
        if (!provider.HasApiKey)
            blockers.Add(new("AI_PROVIDER_UNCONFIGURED", "Configure the AI provider before creating a case.", "ai.provider.unconfigured"));
        if (!quota.Enabled || quota.MaxActiveDraftsPerUser <= 0 || quota.MaxCasesPerUserPerDay <= 0
            || quota.EstimatedCaseCostUsd <= 0 || quota.GlobalBudgetUsd <= 0)
            blockers.Add(new("AI_QUOTA_UNCONFIGURED", "Enable AI quota and configure positive creation limits and a budget.", "ai.quota.unconfigured"));
        if (!provider.BlocksAssetCalls && (!storage.Enabled || string.IsNullOrWhiteSpace(storage.CloudName)
            || string.IsNullOrWhiteSpace(storage.ApiKey) || string.IsNullOrWhiteSpace(storage.ApiSecret)))
            blockers.Add(new("AI_ASSET_STORAGE_UNCONFIGURED", "Configure asset storage before generating case images.", "ai.assetStorage.unconfigured"));

        if (requiresUsagePrices)
        {
            var models = new List<(string Model, bool Image)>
            {
                (provider.LogicModel, false)
            };
            if (includeSemanticReview) models.Add((provider.EffectiveSemanticReviewModel, false));
            if (!provider.BlocksAssetCalls)
            {
                models.Add((provider.ImageModel, true));
                models.Add((string.IsNullOrWhiteSpace(provider.CutoutImageModel) ? provider.ImageModel : provider.CutoutImageModel.Trim(), true));
            }
            if (string.IsNullOrWhiteSpace(usage.PriceVersion) || models.Distinct().Any(model => !HasPrice(usage, model.Model, model.Image)))
                blockers.Add(new("AI_USAGE_PRICE_REQUIRED", "Configure dated model prices and positive per-call reservations for the enabled generation steps.", "ai.usage.priceRequired"));
        }
        return blockers;
    }

    // Keep these configuration requirements aligned with AiUsageAccounting.BeforeCallAsync.
    // Accounting remains authoritative for each request and for remaining global/draft budgets.
    private static bool HasPrice(AiUsageSettings usage, string model, bool image) =>
        !string.IsNullOrWhiteSpace(model) && usage.Models.TryGetValue(model, out var price)
        && price.ReservationUsd > 0 && price.InputPerMillionUsd is >= 0 && price.OutputPerMillionUsd is >= 0
        && price.CachedInputPerMillionUsd is not < 0 && price.CacheWritePerMillionUsd is not < 0
        && price.ImageInputPerMillionUsd is not < 0 && price.ImageOutputPerMillionUsd is not < 0
        && (!image || (price.ImageInputPerMillionUsd is >= 0 && price.ImageOutputPerMillionUsd is >= 0));
}
