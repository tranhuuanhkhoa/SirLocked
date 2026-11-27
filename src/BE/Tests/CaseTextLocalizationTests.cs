using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class CaseTextLocalizationTests
{
    [Fact]
    public void PlayersReadTheirOwnLanguageWithTheSameCluesAndSolution()
    {
        var original = new GameCase
        {
            CaseId = "case-watch",
            Title = "Chiếc đồng hồ ở bến cảng",
            Language = CaseLanguages.Vietnamese,
            Clues = [new CaseClue { ClueId = "clue-watch", Title = "Đồng hồ", Content = "Kim dừng lúc 00:00." }],
            Dialogues = [new CaseDialogue { DialogueId = "dialogue-watch", Answer = "Tôi nghe tiếng chuông." }],
            Hints = [new CaseHint { HintId = "hint-watch", Text = "Xem mặt đồng hồ." }],
            Puzzles = [new CasePuzzle { PuzzleId = "puzzle-watch",
                ParamsJson = """{"label":"Đồng hồ","code":"0030","slots":[{"description":"Xem mặt đồng hồ."}]}""",
                SolutionJson = """{"code":"0030"}""" }],
            FinalLogic = new FinalLogic { CulpritId = "npc-keeper", WinEnding = "Đồng hồ đã được tìm thấy." },
            AlternateLanguageText = new Dictionary<string, string>
            {
                [CaseTextLocalization.Key("Chiếc đồng hồ ở bến cảng")] = "The Watch at the Harbour",
                [CaseTextLocalization.Key("Đồng hồ")] = "Pocket watch",
                [CaseTextLocalization.Key("Kim dừng lúc 00:00.")] = "The hands stopped at 00:00.",
                [CaseTextLocalization.Key("Tôi nghe tiếng chuông.")] = "I heard the bell.",
                [CaseTextLocalization.Key("Xem mặt đồng hồ.")] = "Look at the watch face.",
                [CaseTextLocalization.Key("Đồng hồ đã được tìm thấy.")] = "The watch was found."
            }
        };
        var english = CaseTextLocalization.ForPlayer(original, CaseLanguages.English);
        Assert.Equal("The Watch at the Harbour", english.Title);
        Assert.Equal("The hands stopped at 00:00.", Assert.Single(english.Clues).Content);
        Assert.Equal(original.Clues[0].ClueId, english.Clues[0].ClueId);
        Assert.Equal("I heard the bell.", Assert.Single(english.Dialogues).Answer);
        Assert.Equal("Look at the watch face.", Assert.Single(english.Hints).Text);
        Assert.Contains("Pocket watch", Assert.Single(english.Puzzles).ParamsJson);
        Assert.Contains("Look at the watch face.", english.Puzzles[0].ParamsJson);
        Assert.Equal(original.Puzzles[0].SolutionJson, english.Puzzles[0].SolutionJson);
        Assert.Equal(original.FinalLogic.CulpritId, english.FinalLogic.CulpritId);
        Assert.Equal("Tôi nghe tiếng chuông.", Assert.Single(original.Dialogues).Answer);
        Assert.Same(original, CaseTextLocalization.ForPlayer(original, CaseLanguages.Vietnamese));

        var room = new GameRoom { Id = "room" };
        var snapshot = GameResultFactory.CreateSnapshot(room, english,
            new AccuseRequest { CulpritId = "npc-keeper" }, ["clue-watch"], true, DateTime.UtcNow);
        var result = GameResultFactory.CreateResult(room.Id, snapshot);
        var en = GameplayService.ToResultResponse(result, new GameCase(), CaseLanguages.English);
        var vi = GameplayService.ToResultResponse(result, new GameCase(), CaseLanguages.Vietnamese);
        Assert.Equal("The watch was found.", en.Ending);
        Assert.Equal("Đồng hồ đã được tìm thấy.", vi.Ending);
        Assert.Equal(en.CorrectCulpritId, vi.CorrectCulpritId);
    }
}
