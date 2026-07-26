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
}
