namespace SirLocked.Api.Configurations;

public sealed class CaseCacheSettings
{
    public int AbsoluteExpirationSeconds { get; set; } = 300;
    public int SlidingExpirationSeconds { get; set; } = 60;
}
