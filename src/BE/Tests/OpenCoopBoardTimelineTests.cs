using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>An OPEN_COOP_1 case gets the AI-written case wall and, from Medium up, a reconstruction timeline.</summary>
public sealed class OpenCoopBoardTimelineTests
{
    private static (GameplayProjectionPlan Plan, AiCaseDraft Draft) Planned(string level)
    {
        var draft = OpenCoopProjectionTests.OpenCoopDraft(level);
        return (OptionalPuzzleProjectionTests.Plan(draft), draft);
    }

    private static GameCase Compile(GameplayProjectionPlan plan, GameplayProjectionContent content, AiDraftSettings settings) =>
        new GameCaseProjectionCompiler().Compile(plan, content, settings);

    [Fact]
    public void Board_IsCompiledFromContent()
    {
        var (plan, draft) = Planned("medium");
        var content = ProjectionContentMockFactory.Build(plan);
        content.Board!.CenterKicker = "NGƯỜI MẤT TÍCH";
        var gameCase = Compile(plan, content, draft.Settings);
        Assert.Equal("NGƯỜI MẤT TÍCH", gameCase.Board!.CenterKicker);
        Assert.False(string.IsNullOrWhiteSpace(gameCase.Board.Summary));
    }

    [Fact]
    public void MissingBoard_IsRefused()
    {
        var (plan, draft) = Planned("medium");
        var content = ProjectionContentMockFactory.Build(plan);
        content.Board = null;
        var error = Assert.Throws<ProjectionCompilationException>(() => Compile(plan, content, draft.Settings));
        Assert.Contains(error.Errors, line => line.Contains("board"));
    }

    [Fact]
    public void BoardLinkToAnUnknownCard_FailsCaseValidation()
    {
        var (plan, draft) = Planned("medium");
        var content = ProjectionContentMockFactory.Build(plan);
        content.Board!.Links = [new CaseBoardLink { FromId = plan.Skeleton.TestimonyFragments[0].Id, ToId = "nope", Label = "CÙNG LÚC" }];
        var result = new CaseValidationService().Validate(Compile(plan, content, draft.Settings));
        Assert.Contains(result.Errors, error => error.Path.StartsWith("board.links"));
    }

    [Theory]
    [InlineData("easy", 0, 0)]
    [InlineData("medium", 5, 6)]
    public void Timeline_SizeFollowsTheLevel(string level, int min, int max)
    {
        var (plan, draft) = Planned(level);
        var gameCase = Compile(plan, ProjectionContentMockFactory.Build(plan), draft.Settings);
        if (max == 0)
        {
            Assert.Null(gameCase.Timeline);
            return;
        }
        var events = gameCase.Timeline!.Events;
        Assert.InRange(events.Count, min, max);
        Assert.True(events.First().IsFixed);
        Assert.True(events.Last().IsFixed);
        Assert.All(events, item => Assert.False(string.IsNullOrWhiteSpace(item.TimeLabel)));
        Assert.Equal(events.Select(item => item.SortKey).OrderBy(key => key), events.Select(item => item.SortKey));
        Assert.False(string.IsNullOrWhiteSpace(gameCase.Timeline.Title));
    }

    [Fact]
    public void Schema_HasBoardAndTimelineOnlyForOpenCoop()
    {
        var (plan, _) = Planned("medium");
        var properties = new ProjectionContentSchemaFactory().Build(plan)["properties"]!.AsObject();
        Assert.True(properties.ContainsKey("board"));
        Assert.True(properties.ContainsKey("timeline"));

        var legacy = OptionalPuzzleProjectionTests.Plan(new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f51", LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.NormalRandom, StageCount = 4 }
        });
        var legacyProperties = new ProjectionContentSchemaFactory().Build(legacy)["properties"]!.AsObject();
        Assert.False(legacyProperties.ContainsKey("board"));
        Assert.False(legacyProperties.ContainsKey("timeline"));
    }
}
