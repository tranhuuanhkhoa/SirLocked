using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

// A complete truth already has stable row IDs. Edit selected facts in a copy so a small
// correction does not ask a model to recreate unrelated rows in five successive artifacts.
internal static class TruthFindingRepair
{
    internal const string Version = "truth-finding-edits-v1";
    internal const string UnresolvedAfterRebuild = "UNRESOLVED_AFTER_SCOPED_REBUILD";

    internal static string FindingsKey(CaseTruthFeasibilityReview review)
    {
        var keys = review.Findings.Select(finding => JsonSerializer.Serialize(new
        {
            finding.Code,
            related = finding.RelatedIds.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)
        })).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal);
        return string.Join("\n", keys);
    }
    internal static JsonObject Schema() => JsonNode.Parse("""
        {"type":"object","additionalProperties":false,"required":["edits"],
         "properties":{"edits":{"type":"array","maxItems":32,"items":{"type":"object",
         "additionalProperties":false,"required":["rowId","field","value"],"properties":{
         "rowId":{"type":"string","maxLength":96},"field":{"type":"string","maxLength":64},
         "value":{"type":"string","minLength":1,"maxLength":400}}}}}}
        """)!.AsObject();

    private static readonly (string Stage, string Collection, string Key, string Fields)[] Sections =
    [
        (CaseTruthArtifacts.Timeline, "trueTimeline", "eventId", "action startMinute endMinute travelFromPreviousMinutes"),
        (CaseTruthArtifacts.Opportunity, "opportunityMatrix", "characterId", "availableFromMinute availableToMinute eliminationReason"),
        (CaseTruthArtifacts.Evidence, "traceLedger", "traceId", "physicalCause persistenceReason proves doesNotProve createdAtMinute"),
        (CaseTruthArtifacts.Statements, "statementLedger", "statementId", "content reasonForLie"),
        (CaseTruthArtifacts.ProofGraph, "conclusions", "conclusionId", "proposition"),
        (CaseTruthArtifacts.ProofGraph, "redHerringLedger", "redHerringId", "suspiciousReason innocentExplanation")
    ];

    internal static string EditableFields(string from) => string.Join("\n", Sections
        .Where(section => CaseTruthRepairPolicy.IsAtOrBefore(from, section.Stage))
        .Select(section => $"{section.Collection} ({section.Key}): {section.Fields}"));

    internal static CaseTruthPackage? Apply(CaseTruthPackage source, string from, string json, int maxLength)
    {
        JsonNode? response;
        try { response = JsonNode.Parse(json); }
        catch (JsonException) { return null; }
        if (response is not JsonObject obj || obj["edits"] is not JsonArray { Count: > 0 and <= 32 } edits) return null;
        var copy = JsonSerializer.SerializeToNode(source, AiCaseService.PromptJson)!.AsObject();
        var seen = new HashSet<(string, string)>();
        foreach (var edit in edits)
        {
            if (edit is not JsonObject entry || entry["rowId"] is not JsonValue rowId || !rowId.TryGetValue<string>(out var id)
                || entry["field"] is not JsonValue fieldNode || !fieldNode.TryGetValue<string>(out var field)
                || entry["value"] is not JsonValue valueNode || !valueNode.TryGetValue<string>(out var value)) return null;
            if (string.IsNullOrWhiteSpace(value) || value.Length > maxLength || !seen.Add((id, field))) return null;
            var modified = false;
            foreach (var section in Sections)
            {
                if (!CaseTruthRepairPolicy.IsAtOrBefore(from, section.Stage) || !section.Fields.Split(' ').Contains(field)) continue;
                var rows = section.Collection == "conclusions" ? copy["proofGraph"]?["conclusions"] : copy[section.Collection];
                var row = rows?.AsArray().OfType<JsonObject>().FirstOrDefault(entry => (string?)entry[section.Key] == id);
                if (row?[field] is not JsonValue old) continue;
                if (old.GetValueKind() == JsonValueKind.Number)
                {
                    if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var number)) return null;
                    row[field] = number;
                }
                else row[field] = value;
                modified = !JsonNode.DeepEquals(old, row[field]);
                break;
            }
            if (!modified) return null;
        }
        return copy.Deserialize<CaseTruthPackage>(AiCaseService.PromptJson);
    }
}
