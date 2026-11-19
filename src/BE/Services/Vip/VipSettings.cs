using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Vip;

/// <summary>How fast a VIP order runs: Messages API calls, or the Message Batches API at half the token price.</summary>
public static class VipSpeeds
{
    /// <summary>"Nhanh": ordinary calls, a case in about 1–2 hours.</summary>
    public const string Fast = "FAST";
    /// <summary>"Tiết kiệm": Message Batches, about half the token cost, answers within 24 hours.</summary>
    public const string Saver = "SAVER";

    public static readonly IReadOnlyList<string> All = [Fast, Saver];

    public static string Normalize(string? value) =>
        string.Equals(value?.Trim(), Saver, StringComparison.OrdinalIgnoreCase) ? Saver : Fast;

    public static bool IsKnown(string? value) =>
        All.Contains(value?.Trim().ToUpperInvariant() ?? string.Empty, StringComparer.Ordinal);
}

/// <summary>The models the VIP lane may use (ADMIN picks among them). Only exact current model ids.</summary>
public static class VipModelIds
{
    public const string Haiku = "claude-haiku-5-5";
    public const string Sonnet = "claude-sonnet-5-5";
    public const string Opus = "claude-opus-5-5";

    public static readonly IReadOnlyList<string> Allowed = [Haiku, Sonnet, Opus];
}

/// <summary>One preset's price in coins (part 1 of VUAN-7) and the estimated cost behind it, in VND.</summary>
public sealed class VipPresetPrice
{
    public string Preset { get; set; } = AiGenerationPresets.NormalRandom;
    public long FastXu { get; set; }
    public long SaverXu { get; set; }
    /// <summary>Estimated cost (Claude API + PixelLab) of one order at "Nhanh", in VND. The cost cap is a multiple of it.</summary>
    public long FastCostVnd { get; set; }
    public long SaverCostVnd { get; set; }
}

/// <summary><c>aiVipPricing</c>: what a VIP order costs and how coins relate to money.</summary>
[BsonIgnoreExtraElements]
public class VipPricingSettings
{
    public const string DocumentId = "aiVipPricing";
    [BsonId] public string Id { get; set; } = DocumentId;
    public List<VipPresetPrice> Presets { get; set; } = DefaultPresets();
    /// <summary>Each PixelLab generation above the included 30 (the VIP may order up to <see cref="VipMaxPixelLabCap"/>).</summary>
    public long ExtraPixelLabGenerationXu { get; set; } = 15;
    public int VipMaxPixelLabCap { get; set; } = 60;
    public decimal UsdToVnd { get; set; } = 26_500m;
    /// <summary>1 xu = 10 VND (the payOS starter pack: 10.000 VND = 1.000 xu).</summary>
    public int VndPerXu { get; set; } = 10;
    /// <summary>An order stops and is refunded once its Claude spend reaches this multiple of its estimated cost.</summary>
    public decimal CostCapMultiplier { get; set; } = 2m;
    /// <summary>Largest share of an order's price bonus coins may pay (0 = ordinary coins only; at most 0.3).</summary>
    public decimal MaxBonusShare { get; set; }
    /// <summary>
    /// Whether VIP orders may use new PixelLab pictures. Off until a no-AI PixelLab runner is proven on the studio VPS:
    /// VIP pictures then come from the library and variants only (the plan's cap is 0, no extra pictures are sold).
    /// </summary>
    public bool PixelLabEnabled { get; set; }
    /// <summary>PixelLab Tier 2: about 24 USD for 5.000 generations.</summary>
    public long PixelLabVndPerGeneration { get; set; } = 130;
    public DateTime? UpdatedAt { get; set; }
    public string UpdatedByUserId { get; set; } = string.Empty;

