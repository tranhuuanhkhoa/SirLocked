using System.Text.Json;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public sealed class CaseTruthGenerationQualityTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public void TimelineContract_ReservesDistinctCoreSlotsAndKeepsAuxiliaryIdsAvailable()
    {
        var truth = MockTruth();
        truth.CoreTruth.PreparationActionIds = ["action-prep-a", "action-prep-b"];
        truth.CoreTruth.CrimeActionIds = ["action-crime-a", "action-crime-b", "action-crime-c"];
        truth.CoreTruth.ConcealmentActionIds = ["action-hide"];
        truth.CoreTruth.CulpritMistakeActionIds = ["action-mistake", "action-crime-c"];
        var draft = ShortDraft();
        var budget = AiTruthGenerationBudget.For(draft.Settings);

        var schema = AiCaseService.BuildTrueTimelineSchema(truth, budget);
        var timeline = schema["properties"]!["trueTimeline"]!;
        var prompt = AiCaseService.BuildTruthStagePrompt(draft, CaseTruthArtifacts.Timeline, truth, string.Empty);

        Assert.Equal(7, timeline["minItems"]!.GetValue<int>());
        Assert.Equal(12, timeline["maxItems"]!.GetValue<int>());
        Assert.Null(timeline["items"]!["properties"]!["eventId"]!["enum"]);
        Assert.Contains("Reserve 7 of 12 event slots first", prompt, StringComparison.Ordinal);
        Assert.Contains("At most 5 auxiliary event slots remain", prompt, StringComparison.Ordinal);
        foreach (var id in CaseTruthReferenceContract.CoreActionIds(truth.CoreTruth))
            Assert.Contains(id, prompt, StringComparison.Ordinal);
        Assert.Contains("never combine two core IDs", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void TimelinePreflight_RejectsImpossibleCoreBudgetAndRepairsFromCore()
    {
        var truth = MockTruth();
        var budget = AiTruthGenerationBudget.For(ShortDraft().Settings);
        truth.CoreTruth.CrimeActionIds = Enumerable.Range(0, budget.MaxTimelineEvents + 1)
            .Select(index => $"action-over-budget-{index}").ToList();

        var exception = Assert.Throws<ApiException>(() => AiCaseService.BuildTrueTimelineSchema(truth, budget));
        var errors = Assert.IsAssignableFrom<IEnumerable<CaseValidationError>>(exception.Errors).ToList();

        Assert.Equal(422, exception.StatusCode);
        Assert.Contains(errors, error => error.Code == "TRUTH_BUDGET_EXCEEDED" && error.Path == "coreTruth.actionIds");
        Assert.Equal(CaseTruthArtifacts.CoreTruth, new CaseTruthService().PlanRepair(errors).RegenerateFromArtifact);
        Assert.Throws<ArgumentException>(() => AiStrictSchemaProvider.TrueTimelineSchema(
            budget, truth.CaseSeed.SuspectIds, truth.CoreTruth.TargetId, truth.CoreTruth.TargetKind,
            truth.CaseSeed.LocationIds, truth.CoreTruth.CrimeActionIds));
    }

    [Theory]
    [InlineData(CaseTruthArtifacts.CoreTruth, "personal stake", "timeline slots")]
    [InlineData(CaseTruthArtifacts.Timeline, "MOTIVE PROOF PLAN", "hidden truth")]
    [InlineData(CaseTruthArtifacts.Evidence, "personal gain or loss", "not observations proving exact times")]
    [InlineData(CaseTruthArtifacts.Statements, "personal stake", "explicit timing observation")]
    [InlineData(CaseTruthArtifacts.ProofGraph, "personal gain or loss", "player-observable evidence")]
    public void GenerationStages_RequireObservableMotiveAndBoundedProof(string artifact, string motiveRule, string scopeRule)
    {
        var prompt = AiCaseService.BuildTruthStagePrompt(ShortDraft(), artifact, MockTruth(), string.Empty);

        Assert.Contains(motiveRule, prompt, StringComparison.Ordinal);
        Assert.Contains(scopeRule, prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void OpportunityPrompt_ExplainsEmptyAvailabilityAndRelevantAlibis()
    {
        var prompt = AiCaseService.BuildTruthStagePrompt(ShortDraft(), CaseTruthArtifacts.Opportunity, MockTruth(), string.Empty);

        Assert.Contains("availableFromMinute = availableToMinute = 0", prompt, StringComparison.Ordinal);
        Assert.Contains("boundary-only contact", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not copy the global crime window", prompt, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("before", false)]
    [InlineData("after", false)]
    [InlineData("touch-start", false)]
    [InlineData("touch-end", false)]
    [InlineData("same-location", false)]
    [InlineData("elsewhere-overlap", true)]
    public void VerifiedAlibi_ExcludesAlternativeOnlyWhenItPreventsACrimeAction(string scenario, bool excludes)
    {
        var truth = MockTruth();
        var culprit = truth.OpportunityMatrix.Single(item => item.CharacterId == truth.CoreTruth.CulpritId);
        var alternate = truth.OpportunityMatrix.First(item => item.CharacterId != culprit.CharacterId);
        var witnessId = truth.CaseSeed.SuspectIds.First(id => id != culprit.CharacterId && id != alternate.CharacterId);
        alternate.HasMotive = true;
        alternate.IdentityLinkedToCrime = true;
        alternate.AccessIds = culprit.AccessIds.ToList();
        alternate.ToolIds = culprit.ToolIds.ToList();
        alternate.KnowledgeIds = culprit.KnowledgeIds.ToList();
        var crime = truth.TrueTimeline.First(item => truth.CoreTruth.CrimeActionIds.Contains(item.EventId));
        var start = crime.StartMinute;
        var end = crime.StartMinute + 2;
        if (scenario == "before") (start, end) = (crime.StartMinute - 10, crime.StartMinute - 5);
        if (scenario == "after") (start, end) = (250, 255);
        if (scenario == "touch-start") (start, end) = (crime.StartMinute - 5, crime.StartMinute);
        if (scenario == "touch-end") (start, end) = (crime.EndMinute, crime.EndMinute + 2);
        var locationId = scenario == "same-location" ? crime.LocationId
            : truth.CaseSeed.LocationIds.First(id => id != crime.LocationId);
        var alibi = new TrueTimelineEvent
        {
            EventId = "event-quality-alibi",
            ActorId = alternate.CharacterId,
            LocationId = locationId,
            StartMinute = start,
            EndMinute = end,
            Action = "Sorts guest tickets in full view of another suspect.",
            WitnessIds = [witnessId],
            WitnessObservations = [new WitnessObservation
            {
                WitnessId = witnessId, Mode = "SIGHT", LineOfSightOrHearingClear = true,
                ObservableDetail = "The witness continuously sees the suspect sorting tickets across the open desk."
            }]
        };
        truth.TrueTimeline.Add(alibi);
        truth.TrueTimeline.Add(new TrueTimelineEvent
        {
            EventId = "event-quality-witness", ActorId = witnessId, LocationId = locationId,
            StartMinute = start, EndMinute = end, Action = "Watches the suspect sort tickets across the desk."
        });
        alternate.AlibiVerified = true;
        alternate.AlibiEventIds = [alibi.EventId];
        foreach (var actor in truth.TrueTimeline.GroupBy(item => item.ActorId))
        {
            var ordered = actor.OrderBy(item => item.StartMinute).ToList();
            for (var index = 1; index < ordered.Count; index++)
                if (ordered[index].LocationId != ordered[index - 1].LocationId)
                    ordered[index].TravelFromPreviousMinutes = 5;
        }

        var result = new CaseTruthService().Validate(truth);
        var ambiguity = result.Errors.Where(error => error.Code == "AmbiguousSuspect" && error.RefId == alternate.CharacterId);

        if (excludes) Assert.Empty(ambiguity);
        else Assert.NotEmpty(ambiguity);
        Assert.DoesNotContain(result.Errors, error => error.Code is "UncorroboratedAlibi" or "InvalidAlibi" or "WitnessNotObservable");
        Assert.DoesNotContain(result.Errors, error => error.Code != "AmbiguousSuspect");
    }

    private static AiCaseDraft ShortDraft() => new()
    {
        StoryPreview = new AiStoryPreview { Title = "Proof contract", Summary = "A compact two-player case." },
        Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.ShortDemo, StageCount = 2 }
    };

    private static CaseTruthPackage MockTruth() => JsonSerializer.Deserialize<CaseTruthPackage>(
        AiCaseMockFactory.BuildMockTruthPackageJson(new AiCaseDraft { Settings = new AiDraftSettings { Difficulty = "medium" } }),
        JsonOptions)!;
}
