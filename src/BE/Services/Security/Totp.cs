using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace SirLocked.Api.Services.Security;

public static class Totp
{
    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    public const int StepSeconds = 30;
    public const int Digits = 6;

    public static string GenerateSecret() =>
        EncodeBase32(RandomNumberGenerator.GetBytes(20));

    public static string EncodeBase32(ReadOnlySpan<byte> bytes)
    {
        if (bytes.IsEmpty) return string.Empty;
        var output = new StringBuilder((bytes.Length * 8 + 4) / 5);
        var buffer = 0;
        var bits = 0;
        foreach (var value in bytes)
        {
            buffer = (buffer << 8) | value;
            bits += 8;
            while (bits >= 5)
            {
                bits -= 5;
                output.Append(Base32Alphabet[(buffer >> bits) & 31]);
            }
        }

        if (bits > 0) output.Append(Base32Alphabet[(buffer << (5 - bits)) & 31]);
        return output.ToString();
    }

    public static byte[] DecodeBase32(string value)
    {
        var normalized = value.Trim().TrimEnd('=').ToUpperInvariant();
        var output = new List<byte>(normalized.Length * 5 / 8);
        var buffer = 0;
        var bits = 0;
        foreach (var character in normalized)
        {
            var index = Base32Alphabet.IndexOf(character);
            if (index < 0) throw new FormatException("Invalid Base32 character.");
            buffer = (buffer << 5) | index;
            bits += 5;
            if (bits >= 8)
            {
                bits -= 8;
                output.Add((byte)((buffer >> bits) & 0xff));
            }
        }

        if (bits > 0 && (buffer & ((1 << bits) - 1)) != 0)
            throw new FormatException("Invalid Base32 trailing bits.");
        return output.ToArray();
    }

    public static string ComputeCode(ReadOnlySpan<byte> secret, long step, int digits = Digits)
    {
        if (digits is < 1 or > 9) throw new ArgumentOutOfRangeException(nameof(digits));
        Span<byte> counter = stackalloc byte[8];
        System.Buffers.Binary.BinaryPrimitives.WriteInt64BigEndian(counter, step);
        var hash = HMACSHA1.HashData(secret, counter);
        var offset = hash[^1] & 0x0f;
        var binary = ((hash[offset] & 0x7f) << 24)
                     | (hash[offset + 1] << 16)
                     | (hash[offset + 2] << 8)
                     | hash[offset + 3];
        var divisor = (int)Math.Pow(10, digits);
        return (binary % divisor).ToString($"D{digits}", CultureInfo.InvariantCulture);
    }

    public static bool TryGetMatchingStep(
        string secret,
        string? code,
        DateTimeOffset now,
        long? lastUsedStep,
        out long matchedStep)
    {
        matchedStep = 0;
        if (string.IsNullOrWhiteSpace(code) || code.Length != Digits || code.Any(character => character is < '0' or > '9'))
            return false;

        byte[] secretBytes;
        try
        {
            secretBytes = DecodeBase32(secret);
        }
        catch (FormatException)
        {
            return false;
        }

        var current = now.ToUnixTimeSeconds() / StepSeconds;
        var supplied = Encoding.ASCII.GetBytes(code);
        for (var candidate = current + 1; candidate >= current - 1; candidate--)
        {
            if (candidate <= 0 || candidate <= lastUsedStep) continue;
            var expected = Encoding.ASCII.GetBytes(ComputeCode(secretBytes, candidate));
            if (!CryptographicOperations.FixedTimeEquals(expected, supplied)) continue;
            matchedStep = candidate;
            return true;
        }

        return false;
    }
}
