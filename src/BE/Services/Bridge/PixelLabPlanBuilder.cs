using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Bridge;

/// <summary>
/// The wording and fixed parameters of the 8-step PixelLab workflow, read from
/// ai-game-docs/visual-style-templates/pixellab/templates.json (embedded in the API at build time), the same file
/// scripts/build_pixellab_requests.mjs reads. Nothing here writes a new prompt.
/// </summary>
public sealed class PixelLabTemplates
{
    public const string ResourceName = "SirLocked.PixelLab.templates.json";
    private static readonly Lazy<PixelLabTemplates> Embedded = new(() =>
    {
        using var stream = typeof(PixelLabTemplates).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource {ResourceName} is missing (see SirLocked.Api.csproj).");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return Parse(reader.ReadToEnd());
    });

    public static PixelLabTemplates Default => Embedded.Value;

    public JsonObject Root { get; }
    public IReadOnlyDictionary<string, JsonObject> ById { get; }
    public string Era { get; }
    public string StyleReferenceUrl { get; }
    public string StyleReferenceUsage { get; }
    public JsonObject Policy { get; }
    public IReadOnlyList<string[]> Place { get; }
    public IReadOnlyList<string[]> Area { get; }
    public IReadOnlyList<string[]> Time { get; }
    public IReadOnlyList<string[]> Role { get; }

    private PixelLabTemplates(JsonObject root)
    {
        Root = root;
        ById = root["templates"]!.AsArray().Select(node => node!.AsObject())
            .ToDictionary(node => node["id"]!.GetValue<string>(), StringComparer.Ordinal);
        var shared = root["shared"]!.AsObject();
        Era = shared["era"]!.GetValue<string>();
        StyleReferenceUrl = shared["styleReference"]!["url"]!.GetValue<string>();
        StyleReferenceUsage = shared["styleReference"]!["usage"]!.GetValue<string>();
        Policy = shared["policy"]!.AsObject();
        var glossaries = root["glossaries"]!.AsObject();
        IReadOnlyList<string[]> Read(string name) => glossaries[name]!.AsArray()
            .Select(entry => entry!.AsArray().Select(value => value!.GetValue<string>()).ToArray()).ToList();
        Place = Read("place");
        Area = Read("area");
        Time = Read("time");
        Role = Read("role");
    }

    public static PixelLabTemplates Parse(string json) => new(JsonNode.Parse(json)!.AsObject());

    public int Cost(string templateId) => ById[templateId]["costGenerations"]?.GetValue<int>() ?? 0;
    public int CostPerDirection(string templateId) => ById[templateId]["costPerDirection"]?.GetValue<int>() ?? Cost(templateId);

    /// <summary>
    /// Fills a template's promptParts exactly as renderTemplate() of the JS builder: missing values fall back to the
    /// placeholder default; with no default the {{name}} token stays; parts with "when" need values[when] == true.
    /// </summary>
    public string Render(string templateId, IReadOnlyDictionary<string, object?> values)
    {
        var template = ById[templateId];
        var defaults = template["placeholders"] as JsonObject;
        string Pick(string name, string token)
        {
            if (values.TryGetValue(name, out var value))
            {
                if (value is string text && !string.IsNullOrWhiteSpace(text)) return text.Trim();
                if (value is int or long or double) return Convert.ToString(value, CultureInfo.InvariantCulture)!;
            }
            if (defaults?[name] is JsonObject definition && definition.ContainsKey("default"))
                return definition["default"]?.ToString() ?? string.Empty;
            return token;
        }
        var parts = new List<string>();
        foreach (var raw in template["promptParts"]!.AsArray())
        {
            string text;
            if (raw is JsonValue plain) text = plain.GetValue<string>();
            else
            {
                var part = raw!.AsObject();
                var when = part["when"]?.GetValue<string>();
                if (when is not null && !(values.TryGetValue(when, out var flag) && flag is true)) continue;
                text = part["text"]!.GetValue<string>();
            }
            var filled = Regex.Replace(text, @"\{\{([A-Za-z][A-Za-z0-9_-]*)\}\}", match => Pick(match.Groups[1].Value, match.Value));
            filled = Regex.Replace(filled, @"\s+", " ").Trim();
            if (filled.Length > 0) parts.Add(filled);
        }
        return string.Join(' ', parts);
    }
}

/// <summary>The bot's choice for one subject, resolved against the library.</summary>
public sealed record PixelAssetSubject(
    string Subject,
    string Kind,
    string TargetId,
    string Name,
    IReadOnlyList<string> SlotIds,
    string? Projection,
    string Source,
    string LibraryKey,
    string ParentKey,
    string Variant,
    string LibraryUrl,
    IReadOnlyList<string>? InpaintItems = null);

