using System.Text.Json;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using Xunit;

namespace SirLocked.Tests;

public sealed class PlaytestInstrumentationPrivacyTests
{
    [Fact]
    public void StoredSchema_HasNoSemanticIdOrFreeTextChannel()
    {
        var names = typeof(PlaytestEventRecord).GetProperties().Select(property => property.Name).ToArray();

        Assert.DoesNotContain(names, name => name.Contains("Evidence", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Fragment", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Title", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Content", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Payload", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Text", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void StoredSchema_CarriesNoRawIdentifierOrProgressionChannel()
    {
        var names = typeof(PlaytestEventRecord).GetProperties().Select(property => property.Name).ToArray();

        Assert.DoesNotContain(names, name => name.Contains("Room", StringComparison.OrdinalIgnoreCase));
        // UserHash is the only user-shaped field, and it is a per-room HMAC, never a user id.
        Assert.DoesNotContain(names, name =>
            name.Contains("User", StringComparison.OrdinalIgnoreCase)
            && !name.Equals(nameof(PlaytestEventRecord.UserHash), StringComparison.Ordinal));
        Assert.Contains(names, name => name.Equals(nameof(PlaytestEventRecord.UserHash), StringComparison.Ordinal));

        Assert.DoesNotContain(names, name => name.Contains("Stage", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Scene", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Hint", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Clue", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void UiRequest_RejectsArbitraryEventNamesDuringJsonBinding()
    {
        const string sentinel = "INV_SECRET_SENTINEL_7F91";
        var json = $$"""{"eventType":"{{sentinel}}","durationMs":12}""";

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<RecordUiPlaytestEventRequest>(
            json,
            new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
}