    public static List<VipPresetPrice> DefaultPresets() =>
    [
        new() { Preset = AiGenerationPresets.ShortDemo, FastXu = 5_000, SaverXu = 2_500, FastCostVnd = 41_000, SaverCostVnd = 22_000 },
        new() { Preset = AiGenerationPresets.NormalRandom, FastXu = 8_000, SaverXu = 4_500, FastCostVnd = 68_000, SaverCostVnd = 36_000 },
        new() { Preset = AiGenerationPresets.PuzzleHeavy, FastXu = 9_500, SaverXu = 5_000, FastCostVnd = 81_000, SaverCostVnd = 42_000 },
        new() { Preset = AiGenerationPresets.DialogueHeavy, FastXu = 9_500, SaverXu = 5_000, FastCostVnd = 81_000, SaverCostVnd = 42_000 },
        new() { Preset = AiGenerationPresets.FullFeature, FastXu = 14_000, SaverXu = 7_500, FastCostVnd = 117_000, SaverCostVnd = 62_000 },
        // Not in the price table of part 1: priced like the heavy presets until Yen decides.
        new() { Preset = AiGenerationPresets.CrackTheLieV3, FastXu = 9_500, SaverXu = 5_000, FastCostVnd = 81_000, SaverCostVnd = 42_000 }
    ];

    public VipPresetPrice PresetPrice(string? preset) =>
        Presets.FirstOrDefault(item => string.Equals(item.Preset, preset, StringComparison.OrdinalIgnoreCase))
        ?? Presets.FirstOrDefault(item => item.Preset == AiGenerationPresets.NormalRandom)
        ?? DefaultPresets()[1];
}

/// <summary>Token prices of one model, USD per million tokens (cache write = 5-minute cache).</summary>
public sealed class VipModelPrice
{
    public string Model { get; set; } = string.Empty;
    public decimal InputUsdPerMTok { get; set; }
    public decimal OutputUsdPerMTok { get; set; }
    public decimal CacheReadUsdPerMTok { get; set; }
    public decimal CacheWriteUsdPerMTok { get; set; }
}

/// <summary><c>aiVipModels</c>: which model writes which step (part 3 of VUAN-7). ADMIN may move a step to another model.</summary>
[BsonIgnoreExtraElements]
public class VipModelSettings
{
    public const string DocumentId = "aiVipModels";
    [BsonId] public string Id { get; set; } = DocumentId;
    /// <summary>Light work: the order brief and content check, JSON format repairs.</summary>
    public string Light { get; set; } = VipModelIds.Haiku;
    /// <summary>The main writer of every other step, cutscenes included.</summary>
    public string Main { get; set; } = VipModelIds.Sonnet;
    /// <summary>Rescue: the third try of a step the main model failed twice.</summary>
    public string Rescue { get; set; } = VipModelIds.Opus;
    public int RescueFromAttempt { get; set; } = 3;
    /// <summary>Step name prefix → model id (for example <c>PlanScenePlacement</c> → Opus). The longest prefix wins.</summary>
    public Dictionary<string, string> StepOverrides { get; set; } = new(StringComparer.Ordinal);
    public List<VipModelPrice> Prices { get; set; } = DefaultPrices();
    public DateTime? UpdatedAt { get; set; }
    public string UpdatedByUserId { get; set; } = string.Empty;

    public static List<VipModelPrice> DefaultPrices() =>
    [
        new() { Model = VipModelIds.Haiku, InputUsdPerMTok = 0.10m, OutputUsdPerMTok = 0.50m, CacheReadUsdPerMTok = 0.01m, CacheWriteUsdPerMTok = 0.125m },
        new() { Model = VipModelIds.Sonnet, InputUsdPerMTok = 2m, OutputUsdPerMTok = 10m, CacheReadUsdPerMTok = 0.10m, CacheWriteUsdPerMTok = 2.5m },
        new() { Model = VipModelIds.Opus, InputUsdPerMTok = 4m, OutputUsdPerMTok = 20m, CacheReadUsdPerMTok = 0.20m, CacheWriteUsdPerMTok = 5m }
    ];

    public VipModelPrice TokenPrice(string model) =>
        Prices.FirstOrDefault(item => string.Equals(item.Model, model, StringComparison.Ordinal))
        ?? DefaultPrices().FirstOrDefault(item => item.Model == model)
        ?? DefaultPrices()[1];
}

