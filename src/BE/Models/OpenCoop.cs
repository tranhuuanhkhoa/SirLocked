using System.Text.Json;
using System.Text.Json.Serialization;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

/// <summary>
/// Rule sets layered over <see cref="GameCase.MechanicsVersion"/>. Classic cases keep the gated V1–V3
/// rules. Open-coop cases open every place from the start, share one notebook between both detectives,
/// let either detective solve puzzles and crack lies, add the timeline, and allow a second accusation.
/// </summary>
public static class CaseRuleSets
{
    public const string Classic = "";
    public const string OpenCoop = "OPEN_COOP";

    public static bool IsOpenCoop(GameCase? gameCase) =>
        gameCase is not null && string.Equals(gameCase.RuleSet, OpenCoop, StringComparison.OrdinalIgnoreCase);

    public static bool IsKnown(string? ruleSet) =>
        string.IsNullOrEmpty(ruleSet) || string.Equals(ruleSet, OpenCoop, StringComparison.OrdinalIgnoreCase);

    /// <summary>Wrong accusations allowed before the case is lost (the first one only costs score).</summary>
    public const int AccusationAttempts = 2;
}

/// <summary>
/// The case's reconstruction timeline. Fixed events sit on the ruler as soon as their source clues are
/// known; the team drags open events between them, and the server checks the position by
/// <see cref="CaseTimelineEvent.SortKey"/>.
/// </summary>
/// <summary>
/// Open co-op case wall ("Sơ đồ vụ án"): the card pinned in the middle and optional red strings the
/// author draws between two pinned items. Who each item belongs to comes from the case itself: a
/// statement belongs to its speaker, a piece of evidence to its <see cref="CaseClue.RelatedCharacterIds"/>
/// (or to the middle card when it names nobody).
/// </summary>
[BsonIgnoreExtraElements]
public class CaseBoard
{
    /// <summary>Small caps line above the middle card, e.g. "VẬT BỊ MẤT" (defaults to "NẠN NHÂN" / "VỤ VIỆC").</summary>
    public string CenterKicker { get; set; } = string.Empty;
    /// <summary>Middle card title when the case has no victim character (defaults to the case title).</summary>
    public string CenterTitle { get; set; } = string.Empty;
    public string CenterSubtitle { get; set; } = string.Empty;
    /// <summary>One-paragraph brief on the pinned "Tóm tắt" sheet (defaults to the case summary).</summary>
    public string Summary { get; set; } = string.Empty;
    public List<CaseBoardLink> Links { get; set; } = new();
}

/// <summary>A labelled red string between two board items, drawn once both are pinned.</summary>
[BsonIgnoreExtraElements]
public class CaseBoardLink
{
    public string FromId { get; set; } = string.Empty;
    public string ToId { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public class CaseTimeline
{
    public string Title { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public List<CaseTimelineEvent> Events { get; set; } = new();
}

[BsonIgnoreExtraElements]
public class CaseTimelineEvent
{
    public string EventId { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Detail { get; set; } = string.Empty;
    /// <summary>Day heading shown on the ruler, e.g. "Thứ Hai".</summary>
    public string DayLabel { get; set; } = string.Empty;
    /// <summary>Clock text shown once the event is placed, e.g. "17:05" (may stay hidden for open events).</summary>
    public string TimeLabel { get; set; } = string.Empty;
    /// <summary>Total order key (minutes from the case's reference start). Unique per event.</summary>
    public int SortKey { get; set; }
    /// <summary>Fixed events are placed automatically; open events must be placed by the players.</summary>
    public bool IsFixed { get; set; }
    /// <summary>The event card appears once every one of these clues is unlocked (empty = from the start).</summary>
    public List<string> RequiredClueIds { get; set; } = new();
    /// <summary>Clues unlocked when this event is placed correctly.</summary>
    public List<string> RevealClueIds { get; set; } = new();
}

/// <summary>
/// Server-side progress of one interactive puzzle in one room. Kinds keep their own small values in
/// <see cref="Data"/> (strings, usually numbers or compact JSON).
/// </summary>
[BsonIgnoreExtraElements]
public class PuzzleRunState
{
    public int Attempts { get; set; }
    /// <summary>Probe actions spent (e.g. weighings on the balance scale).</summary>
    public int ProbesUsed { get; set; }
    public List<string> Log { get; set; } = new();
    public Dictionary<string, string> Data { get; set; } = new();
}

/// <summary>
/// Reads a JSON object (or a JSON string) from case files and keeps it as raw JSON text, so puzzle
/// parameters stay readable in authored JSON but are stored as a plain string in MongoDB.
/// </summary>
public sealed class RawJsonStringConverter : JsonConverter<string>
{
    public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return string.Empty;
        if (reader.TokenType == JsonTokenType.String) return reader.GetString() ?? string.Empty;
        using var document = JsonDocument.ParseValue(ref reader);
        return document.RootElement.GetRawText();
    }

    public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            writer.WriteNullValue();
            return;
        }
        try
        {
            using var document = JsonDocument.Parse(value);
            document.RootElement.WriteTo(writer);
        }
        catch (JsonException)
        {
            writer.WriteStringValue(value);
        }
    }
}
