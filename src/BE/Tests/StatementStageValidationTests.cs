using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class StatementStageValidationTests
{
    [Fact]
    public void RegeneratedStatements_UseCurrentSourcesBeforeProofGraphIsRebuilt()
    {
        var (truth, settings) = Fixture();
        var service = new CaseTruthService();
        foreach (var statement in truth.StatementLedger)
            statement.StatementId += "-regenerated";
        truth.RedHerringLedger.Add(new RedHerringLedgerEntry
        {
            RedHerringId = "old-downstream-red-herring",
            ClearingStatementIds = ["old-downstream-statement"]
        });
        var before = service.Canonicalize(truth);

        var stage = service.ValidateStatementArtifact(truth, settings);
        var full = service.Validate(truth);

        Assert.True(stage.IsValid, string.Join(" | ", stage.Errors.Select(error => error.Message)));
        Assert.Contains(full.Errors, error => error.Code == "MissingReference"
            && error.Path.StartsWith("proofGraph", StringComparison.Ordinal));
        Assert.Contains(full.Errors, error => error.Code == "MissingReference"
            && error.RefId == "old-downstream-statement");
        Assert.Equal(before, service.Canonicalize(truth));
    }

    [Fact]
    public void CurrentStatementKnowledgeErrors_StillBlockStageValidation()
    {
        var (truth, settings) = Fixture();
        foreach (var statement in truth.StatementLedger)
            statement.StatementId += "-regenerated";
        truth.StatementLedger[0].KnowledgeSourceIds = ["nonexistent-knowledge-source"];

        var result = new CaseTruthService().ValidateStatementArtifact(truth, settings);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.RefId == "nonexistent-knowledge-source");
        Assert.DoesNotContain(result.Errors, error => error.Code == "ProjectionMissingRequiredStatement");
    }

    [Theory]
    [InlineData("CORE_TRUTH")]
    [InlineData("TIMELINE")]
    [InlineData("OPPORTUNITY")]
    [InlineData("EVIDENCE")]
    [InlineData("STATEMENTS")]
    [InlineData("PROOF_GRAPH")]
    public void RepairPrefix_AcceptsValidUpstreamAtEveryBoundary(string boundary)
    {
        var (truth, settings) = Fixture();
        var result = new CaseTruthService().ValidateRepairPrefix(truth,
            AiTruthGenerationBudget.ForProjection(settings), settings, boundary);
        Assert.True(result.IsValid, string.Join(" | ", result.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}")));
    }

    [Fact]
    public void RepairPrefix_ReusesCurrentLedgersWithoutTrustingStaleGraph()
    {
        var (truth, settings) = Fixture();
        foreach (var statement in truth.StatementLedger)
            statement.StatementId += "-new";
        var service = new CaseTruthService();
        var before = service.Canonicalize(truth);

        var prefix = service.ValidateRepairPrefix(truth, AiTruthGenerationBudget.ForProjection(settings),
            settings, SirLocked.Api.Services.Interfaces.CaseTruthArtifacts.ProofGraph);

        Assert.True(prefix.IsValid, string.Join(" | ", prefix.Errors.Select(error => error.Message)));
        Assert.False(service.Validate(truth).IsValid);
        Assert.Equal(before, service.Canonicalize(truth));
    }

    [Fact]
    public void RepairPrefix_ValidatesTimelineBeforeEvidenceExists()
    {
        var (truth, settings) = Fixture();
        truth.TraceLedger.Clear();
        truth.StatementLedger.Clear();
        truth.ProofGraph.Conclusions.Clear();
        var service = new CaseTruthService();
        var budget = AiTruthGenerationBudget.ForProjection(settings);

        var beforeEvidence = service.ValidateRepairPrefix(truth, budget, settings,
            SirLocked.Api.Services.Interfaces.CaseTruthArtifacts.Evidence);
        var beforeStatements = service.ValidateRepairPrefix(truth, budget, settings,
            SirLocked.Api.Services.Interfaces.CaseTruthArtifacts.Statements);

        Assert.True(beforeEvidence.IsValid, string.Join(" | ", beforeEvidence.Errors.Select(error => error.Message)));
        Assert.False(beforeStatements.IsValid);
        Assert.Empty(truth.TraceLedger);
    }

    [Fact]
    public void RepairPrefix_RejectsInvalidEarlierEvidence()
    {
        var (truth, settings) = Fixture();
        truth.TraceLedger[0].SourceActionId = "unknown-upstream-event";
        truth.ProofGraph.Conclusions.Clear();

        var result = new CaseTruthService().ValidateRepairPrefix(truth,
            AiTruthGenerationBudget.ForProjection(settings), settings,
            SirLocked.Api.Services.Interfaces.CaseTruthArtifacts.ProofGraph);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.RefId == "unknown-upstream-event");
    }

    private static (CaseTruthPackage Truth, AiDraftSettings Settings) Fixture()
    {
        var draft = new AiCaseDraft
        {
            PlannedTargetKind = CaseTargetKinds.Asset,
            LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            Settings = new AiDraftSettings
            {
                GenerationPreset = AiGenerationPresets.ShortDemo,
                StageCount = 2,
                IncludeCrackTheLie = true,
                MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
            }
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(
            AiCaseMockFactory.BuildMockTruthPackageJson(draft), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        return (truth, draft.Settings);
    }
}