/// <summary><c>hintPricing</c>: part 7 of VUAN-7.</summary>
[BsonIgnoreExtraElements]
public class HintPricingSettings
{
    public const string DocumentId = "hintPricing";
    [BsonId] public string Id { get; set; } = DocumentId;
    /// <summary>Level 2 costs this many coins, or one rewarded ad when ads are on.</summary>
    public long Level2Xu { get; set; } = 20;
    public long Level3Xu { get; set; } = 50;
    /// <summary>Case score lost for each level-2 hint, percent of the score.</summary>
    public int Level2PenaltyPercent { get; set; } = 5;
    public int Level3PenaltyPercent { get; set; } = 15;
    /// <summary>VIP players open level 2 for free (a perk of the VIP plan).</summary>
    public bool VipFreeLevel2 { get; set; }
    /// <summary>What one finished rewarded ad is worth, VND (about 2 USD per 1.000 views).</summary>
    public long AdRevenueVndPerView { get; set; } = 53;
    public DateTime? UpdatedAt { get; set; }
    public string UpdatedByUserId { get; set; } = string.Empty;
}

/// <summary><c>authorRewards</c>: part 8 of VUAN-7.</summary>
[BsonIgnoreExtraElements]
public class AuthorRewardSettings
{
    public const string DocumentId = "authorRewards";
    [BsonId] public string Id { get; set; } = DocumentId;
    /// <summary>Share of a case's hint coins and ad revenue paid to its author, percent.</summary>
    public int RevenueSharePercent { get; set; } = 30;
    public int HoldDays { get; set; } = 7;
    /// <summary>Most bonus coins one author may receive in a calendar month (Vietnam time), tier bonuses included.</summary>
    public long MonthlyCapXu { get; set; } = 20_000;
    public int SilverCompletions { get; set; } = 100;
    public int SilverMinRatingPercent { get; set; } = 85;
    public long SilverBonusXu { get; set; } = 1_500;
    public int GoldCompletions { get; set; } = 500;
    public int GoldMinRatingPercent { get; set; } = 90;
    public long GoldBonusXu { get; set; } = 5_000;
    public int MinAccountAgeDays { get; set; } = 7;
    public int MinOtherCasesPlayed { get; set; } = 1;
    /// <summary>A completion counts when the game lasted at least this share of the case's estimated play time.</summary>
    public decimal MinPlayTimeRatio { get; set; } = 0.5m;
    public DateTime? UpdatedAt { get; set; }
    public string UpdatedByUserId { get; set; } = string.Empty;
}

/// <summary>Reads and validates the four VUAN-7 settings documents of <c>gameSettings</c>.</summary>
public sealed class VipSettingsStore(MongoDbContext db)
{
    private IMongoCollection<VipPricingSettings> Pricing => db.Database.GetCollection<VipPricingSettings>("gameSettings");
    private IMongoCollection<VipModelSettings> Models => db.Database.GetCollection<VipModelSettings>("gameSettings");
    private IMongoCollection<HintPricingSettings> Hints => db.Database.GetCollection<HintPricingSettings>("gameSettings");
    private IMongoCollection<AuthorRewardSettings> Authors => db.Database.GetCollection<AuthorRewardSettings>("gameSettings");

    public async Task<VipPricingSettings> GetPricingAsync(CancellationToken ct = default) =>
        await Pricing.Find(item => item.Id == VipPricingSettings.DocumentId).FirstOrDefaultAsync(ct) ?? new VipPricingSettings();

    public async Task<VipModelSettings> GetModelsAsync(CancellationToken ct = default) =>
        await Models.Find(item => item.Id == VipModelSettings.DocumentId).FirstOrDefaultAsync(ct) ?? new VipModelSettings();

    public async Task<HintPricingSettings> GetHintsAsync(CancellationToken ct = default) =>
        await Hints.Find(item => item.Id == HintPricingSettings.DocumentId).FirstOrDefaultAsync(ct) ?? new HintPricingSettings();

    public async Task<AuthorRewardSettings> GetAuthorsAsync(CancellationToken ct = default) =>
        await Authors.Find(item => item.Id == AuthorRewardSettings.DocumentId).FirstOrDefaultAsync(ct) ?? new AuthorRewardSettings();

