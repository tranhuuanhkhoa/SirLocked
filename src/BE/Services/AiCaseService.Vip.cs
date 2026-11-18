using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using MongoDB.Driver;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Vip;

namespace SirLocked.Api.Services;

/// <summary>
/// The two extra steps of a paid VIP order (VUAN-7): the order brief with its content check (light model, before the
/// story), and the picture plan (one main-model call that picks library pictures, variants and PixelLab requests within
/// the order's pixelLabCap, through the same <see cref="PixelAssetPlanning"/> rules as the bot's plan).
/// </summary>
public partial class AiCaseService
{
    internal const string VipBriefSchemaVersion = "vip-brief-v1";
    internal const string VipAssetPlanSchemaVersion = "vip-asset-plan-v1";
    private const int VipAssetPlanTries = 3;

    internal static JsonObject VipBriefSchema()
    {
        static JsonObject Str() => new() { ["type"] = "string" };
        static JsonObject List() => new() { ["type"] = "array", ["items"] = new JsonObject { ["type"] = "string" } };
        return new JsonObject
        {
            ["type"] = "object",
            ["additionalProperties"] = false,
            ["required"] = new JsonArray("summary", "victim", "setting", "suspects", "mustInclude", "avoid", "tone", "contentOk", "contentIssues"),
            ["properties"] = new JsonObject
            {
                ["summary"] = Str(), ["victim"] = Str(), ["setting"] = Str(), ["suspects"] = List(),
                ["mustInclude"] = List(), ["avoid"] = List(), ["tone"] = Str(),
                ["contentOk"] = new JsonObject { ["type"] = "boolean" },
                ["contentIssues"] = List()
            }
        };
    }

    internal static string VipBriefPrompt(AiCaseDraft draft)
    {
        var level = draft.Order?.ContentLevel ?? AiCaseContentLevels.Standard;
        return new StringBuilder()
            .AppendLine("A VIP player paid for a detective case in Sir Locked (a cooperative two-player pixel detective game).")
            .AppendLine("Read the order below and return a structured brief for the writers, plus a content check.")
            .AppendLine()
            .AppendLine("Brief: summary (2-4 sentences in the case language), victim, setting, suspects (names or roles the creator asked for),")
            .AppendLine("mustInclude (concrete wishes), avoid (what the creator does not want), tone.")
            .AppendLine()
            .AppendLine($"Content check (content level {level}). contentOk is false when the order asks for any of:")
            .AppendLine("- real people (living or historical public figures, the creator's acquaintances) as characters or victims;")
            .AppendLine("- characters, places or plots copied from an existing book, film or game;")
            .AppendLine("- sexual content, content involving minors in danger, hate speech or slurs, real-world extremism;")
            .AppendLine("- self-harm or suicide shown or explained; instructions for weapons, poisons or crimes that work in reality;")
            .AppendLine(level == AiCaseContentLevels.Light
                ? "- any death or blood on screen (LIGHT: thefts, disappearances, frauds; a death may only be mentioned)."
                : "- graphic violence or gore (STANDARD: a murder may happen, never described in detail).")
            .AppendLine("List every problem in contentIssues (empty when contentOk is true). Do not soften the brief to pass the check.")
            .AppendLine()
            .AppendLine("CREATOR IDEA:")
            .AppendLine(string.IsNullOrWhiteSpace(draft.Prompt) ? "(none: the writers choose)" : draft.Prompt)
            .ToString();
    }

    private static string MockVipBrief() => JsonSerializer.Serialize(new
    {
        summary = "A small mystery for two detectives.",
        victim = "A shop owner",
        setting = "Hàng Đường street",
        suspects = Array.Empty<string>(),
        mustInclude = Array.Empty<string>(),
        avoid = Array.Empty<string>(),
        tone = "cozy",
        contentOk = true,
        contentIssues = Array.Empty<string>()
    });

