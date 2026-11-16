using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class AssetLibraryKinds
{
    public const string OutdoorMap = "OUTDOOR_MAP";
    public const string Interior = "INTERIOR";
    public const string Npc = "NPC";
    public const string Item = "ITEM";
    public const string Prop = "PROP";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        OutdoorMap, Interior, Npc, Item, Prop
    };
}

public static class AssetLibrarySources
{
    public const string PixelLab = "PIXELLAB";
    public const string Variant = "VARIANT";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { PixelLab, Variant };
}

/// <summary>One reusable picture of the shared studio library (map, room, NPC, item or prop).</summary>
[BsonIgnoreExtraElements]
public class AssetLibraryEntry
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    /// <summary>Stable, unique key chosen by the studio, for example <c>map-ben-cang</c>.</summary>
    public string Key { get; set; } = string.Empty;
    public string Kind { get; set; } = AssetLibraryKinds.Prop;
    /// <summary>A world key from <see cref="AiCaseWorlds"/>, or <c>ALL</c>.</summary>
    public string World { get; set; } = AiCaseWorlds.All;
    public List<string> Tags { get; set; } = new();
    public string NameVi { get; set; } = string.Empty;
    public string NameEn { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string ThumbUrl { get; set; } = string.Empty;
    public int Width { get; set; }
    public int Height { get; set; }
    /// <summary>The picture this one was derived from, when it is a variant.</summary>
    public string ParentKey { get; set; } = string.Empty;
    /// <summary>
    /// How the variant was made, for example <c>night</c>, <c>mirror</c> or a compact JSON recipe
    /// (<c>{"type":"night","lights":[...]}</c>), at most 2,000 characters.
    /// </summary>
    public string Variant { get; set; } = string.Empty;
    public string Source { get; set; } = AssetLibrarySources.PixelLab;
    public string PixelLabJobId { get; set; } = string.Empty;
    public string FirstUsedByCaseId { get; set; } = string.Empty;
    /// <summary>The PixelLab prompt (or variant recipe note) the picture was made from, for the studio's inventory.</summary>
    public string Prompt { get; set; } = string.Empty;
    /// <summary>
    /// Extra files of the same asset by role, for example <c>sprite</c>, <c>idle</c> (9-frame 1152x128 sheet),
    /// <c>portrait</c> (288x288) or <c>mask</c>. Each value is an https:// or /assets/ URL.
    /// </summary>
    public Dictionary<string, string> Files { get; set; } = new(StringComparer.Ordinal);
    /// <summary>A broken picture kept for the record: the studio and the order form never offer it.</summary>
    public bool Retired { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
