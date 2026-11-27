using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Services;

public partial class AiCaseService
{
    private async Task<(GameCase Case, CaseValidationResult Validation)> RepairProjectionFieldsAsync(
        AiCaseDraft draft, GameCase gameCase, CaseValidationResult validation, string sourceStep,
        ProjectionRepairScope? reviewScope = null)
    {
        if (validation.IsValid || draft.ProjectionPlan is null || string.IsNullOrWhiteSpace(draft.ProjectionContentJson))
            return (gameCase, validation);

        var fullSchema = CaseLogicSchema(draft);
        for (var round = 0; round < 2 && !validation.IsValid; round++)
        {
            var paths = ProjectionFieldRepair.Paths(fullSchema, validation);
            if (paths.Count == 0) break; // a locked/structural error needs the upstream owner, not a rewrite
            var feedback = FormatValidation(validation);
            var (merged, step) = await RequestProjectionFieldPatchAsync(draft, fullSchema, paths, sourceStep, $"""
                Preserve the meaning of the reviewed contradiction.
                For a dialogue word-count error, edit only that answer. Keep every existing testimony fragment
                verbatim, with the same meaning, time, place, and speaker. Aim for 55–75 whitespace-delimited
                words so the corrected answer stays comfortably in the 45–100 range.
                Fix these validation errors:
                {feedback}
                """, round + 1, reviewScope);
            if (merged is null) break;
            (gameCase, validation) = await ParseRepairValidateAsync(draft, merged);
            if (!validation.IsValid)
                await RecordValidationAttemptAsync(draft, step, round + 1, merged, validation);
        }
        return (gameCase, validation);
    }

    private async Task<(string? Json, string Step)> RequestProjectionFieldPatchAsync(AiCaseDraft draft, JsonObject fullSchema,
        IReadOnlyList<string[]> paths, string sourceStep, string feedback, int attempt, ProjectionRepairScope? reviewScope = null)
    {
        var schema = ProjectionFieldRepair.Schema(fullSchema, paths);
        var baseline = draft.ProjectionContentJson;
        var content = JsonSerializer.Deserialize<GameplayProjectionContent>(baseline, PrettyJson)!;
        var currentFields = ProjectionWireContract.SerializeFields(content, schema);
        var step = $"RepairProjectionFields:{sourceStep}:{Sha256(baseline + feedback)[..16]}";
        var patch = await GenerateJsonAsync(draft.Id, step, BuildFullLogicRequestPrompt(draft, $"""
            Return only the fields in the patch schema, with their existing object keys. The server will
            merge them into the current projection and validate the result. Preserve all valid story facts.
            {feedback}
            """, currentFields, reviewScope),
            Math.Min(MaxFullCaseOutputTokens(draft), 9000), ProjectionFieldRepair.Version, schema, attempt,
            generationRunId: draft.GenerationRunId, mockResponseFactory: () => ProjectionWireContract.SerializeFields(
                ProjectionContentMockFactory.Build(draft.ProjectionPlan!), schema));
        if (AiBridgeSchemaValidator.Validate(schema.ToJsonString(), patch).Count > 0
            || ProjectionCanonicalizer.FindDuplicatePropertyPaths(patch).Count > 0)
            return (null, step);

        var merged = ProjectionFieldRepair.Merge(baseline, patch, paths);
        return (JsonNode.DeepEquals(JsonNode.Parse(baseline), JsonNode.Parse(merged)) ? null : merged, step);
    }
}
