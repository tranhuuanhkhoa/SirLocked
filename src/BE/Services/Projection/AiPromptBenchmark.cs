using System.Text;
using System.Text.Json;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public sealed record AiPromptBenchmarkRow(string Preset, string Language, int MechanicsVersion,
    int PreviousPlanBytes, int NarrativeContextBytes, int LegacySchemaBytes, int CompactSchemaBytes,
    int LegacyOutputBytes, int CompactOutputBytes, int SemanticBatchCount, bool CompiledEquivalent,
    int MissingNarrativeFacts, int ProjectionErrors);

/// <summary>Deterministic offline fixture benchmark. Byte counts are not billed/tokenizer token counts.</summary>
public static class AiPromptBenchmark
{
    public static IReadOnlyList<AiPromptBenchmarkRow> Run()
    {
        var result = new List<AiPromptBenchmarkRow>();
        foreach (var preset in new[] { AiGenerationPresets.ShortDemo, AiGenerationPresets.NormalRandom, AiGenerationPresets.FullFeature })
        foreach (var language in new[] { CaseLanguages.English, CaseLanguages.Vietnamese })
        foreach (var isV3 in new[] { false, true })
        {
            var draft = Fixture(preset, language, isV3);
            var plan = draft.ProjectionPlan!;
            var oldSchema = new ProjectionContentSchemaFactory().Build(plan);
            var schema = ProjectionWireContract.Schema(oldSchema, ProjectionWireContract.CompactVersion);
            var content = ProjectionContentMockFactory.Build(plan);
            var legacy = ProjectionWireContract.Serialize(content, oldSchema);
            var compact = ProjectionWireContract.Serialize(content, schema);
            var legacyContent = JsonSerializer.Deserialize<GameplayProjectionContent>(legacy, JsonOptions)!;
            var compactContent = JsonSerializer.Deserialize<GameplayProjectionContent>(compact, JsonOptions)!;
            ProjectionContentLocks.Apply(plan, legacyContent);
            ProjectionContentLocks.Apply(plan, compactContent);
            var compiler = new GameCaseProjectionCompiler();
            var before = compiler.Compile(plan, legacyContent, draft.Settings);
            var after = compiler.Compile(plan, compactContent, draft.Settings);
            before.CreatedAt = after.CreatedAt = DateTime.UnixEpoch;
            before.UpdatedAt = after.UpdatedAt = DateTime.UnixEpoch;
            var context = ProjectionPromptContext.Build(draft);
            using var contextDoc = JsonDocument.Parse(context);
            var facts = contextDoc.RootElement.GetProperty("facts");
            var missing = plan.Clues.Values.Count(slot => !facts.GetProperty("traces").TryGetProperty(slot.TraceId, out _))
                + plan.Dialogues.Values.SelectMany(slot => slot.StatementIds).Count(id => !facts.GetProperty("statements").TryGetProperty(id, out _));
            result.Add(new AiPromptBenchmarkRow(preset, language, draft.Settings.MechanicsVersion,
                Bytes(draft.ProjectionPlanJson), Bytes(context), Bytes(oldSchema.ToJsonString()), Bytes(schema.ToJsonString()),
                Bytes(legacy), Bytes(compact), isV3 ? AiCaseService.BuildSemanticReviewBatches(after).Count : 0,
                ProjectionCanonicalizer.Canonicalize(before) == ProjectionCanonicalizer.Canonicalize(after), missing,
                new ProjectionGraphValidator(new CaseTruthService()).Validate(draft.CaseTruth!, plan, after).Errors.Count));
        }
        return result;
    }

    internal static AiCaseDraft Fixture(string preset = AiGenerationPresets.NormalRandom,
        string language = CaseLanguages.English, bool isV3 = false)
    {
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f0f",
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            ProjectionContentSchemaVersion = ProjectionWireContract.CompactVersion,
            StoryPreview = new AiStoryPreview
            {
                Title = language == CaseLanguages.Vietnamese ? "Chiếc chìa khóa thất lạc" : "The missing key",
                Summary = language == CaseLanguages.Vietnamese ? "Điều tra tại một nhà hát cổ." : "Investigate an old theatre.",
                Setting = "Victorian theatre"
            },
            Settings = new AiDraftSettings
            {
                GenerationPreset = preset, StageCount = preset == AiGenerationPresets.ShortDemo ? 2 : preset == AiGenerationPresets.FullFeature ? 6 : 4,
                ShortDemoProfileVersion = preset == AiGenerationPresets.ShortDemo ? 1 : 0,
                Language = language, IncludeCrackTheLie = isV3,
                MechanicsVersion = isV3 ? CaseMechanicsVersions.InvestigationV3PairedConfrontation : CaseMechanicsVersions.InvestigationV2
            }
        };
        draft.CaseTruth = JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), JsonOptions)!;
        // Full V3 needs distinct authored contradictions; the generic dry-run factory supplies one.
        if (isV3)
            for (var index = 0; index < CrackGenerationBudgets.For(preset).MinCracks; index++)
            {
                var statement = draft.CaseTruth.StatementLedger[index];
                statement.ContradictedByTraceIds = [draft.CaseTruth.TraceLedger[index].TraceId];
                statement.TruthStatus = StatementTruthStatuses.Misleading;
                statement.ReasonForLie = "The witness conceals a private visit.";
            }
        var truthService = new CaseTruthService();
        draft.TruthHash = truthService.ComputeHash(draft.CaseTruth);
        draft.ProjectionPlan = new GameplayProjectionPlanner(truthService).Build(draft, draft.CaseTruth);
        draft.ProjectionPlanJson = ProjectionCanonicalizer.Canonicalize(draft.ProjectionPlan);
        return draft;
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static int Bytes(string value) => Encoding.UTF8.GetByteCount(value);
}
