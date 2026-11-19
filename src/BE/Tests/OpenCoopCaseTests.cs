using System.Text.Json;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The first OPEN_COOP case ("Trâm hồng ngọc mất tích") and the open co-op rules.</summary>
public sealed class OpenCoopCaseTests
{
    private const string FileName = "case-pixel-tram-hong-ngoc-vi.json";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static GameCase Load()
    {
        var gameCase = JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", FileName)), JsonOptions)!;
        PuzzleKindRegistry.FillMissing(gameCase);
        return gameCase;
    }

    private static string Errors(CaseValidationResult validation) =>
        string.Join(Environment.NewLine, validation.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message} [{error.RefId}]"));

    [Fact]
    public void OpenCoopCase_IsPublishValid()
    {
        var gameCase = Load();
        var validation = new CaseValidationService().Validate(gameCase);
        Assert.True(validation.IsValid, Errors(validation));
        Assert.True(CaseRuleSets.IsOpenCoop(gameCase));
        Assert.InRange(gameCase.Characters.Count, 1, 2);
    }

    [Fact]
    public void OpenCoopCase_UsesAllTenPuzzleKinds_EachWithItsOwnAnswer()
    {
        var gameCase = Load();
        var kinds = gameCase.Puzzles.Where(PuzzleKindRegistry.IsInteractive).Select(p => p.Kind).ToList();
        Assert.Equal(10, kinds.Distinct().Count());
        Assert.All(gameCase.Puzzles, puzzle =>
        {
            Assert.NotNull(PuzzleKindRegistry.Find(puzzle.Kind));
            Assert.False(string.IsNullOrWhiteSpace(puzzle.SolutionJson), puzzle.PuzzleId + " has no generated solution");
            Assert.NotEmpty(puzzle.UnlockClueIds);
        });
    }

    [Fact]
    public void OpenCoopRules_OpenEverySceneAndTheAccusationWithTheFirstEvidence()
    {
        var gameCase = Load();
        var state = new GameplayState { CurrentSceneId = "scene-tn-pho" };
        Assert.All(GameRules.GetAuthoredScenes(gameCase), scene => Assert.True(GameRules.CanEnterScene(gameCase, state, scene.SceneId)));
        Assert.False(GameRules.IsAccusationAvailable(gameCase, state));
        state.UnlockedClueIds.Add("evidence-tn-so-gui");
        Assert.True(GameRules.IsAccusationAvailable(gameCase, state, "scene-tn-pho"));
        state.WrongAccusationCount = CaseRuleSets.AccusationAttempts;
        Assert.False(GameRules.IsAccusationAvailable(gameCase, state));
    }

    [Fact]
    public void Timeline_ChecksPositionsBySortKey_AndRevealsTheTrueNight()
    {
        var gameCase = Load();
        var timeline = gameCase.Timeline!;
        var state = new GameplayState();
        state.UnlockedClueIds.AddRange(new[] { "fact-tn-buu-khai-ve", "evidence-tn-so-gui", "evidence-tn-dong-ho", "evidence-tn-bien-nhan" });
        var view = TimelineRules.BuildView(gameCase, state)!;
        Assert.Equal(new[] { "tl-tn-dong-tiem", "tl-tn-luc-xong", "tl-tn-bao-mat" }, view.Placed.Select(e => e.EventId).ToArray());
        Assert.Equal(2, view.Open.Count);
        Assert.All(view.Open, e => Assert.Equal(string.Empty, e.TimeLabel));

        var gui = timeline.Events.First(e => e.EventId == "tl-tn-gui-lo");
        Assert.Equal(TimelineRules.PlacementOutcome.TooEarly, TimelineRules.Judge(timeline, state, gui, null));
        Assert.Equal(TimelineRules.PlacementOutcome.TooLate, TimelineRules.Judge(timeline, state, gui, "tl-tn-luc-xong"));
        Assert.Equal(TimelineRules.PlacementOutcome.Correct, TimelineRules.Judge(timeline, state, gui, "tl-tn-dong-tiem"));
        state.PlacedTimelineEventIds.Add(gui.EventId);
        var ve = timeline.Events.First(e => e.EventId == "tl-tn-buu-ve");
        Assert.Equal(TimelineRules.PlacementOutcome.Correct, TimelineRules.Judge(timeline, state, ve, "tl-tn-gui-lo"));
        Assert.Contains("fact-tn-gio-that", ve.RevealClueIds);
    }

    [Fact]
    public void LeadHints_NameAConcreteNextStep()
    {
        var gameCase = Load();
        var state = new GameplayState { CurrentSceneId = "scene-tn-pho", VisitedSceneIds = { "scene-tn-pho" } };
        var (general, level1, remaining) = LeadHintRules.Next(gameCase, state, PlayerRole.Investigator, 1);
        var (specific, level2, _) = LeadHintRules.Next(gameCase, state, PlayerRole.Investigator, 2);
        Assert.True(remaining > 0);
        Assert.Equal(1, level1);
        Assert.Equal(2, level2);
        Assert.NotEqual(general, specific);
    }