/// <summary>
/// The PixelLab request plan of a pixel draft: a C# port of scripts/build_pixellab_requests.mjs for the subjects the
/// bot marks as new (PIXELLAB). Library pictures and variants cost 0 generations and produce no request. The golden
/// test (Tests/Fixtures/pixellab-plan-dong-ho.golden.json) keeps both builders on the same prompts.
/// </summary>
public static class PixelLabPlanBuilder
{
    private static readonly Regex PlayerPattern = new(@"\b(sherlock|holmes|watson)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex Placeholder = new(@"\{\{([^{}]+)\}\}");
    private static readonly HashSet<string> Facings = new(StringComparer.Ordinal)
        { "south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west" };
    private static readonly string[] BuildingPositions = ["West", "East", "South-west", "South-east", "North-west", "North-east", "South", "North"];
    private static readonly string[] NumberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
        "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
    private const int IconColumns = 4;
    private const int IconCell = 64;
    private const int IconsPerSheet = 16;

    // ------------------------------------------------------------------ text helpers (same as the JS builder)

    public static string? AsciiText(string? value)
    {
        if (value is null) return null;
        var text = value.Replace('‘', '\'').Replace('’', '\'').Replace('ʼ', '\'')
            .Replace('“', '"').Replace('”', '"').Replace('–', '-').Replace('—', '-')
            .Replace("…", "...");
        text = Regex.Replace(text, @"[ \s]+", " ").Trim();
        return text.Length > 0 && text.All(ch => ch >= 0x20 && ch <= 0x7e) ? text : null;
    }

    private static string Fold(string? value)
    {
        var decomposed = (value ?? string.Empty).Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
            if (ch is < '̀' or > 'ͯ') builder.Append(ch);
        return builder.ToString().Replace('đ', 'd').Replace('Đ', 'D').ToLowerInvariant();
    }

    private static string LowerVi(string? value) => (value ?? string.Empty).Normalize(NormalizationForm.FormC).ToLowerInvariant();
    private static string Sentence(string text) => Regex.IsMatch(text, @"[.!?]$") ? text : $"{text}.";
    private static string StripPeriod(string text) => Regex.Replace(text, @"[.\s]+$", string.Empty);
    private static string Cap(string text) => text.Length == 0 ? text : char.ToUpperInvariant(text[0]) + text[1..];
    private static string NumberWord(int n) => n >= 0 && n < NumberWords.Length ? NumberWords[n] : n.ToString(CultureInfo.InvariantCulture);

    private static string StripPrefixes(string id, params string[] prefixes)
    {
        var result = id;
        foreach (var prefix in prefixes)
            if (result.StartsWith(prefix, StringComparison.Ordinal)) result = result[prefix.Length..];
        return result;
    }

    public static string SceneKey(string sceneId) => StripPrefixes(sceneId, "scene-", "px-");
    public static string CharacterKey(string characterId) => StripPrefixes(characterId, "char-", "px-");
    public static string ItemKey(string itemId) => StripPrefixes(itemId, "item-", "px-");
    public static string CaseSlug(string caseId) => Regex.Replace(StripPrefixes(caseId, "case-", "pixel-"), "-(vi|en)$", string.Empty);

    private static string[]? Glossary(IReadOnlyList<string[]> glossary, params string?[] texts)
    {
        foreach (var text in texts)
        {
            var haystack = LowerVi(text);
            if (haystack.Length == 0) continue;
            var hit = glossary.FirstOrDefault(entry => haystack.Contains(entry[0], StringComparison.Ordinal));
            if (hit is not null) return hit;
        }
        return null;
    }

    private static List<string> Tokens(string? text) =>
        text is null ? new List<string>() : Placeholder.Matches(text).Select(match => match.Groups[1].Value).Distinct().ToList();

    // ------------------------------------------------------------------ plan

    private sealed class Request
    {
        public string Id = string.Empty;
        public int Step;
        public string Stage = string.Empty;
        public string Template = string.Empty;
        public JsonObject Subject = new();
        public JsonObject Params = new();
        public string Prompt = string.Empty;
        public JsonArray References = new();
        public List<string> DependsOn = new();
        public List<string> DependsOnLibrary = new();
        public int Calls = 1;
        public int Generations;
        public JsonObject Extra = new();
        public Dictionary<string, JsonObject> Hints = new(StringComparer.Ordinal);
        public Dictionary<string, JsonObject> Deps = new(StringComparer.Ordinal);
        public JsonArray Outputs = new();
        public JsonObject? Target;
        public bool NeedsReview;
    }

    /// <summary>
    /// Builds the plan. <paramref name="subjects"/> lists every scene, character and icon item of the draft with the
    /// bot's choice; only PIXELLAB subjects produce requests. <paramref name="recordRoot"/> is where originals,
    /// requests and receipts are kept on the bot's machine (outside src/FE/public).
    /// </summary>
    public static JsonObject Build(GameCase gameCase, IReadOnlyList<PixelAssetSubject> subjects, int pixelLabCap,
        PixelLabTemplates? templates = null, string? recordRoot = null)
    {
        var T = templates ?? PixelLabTemplates.Default;
        var era = T.Era;
        var root = recordRoot ?? $"art/{CaseSlug(string.IsNullOrWhiteSpace(gameCase.CaseId) ? "case" : gameCase.CaseId)}";
        var warnings = new List<string>();
        var requests = new List<Request>();
        var bySubject = subjects.ToDictionary(entry => entry.Subject, StringComparer.Ordinal);
        bool IsNew(string subject) => bySubject.TryGetValue(subject, out var entry) && entry.Source == AiAssetSources.PixelLab;
        string? LibraryOf(string subject) => bySubject.TryGetValue(subject, out var entry) && entry.Source != AiAssetSources.PixelLab
            ? (entry.Source == AiAssetSources.Variant ? entry.ParentKey : entry.LibraryKey) : null;
        string? LibraryUrl(string subject) => bySubject.TryGetValue(subject, out var entry) && entry.Source != AiAssetSources.PixelLab
            ? entry.LibraryUrl : null;

        var scenes = PixelCasePipeline.OrderedScenes(gameCase).ToList();
        string Projection(CaseScene scene) => bySubject.TryGetValue($"scene:{scene.SceneId}", out var entry) && entry.Projection is { } projection
            ? projection
            : scene.Runtime?.Render?.Mode == SceneRenderModes.Pixel ? scene.Runtime.Render.Projection : PixelCasePipeline.ProjectionFor(gameCase, scene);
        var maps = scenes.Where(scene => Projection(scene) == SceneRenderModes.TopDown).ToList();
        var interiors = scenes.Where(scene => Projection(scene) == SceneRenderModes.Isometric).ToList();
        bool Linked(CaseScene a, CaseScene b) =>
            (a.Runtime?.Transitions ?? new()).Any(t => t.TargetSceneId == b.SceneId) || (b.Runtime?.Transitions ?? new()).Any(t => t.TargetSceneId == a.SceneId);
        CaseScene? MapOf(CaseScene interior) => maps.FirstOrDefault(map => Linked(map, interior)) ?? maps.FirstOrDefault();
        var itemsById = gameCase.Items.GroupBy(item => item.ItemId).ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        JsonArray PaintedItems(CaseScene scene) => new(scene.ItemIds.Where(itemsById.ContainsKey).Select(id => itemsById[id])
            .Select(item => (JsonNode)new JsonObject
            {
                ["itemId"] = item.ItemId, ["name"] = item.Name, ["visualDescription"] = AsciiText(item.VisualDescription) ?? string.Empty
            }).ToArray());
        JsonArray PaintedClues(CaseScene scene) => new(gameCase.Clues
            .Where(clue => clue.SceneId == scene.SceneId && string.Equals(clue.DiscoverMethod, "camera", StringComparison.OrdinalIgnoreCase))
            .Select(clue => (JsonNode)new JsonObject
            {
                ["clueId"] = clue.ClueId, ["title"] = clue.Title, ["visualDescription"] = AsciiText(clue.VisualDescription) ?? string.Empty
            }).ToArray());
        JsonObject Fixed(string templateId) => T.ById[templateId]["fixedParams"]?.DeepClone().AsObject() ?? new JsonObject();
        Request Add(Request request) { requests.Add(request); return request; }

        // ---------------- step 1: outdoor maps that are new
        var mapRequests = new Dictionary<string, Request>(StringComparer.Ordinal);
        foreach (var scene in maps.Where(scene => IsNew($"scene:{scene.SceneId}")))
        {
            var key = SceneKey(scene.SceneId);
            var buildings = interiors.Where(interior => maps.Count == 1 || MapOf(interior) == scene).ToList();
            var hints = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
            var needsReview = false;
            var lines = buildings.Select((interior, index) =>
            {
                var ikey = SceneKey(interior.SceneId);
                var position = index < BuildingPositions.Length ? BuildingPositions[index] : $"Building {index + 1}";
                var hit = Glossary(T.Place, interior.Title, interior.Description);
                var title = AsciiText(interior.Title);
                var exterior = hit?[1] ?? (title is not null ? $"a building housing the {title}" : null);
                if (hit is not null) needsReview = true;
                if (exterior is null)
                {
                    exterior = $"{{{{buildingExterior:{ikey}}}}}";
                    hints[$"buildingExterior:{ikey}"] = new JsonObject
                    {
                        ["fillFrom"] = "author",
                        ["hint"] = "English exterior of this building as seen from above: size, materials, roof, shopfront, one front door.",
                        ["context"] = new JsonObject { ["sceneId"] = interior.SceneId, ["title"] = interior.Title, ["description"] = interior.Description }
                    };
                }
                return $"{index + 1}) {position}: {Sentence(exterior)}";
            }).ToList();
            if (buildings.Count > BuildingPositions.Length)
                warnings.Add($"Map {scene.SceneId}: {buildings.Count} buildings is crowded for one 512x512 map; consider merging or a bigger map.");
            string? areaDescription = null;
            var area = Glossary(T.Area, scene.Title, scene.Description);
            var time = Glossary(T.Time, scene.Title, scene.Description);
            var sceneTitle = AsciiText(scene.Title);
            if (area is not null) { areaDescription = string.Join(' ', new[] { area[1], time?[1] }.Where(part => part is not null)); needsReview = true; }
            else if (sceneTitle is not null) areaDescription = sceneTitle;
            if (areaDescription is null)
                hints["areaDescription"] = new JsonObject
                {
                    ["fillFrom"] = "--map-description",
                    ["hint"] = "Short English phrase for the whole area with time of day, e.g. \"riverside street block on a clear morning\".",
                    ["context"] = new JsonObject { ["sceneId"] = scene.SceneId, ["title"] = scene.Title, ["description"] = scene.Description }
                };
            var layout = AsciiText(scene.VisualDescription);
            if (!string.IsNullOrWhiteSpace(scene.VisualDescription) && layout is null)
                warnings.Add($"Scene {scene.SceneId}: visualDescription is not ASCII English; ignored.");
            var painted = PaintedItems(scene);
            var mustDescribe = layout is null && painted.Count > 0;
            if (mustDescribe)
                hints["layoutDetails"] = new JsonObject
                {
                    ["fillFrom"] = $"scenes[sceneId={scene.SceneId}].visualDescription",
                    ["hint"] = "English sentences for the layout (edges, square, landmarks) that also paint every investigation item of this scene into the map.",
                    ["context"] = new JsonObject
                    {
                        ["sceneId"] = scene.SceneId, ["title"] = scene.Title, ["description"] = scene.Description, ["paintedItems"] = painted.DeepClone()
                    }
                };
            var values = new Dictionary<string, object?>
            {
                ["era"] = era,
                ["areaDescription"] = areaDescription,
                ["layoutDetails"] = layout is not null ? Sentence(layout) : mustDescribe ? "{{layoutDetails}}" : string.Empty,
                ["buildingCountWord"] = Cap(NumberWord(buildings.Count)),
                ["buildingList"] = string.Join(' ', lines),
                ["multipleBuildings"] = buildings.Count >= 2,
                ["singleBuilding"] = buildings.Count == 1
            };
            var request = Add(new Request
            {
                Id = $"map.{key}", Step = 1, Stage = "outdoor-map", Template = "outdoor-map",
                Subject = new JsonObject { ["kind"] = "scene", ["sceneId"] = scene.SceneId, ["title"] = scene.Title, ["projection"] = "topdown" },
                Params = Fixed("outdoor-map"),
                Prompt = T.Render("outdoor-map", values),
                Generations = T.Cost("outdoor-map"),
                Hints = hints,
                NeedsReview = needsReview,
                Extra = new JsonObject
                {
                    ["buildings"] = new JsonArray(buildings.Select((interior, index) => (JsonNode)new JsonObject
                    {
                        ["sceneId"] = interior.SceneId, ["title"] = interior.Title,
                        ["position"] = index < BuildingPositions.Length ? BuildingPositions[index] : $"Building {index + 1}"
                    }).ToArray()),
                    ["paintedItems"] = painted.Count > 0 ? painted : null,
                    ["paintedClues"] = PaintedClues(scene) is { Count: > 0 } clues ? clues : null
                },
                Outputs = new JsonArray(
                    Output("original", $"{root}/map/{key}-512.png"), Output("record", $"{root}/map/{key}.request.json"),
                    Output("record", $"{root}/map/{key}.receipt.json")),
                Target = SlotTarget($"background:{scene.SceneId}", $"scenes[{scene.SceneId}].backgroundUrl", "512x512",
                    "runtime 2048x2048 (render.pixelScale 4, topdown)")
            });
            mapRequests[scene.SceneId] = request;
        }
        var firstMap = maps.Select(map => mapRequests.GetValueOrDefault(map.SceneId)).FirstOrDefault(request => request is not null);

        // ---------------- step 2: new NPCs: front sprite, then v3 rotations; step 3: idle
        var npcs = gameCase.Characters.Where(character => IsNew($"character:{character.CharacterId}")).ToList();
        var skipped = new JsonArray();
        foreach (var player in npcs.Where(character => PlayerPattern.IsMatch(character.Name ?? string.Empty) || PlayerPattern.IsMatch(character.CharacterId)).ToList())
        {
            skipped.Add(new JsonObject { ["characterId"] = player.CharacterId, ["name"] = player.Name, ["reason"] = "player character already exists in PixelLab" });
            npcs.Remove(player);
        }
        var npcInfo = npcs.Select(character =>
        {
            var appearance = AsciiText(character.VisualDescription);
            if (!string.IsNullOrWhiteSpace(character.VisualDescription) && appearance is null)
                warnings.Add($"Character {character.CharacterId}: visualDescription is not ASCII English; ignored.");
            if (appearance is not null && !string.IsNullOrWhiteSpace(character.Name) && Fold(appearance).Contains(Fold(character.Name), StringComparison.Ordinal))
                warnings.Add($"Character {character.CharacterId}: visualDescription contains the character name; names should stay out of prompts.");
            var roleEn = AsciiText(character.Role) ?? Glossary(T.Role, character.Role, character.Description)?[1];
            var facing = scenes.SelectMany(scene => scene.Runtime?.CharacterPlacements ?? new())
                .FirstOrDefault(placement => placement.CharacterId == character.CharacterId && Facings.Contains(placement.Direction))?.Direction ?? "south";
            return (Character: character, Key: CharacterKey(character.CharacterId), Appearance: appearance, RoleEn: roleEn, Facing: facing,
                SceneIds: scenes.Where(scene => scene.CharacterIds.Contains(character.CharacterId)).Select(scene => scene.SceneId).ToList());
        }).ToList();
        JsonObject AppearanceHint((CaseCharacter Character, string Key, string? Appearance, string? RoleEn, string Facing, List<string> SceneIds) info, bool shortForm) => new()
        {
            ["fillFrom"] = $"characters[characterId={info.Character.CharacterId}].visualDescription",
            ["hint"] = $"{(shortForm ? "Short comma-separated" : "One or two sentences of")} English ASCII appearance, no name"
                       + (info.RoleEn is not null ? $", e.g. \"a {era} {info.RoleEn}, <age>, <build>, <hair and face>, <clothes>, <one held prop>\"" : string.Empty) + ".",
            ["context"] = new JsonObject
            {
                ["characterId"] = info.Character.CharacterId, ["name"] = info.Character.Name, ["role"] = info.Character.Role, ["description"] = info.Character.Description
            }
        };
        var frontReference = T.ById["character-front"]["references"]![0]!.AsObject();
        foreach (var info in npcInfo)
        {
            Add(new Request
            {
                Id = $"front.{info.Key}", Step = 2, Stage = "character-front", Template = "character-front",
                Subject = new JsonObject
                {
                    ["kind"] = "npc", ["characterId"] = info.Character.CharacterId, ["name"] = info.Character.Name,
                    ["sceneIds"] = new JsonArray(info.SceneIds.Select(id => (JsonNode)id).ToArray())
                },
                Params = Fixed("character-front"),
                Prompt = T.Render("character-front", new Dictionary<string, object?> { ["characterAppearance"] = info.Appearance is null ? null : Sentence(info.Appearance) }),
                References = new JsonArray(new JsonObject
                {
                    ["param"] = frontReference["param"]!.GetValue<string>(), ["url"] = T.StyleReferenceUrl,
                    ["usage"] = frontReference["usage"]!.GetValue<string>(), ["usageSent"] = frontReference["usageSent"]!.GetValue<bool>()
                }),
                Generations = T.Cost("character-front"),
                Extra = new JsonObject { ["expectedCandidates"] = T.ById["character-front"]["expectedCandidates"]?.DeepClone() },
                Hints = new() { ["characterAppearance"] = AppearanceHint(info, false) },
                Outputs = new JsonArray(Enumerable.Range(0, 4).Select(n => (JsonNode)Output("original", $"{root}/chars/{info.Key}/front-{n}.png"))
                    .Append(Output("record", $"{root}/chars/{info.Key}.front.request.json"))
                    .Append(Output("record", $"{root}/chars/{info.Key}/front.receipt.json")).ToArray())
            });
        }
        var rotateReference = T.ById["character-rotate"]["references"]![0]!.AsObject();
        foreach (var info in npcInfo)
        {
            Add(new Request
            {
                Id = $"rotate.{info.Key}", Step = 2, Stage = "character-rotate", Template = "character-rotate",
                Subject = new JsonObject { ["kind"] = "npc", ["characterId"] = info.Character.CharacterId, ["name"] = info.Character.Name },
                Params = Fixed("character-rotate"),
                Prompt = T.Render("character-rotate", new Dictionary<string, object?> { ["characterShortDescription"] = info.Appearance is null ? null : StripPeriod(info.Appearance) }),
                References = new JsonArray(new JsonObject
                {
                    ["param"] = rotateReference["param"]!.GetValue<string>(), ["url"] = "{{frontCandidateUrl}}",
                    ["usage"] = rotateReference["usage"]!.GetValue<string>(), ["usageSent"] = rotateReference["usageSent"]!.GetValue<bool>()
                }),
                DependsOn = new() { $"front.{info.Key}" },
                Generations = T.Cost("character-rotate"),
                Extra = new JsonObject { ["expectedResult"] = T.ById["character-rotate"]["expectedResult"]?.DeepClone() },
                Hints = new() { ["characterShortDescription"] = AppearanceHint(info, true) },
                Deps = new()
                {
                    ["frontCandidateUrl"] = new JsonObject
                    {
                        ["from"] = $"front.{info.Key}",
                        ["how"] = "Pick the straight-on south-facing candidate: https://api.pixellab.ai/mcp/images/<front job_id>/download?index=<n>."
                    }
                },
                Outputs = new JsonArray(Output("original", $"{root}/chars/{info.Key}/character.zip"), Output("record", $"{root}/chars/{info.Key}/character.receipt.json"))
            });
        }
        foreach (var info in npcInfo)
        {
            var parameters = Fixed("character-idle");
            parameters["character_id"] = "{{characterId}}";
            parameters["direction"] = info.Facing;
            Add(new Request
            {
                Id = $"idle.{info.Key}", Step = 3, Stage = "character-idle", Template = "character-idle",
                Subject = new JsonObject { ["kind"] = "npc", ["characterId"] = info.Character.CharacterId, ["name"] = info.Character.Name },
                Params = parameters,
                Prompt = T.Render("character-idle", new Dictionary<string, object?>()),
                DependsOn = new() { $"rotate.{info.Key}" },
                Generations = T.CostPerDirection("character-idle"),
                Deps = new() { ["characterId"] = new JsonObject { ["from"] = $"rotate.{info.Key}", ["how"] = "character_id returned by create_character." } },
                Outputs = new JsonArray(Output("original", $"{root}/chars/{info.Key}/spritesheet.zip"), Output("record", $"{root}/chars/{info.Key}/idle.receipt.json")),
                Target = new JsonObject
                {
                    ["slots"] = new JsonArray($"character-sprite:{info.Character.CharacterId}", $"character-portrait:{info.Character.CharacterId}"),
                    ["process"] = "asset_process npc_bundle <character.zip with the idle animation> -> idle sheet 1152x128 (9 frames of 128) + portrait 288x288",
                    ["fields"] = new JsonArray($"characters[{info.Character.CharacterId}].presentation.spriteSheet", $"characters[{info.Character.CharacterId}].imageUrl")
                }
            });
        }

        // ---------------- step 5: object mask of every new outdoor map
        var maskReference = T.ById["object-mask"]["references"]![0]!.AsObject();
        foreach (var scene in maps.Where(scene => mapRequests.ContainsKey(scene.SceneId)))
        {
            var key = SceneKey(scene.SceneId);
            var map = mapRequests[scene.SceneId];
            Add(new Request
            {
                Id = $"mask.{key}", Step = 5, Stage = "object-mask", Template = "object-mask",
                Subject = new JsonObject { ["kind"] = "scene", ["sceneId"] = scene.SceneId, ["title"] = scene.Title },
                Params = Fixed("object-mask"),
                Prompt = T.Render("object-mask", new Dictionary<string, object?>()),
                References = new JsonArray(new JsonObject
                {
                    ["param"] = maskReference["param"]!.GetValue<string>(), ["url"] = "{{mapImageUrl}}",
                    ["usage"] = maskReference["usage"]!.GetValue<string>(), ["usageSent"] = maskReference["usageSent"]!.GetValue<bool>()
                }),
                DependsOn = new() { map.Id },
                Generations = T.Cost("object-mask"),
                NeedsReview = true,
                Extra = new JsonObject { ["reviewNote"] = "Adjust objectList/groundList to what the generated map really shows before sending." },
                Deps = new() { ["mapImageUrl"] = new JsonObject { ["from"] = map.Id, ["how"] = "https://api.pixellab.ai/mcp/images/<map job_id>/download?index=0 (native 512, no upscale)." } },
                Outputs = new JsonArray(Output("original", $"{root}/mask/{key}-mask-raw.png"), Output("record", $"{root}/mask/{key}.request.json"),
                    Output("record", $"{root}/mask/{key}.receipt.json"))
            });
        }

        // ---------------- step 7: new interiors, then inventory icon sheets
        var interiorReference = T.ById["interior"]["references"]![0]!.AsObject();
        var interiorRequests = new List<Request>();
        foreach (var scene in interiors.Where(scene => IsNew($"scene:{scene.SceneId}")))
        {
            var key = SceneKey(scene.SceneId);
            var outdoor = MapOf(scene);
            // A library map is cropped locally (0 generations); a new map must be drawn first.
            var map = outdoor is null ? firstMap : mapRequests.GetValueOrDefault(outdoor.SceneId);
            var libraryMap = outdoor is not null && map is null ? LibraryOf($"scene:{outdoor.SceneId}") : null;
            var hit = Glossary(T.Place, scene.Title, scene.Description);
            var contents = AsciiText(scene.VisualDescription);
            if (!string.IsNullOrWhiteSpace(scene.VisualDescription) && contents is null)
                warnings.Add($"Scene {scene.SceneId}: visualDescription is not ASCII English; ignored.");
            var roomSubject = hit?[2] ?? AsciiText(scene.Title);
            var painted = PaintedItems(scene);
            var hints = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
            if (roomSubject is null)
                hints["roomSubject"] = new JsonObject
                {
                    ["fillFrom"] = "author", ["hint"] = "English room type, e.g. \"apothecary shop\".",
                    ["context"] = new JsonObject { ["sceneId"] = scene.SceneId, ["title"] = scene.Title, ["description"] = scene.Description }
                };
            if (contents is null)
                hints["roomContents"] = new JsonObject
                {
                    ["fillFrom"] = $"scenes[sceneId={scene.SceneId}].visualDescription",
                    ["hint"] = "A few English sentences: furniture along the left wall, right wall and back corner, plus every investigation item of this scene painted into the room.",
                    ["context"] = new JsonObject
                    {
                        ["sceneId"] = scene.SceneId, ["title"] = scene.Title, ["description"] = scene.Description, ["paintedItems"] = painted.DeepClone()
                    }
                };
            var prepare = libraryMap is not null
                ? $"Crop this building (roof, front wall and door) from the NATIVE 512 library map {libraryMap} ({LibraryUrl($"scene:{outdoor!.SceneId}")}), no upscale; upload it and pass the returned upload:<id> ref (uploads expire after a few days)."
                : $"Crop this building (roof, front wall and door) from the NATIVE 512 map of {map?.Id ?? "the outdoor map"}, no upscale; upload it and pass the returned upload:<id> ref (uploads expire after a few days).";
            interiorRequests.Add(Add(new Request
            {
                Id = $"interior.{key}", Step = 7, Stage = "interior", Template = "interior",
                Subject = new JsonObject { ["kind"] = "scene", ["sceneId"] = scene.SceneId, ["title"] = scene.Title, ["projection"] = "isometric" },
                Params = Fixed("interior"),
                Prompt = T.Render("interior", new Dictionary<string, object?> { ["era"] = era, ["roomSubject"] = roomSubject, ["roomContents"] = contents is null ? null : Sentence(contents) }),
                References = new JsonArray(new JsonObject
                {
                    ["param"] = interiorReference["param"]!.GetValue<string>(), ["url"] = "{{exteriorCropRef}}",
                    ["usage"] = interiorReference["usage"]!.GetValue<string>(), ["usageSent"] = interiorReference["usageSent"]!.GetValue<bool>(),
                    ["prepare"] = prepare
                }),
                DependsOn = map is not null ? new() { map.Id } : new(),
                DependsOnLibrary = libraryMap is not null ? new() { libraryMap } : new(),
                Generations = T.Cost("interior"),
                NeedsReview = hit is not null,
                Extra = new JsonObject
                {
                    ["paintedItems"] = painted.Count > 0 ? painted : null,
                    ["paintedClues"] = PaintedClues(scene) is { Count: > 0 } clues ? clues : null
                },
                Hints = hints,
                Deps = new()
                {
                    ["exteriorCropRef"] = new JsonObject
                    {
                        ["from"] = map?.Id ?? (libraryMap is null ? null : $"library:{libraryMap}"),
                        ["how"] = "upload:<id> of the exterior crop."
                    }
                },
                Outputs = new JsonArray(Output("original", $"{root}/interiors/{key}-512.png"), Output("record", $"{root}/interiors/{key}.request.json"),
                    Output("record", $"{root}/interiors/{key}.receipt.json")),
                Target = SlotTarget($"background:{scene.SceneId}", $"scenes[{scene.SceneId}].backgroundUrl", "512x512",
                    "runtime 2048x2048 (render.pixelScale 4, isometric); cut the area outside the room to transparent")
            }));
        }

        // ---------------- step 7: items painted into a library or variant scene (never pasted)
        var inpaintReference = T.ById["item-inpaint"]["references"]![0]!.AsObject();
        foreach (var scene in scenes)
        {
            if (!bySubject.TryGetValue($"scene:{scene.SceneId}", out var sceneChoice) || sceneChoice.Source == AiAssetSources.PixelLab
                || sceneChoice.InpaintItems is not { Count: > 0 } inpaintItems) continue;
            var key = SceneKey(scene.SceneId);
            var libraryScene = LibraryOf($"scene:{scene.SceneId}");
            Request? previous = null;
            foreach (var itemId in inpaintItems.Where(itemsById.ContainsKey))
            {
                var item = itemsById[itemId];
                var ikey = ItemKey(item.ItemId);
                var visual = AsciiText(item.VisualDescription);
                if (!string.IsNullOrWhiteSpace(item.VisualDescription) && visual is null)
                    warnings.Add($"Item {item.ItemId}: visualDescription is not ASCII English; ignored.");
                var hints = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
                if (visual is null)
                    hints["itemVisual"] = new JsonObject
                    {
                        ["fillFrom"] = $"items[itemId={item.ItemId}].visualDescription",
                        ["hint"] = "Short English phrase of the object as it lies in the scene, e.g. \"a small red closed ledger book\".",
                        ["context"] = new JsonObject { ["itemId"] = item.ItemId, ["name"] = item.Name, ["sceneId"] = scene.SceneId, ["sceneTitle"] = scene.Title }
                    };
                var parameters = Fixed("item-inpaint");
                parameters["image_url"] = "{{inpaintSourceRef}}";
                parameters["mask"] = "{{inpaintMask}}";
                parameters["bounding_box"] = "{{inpaintBoundingBox}}";
                var request = Add(new Request
                {
                    Id = $"inpaint.{key}.{ikey}", Step = 7, Stage = "item-inpaint", Template = "item-inpaint",
                    Subject = new JsonObject
                    {
                        ["kind"] = "item", ["itemId"] = item.ItemId, ["name"] = item.Name, ["sceneId"] = scene.SceneId, ["sceneTitle"] = scene.Title
                    },
                    Params = parameters,
                    Prompt = T.Render("item-inpaint", new Dictionary<string, object?> { ["itemVisual"] = visual is null ? null : StripPeriod(visual) }),
                    References = new JsonArray(new JsonObject
                    {
                        ["param"] = inpaintReference["param"]!.GetValue<string>(), ["url"] = "{{inpaintContextRef}}",
                        ["usage"] = inpaintReference["usage"]!.GetValue<string>(), ["usageSent"] = inpaintReference["usageSent"]!.GetValue<bool>(),
                        ["prepare"] = $"asset_process inpaint_prep {{ scene: <the 512 background of {scene.SceneId}{(previous is null ? string.Empty : $" after {previous.Id}")}>, "
                                      + "rect: [x0,y0,x1,y1] where the object goes (native pixels), description: <this prompt> } writes source.png, mask and context.png; "
                                      + "upload source.png and context.png (get_upload_url) and send calls[0].params of its answer."
                    }),
                    DependsOn = previous is not null ? new() { previous.Id } : new(),
                    DependsOnLibrary = libraryScene is not null ? new() { libraryScene } : new(),
                    Generations = T.Cost("item-inpaint"),
                    Extra = new JsonObject
                    {
                        ["fallback"] = T.ById["item-inpaint"]["fallback"]?.DeepClone(),
                        ["placement"] = $"scenes[{scene.SceneId}].runtime.itemPlacements[{item.ItemId}]: asset \"\", hotspot over the painted object (inpaint_merge returns it)"
                    },
                    Hints = hints,
                    Deps = new()
                    {
                        ["inpaintSourceRef"] = new JsonObject { ["from"] = "asset_process inpaint_prep", ["how"] = "upload:<id> of source.png (128 or 256 crop of the native 512 scene)." },
                        ["inpaintMask"] = new JsonObject { ["from"] = "asset_process inpaint_prep", ["how"] = "mask_x, mask_y, mask_width, mask_height from calls[0].params." },
                        ["inpaintBoundingBox"] = new JsonObject { ["from"] = "asset_process inpaint_prep", ["how"] = "bounding_box from calls[0].params (where the source sits in context.png)." },
                        ["inpaintContextRef"] = new JsonObject { ["from"] = "asset_process inpaint_prep", ["how"] = "upload:<id> of context.png." }
                    },
                    Outputs = new JsonArray(Output("original", $"{root}/inpaint/{key}-{ikey}.png"), Output("record", $"{root}/inpaint/{key}-{ikey}.request.json"),
                        Output("record", $"{root}/inpaint/{key}-{ikey}.receipt.json")),
                    Target = new JsonObject
                    {
                        ["slots"] = new JsonArray($"background:{scene.SceneId}"),
                        ["process"] = "asset_process inpaint_merge { plan: <plan.json of inpaint_prep>, result: <PixelLab PNG> } -> the scene with the object (only the mask copied) and its itemPlacement",
                        ["field"] = $"scenes[{scene.SceneId}].backgroundUrl",
                        ["size"] = "512x512"
                    }
                });
                previous = request;
            }
        }

        var iconCells = new List<(string Icon, List<string> ItemIds, string Name, string? Visual)>();
        foreach (var item in gameCase.Items.Where(item => PixelCasePipeline.HasInventoryIcon(item) && IsNew($"item:{item.ItemId}")))
        {
            var url = item.ImageUrl?.Trim() ?? string.Empty;
            var match = Regex.Match(url, @"/items/([^/?#]+)\.png(?:[?#].*)?$", RegexOptions.IgnoreCase);
            var icon = match.Success ? match.Groups[1].Value : ItemKey(item.ItemId);
            var existing = iconCells.FindIndex(cell => cell.Icon == icon);
            if (existing >= 0) { iconCells[existing].ItemIds.Add(item.ItemId); continue; }
            iconCells.Add((icon, new List<string> { item.ItemId }, item.Name, AsciiText(item.VisualDescription)));
        }
        var styleSource = interiorRequests.FirstOrDefault() ?? firstMap;
        var libraryStyle = styleSource is null
            ? interiors.Concat(maps).Select(scene => $"scene:{scene.SceneId}").FirstOrDefault(subject => LibraryUrl(subject) is { Length: > 0 })
            : null;
        var iconReference = T.ById["icon-sheet"]["references"]![0]!.AsObject();
        for (var start = 0; start < iconCells.Count; start += IconsPerSheet)
        {
            var cells = iconCells.Skip(start).Take(IconsPerSheet).ToList();
            var n = start / IconsPerSheet + 1;
            var hints = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
            var grid = cells.Select((cell, index) =>
            {
                var token = $"itemVisual:{cell.Icon}";
                if (cell.Visual is null)
                    hints[token] = new JsonObject
                    {
                        ["fillFrom"] = $"items[itemId={cell.ItemIds[0]}].visualDescription",
                        ["hint"] = "Short English noun phrase for the icon, e.g. \"small brown leather logbook\".",
                        ["context"] = new JsonObject { ["itemIds"] = new JsonArray(cell.ItemIds.Select(id => (JsonNode)id).ToArray()), ["name"] = cell.Name }
                    };
                var col = index % IconColumns;
                var row = index / IconColumns;
                return new JsonObject
                {
                    ["cell"] = index, ["row"] = row + 1, ["col"] = col + 1,
                    ["box"] = new JsonArray(col * IconCell, row * IconCell, (col + 1) * IconCell, (row + 1) * IconCell),
                    ["icon"] = cell.Icon, ["itemIds"] = new JsonArray(cell.ItemIds.Select(id => (JsonNode)id).ToArray()), ["name"] = cell.Name,
                    ["text"] = cell.Visual is null ? $"{{{{{token}}}}}" : StripPeriod(cell.Visual),
                    ["slotId"] = $"item:{cell.ItemIds[0]}"
                };
            }).ToList();
            var rows = new List<string>();
            for (var r = 0; r * IconColumns < grid.Count; r++)
                rows.Add($"Row {r + 1}: {string.Join("; ", grid.Skip(r * IconColumns).Take(IconColumns).Select(cell => cell["text"]!.GetValue<string>()))}.");
            var empty = IconsPerSheet - cells.Count;
            var values = new Dictionary<string, object?>
            {
                ["era"] = era,
                ["itemCountWord"] = NumberWord(cells.Count),
                ["gridRows"] = string.Join(' ', rows),
                ["emptyCellsNote"] = empty > 0
                    ? $"The remaining {NumberWord(empty)} cell{(empty == 1 ? string.Empty : "s")} after the last object stay{(empty == 1 ? "s" : string.Empty)} empty."
                    : string.Empty
            };
            var styleToken = styleSource?.Stage == "interior" ? "interiorImageUrl" : "mapImageUrl";
            var styleUrl = libraryStyle is not null ? LibraryUrl(libraryStyle)! : $"{{{{{styleToken}}}}}";
            Add(new Request
            {
                Id = $"icons.{n}", Step = 7, Stage = "icon-sheet", Template = "icon-sheet",
                Subject = new JsonObject { ["kind"] = "items", ["sheet"] = n, ["count"] = cells.Count },
                Params = Fixed("icon-sheet"),
                Prompt = T.Render("icon-sheet", values),
                References = new JsonArray(new JsonObject
                {
                    ["param"] = iconReference["param"]!.GetValue<string>(), ["url"] = styleUrl,
                    ["usage"] = iconReference["usage"]!.GetValue<string>(), ["usageSent"] = iconReference["usageSent"]!.GetValue<bool>()
                }),
                DependsOn = styleSource is not null ? new() { styleSource.Id } : new(),
                DependsOnLibrary = libraryStyle is not null ? new() { LibraryOf(libraryStyle)! } : new(),
                Generations = T.Cost("icon-sheet"),
                Extra = new JsonObject { ["grid"] = new JsonArray(grid.Select(cell => (JsonNode)cell).ToArray()) },
                Hints = hints,
                Deps = libraryStyle is not null ? new() : new()
                {
                    [styleToken] = new JsonObject
                    {
                        ["from"] = styleSource?.Id, ["how"] = "https://api.pixellab.ai/mcp/images/<job_id>/download?index=0 of that finished image."
                    }
                },
                Outputs = new JsonArray(Output("original", $"{root}/items/sheet-{n}-256.png"), Output("record", $"{root}/items/sheet-{n}.request.json"),
                    Output("record", $"{root}/items/sheet-{n}.receipt.json")),
                Target = new JsonObject
                {
                    ["slots"] = new JsonArray(grid.Select(cell => (JsonNode)cell["slotId"]!.GetValue<string>()).ToArray()),
                    ["process"] = "asset_process icon_sheet <sheet-256.png> -> one 64x64 PNG per cell (items[].imageUrl)",
                    ["size"] = "64x64"
                }
            });
        }

        // ---------------- finalise
        var missingCount = 0;
        var final = new JsonArray();
        var order = 0;
        foreach (var request in requests)
        {
            if (!request.Prompt.All(ch => ch >= 0x20 && ch <= 0x7e))
                throw new InvalidOperationException($"Prompt of {request.Id} is not ASCII.");
            var promptTokens = Tokens(request.Prompt);
            var missing = new JsonArray(promptTokens.Select(token =>
            {
                var entry = new JsonObject { ["placeholder"] = $"{{{{{token}}}}}" };
                var hint = request.Hints.GetValueOrDefault(token) ?? new JsonObject { ["fillFrom"] = "author", ["hint"] = "Fill before sending." };
                foreach (var (name, value) in hint) entry[name] = value?.DeepClone();
                return (JsonNode)entry;
            }).ToArray());
            missingCount += missing.Count;
            var depTokens = Tokens(request.Params.ToJsonString()).Concat(Tokens(request.References.ToJsonString()))
                .Distinct().Where(token => !promptTokens.Contains(token)).ToList();
            var fromDeps = new JsonArray(depTokens.Select(token =>
            {
                var entry = new JsonObject { ["placeholder"] = $"{{{{{token}}}}}" };
                var dep = request.Deps.GetValueOrDefault(token) ?? new JsonObject { ["from"] = null, ["how"] = "Fill before sending." };
                foreach (var (name, value) in dep) entry[name] = value?.DeepClone();
                return (JsonNode)entry;
            }).ToArray());
            var node = new JsonObject
            {
                ["id"] = request.Id,
                ["order"] = ++order,
                ["step"] = request.Step,
                ["stage"] = request.Stage,
                ["tool"] = T.ById[request.Template]["tool"]?.GetValue<string>(),
                ["template"] = request.Template,
                ["subject"] = request.Subject,
                ["params"] = request.Params,
                ["promptParam"] = T.ById[request.Template]["promptParam"]?.GetValue<string>(),
                ["prompt"] = request.Prompt,
                ["references"] = request.References,
                ["dependsOn"] = new JsonArray(request.DependsOn.Select(id => (JsonNode)id).ToArray()),
                ["calls"] = request.Calls,
                ["estimatedGenerations"] = request.Generations
            };
            if (request.DependsOnLibrary.Count > 0) node["dependsOnLibrary"] = new JsonArray(request.DependsOnLibrary.Select(id => (JsonNode)id).ToArray());
            foreach (var (name, value) in request.Extra) if (value is not null) node[name] = value.DeepClone();
            if (request.NeedsReview) node["needsReview"] = true;
            node["missingInputs"] = missing;
            node["inputsFromDependencies"] = fromDeps;
            node["rerollPolicy"] = "ask-user-first";
            node["outputs"] = request.Outputs;
            if (request.Target is not null) node["target"] = request.Target;
            final.Add(node);
        }

        var reuse = new JsonArray(subjects.Where(entry => entry.Source != AiAssetSources.PixelLab).Select(entry => (JsonNode)new JsonObject
        {
            ["subject"] = entry.Subject, ["kind"] = entry.Kind, ["name"] = entry.Name, ["source"] = entry.Source,
            ["libraryKey"] = entry.LibraryKey, ["parentKey"] = entry.ParentKey, ["variant"] = entry.Variant, ["libraryUrl"] = entry.LibraryUrl,
            ["slots"] = new JsonArray(entry.SlotIds.Select(id => (JsonNode)id).ToArray()), ["estimatedGenerations"] = 0
        }).ToArray());
        var total = requests.Sum(request => request.Generations);
        var byStep = new JsonObject();
        foreach (var group in requests.GroupBy(request => request.Step).OrderBy(group => group.Key))
            byStep[group.Key.ToString(CultureInfo.InvariantCulture)] = group.Sum(request => request.Generations);
        var newSubjects = subjects.Where(entry => entry.Source == AiAssetSources.PixelLab).ToList();
        return new JsonObject
        {
            ["planVersion"] = 1,
            ["generator"] = "PixelLabPlanBuilder (C# port of scripts/build_pixellab_requests.mjs)",
            ["templates"] = "ai-game-docs/visual-style-templates/pixellab/templates.json",
            ["policy"] = T.Policy.DeepClone(),
            ["styleReference"] = new JsonObject { ["url"] = T.StyleReferenceUrl, ["usage"] = T.StyleReferenceUsage },
            ["rules"] = new JsonArray(
                "Library first: reuse or make a variant (0 generations); only really new pictures go to PixelLab.",
                "Prompts are ASCII English without character names; maps and rooms say: No people, no animals, no readable text.",
                "New characters: draw the straight-on south front first, then rotate (v3), then idle.",
                "Investigation items are part of the scene art: a new scene paints them from visualDescription; a library or variant scene gets them with item-inpaint (asset_process inpaint_prep / inpaint_merge). Never paste an item picture onto a scene.",
                "Masks and exterior crops come from the NATIVE 512 map, never an upscaled copy.",
                "First creation runs; any reroll or re-creation asks Yen first.",
                "Keep the original PNGs, the requests and the receipts with job IDs outside src/FE/public."),
            ["requests"] = final,
            ["reuse"] = reuse,
            ["skippedCharacters"] = skipped,
            ["summary"] = new JsonObject
            {
                ["requests"] = requests.Count,
                ["pixellabCalls"] = requests.Sum(request => request.Calls),
                ["estimatedGenerations"] = total,
                ["generationsByStep"] = byStep,
                ["pixelLabCap"] = pixelLabCap,
                ["withinCap"] = total <= pixelLabCap,
                ["newSubjects"] = new JsonArray(newSubjects.Select(entry => (JsonNode)entry.Subject).ToArray()),
                ["reusedSubjects"] = reuse.Count,
                ["missingInputs"] = missingCount,
                ["requestsNeedingInput"] = new JsonArray(final.Where(node => node!["missingInputs"]!.AsArray().Count > 0)
                    .Select(node => (JsonNode)node!["id"]!.GetValue<string>()).ToArray()),
                ["warnings"] = new JsonArray(warnings.Select(text => (JsonNode)text).ToArray())
            }
        };
    }

    /// <summary>Clear message for a plan that needs more generations than the order allows.</summary>
    public static string CapMessage(JsonObject plan)
    {
        var summary = plan["summary"]!.AsObject();
        var total = summary["estimatedGenerations"]!.GetValue<int>();
        var cap = summary["pixelLabCap"]!.GetValue<int>();
        var lines = plan["requests"]!.AsArray()
            .Select(node => $"{node!["id"]!.GetValue<string>()} ({node["estimatedGenerations"]!.GetValue<int>()})");
        return $"The picture plan needs {total} PixelLab generations but this order allows {cap} (pixelLabCap). "
               + $"New requests: {string.Join(", ", lines)}. Reuse library pictures or variants (0 generations) for some of them, "
               + "or ask Yen to raise the cap. Nothing may be drawn before the plan fits.";
    }

    private static JsonObject Output(string kind, string path) => new() { ["kind"] = kind, ["path"] = path };

    private static JsonObject SlotTarget(string slotId, string field, string size, string runtime) => new()
    {
        ["slots"] = new JsonArray(slotId), ["field"] = field, ["size"] = size, ["runtime"] = runtime
    };
}
