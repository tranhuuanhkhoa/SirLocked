namespace SirLocked.Api.Configurations;

/// <summary>
/// Public AI admission controls. Keep the switch off for local/mock development;
/// production must explicitly provide a daily limit, estimated reservation and a
/// non-zero global budget before paid generation is accepted.
/// </summary>
public sealed class AiQuotaSettings
{
    public bool Enabled { get; set; }
    public int MaxActiveDraftsPerUser { get; set; } = 1;
    public int MaxCasesPerUserPerDay { get; set; } = 1;
    public decimal EstimatedCaseCostUsd { get; set; }
    public decimal GlobalBudgetUsd { get; set; }
}
