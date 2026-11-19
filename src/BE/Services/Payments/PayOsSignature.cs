using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace SirLocked.Api.Services.Payments;

/// <summary>payOS payment-request canonical form: sorted fields, no URL encoding.</summary>
public static class PayOsSignature
{
    private static readonly JsonSerializerOptions Json = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static string Sign(JsonElement data, string key)
    {
        var canonical = string.Join("&", data.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal)
            .Select(p => $"{p.Name}={Value(p.Value)}"));
        return Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    private static string Value(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => "",
        JsonValueKind.String => value.GetString() is "null" or "undefined" ? "" : value.GetString()!,
        JsonValueKind.Array => JsonSerializer.Serialize(value.EnumerateArray().Select(item =>
            item.ValueKind == JsonValueKind.Object
                ? (object)item.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal).ToDictionary(p => p.Name, p => p.Value)
                : item), Json),
        _ => value.GetRawText()
    };

    public static bool Verify(JsonElement data, string? signature, string key)
    {
        if (data.ValueKind != JsonValueKind.Object || string.IsNullOrEmpty(key) || signature?.Length != 64) return false;
        // Duplicate JSON properties must not be interpreted differently by the verifier and consumer.
        var names = data.EnumerateObject().Select(p => p.Name).ToArray();
        if (names.Distinct(StringComparer.Ordinal).Count() != names.Length) return false;
        try { return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(signature), Convert.FromHexString(Sign(data, key))); }
        catch (FormatException) { return false; }
    }
}
