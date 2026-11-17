using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Bridge;

/// <summary>
/// Turns the bot's declared picture sources into the PixelLab request plan of a pixel draft and checks it against the
/// library and the order's pixelLabCap (VUAN-6B, "library first"). Pure: the bridge service loads the library.
/// </summary>
public static class PixelAssetPlanning
{
    public sealed record Result(JsonObject Plan, List<PixelAssetSubject> Subjects, List<string> Errors, int EstimatedGenerations, int PixelLabCap)
    {
        public bool WithinCap => EstimatedGenerations <= PixelLabCap;
    }

    /// <summary>Library kinds a subject may reuse.</summary>
    public static string LibraryKindFor(string kind, string? projection) => kind switch
    {
        "scene" => projection == SceneRenderModes.TopDown ? AssetLibraryKinds.OutdoorMap : AssetLibraryKinds.Interior,
        "character" => AssetLibraryKinds.Npc,
        _ => AssetLibraryKinds.Item
    };

    public static Result Plan(GameCase gameCase, IReadOnlyList<AiAssetChoice> choices, IReadOnlyCollection<AssetLibraryEntry> library,
        int pixelLabCap, string? recordRoot = null, PixelLabTemplates? templates = null)
    {
        var errors = new List<string>();
        var byKey = library.Where(entry => !entry.Retired).GroupBy(entry => entry.Key, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var known = AiCaseService.PixelSubjects(gameCase);
        var knownIds = known.Select(subject => subject.Subject).ToHashSet(StringComparer.Ordinal);
        foreach (var choice in choices.Where(choice => !knownIds.Contains(choice.Subject ?? string.Empty)))
            errors.Add($"{choice.Subject}: not a picture subject of this draft (see subjects in assets-needed).");
        foreach (var duplicate in choices.GroupBy(choice => choice.Subject, StringComparer.Ordinal).Where(group => group.Count() > 1))
            errors.Add($"{duplicate.Key}: declared more than once.");

        var subjects = new List<PixelAssetSubject>();
        foreach (var subject in known)
        {
            var choice = choices.FirstOrDefault(entry => string.Equals(entry.Subject, subject.Subject, StringComparison.Ordinal));
            var source = (choice?.Source ?? AiAssetSources.PixelLab).Trim().ToUpperInvariant();
            var libraryKey = (choice?.LibraryKey ?? string.Empty).Trim();
            var parentKey = (choice?.ParentKey ?? string.Empty).Trim();
            var variant = (choice?.Variant ?? string.Empty).Trim();
            var libraryUrl = string.Empty;
            var wantedKind = LibraryKindFor(subject.Kind, subject.Projection);
            if (!AiAssetSources.All.Contains(source))
            {
                errors.Add($"{subject.Subject}: source must be LIBRARY, VARIANT or PIXELLAB.");
                source = AiAssetSources.PixelLab;
            }
            else if (source != AiAssetSources.PixelLab)
            {
                var key = source == AiAssetSources.Library ? libraryKey : parentKey;
                var field = source == AiAssetSources.Library ? "libraryKey" : "parentKey";
                if (key.Length == 0)
                    errors.Add($"{subject.Subject}: {source} needs {field}.");
                else if (!byKey.TryGetValue(key, out var entry))
                    errors.Add($"{subject.Subject}: library key '{key}' is not in the server library (library_sync push first, or it is retired).");
                else if (entry.Kind != wantedKind)
                    errors.Add($"{subject.Subject}: '{key}' is a {entry.Kind}; this subject needs a {wantedKind}.");
                else
                    libraryUrl = entry.Url;
                if (source == AiAssetSources.Variant && variant.Length == 0)
                    errors.Add($"{subject.Subject}: VARIANT needs variant (night, dusk, snow, after_rain, mirror, recolor or compose).");
            }
            var inpaint = (choice?.InpaintItems ?? new List<string>()).Select(id => (id ?? string.Empty).Trim()).Where(id => id.Length > 0)
                .Distinct(StringComparer.Ordinal).ToList();
            if (inpaint.Count > 0)
            {
                if (subject.Kind != "scene")
                {
                    errors.Add($"{subject.Subject}: inpaintItems is only for scene subjects.");
                    inpaint.Clear();
                }
                else if (source == AiAssetSources.PixelLab)
                {
                    errors.Add($"{subject.Subject}: a new PixelLab scene paints its items from the scene's visualDescription; inpaintItems is for LIBRARY or VARIANT scenes.");
                    inpaint.Clear();
                }
                else
                {
                    var scene = PixelCasePipeline.OrderedScenes(gameCase).FirstOrDefault(candidate => candidate.SceneId == subject.TargetId);
                    foreach (var itemId in inpaint.Where(id => scene is null || !scene.ItemIds.Contains(id)).ToList())
                    {
                        errors.Add($"{subject.Subject}: inpaintItems '{itemId}' is not an item of this scene.");
                        inpaint.Remove(itemId);
                    }
                }
            }
            subjects.Add(new PixelAssetSubject(subject.Subject, subject.Kind, subject.TargetId, subject.Name, subject.SlotIds, subject.Projection,
                source, libraryKey, parentKey, variant, libraryUrl, inpaint));
        }
        var plan = PixelLabPlanBuilder.Build(gameCase, subjects, pixelLabCap, templates, recordRoot);
        var total = plan["summary"]!["estimatedGenerations"]!.GetValue<int>();
        return new Result(plan, subjects, errors, total, pixelLabCap);
    }

    /// <summary>Library suggestions for a subject from the creator's order (its picked locations and NPC faces).</summary>
    public static List<string> Suggestions(AiCaseOrder? order, string kind, string? projection, IReadOnlyCollection<AssetLibraryEntry> library)
    {
        if (order is null) return new List<string>();
        var wanted = LibraryKindFor(kind, projection);
        var picked = kind == "character" ? order.NpcIds : kind == "scene" ? order.LocationIds : new List<string>();
        return picked.Where(key => library.Any(entry => entry.Key == key && entry.Kind == wanted && !entry.Retired)).ToList();
    }
}
