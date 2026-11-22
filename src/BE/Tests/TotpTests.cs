using System.Text;
using SirLocked.Api.Services.Security;
using Xunit;

namespace SirLocked.Api.Tests;

public sealed class TotpTests
{
    private static readonly byte[] RfcSecret = Encoding.ASCII.GetBytes("12345678901234567890");

    [Theory]
    [InlineData(59, "287082")]
    [InlineData(1111111109, "081804")]
    [InlineData(1111111111, "050471")]
    [InlineData(1234567890, "005924")]
    [InlineData(2000000000, "279037")]
    [InlineData(20000000000, "353130")]
    public void ComputesRfc6238Sha1VectorsInSixDigitMode(long unixTime, string expected)
    {
        var step = unixTime / Totp.StepSeconds;
        Assert.Equal(expected, Totp.ComputeCode(RfcSecret, step));
    }

    [Theory]
    [InlineData("", "")]
    [InlineData("f", "MY")]
    [InlineData("fo", "MZXQ")]
    [InlineData("foo", "MZXW6")]
    [InlineData("foob", "MZXW6YQ")]
    [InlineData("fooba", "MZXW6YTB")]
    [InlineData("foobar", "MZXW6YTBOI")]
    public void EncodesAndDecodesRfc4648Base32WithoutPadding(string plain, string encoded)
    {
        var bytes = Encoding.ASCII.GetBytes(plain);
        Assert.Equal(encoded, Totp.EncodeBase32(bytes));
        Assert.Equal(bytes, Totp.DecodeBase32(encoded));
    }

    [Fact]
    public void MatchesOnlyTheAdjacentTimeStepsAndRejectsReplay()
    {
        var secret = Totp.EncodeBase32(RfcSecret);
        var now = DateTimeOffset.FromUnixTimeSeconds(60);
        var code = Totp.ComputeCode(RfcSecret, 1);

        Assert.True(Totp.TryGetMatchingStep(secret, code, now, null, out var matched));
        Assert.Equal(1, matched);
        Assert.False(Totp.TryGetMatchingStep(secret, code, now, matched, out _));
        Assert.False(Totp.TryGetMatchingStep(secret, "ABC123", now, null, out _));
    }
}