    /// <summary>
    /// VIP orders only: writes the brief once (light model). A failed content check stops the order before any
    /// expensive step; the reconciler then refunds it in full.
    /// </summary>
    private async Task EnsureVipBriefAsync(AiCaseDraft draft)
    {
        if (draft.Lane != AiDraftLanes.VipApi || draft.VipBrief is not null) return;
        var json = await GenerateJsonAsync(
            draft.Id, VipModelRouter.BriefStep, VipBriefPrompt(draft), maxOutputTokens: 2000,
            VipBriefSchemaVersion, VipBriefSchema(), attemptNumber: 1,
            mockResponseFactory: MockVipBrief, generationRunId: draft.GenerationRunId);
        var node = JsonNode.Parse(json)!.AsObject();
        static List<string> Strings(JsonNode? value) =>
            value is JsonArray array ? array.Select(item => item?.GetValue<string>() ?? string.Empty).Where(item => item.Length > 0).ToList() : [];
        var brief = new AiVipBrief
        {
            Summary = node["summary"]?.GetValue<string>() ?? string.Empty,
            Victim = node["victim"]?.GetValue<string>() ?? string.Empty,
            Setting = node["setting"]?.GetValue<string>() ?? string.Empty,
            Suspects = Strings(node["suspects"]),
            MustInclude = Strings(node["mustInclude"]),
            Avoid = Strings(node["avoid"]),
            Tone = node["tone"]?.GetValue<string>() ?? string.Empty,
            ContentOk = node["contentOk"]?.GetValue<bool>() ?? false,
            ContentIssues = Strings(node["contentIssues"]),
            CreatedAt = DateTime.UtcNow
        };
        await _db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draft.Id,
            Builders<AiCaseDraft>.Update.Set(item => item.VipBrief, brief).Set(item => item.UpdatedAt, DateTime.UtcNow));
        draft.VipBrief = brief;
        _orderBlocks.Remove(draft.Id);
        await LogGenerationAsync(draft.Id, ProviderName, VipModelRouter.BriefStep, brief.ContentOk ? "CONTENT_OK" : "CONTENT_REJECTED",
            string.Empty, brief.ContentOk ? "Brief written." : "Content check failed: " + string.Join("; ", brief.ContentIssues), null);
        if (!brief.ContentOk)
            throw VipLaneErrors.Stop(VipLaneErrors.ContentRejected,
                "The order does not pass the content rules: " + string.Join("; ", brief.ContentIssues.Take(5)));
    }

    /// <summary>The brief of a VIP order, appended to every later step's prompt next to the order block.</summary>
    internal static string BuildVipBriefBlock(AiVipBrief? brief)
    {
        if (brief is null) return string.Empty;
        var builder = new StringBuilder().AppendLine("CREATOR BRIEF (from the paid order; follow it):");
        builder.AppendLine("- summary: " + brief.Summary);
        if (brief.Victim.Length > 0) builder.AppendLine("- victim: " + brief.Victim);
        if (brief.Setting.Length > 0) builder.AppendLine("- setting: " + brief.Setting);
        if (brief.Suspects.Count > 0) builder.AppendLine("- suspects: " + string.Join("; ", brief.Suspects));
        if (brief.MustInclude.Count > 0) builder.AppendLine("- must include: " + string.Join("; ", brief.MustInclude));
        if (brief.Avoid.Count > 0) builder.AppendLine("- avoid: " + string.Join("; ", brief.Avoid));
        if (brief.Tone.Length > 0) builder.AppendLine("- tone: " + brief.Tone);
        return builder.ToString().TrimEnd();
    }

    internal static JsonObject VipAssetPlanSchema() => new()
    {
        ["type"] = "object",
        ["additionalProperties"] = false,
        ["required"] = new JsonArray("choices"),
        ["properties"] = new JsonObject
        {
            ["choices"] = new JsonObject
            {
                ["type"] = "array",
                ["items"] = new JsonObject
                {
                    ["type"] = "object",
                    ["additionalProperties"] = false,
                    ["required"] = new JsonArray("subject", "source", "libraryKey", "parentKey", "variant", "inpaintItems", "note"),
                    ["properties"] = new JsonObject
                    {
                        ["subject"] = new JsonObject { ["type"] = "string" },
                        ["source"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("LIBRARY", "VARIANT", "PIXELLAB") },
                        ["libraryKey"] = new JsonObject { ["type"] = "string" },
                        ["parentKey"] = new JsonObject { ["type"] = "string" },
                        ["variant"] = new JsonObject { ["type"] = "string" },
                        ["inpaintItems"] = new JsonObject { ["type"] = "array", ["items"] = new JsonObject { ["type"] = "string" } },
                        ["note"] = new JsonObject { ["type"] = "string" }
                    }
                }
            }
        }
    };

    /// <summary>
    /// VIP pixel orders: one planning call chooses where every picture comes from; the plan goes through
    /// <see cref="PixelAssetPlanning.Plan"/> (templates.json, NPC in three steps, items painted into scenes with a wide
    /// inpaint mask, never pasted) and must fit pixelLabCap by its <c>estimatedGenerations</c>. A plan that does not fit
    /// is asked again with the reason (the third try goes to the rescue model); still too big, the order stops.
    /// </summary>
    private async Task EnsureVipAssetPlanAsync(AiCaseDraft draft)
    {
        if (draft.Lane != AiDraftLanes.VipApi || !PixelCasePipeline.IsPixel(draft) || draft.AssetPlan is not null) return;
        if (string.IsNullOrWhiteSpace(draft.GeneratedJson)) return;
        var gameCase = _caseService.ParseCase(draft.GeneratedJson);
        var library = await _db.AssetLibrary.Find(Builders<AssetLibraryEntry>.Filter.Empty).ToListAsync(_operationCancellationToken);
        // PixelLab for VIP orders is off until a no-AI PixelLab runner is proven: library and variants only.
        var pixelLabEnabled = (await new VipSettingsStore(_db).GetPricingAsync(_operationCancellationToken)).PixelLabEnabled;
        var cap = pixelLabEnabled ? draft.Order?.PixelLabCap ?? AiCaseOrder.VipPixelLabCap : 0;
        var recordRoot = $"tmp/pixellab/{draft.Id}";
        var preview = PixelAssetPlanning.Plan(gameCase, [], library, cap, recordRoot);
        var world = draft.Order?.World ?? AiCaseWorlds.HangDuongVictorian;
        var basePrompt = VipAssetPlanPrompt(draft, preview, library, world, cap);
        var feedback = string.Empty;
        for (var attempt = 1; attempt <= VipAssetPlanTries; attempt++)
        {
            var json = await GenerateJsonAsync(
                draft.Id, VipModelRouter.AssetPlanStep, basePrompt + feedback, maxOutputTokens: 4000,
                VipAssetPlanSchemaVersion, VipAssetPlanSchema(), attemptNumber: attempt,
                mockResponseFactory: () => MockVipAssetPlan(preview, library),
                generationRunId: draft.GenerationRunId);
            var choices = JsonSerializer.Deserialize<VipAssetPlanAnswer>(json, CompactJson)?.Choices ?? [];
            var result = PixelAssetPlanning.Plan(gameCase, choices, library, cap, recordRoot);
            if (result.Errors.Count == 0 && result.WithinCap)
            {
                var accepted = PixelAssetPlanning.Accept(result, choices);
                await _db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draft.Id,
                    Builders<AiCaseDraft>.Update.Set(item => item.AssetPlan, accepted).Set(item => item.UpdatedAt, DateTime.UtcNow));
                draft.AssetPlan = accepted;
                await LogGenerationAsync(draft.Id, ProviderName, VipModelRouter.AssetPlanStep, "PLANNED", string.Empty,
                    $"Picture plan accepted: {result.EstimatedGenerations}/{cap} PixelLab generations, {accepted.Requests} request(s).", null);
                return;
            }
            feedback = "\n\nYOUR LAST PLAN WAS REFUSED. Fix it:\n"
                       + (result.Errors.Count > 0 ? "- " + string.Join("\n- ", result.Errors.Take(20)) + "\n" : string.Empty)
                       + (result.WithinCap ? string.Empty
                           : $"- it needs {result.EstimatedGenerations} PixelLab generations but the order allows {cap}: use more library pictures and variants.\n");
        }
        throw VipLaneErrors.Stop(VipLaneErrors.PixelLabCap,
            $"No picture plan fits the order's {cap} PixelLab generations after {VipAssetPlanTries} tries.");
    }

    private sealed class VipAssetPlanAnswer
    {
        public List<AiAssetChoice> Choices { get; set; } = [];
    }

    private static string VipAssetPlanPrompt(
        AiCaseDraft draft, PixelAssetPlanning.Result preview, IReadOnlyCollection<AssetLibraryEntry> library, string world, int cap)
    {
        var builder = new StringBuilder()
            .AppendLine("Plan the pictures of this pixel detective case. For every subject choose its source:")
            .AppendLine(cap == 0
                ? "PixelLab is NOT available for this order: use LIBRARY or VARIANT for every subject (a library picture may serve several subjects) and leave inpaintItems empty."
                : string.Empty)
            .AppendLine("- LIBRARY: reuse a library picture as it is (libraryKey). Costs 0 PixelLab generations.")
            .AppendLine("- VARIANT: a code-made variant of a library picture (parentKey + variant: night, dusk, snow, after_rain, mirror, recolor). Costs 0.")
            .AppendLine("- PIXELLAB: a new picture. A new NPC costs 14 generations (front, rotate, idle; 96x96 frames, life-like proportions, never chibi);")
            .AppendLine("  a new room or map costs about 25. New scenes describe their investigation items so PixelLab paints them in.")
            .AppendLine("- A LIBRARY or VARIANT scene that lacks an investigation item lists it in inpaintItems: the item is painted into the")
            .AppendLine("  scene with one wide-mask inpaint per scene (10 generations), never pasted as a separate picture.")
            .AppendLine($"The whole plan must stay within {cap} PixelLab generations: library first, then variants, PixelLab last.")
            .AppendLine("Keep libraryKey/parentKey/variant empty when they do not apply; inpaintItems lists item ids of that scene.")
            .AppendLine()
            .AppendLine("SUBJECTS:");
        foreach (var subject in preview.Subjects)
        {
            var suggestions = PixelAssetPlanning.Suggestions(draft.Order, subject.Kind, subject.Projection, library);
            builder.Append("- ").Append(subject.Subject).Append(" | kind ").Append(subject.Kind)
                .Append(" | ").Append(subject.Name)
                .Append(" | library kind ").Append(PixelAssetPlanning.LibraryKindFor(subject.Kind, subject.Projection));
            if (!string.IsNullOrWhiteSpace(subject.Projection)) builder.Append(" | projection ").Append(subject.Projection);
            if (suggestions.Count > 0) builder.Append(" | suggested keys: ").Append(string.Join(", ", suggestions.Take(8)));
            builder.AppendLine();
        }
        builder.AppendLine().AppendLine($"LIBRARY ({world} and shared pictures; key | kind | name | tags):");
        foreach (var entry in library
                     .Where(entry => !entry.Retired && (entry.World == world || entry.World == AiCaseWorlds.All))
                     .OrderBy(entry => entry.Kind, StringComparer.Ordinal).ThenBy(entry => entry.Key, StringComparer.Ordinal)
                     .Take(400))
            builder.Append("- ").Append(entry.Key).Append(" | ").Append(entry.Kind).Append(" | ").Append(entry.NameEn.Length > 0 ? entry.NameEn : entry.NameVi)
                .Append(" | ").AppendLine(string.Join(",", entry.Tags.Take(8)));
        return builder.ToString();
    }

    private static string MockVipAssetPlan(PixelAssetPlanning.Result preview, IReadOnlyCollection<AssetLibraryEntry> library) =>
        JsonSerializer.Serialize(new
        {
            choices = preview.Subjects.Select(subject =>
            {
                var kind = PixelAssetPlanning.LibraryKindFor(subject.Kind, subject.Projection);
                var match = library.FirstOrDefault(entry => !entry.Retired && entry.Kind == kind);
                return new
                {
                    subject = subject.Subject,
                    source = match is null ? "PIXELLAB" : "LIBRARY",
                    libraryKey = match?.Key ?? string.Empty,
                    parentKey = string.Empty,
                    variant = string.Empty,
                    inpaintItems = Array.Empty<string>(),
                    note = string.Empty
                };
            })
        }, CompactJson);
}