    public async Task<VipPricingSettings> SavePricingAsync(VipPricingSettings value, string userId, CancellationToken ct = default)
    {
        ValidatePricing(value);
        value.Id = VipPricingSettings.DocumentId;
        value.UpdatedAt = DateTime.UtcNow;
        value.UpdatedByUserId = userId;
        await Pricing.ReplaceOneAsync(item => item.Id == value.Id, value, new ReplaceOptions { IsUpsert = true }, ct);
        return value;
    }

    public async Task<VipModelSettings> SaveModelsAsync(VipModelSettings value, string userId, CancellationToken ct = default)
    {
        ValidateModels(value);
        value.Id = VipModelSettings.DocumentId;
        value.UpdatedAt = DateTime.UtcNow;
        value.UpdatedByUserId = userId;
        await Models.ReplaceOneAsync(item => item.Id == value.Id, value, new ReplaceOptions { IsUpsert = true }, ct);
        return value;
    }

    public async Task<HintPricingSettings> SaveHintsAsync(HintPricingSettings value, string userId, CancellationToken ct = default)
    {
        ValidateHints(value);
        value.Id = HintPricingSettings.DocumentId;
        value.UpdatedAt = DateTime.UtcNow;
        value.UpdatedByUserId = userId;
        await Hints.ReplaceOneAsync(item => item.Id == value.Id, value, new ReplaceOptions { IsUpsert = true }, ct);
        return value;
    }

    public async Task<AuthorRewardSettings> SaveAuthorsAsync(AuthorRewardSettings value, string userId, CancellationToken ct = default)
    {
        ValidateAuthors(value);
        value.Id = AuthorRewardSettings.DocumentId;
        value.UpdatedAt = DateTime.UtcNow;
        value.UpdatedByUserId = userId;
        await Authors.ReplaceOneAsync(item => item.Id == value.Id, value, new ReplaceOptions { IsUpsert = true }, ct);
        return value;
    }

    // ------------------------------------------------------------------ validation

    private static ApiException Invalid(string field, string message) =>
        ApiException.BadRequest(message, new ApiErrorDetails("AI_SETTINGS_INVALID", "ai.settings.invalid") { Field = field });

    private static void Range(string field, decimal value, decimal min, decimal max)
    {
        if (value < min || value > max) throw Invalid(field, $"{field} must be between {min} and {max}.");
    }

    public static void ValidatePricing(VipPricingSettings value)
    {
        if (value.Presets is null || value.Presets.Count == 0) throw Invalid("vipPricing.presets", "Every preset needs a price.");
        foreach (var preset in AiGenerationPresets.All)
            if (value.Presets.Count(item => item.Preset == preset) != 1)
                throw Invalid("vipPricing.presets", $"Preset {preset} needs exactly one price row.");
        if (value.Presets.Any(item => !AiGenerationPresets.All.Contains(item.Preset ?? string.Empty)))
            throw Invalid("vipPricing.presets", "Unknown preset in the price list.");
        foreach (var item in value.Presets)
        {
            Range($"vipPricing.presets.{item.Preset}.fastXu", item.FastXu, 1, 1_000_000);
            Range($"vipPricing.presets.{item.Preset}.saverXu", item.SaverXu, 1, 1_000_000);
            Range($"vipPricing.presets.{item.Preset}.fastCostVnd", item.FastCostVnd, 1, 100_000_000);
            Range($"vipPricing.presets.{item.Preset}.saverCostVnd", item.SaverCostVnd, 1, 100_000_000);
        }
        Range("vipPricing.extraPixelLabGenerationXu", value.ExtraPixelLabGenerationXu, 0, 10_000);
        Range("vipPricing.vipMaxPixelLabCap", value.VipMaxPixelLabCap, AiCaseOrder.VipPixelLabCap, 100);
        Range("vipPricing.usdToVnd", value.UsdToVnd, 1_000, 1_000_000);
        Range("vipPricing.vndPerXu", value.VndPerXu, 1, 10_000);
        Range("vipPricing.costCapMultiplier", value.CostCapMultiplier, 1, 10);
        Range("vipPricing.maxBonusShare", value.MaxBonusShare, 0, 0.3m);
        Range("vipPricing.pixelLabVndPerGeneration", value.PixelLabVndPerGeneration, 0, 100_000);
    }

