using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public interface IGameplayProjectionPlanner
{
    CaseValidationResult ValidateProjectability(AiCaseDraft draft, CaseTruthPackage truth);
    GameplayProjectionPlan Build(AiCaseDraft draft, CaseTruthPackage truth);
}

public interface IProjectionContentSchemaFactory
{
    JsonObject Build(GameplayProjectionPlan plan);
}

public interface IGameCaseProjectionCompiler
{
    GameCase Compile(GameplayProjectionPlan plan, GameplayProjectionContent content, AiDraftSettings settings);
}

public interface IProjectionGraphValidator
{
    CaseValidationResult Validate(CaseTruthPackage truth, GameplayProjectionPlan plan, GameCase gameCase);
}

/// <summary>
/// Restores the plan-owned slot values that the strict content schema does not ask the model for.
/// Only fields whose single valid answer already lives in the plan are written; slot membership,
/// identity strings and player-facing prose stay exactly as generated so the compiler's conformance
/// checks keep their teeth.
/// </summary>
public static class ProjectionContentLocks
{
    public static void Apply(GameplayProjectionPlan plan, GameplayProjectionContent content)
    {
        foreach (var (id, clue) in content.Clues)
        {
            if (!plan.Clues.TryGetValue(id, out var slot)) continue;
            clue.SupportsConclusionIds = slot.SupportsConclusionIds.ToList();
        }
        foreach (var (id, dialogue) in content.Dialogues)
        {
            if (!plan.Dialogues.TryGetValue(id, out var slot)) continue;
            dialogue.StatementIds = slot.StatementIds.ToList();
        }
        foreach (var (id, puzzle) in content.Puzzles)
        {
            if (plan.Puzzles.TryGetValue(id, out var slot))
            {
                puzzle.BasedOnTruthIds = slot.BasedOnTruthIds.ToList();
                puzzle.RevealsConclusionIds = slot.RevealsConclusionIds.ToList();
            }
            var skeleton = plan.Skeleton.Puzzles.FirstOrDefault(item => item.PuzzleId == id);
            if (skeleton is null) continue;
            puzzle.Options = skeleton.Options.ToList();
            puzzle.CorrectSequence = skeleton.CorrectSequence.ToList();
        }
    }
}

public static class ProjectionCanonicalizer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string HashObject<T>(T value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonicalize(value)))).ToLowerInvariant();

    public static string Canonicalize<T>(T value)
    {
        var node = JsonSerializer.SerializeToNode(value, JsonOptions)
                   ?? throw new InvalidOperationException("Projection artifact could not be serialized.");
        return Sort(node).ToJsonString(JsonOptions);
    }

    public static string ComputePlanHash(GameplayProjectionPlan plan)
    {
        var node = JsonSerializer.SerializeToNode(plan, JsonOptions)?.AsObject()
                   ?? throw new InvalidOperationException("Projection plan could not be serialized.");
        node["planHash"] = string.Empty;
        if (node["skeleton"] is JsonObject skeleton)
            skeleton["projectionPlanHash"] = string.Empty;
        return Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes(Sort(node).ToJsonString(JsonOptions)))).ToLowerInvariant();
    }

    public static IReadOnlyList<string> FindDuplicatePropertyPaths(string json)
    {
        using var document = JsonDocument.Parse(json);
        var duplicates = new List<string>();
        Visit(document.RootElement, "$", duplicates);
        return duplicates;
    }

    private static void Visit(JsonElement element, string path, ICollection<string> duplicates)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                var childPath = $"{path}.{property.Name}";
                if (!names.Add(property.Name)) duplicates.Add(childPath);
                Visit(property.Value, childPath, duplicates);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var item in element.EnumerateArray())
            {
                Visit(item, $"{path}[{index}]", duplicates);
                index++;
            }
        }
    }

    private static JsonNode Sort(JsonNode node) =>
        node switch
        {
            JsonObject obj => new JsonObject(obj.OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .Select(pair => KeyValuePair.Create(pair.Key, pair.Value is null ? null : Sort(pair.Value)))),
            JsonArray array => new JsonArray(array.Select(item => item is null ? null : Sort(item)).ToArray()),
            _ => node.DeepClone()
        };
}
