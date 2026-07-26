namespace SirLocked.Api.Configurations;

public sealed class AccusationSettings
{
    /// <summary>
    /// Whether both detectives must confirm the final accusation, configured as
    /// <c>Accusation__RequireConsensus</c>. Null (the default) follows the case's mechanics version,
    /// so V3 cases require consensus while published V1/V2 cases keep the unilateral route.
    /// Set explicitly to force one behaviour on every version.
    /// </summary>
    public bool? RequireConsensus { get; set; }
}
