using System.Text.Json;
using System.Text.Json.Nodes;

namespace SirLocked.Api.Services.Projection;

/// <summary>A smaller model wire format; persisted/public GameCase contracts do not change.</summary>
public static class ProjectionWireContract
{
    public const string CompactVersion = "gameplay-projection-content-v2";
    public const string PromptVersion = "ai-projection-content-prompt-v2";

    public static string Version(string? version) => version == CompactVersion ? CompactVersion : GameplayProjectionVersions.Content;

    public static JsonObject Schema(JsonObject legacy, string? version)
    {
        var schema = legacy.DeepClone().AsObject();
        if (Version(version) != CompactVersion) return schema;
        StripConstants(schema, root: true);
        schema["properties"]!["schemaVersion"]!["const"] = CompactVersion;
        return schema;
    }

    private static void StripConstants(JsonObject schema, bool root = false)
    {
        if (schema["properties"] is not JsonObject properties) return;
        foreach (var (name, value) in properties.ToArray())
        {
            if (value is not JsonObject child) continue;
            if (!root && child.ContainsKey("const"))
            {
                properties.Remove(name);
                if (schema["required"] is JsonArray required)
                    for (var i = required.Count - 1; i >= 0; i--)
                        if (required[i]?.GetValue<string>() == name) required.RemoveAt(i);
            }
            else StripConstants(child);
        }
    }

    public static string Serialize(GameplayProjectionContent content, JsonObject schema)
    {
        var node = JsonSerializer.SerializeToNode(content, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        node["schemaVersion"] = schema["properties"]!["schemaVersion"]!["const"]!.GetValue<string>();
        return Project(node, schema).ToJsonString();
    }

    private static JsonNode Project(JsonNode node, JsonObject schema)
    {
        if (node is JsonObject obj && schema["properties"] is JsonObject properties)
            return new JsonObject(properties.Select(pair => KeyValuePair.Create(pair.Key,
                obj[pair.Key] is { } value ? Project(value, pair.Value!.AsObject()) : null)));
        return node.DeepClone();
    }

    public static void RestoreScalarLocks(GameplayProjectionPlan plan, GameplayProjectionContent content)
    {
        if (content.SchemaVersion != CompactVersion) return;
        foreach (var (id, value) in content.Stages) value.StageId = id;
        foreach (var (id, value) in content.Scenes)
            if (plan.Scenes.TryGetValue(id, out var slot)) { value.SceneId = id; value.TruthLocationId = slot.TruthLocationId; }
        foreach (var (id, value) in content.Characters) value.CharacterId = id;
        foreach (var (id, value) in content.Items) value.ItemId = id;
        foreach (var (id, value) in content.Clues)
            if (plan.Clues.TryGetValue(id, out var slot))
            { value.ClueId = id; value.TraceId = slot.TraceId; value.SceneId = slot.SceneId; value.SourceActionId = slot.SourceActionId; }
        foreach (var (id, value) in content.Dialogues)
            if (plan.Dialogues.TryGetValue(id, out var slot)) { value.DialogueId = id; value.CharacterId = slot.CharacterId; }
        foreach (var (id, value) in content.TestimonyFragments) value.FragmentId = id;
        foreach (var (id, value) in content.EvidenceChallenges) value.ChallengeId = id;
        foreach (var (id, value) in content.ConversationNodes) value.NodeId = id;
        foreach (var (id, value) in content.Puzzles)
        {
            value.PuzzleId = id;
            var puzzle = plan.Skeleton.Puzzles.FirstOrDefault(item => item.PuzzleId == id);
            if (puzzle is not null) value.CorrectCode = puzzle.CorrectCode;
        }
        foreach (var (id, value) in content.Interactions) value.InteractionId = id;
        foreach (var (id, value) in content.Deductions)
            if (plan.Deductions.TryGetValue(id, out var slot)) { value.DeductionId = id; value.ConclusionId = slot.ConclusionId; }
        foreach (var (id, value) in content.RequiredTeamworkChains) value.ChainId = id;
        foreach (var (id, value) in content.Hints) value.HintId = id;
    }
}
