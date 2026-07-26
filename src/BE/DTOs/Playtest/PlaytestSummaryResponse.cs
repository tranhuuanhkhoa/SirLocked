namespace SirLocked.Api.DTOs.Playtest;

/// <summary>Aggregated playtest signals. Every field is derived from hashed, ID-free events.</summary>
public sealed class PlaytestSummaryResponse
{
    public DateTime From { get; set; }
    public DateTime To { get; set; }

    /// <summary>Distinct session pseudonyms in range, not room identifiers.</summary>
    public int SessionCount { get; set; }

    /// <summary>How many events actually went into this fold.</summary>
    public int EventCount { get; set; }

    /// <summary>True when the range held more events than one summary reads; narrow the range.</summary>
    public bool IsTruncated { get; set; }

    public Dictionary<string, long> WaitingMsByRole { get; set; } = new();

    /// <summary>Null when either role has no waiting time; there is nothing to compare yet.</summary>
    public double? WaitingImbalancePct { get; set; }

    public Dictionary<string, long> NotebookOpenMsByRole { get; set; } = new();
    public Dictionary<string, int> ConfrontationOutcomes { get; set; } = new();
    public double? MedianRevisionsPerAttempt { get; set; }
    public double? MedianStageMs { get; set; }
    public Dictionary<int, int> HintCountByTier { get; set; } = new();
    public int OptimisticRetryCount { get; set; }
    public int ReconnectRestoredCount { get; set; }
}
