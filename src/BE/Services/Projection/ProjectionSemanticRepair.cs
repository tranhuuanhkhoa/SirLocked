using System.Text.Json.Nodes;

namespace SirLocked.Api.Services.Projection;

public sealed record ProjectionRepairScope(
    IReadOnlySet<string> ChallengeIds,
    IReadOnlyDictionary<string, HashSet<string>> Slots);

/// <summary>Patch only the dependency closure of failed contradictions; never replace other content.</summary>
public static class ProjectionSemanticRepair
{
    public static ProjectionRepairScope Scope(GameplayProjectionPlan plan, IEnumerable<string> failedIds)
    {
        var challenges = failedIds.Where(plan.Challenges.ContainsKey).ToHashSet(StringComparer.Ordinal);
        var clues = new HashSet<string>(StringComparer.Ordinal);
        var dialogues = new HashSet<string>(StringComparer.Ordinal);
        bool changed;
        do
        {
            foreach (var id in challenges)
            {
                clues.Add(plan.Challenges[id].CorrectEvidenceId);
                dialogues.Add(plan.Challenges[id].DialogueId);
            }
            changed = false;
            foreach (var (id, challenge) in plan.Challenges)
                if (dialogues.Contains(challenge.DialogueId) || challenge.CandidateEvidenceIds.Any(clues.Contains))
                    changed |= challenges.Add(id);
        } while (changed);

        var fragments = plan.TestimonyFragments.Where(pair => dialogues.Contains(pair.Value.DialogueId))
            .Select(pair => pair.Key).ToHashSet(StringComparer.Ordinal);
        var nodes = plan.ConversationNodes.Where(pair => challenges.Contains(pair.Value.ChallengeId))
            .Select(pair => pair.Key).ToHashSet(StringComparer.Ordinal);
        return new ProjectionRepairScope(challenges, new Dictionary<string, HashSet<string>>(StringComparer.Ordinal)
        {
            ["clues"] = clues, ["dialogues"] = dialogues, ["testimonyFragments"] = fragments,
            ["evidenceChallenges"] = challenges, ["conversationNodes"] = nodes
        });
    }

    public static JsonObject Schema(JsonObject contentSchema, ProjectionRepairScope scope)
    {
        var schema = contentSchema.DeepClone().AsObject();
        var properties = schema["properties"]!.AsObject();
        foreach (var key in properties.Select(pair => pair.Key).ToArray())
        {
            if (key is "schemaVersion" or "planHash") continue;
            if (!scope.Slots.TryGetValue(key, out var keys) || keys.Count == 0)
            { properties.Remove(key); continue; }
            var section = properties[key]!.AsObject();
            var slots = section["properties"]!.AsObject();
            foreach (var id in slots.Select(pair => pair.Key).Where(id => !keys.Contains(id)).ToArray()) slots.Remove(id);
            section["required"] = new JsonArray(slots.Select(pair => JsonValue.Create(pair.Key)).ToArray());
        }
        schema["required"] = new JsonArray(properties.Select(pair => JsonValue.Create(pair.Key)).ToArray());
        return schema;
    }

    public static string Checkpoint(string contentJson, JsonObject patchSchema)
    {
        var content = JsonNode.Parse(contentJson)!.AsObject();
        var result = new JsonObject();
        foreach (var (section, value) in patchSchema["properties"]!.AsObject())
        {
            if (section is "schemaVersion" or "planHash")
                result[section] = value!["const"]!.DeepClone();
            else
            {
                var slots = new JsonObject();
                foreach (var (id, _) in value!["properties"]!.AsObject())
                    slots[id] = content[section]![id]!.DeepClone();
                result[section] = slots;
            }
        }
        return result.ToJsonString();
    }

    public static string Merge(string baselineJson, string patchJson, JsonObject patchSchema)
    {
        if (ProjectionCanonicalizer.FindDuplicatePropertyPaths(patchJson).Count > 0)
            throw new ProjectionCompilationException(["PROJECTION_PATCH_DUPLICATE_PROPERTY."]);
        var baseline = JsonNode.Parse(baselineJson)!.AsObject();
        if (JsonNode.Parse(patchJson) is not JsonObject patch)
            throw new ProjectionCompilationException(["PROJECTION_PATCH_SCOPE expected a JSON object."]);
        var properties = patchSchema["properties"]!.AsObject();
        if (!patch.Select(pair => pair.Key).ToHashSet().SetEquals(properties.Select(pair => pair.Key)))
            throw new ProjectionCompilationException(["PROJECTION_PATCH_SCOPE root sections differ from the repair scope."]);
        foreach (var (section, value) in patch)
        {
            if (section is "schemaVersion" or "planHash")
            {
                if (value is not JsonValue scalar || !scalar.TryGetValue<string>(out var identity)
                    || identity != properties[section]!["const"]!.GetValue<string>())
                    throw new ProjectionCompilationException(["PROJECTION_PATCH_ENVELOPE changed identity."]);
                continue;
            }
            if (value is not JsonObject slots || !slots.Select(pair => pair.Key).ToHashSet()
                    .SetEquals(properties[section]!["properties"]!.AsObject().Select(pair => pair.Key)))
                throw new ProjectionCompilationException([$"PROJECTION_PATCH_SCOPE {section} differs from the repair scope."]);
            foreach (var (id, item) in slots)
            {
                if (item is not JsonObject)
                    throw new ProjectionCompilationException([$"PROJECTION_PATCH_SCOPE {section}.{id} must be an object."]);
                baseline[section]![id] = item.DeepClone();
            }
        }
        return baseline.ToJsonString();
    }
}
