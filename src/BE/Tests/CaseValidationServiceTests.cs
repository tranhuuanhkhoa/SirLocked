using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class CaseValidationServiceTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly CaseValidationService _validator = new();

    private static GameCase LoadSampleCase()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "SeedData", "sample-case.json");
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<GameCase>(json, JsonOptions)!;
    }

    [Fact]
    public void SampleCase_IsValid()
    {
        var result = _validator.Validate(LoadSampleCase());
        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void SampleCase_HasExpectedShape()
    {
        var c = LoadSampleCase();
        Assert.InRange(c.Stages.Count, 3, 4);
        Assert.InRange(c.Stages.Sum(s => s.Scenes.Count), 4, 6);
        Assert.InRange(c.Characters.Count, 4, 5);
        Assert.InRange(c.Items.Count, 8, 10);
        Assert.InRange(c.Clues.Count, 10, 12);
        Assert.InRange(c.Dialogues.Count, 10, 16);
        Assert.Contains(c.Clues, clue => clue.IsRedHerring);
        Assert.NotEmpty(c.FinalLogic.WinEnding);
        Assert.NotEmpty(c.FinalLogic.FailEnding);
    }

    [Fact]
    public void DuplicateItemId_IsRejected()
    {
        var c = LoadSampleCase();
        c.Items.Add(new CaseItem { ItemId = c.Items[0].ItemId, Name = "Copy" });
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "DuplicateId" && e.RefId == c.Items[0].ItemId);
    }

    [Fact]
    public void MissingSceneItemReference_IsRejected()
    {
        var c = LoadSampleCase();
        c.Stages[0].Scenes[0].ItemIds.Add("item-does-not-exist");
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "MissingReference" && e.RefId == "item-does-not-exist");
    }

    [Fact]
    public void FinalEvidenceUsingItemId_IsRejected()
    {
        var c = LoadSampleCase();
        c.FinalLogic.RequiredEvidenceIds.Add(c.Items[0].ItemId);
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "InvalidEvidenceReference"
            && e.Message.Contains("not an item ID"));
    }

    [Fact]
    public void FinalEvidenceWithoutIsEvidenceFlag_IsRejected()
    {
        var c = LoadSampleCase();
        var evidenceClue = c.Clues.First(cl => cl.ClueId == c.FinalLogic.RequiredEvidenceIds[0]);
        evidenceClue.IsEvidence = false;
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "InvalidEvidenceFlag" && e.RefId == evidenceClue.ClueId);
    }

    [Fact]
    public void UnlockCycle_BlockingRequiredProgress_IsRejected()
    {
        var c = LoadSampleCase();
        // First scene's required dialogue now requires a clue that only its own asking unlocks elsewhere:
        // make the first item's unlock depend on a clue that is unlocked by a dialogue requiring that same clue.
        var firstScene = c.Stages[0].Scenes[0];
        var requiredDialogueId = firstScene.CompleteCondition.RequiredDialogueIds[0];
        var dialogue = c.Dialogues.First(d => d.DialogueId == requiredDialogueId);
        var lateClue = c.FinalLogic.RequiredEvidenceIds.Last(); // discoverable only in a later stage
        dialogue.RequiredClueIds.Add(lateClue);

        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "UnreachableScene" && e.RefId == firstScene.SceneId);
    }

    [Fact]
    public void UndiscoverableFinalEvidence_IsRejected()
    {
        var c = LoadSampleCase();
        c.Clues.Add(new CaseClue
        {
            ClueId = "clue-never-unlocked",
            Title = "Ghost clue",
            Content = "Nothing unlocks this.",
            IsEvidence = true,
            Source = c.Items[0].ItemId,
            SourceType = "item"
        });
        c.FinalLogic.RequiredEvidenceIds.Add("clue-never-unlocked");
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code is "UndiscoverableEvidence" or "OrphanClue");
    }

    [Fact]
    public void InvalidCompleteConditionLogic_IsRejected()
    {
        var c = LoadSampleCase();
        c.Stages[0].Scenes[0].CompleteCondition.Logic = "MAYBE";
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "InvalidValue" && e.Path.Contains("completeCondition.logic"));
    }

    [Fact]
    public void MockCaseFactory_ProducesValidCase()
    {
        for (var stages = 2; stages <= 5; stages++)
        {
            var mock = MockCaseFactory.Create("A locked-room manor mystery with a poisoned drink", stages, "medium");
            var result = _validator.Validate(mock);
            Assert.True(result.IsValid,
                $"stages={stages}: " + string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
        }
    }
}
