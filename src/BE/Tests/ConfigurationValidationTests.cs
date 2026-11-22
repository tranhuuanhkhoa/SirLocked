using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.Internal;
using SirLocked.Api.Configurations;
using Xunit;

namespace SirLocked.Tests;

public sealed class ConfigurationValidationTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("short-secret")]
    public void JwtSecret_RejectsMissingOrWeakValues(string? secret)
    {
        Assert.False(JwtSettings.IsSecretValid(secret));
    }

    [Fact]
    public void JwtSecret_AcceptsThirtyTwoOrMoreCharacters()
    {
        Assert.True(JwtSettings.IsSecretValid(new string('x', JwtSettings.MinimumSecretLength)));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("")]
    public void AutoVerifyRegistrations_IsIgnoredOutsideDevelopment(string environmentName)
    {
        // The flag is a test convenience, so a deployed environment must not be able to opt in by
        // setting it - unlike Auth__SeedDefaultAdmin, there is no legitimate reason to enable this.
        var configuration = Configuration(("Auth:AutoVerifyRegistrations", "true"), ("AUTH_AUTO_VERIFY_REGISTRATIONS", "true"));

        Assert.False(AuthSettings.ResolveAutoVerifyRegistrations(configuration, Environment(environmentName)));
    }

    [Fact]
    public void AutoVerifyRegistrations_StaysOffInDevelopmentUntilItIsAskedFor()
    {
        Assert.False(AuthSettings.ResolveAutoVerifyRegistrations(Configuration(), Environment(Environments.Development)));
    }

    [Theory]
    [InlineData("Auth:AutoVerifyRegistrations")]
    [InlineData("AUTH_AUTO_VERIFY_REGISTRATIONS")]
    public void AutoVerifyRegistrations_AcceptsEitherKeyInDevelopment(string key)
    {
        var configuration = Configuration((key, "true"));

        Assert.True(AuthSettings.ResolveAutoVerifyRegistrations(configuration, Environment(Environments.Development)));
    }

    [Fact]
    public void AuthRateLimits_KeepExistingDefaults_WhenConfigurationIsAbsent()
    {
        var settings = RateLimitingSettings.FromConfiguration(Configuration());

        Assert.Equal(5, settings.Login.PermitLimit);
        Assert.Equal(60, settings.Login.WindowSeconds);
        Assert.Equal(3, settings.Register.PermitLimit);
        Assert.Equal(300, settings.Register.WindowSeconds);
    }

    [Fact]
    public void AuthRateLimits_BindConfiguredValues()
    {
        var settings = RateLimitingSettings.FromConfiguration(Configuration(
            ("RateLimiting:Login:PermitLimit", "100000"),
            ("RateLimiting:Login:WindowSeconds", "60"),
            ("RateLimiting:Register:PermitLimit", "100000"),
            ("RateLimiting:Register:WindowSeconds", "300")));

        Assert.Equal(100000, settings.Login.PermitLimit);
        Assert.Equal(60, settings.Login.WindowSeconds);
        Assert.Equal(100000, settings.Register.PermitLimit);
        Assert.Equal(300, settings.Register.WindowSeconds);
    }

    private static IConfiguration Configuration(params (string Key, string Value)[] entries) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(entries.Select(entry => new KeyValuePair<string, string?>(entry.Key, entry.Value)))
            .Build();

    private static IHostEnvironment Environment(string environmentName) =>
        new HostingEnvironment { EnvironmentName = environmentName };
}