    [Fact]
    public void Score_UsesTimelineCoverage_AndPenalisesTheFirstWrongAccusation()
    {
        var gameCase = Load();
        var state = new GameplayState();
        var clean = GameplayV2Rules.BuildScoreSummary(gameCase, state, true);
        state.WrongAccusationCount = 1;
        var penalised = GameplayV2Rules.BuildScoreSummary(gameCase, state, true);
        Assert.Equal(15, penalised.WrongAccusationPenalty);
        Assert.True(penalised.TotalScore < clean.TotalScore || clean.TotalScore == 0);
        Assert.Equal(0, clean.DeductionCoverageScore);
    }

    [Fact]
    public void CaseWall_StatementsBelongToTheSpeaker_EvidenceToWhoItPointsAt()
    {
        var gameCase = Load();
        Assert.Equal(CaseBoardRules.CaseTarget, CaseBoardRules.CenterTargetId(gameCase));
        Assert.Equal(new[] { "char-tn-dang-buu" }, CaseBoardRules.Targets(gameCase, "frag-tn-buu-gia"));
        Assert.Equal(new[] { "char-tn-trinh-luc" }, CaseBoardRules.Targets(gameCase, "frag-tn-luc-doi-ma"));
        Assert.Equal(new[] { "char-tn-trinh-luc" }, CaseBoardRules.Targets(gameCase, "evidence-tn-bien-nhan"));
        Assert.Equal(new[] { CaseBoardRules.CaseTarget }, CaseBoardRules.Targets(gameCase, "evidence-tn-tu-kinh"));
        Assert.Empty(CaseBoardRules.Targets(gameCase, "fact-tn-buu-khai-ve"));
        Assert.True(CaseBoardRules.IsCorrect(gameCase, "frag-tn-buu-gia", "char-tn-dang-buu"));
        Assert.False(CaseBoardRules.IsCorrect(gameCase, "frag-tn-buu-gia", "char-tn-trinh-luc"));
        Assert.Equal("Chủ tiệm cầm đồ", CaseBoardRules.ShortRole("Chủ tiệm cầm đồ — người báo mất", null));
    }

    [Fact]
    public void CaseWall_View_CountsEveryCardOnce_AndShowsOnlyFoundCards()
    {
        var gameCase = Load();
        var state = new GameplayState { CurrentSceneId = "scene-tn-pho" };
        var empty = CaseBoardRules.BuildView(gameCase, state)!;
        var cards = gameCase.TestimonyFragments.Count + gameCase.Clues.Count(clue => clue.IsEvidence);
        Assert.Equal(cards, empty.TotalItems);
        Assert.Equal(cards, empty.Center.StatementTotal + empty.Center.EvidenceTotal + empty.Columns.Sum(column => column.StatementTotal + column.EvidenceTotal));
        Assert.Empty(empty.Envelope);
        Assert.Equal("Trâm hồng ngọc", empty.Center.Title);
        Assert.Equal(2, empty.Columns.Count);

        state.ClueDiscoveries.Add(new ClueDiscoveryRecord { ClueId = "evidence-tn-hop-dong", DiscoveredAt = DateTime.UtcNow.AddMinutes(-3) });
        state.ClueDiscoveries.Add(new ClueDiscoveryRecord { ClueId = "evidence-tn-so-cam-do", DiscoveredAt = DateTime.UtcNow.AddMinutes(-2) });
        state.ClueDiscoveries.Add(new ClueDiscoveryRecord { ClueId = "fact-tn-buu-khai-ve", DiscoveredAt = DateTime.UtcNow.AddMinutes(-2) });
        state.TestimonyDiscoveries.Add(new TestimonyDiscoveryRecord { TestimonyFragmentId = "frag-tn-buu-gia", DiscoveredAt = DateTime.UtcNow.AddMinutes(-1) });
        var view = CaseBoardRules.BuildView(gameCase, state)!;
        Assert.Equal(new[] { "evidence-tn-hop-dong", "evidence-tn-so-cam-do", "frag-tn-buu-gia" }, view.Envelope);
        Assert.Equal(("evidence-tn-hop-dong", "char-tn-dang-buu"), CaseBoardRules.NextHint(gameCase, state));

        state.BoardPins["evidence-tn-hop-dong"] = "char-tn-dang-buu";
        Assert.Empty(CaseBoardRules.BuildView(gameCase, state)!.Links);
        state.BoardPins["evidence-tn-so-cam-do"] = "char-tn-dang-buu";
        view = CaseBoardRules.BuildView(gameCase, state)!;
        Assert.Equal(new[] { "frag-tn-buu-gia" }, view.Envelope);
        Assert.Equal(2, view.Pins.Count);
        Assert.Single(view.Links);
        Assert.Equal(("frag-tn-buu-gia", "char-tn-dang-buu"), CaseBoardRules.NextHint(gameCase, state));
    }

    [Fact]
    public void CaseWall_StringBetweenALieAndItsBreakingEvidence_IsRejected()
    {
        var gameCase = Load();
        gameCase.Board!.Links.Add(new CaseBoardLink { FromId = "frag-tn-buu-gia", ToId = "evidence-tn-cuong-phieu", Label = "GIÁ THẬT" });
        gameCase.Board.Links.Add(new CaseBoardLink { FromId = "evidence-tn-hop-dong", ToId = "nope", Label = "X" });
        var validation = new CaseValidationService().Validate(gameCase);
        Assert.Contains(validation.Errors, error => error.Path.StartsWith("board.links") && error.Message.Contains("crack answer"));
        Assert.Contains(validation.Errors, error => error.Path.StartsWith("board.links") && error.RefId == "nope");
    }
}
