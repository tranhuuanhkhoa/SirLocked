namespace SirLocked.Api.Configurations;

/// <summary>Explicit, dated prices. Missing prices mean unknown cost, never free usage.</summary>
public sealed class AiUsageSettings
{
    public string PriceVersion { get; set; } = string.Empty;
    public decimal MaxDraftUsd { get; set; }
    /// <summary>Optional serialized text-request cap, including its schema. Zero disables the cap.</summary>
    public int MaxTextRequestBytes { get; set; }
    /// <summary>Optional paid text output-token cap. Oversized requests are rejected, never truncated.</summary>
    public int MaxTextOutputTokens { get; set; }
    public Dictionary<string, AiModelPrice> Models { get; set; } = new(StringComparer.Ordinal);
}

public sealed class AiModelPrice
{
    public decimal? InputPerMillionUsd { get; set; }
    public decimal? CachedInputPerMillionUsd { get; set; }
    public decimal? OutputPerMillionUsd { get; set; }
    public decimal? ImageInputPerMillionUsd { get; set; }
    public decimal? ImageOutputPerMillionUsd { get; set; }
    public decimal? CacheWritePerMillionUsd { get; set; }
    /// <summary>Conservative reservation for one request, including a failed/incomplete response.</summary>
    public decimal ReservationUsd { get; set; }
}
