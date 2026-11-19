using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// A bridge answer to a truth stage is checked against that stage's own deterministic rules when the bot submits it,
/// so a wrong answer is refused with its errors while the request is still open, instead of failing the draft later.
/// </summary>
public sealed class TruthStageAnswerCheckTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const string Run = "run-truth-1";

    private static readonly TruthStageRules Rules = new(new CaseTruthService(), new GameplayProjectionPlanner(new CaseTruthService()));

    /// <summary>An OPEN_COOP Easy draft paused at <paramref name="stage"/>, its saved truth checkpointed at the stage before.</summary>
    private static (AiCaseDraft Draft, CaseTruthPackage Truth) PausedAt(string checkpoint)
    {
        var draft = OpenCoopProjectionTests.OpenCoopDraft("easy");
        draft.Id = "64b64c0f0f0f0f0f0f0f0f41";
        draft.LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim;
        draft.PlannedTargetKind = CaseTargetKinds.Asset;
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), Json)!;
        draft.CaseTruth = JsonSerializer.Deserialize<CaseTruthPackage>(JsonSerializer.Serialize(truth, Json), Json);
        draft.TruthCheckpointArtifact = checkpoint;
        draft.QueuedOperation = AiQueuedOperations.CaseTruth;
        draft.GenerationRunId = Run;
        return (draft, truth);
    }

    private static AiBridgeRequest Request(string schemaVersion, string run = Run) => new()
    {
        Id = "64b64c0f0f0f0f0f0f0f0f42", OwnerType = AiBridgeOwnerTypes.CaseDraft, OwnerId = "64b64c0f0f0f0f0f0f0f0f41",
        GenerationRunId = run, SchemaVersion = schemaVersion
    };

    private static string Statements(CaseTruthPackage truth) => JsonSerializer.Serialize(new { statementLedger = truth.StatementLedger }, Json);

    [Fact]
    public void ACorrectStatementsAnswer_IsAccepted()
    {
        var (draft, truth) = PausedAt(CaseTruthArtifacts.Evidence);
        var result = Rules.CheckAnswer(draft, Request(AiGenerationSchemaVersions.StatementLedger), Statements(truth));
        Assert.NotNull(result);
        Assert.Empty(result!.Errors);
    }

    [Fact]
    public void ARequiredStatementWithoutAnEvent_IsRefusedAtSubmit()
    {
        var (draft, truth) = PausedAt(CaseTruthArtifacts.Evidence);
        var required = truth.StatementLedger.First(item => item.ContradictedByTraceIds.Count > 0);
        required.EventIds.Clear();
        var result = Rules.CheckAnswer(draft, Request(AiGenerationSchemaVersions.StatementLedger), Statements(truth));
        Assert.Contains(result!.Errors, error => error.RefId == required.StatementId);
    }

    [Fact]
    public void AWitnessWhoWasNotThere_IsRefusedAtSubmit()
    {
        var (draft, truth) = PausedAt(CaseTruthArtifacts.CoreTruth);
        var observed = truth.TrueTimeline.First();
        var absent = truth.CaseSeed.SuspectIds.First(id => id != observed.ActorId && !observed.WitnessIds.Contains(id));
        observed.WitnessIds.Add(absent);
        var answer = JsonSerializer.Serialize(new { trueTimeline = truth.TrueTimeline }, Json);
        var result = Rules.CheckAnswer(draft, Request(AiGenerationSchemaVersions.TrueTimeline), answer);
        Assert.Contains(result!.Errors, error => error.Code == "WitnessNotObservable");
    }

    [Fact]
    public void ACorrectTimelineAnswer_IsAccepted()
    {
        var (draft, truth) = PausedAt(CaseTruthArtifacts.CoreTruth);
        var answer = JsonSerializer.Serialize(new { trueTimeline = truth.TrueTimeline }, Json);
        Assert.Empty(Rules.CheckAnswer(draft, Request(AiGenerationSchemaVersions.TrueTimeline), answer)!.Errors);
    }

    [Fact]
    public void AnAnswerFromAnotherRun_IsNotCheckedHere()
    {
        var (draft, truth) = PausedAt(CaseTruthArtifacts.Evidence);
        Assert.Null(Rules.CheckAnswer(draft, Request(AiGenerationSchemaVersions.StatementLedger, "old-run"), Statements(truth)));
    }

    [Fact]
    public void ATruthRepairRun_IsNotCheckedHere_ItsBaseIsTheCandidate()
    {
        var (draft, truth) = PausedAt(CaseTruthArtifacts.Evidence);
        draft.QueuedOperation = AiQueuedOperations.TruthRepair;
        Assert.Null(Rules.CheckAnswer(draft, Request(AiGenerationSchemaVersions.StatementLedger), Statements(truth)));
    }

    [Fact]
    public void ACheckpointThatDoesNotMatchTheStage_IsNotCheckedHere()
    {
        var (draft, truth) = PausedAt(CaseTruthArtifacts.Opportunity);
        Assert.Null(Rules.CheckAnswer(draft, Request(AiGenerationSchemaVersions.StatementLedger), Statements(truth)));
    }

    [Fact]
    public void Errors_ReadLikeTheDraftsValidationReport()
    {
        var (draft, truth) = PausedAt(CaseTruthArtifacts.Evidence);
        var required = truth.StatementLedger.First(item => item.ContradictedByTraceIds.Count > 0);
        required.EventIds.Clear();
        var lines = TruthStageRules.Describe(Rules.CheckAnswer(draft, Request(AiGenerationSchemaVersions.StatementLedger), Statements(truth))!);
        Assert.Contains(lines, line => line.Contains($"[ref: {required.StatementId}]") && line.Contains("statementLedger"));
    }
}