    public static void ValidateModels(VipModelSettings value)
    {
        foreach (var (field, model) in new[] { ("light", value.Light), ("main", value.Main), ("rescue", value.Rescue) })
            if (!VipModelIds.Allowed.Contains(model)) throw Invalid($"vipModels.{field}", $"Unknown model '{model}'.");
        Range("vipModels.rescueFromAttempt", value.RescueFromAttempt, 2, 10);
        value.StepOverrides ??= new Dictionary<string, string>(StringComparer.Ordinal);
        if (value.StepOverrides.Count > 40) throw Invalid("vipModels.stepOverrides", "At most 40 step overrides.");
        foreach (var (step, model) in value.StepOverrides)
        {
            if (string.IsNullOrWhiteSpace(step) || step.Length > 80 || !step.All(ch => char.IsLetterOrDigit(ch) || ch is ':' or '_' or '-'))
                throw Invalid("vipModels.stepOverrides", $"Bad step name '{step}'.");
            if (!VipModelIds.Allowed.Contains(model)) throw Invalid("vipModels.stepOverrides", $"Unknown model '{model}'.");
        }
        value.Prices ??= VipModelSettings.DefaultPrices();
        foreach (var model in VipModelIds.Allowed)
            if (value.Prices.All(item => item.Model != model)) value.Prices.Add(VipModelSettings.DefaultPrices().First(item => item.Model == model));
        foreach (var price in value.Prices)
        {
            if (!VipModelIds.Allowed.Contains(price.Model)) throw Invalid("vipModels.prices", $"Unknown model '{price.Model}'.");
            Range($"vipModels.prices.{price.Model}.inputUsdPerMTok", price.InputUsdPerMTok, 0, 1_000);
            Range($"vipModels.prices.{price.Model}.outputUsdPerMTok", price.OutputUsdPerMTok, 0, 1_000);
            Range($"vipModels.prices.{price.Model}.cacheReadUsdPerMTok", price.CacheReadUsdPerMTok, 0, 1_000);
            Range($"vipModels.prices.{price.Model}.cacheWriteUsdPerMTok", price.CacheWriteUsdPerMTok, 0, 1_000);
        }
    }

    public static void ValidateHints(HintPricingSettings value)
    {
        Range("hintPricing.level2Xu", value.Level2Xu, 0, 10_000);
        Range("hintPricing.level3Xu", value.Level3Xu, 0, 10_000);
        Range("hintPricing.level2PenaltyPercent", value.Level2PenaltyPercent, 0, 50);
        Range("hintPricing.level3PenaltyPercent", value.Level3PenaltyPercent, 0, 50);
        Range("hintPricing.adRevenueVndPerView", value.AdRevenueVndPerView, 0, 100_000);
    }

    public static void ValidateAuthors(AuthorRewardSettings value)
    {
        Range("authorRewards.revenueSharePercent", value.RevenueSharePercent, 0, 50);
        Range("authorRewards.holdDays", value.HoldDays, 0, 60);
        Range("authorRewards.monthlyCapXu", value.MonthlyCapXu, 0, 1_000_000);
        Range("authorRewards.silverCompletions", value.SilverCompletions, 1, 1_000_000);
        Range("authorRewards.silverMinRatingPercent", value.SilverMinRatingPercent, 0, 100);
        Range("authorRewards.silverBonusXu", value.SilverBonusXu, 0, 1_000_000);
        Range("authorRewards.goldCompletions", value.GoldCompletions, 1, 1_000_000);
        Range("authorRewards.goldMinRatingPercent", value.GoldMinRatingPercent, 0, 100);
        Range("authorRewards.goldBonusXu", value.GoldBonusXu, 0, 1_000_000);
        if (value.GoldCompletions < value.SilverCompletions)
            throw Invalid("authorRewards.goldCompletions", "The gold tier needs at least as many completions as silver.");
        Range("authorRewards.minAccountAgeDays", value.MinAccountAgeDays, 0, 365);
        Range("authorRewards.minOtherCasesPlayed", value.MinOtherCasesPlayed, 0, 100);
        Range("authorRewards.minPlayTimeRatio", value.MinPlayTimeRatio, 0, 1);
    }
}
