using SirLocked.Api.Configurations;
using Xunit;

namespace SirLocked.Tests;

public sealed class JwtSettingsTests
{
    [Fact]
    public void EffectiveExpiryMinutes_DefaultsToSixty()
    {
        Assert.Equal(60, new JwtSettings().EffectiveExpiryMinutes);
    }

    [Fact]
    public void EffectiveExpiryMinutes_UsesLegacyHoursWhenNewValueIsUnset()
    {
        Assert.Equal(720, new JwtSettings { ExpiryHours = 12 }.EffectiveExpiryMinutes);
    }

    [Fact]
    public void EffectiveExpiryMinutes_PrefersMinutesWhenBothValuesAreConfigured()
    {
        Assert.Equal(45, new JwtSettings { ExpiryMinutes = 45, ExpiryHours = 12 }.EffectiveExpiryMinutes);
    }
}
