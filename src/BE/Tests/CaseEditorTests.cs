using System.Text.Json;
using SirLocked.Api.DTOs.CaseEditor;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.CaseEditor;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// Case Studio (/admin/editor): what the server keeps for itself on a save, which picture URLs pass, how many saved
/// copies are kept, the validation shown after a save (E3 hint rule, pixel layout) and "Chơi thử cảnh này".
/// </summary>
public sealed class CaseEditorTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static GameCase Load(string file) => JsonSerializer.Deserialize<GameCase>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", file)), Web)!;

    /// <summary>The tutorial case under another id: a complete, valid pixel draft that the editor may change.</summary>
    private static GameCase EditableDraft()
    {
        var gameCase = Load(TutorialRules.CaseFile);
        gameCase.CaseId = "case-editor-test";
        gameCase.Status = CaseStatus.Draft;
        PuzzleKindRegistry.FillMissing(gameCase);
        return gameCase;
    }

    private static GameCase Clone(GameCase gameCase) =>
        JsonSerializer.Deserialize<GameCase>(JsonSerializer.Serialize(gameCase, Web), Web)!;

    private static CaseEditorService Editor() =>
        new(null!, null!, new CaseValidationService(), null!, null!, null!);

    private static IEnumerable<CaseScene> Scenes(GameCase gameCase) => gameCase.Stages.SelectMany(stage => stage.Scenes);

    [Fact]
    public void PrepareForSave_KeepsEveryServerOwnedField()
    {
        var stored = EditableDraft();
        stored.Id = "66aa00000000000000000001";
        stored.SourceAiDraftId = "66aa00000000000000000002";
        stored.TruthHash = "hash-from-gate";
        stored.LogicVerificationStatus = CaseLogicVerificationStatuses.CausalVerified;
        stored.AiSemanticReviewStatus = "PASSED";
        stored.CreatedAt = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);
        var edited = Clone(stored);
        edited.Id = string.Empty;
        edited.Status = CaseStatus.Published;
        edited.SourceAiDraftId = "someone-else";
        edited.TruthHash = "forged";
        edited.LogicVerificationStatus = "FORGED";
        edited.AiSemanticReviewStatus = "FORGED";
        edited.RuleSet = "FORGED";
        edited.MechanicsVersion = 99;
        edited.Presentation = null;
        edited.CreatedAt = DateTime.UtcNow;
        edited.Title = "Tên mới do editor đặt";

        CaseEditorService.PrepareForSave(stored, edited);

        Assert.Equal(stored.Id, edited.Id);
        Assert.Equal(CaseStatus.Draft, edited.Status);
        Assert.Equal(stored.SourceAiDraftId, edited.SourceAiDraftId);
        Assert.Equal("hash-from-gate", edited.TruthHash);
        Assert.Equal(CaseLogicVerificationStatuses.CausalVerified, edited.LogicVerificationStatus);
        Assert.Equal("PASSED", edited.AiSemanticReviewStatus);
        Assert.Equal(stored.RuleSet, edited.RuleSet);
        Assert.Equal(stored.MechanicsVersion, edited.MechanicsVersion);
        Assert.Same(stored.Presentation, edited.Presentation);
        Assert.Equal(stored.CreatedAt, edited.CreatedAt);
        Assert.Equal("Tên mới do editor đặt", edited.Title);
    }

    [Fact]
    public void PrepareForSave_MovesThePercentHotspotsWithTheRuntimeBoxes()
    {
        var stored = EditableDraft();
        var edited = Clone(stored);
        var scene = Scenes(edited).First(entry => entry.Runtime?.ItemPlacements.Count > 0
                                                  && entry.Hotspots.Any(hotspot => hotspot.Type != "CHARACTER"));
        var placement = scene.Runtime!.ItemPlacements.First(entry => scene.Hotspots.Any(hotspot => hotspot.TargetId == entry.ItemId));
        placement.Hotspot = new RuntimeBox { X = 1024, Y = 512, Width = 128, Height = 64 };

        CaseEditorService.PrepareForSave(stored, edited);

        var hotspot = scene.Hotspots.First(entry => entry.TargetId == placement.ItemId);
        Assert.Equal(50, hotspot.X);
        Assert.Equal(25, hotspot.Y);
        Assert.Equal(6.25, hotspot.Width);
        Assert.Equal(3.125, hotspot.Height);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("http://example.com/npc.png")]
    [InlineData("/assets/../secrets.png")]
    [InlineData("data:image/png;base64,AAAA")]
    [InlineData("//evil.example/npc.png")]
    public void PrepareForSave_RefusesPicturesOffTheSiteOrWithoutHttps(string url)
    {
        var stored = EditableDraft();
        var edited = Clone(stored);
        edited.Characters[0].ImageUrl = url;

        var error = Assert.Throws<SirLocked.Api.DTOs.ApiException>(() => CaseEditorService.PrepareForSave(stored, edited));
        Assert.Equal(422, error.StatusCode);
        Assert.Contains("characters[0].imageUrl", CaseEditorService.UnsafeUrls(edited));
    }

    [Fact]
    public void UnsafeUrls_AcceptsSiteAssetsHttpsAndEmpty()
    {
        var gameCase = EditableDraft();
        gameCase.Characters[0].ImageUrl = "/assets/pixel/library/npc/v-npc-quan-gia/portrait.png";
        gameCase.Characters[1].ImageUrl = "https://res.cloudinary.com/demo/image/upload/npc.png";
        gameCase.Characters[2].ImageUrl = string.Empty;
        gameCase.Characters[0].Presentation!.SpriteSheet!.Url = "/assets/pixel/library/npc/v-npc-quan-gia/idle.png";
        gameCase.Items[0].ImageUrl = "javascript:void(0)";
        Scenes(gameCase).First().BackgroundUrl = "http://plain.example/bg.png";

        var bad = CaseEditorService.UnsafeUrls(gameCase).ToList();

        Assert.Equal(new[] { "items[0].imageUrl", $"scene:{Scenes(gameCase).First().SceneId}.backgroundUrl" }, bad);
    }

    [Fact]
    public void RevisionsToPrune_KeepsTheOriginalAndTheNewestFifty()
    {
        var revisions = new List<(int, string)> { (1, CaseEditorRevisionKinds.Original) };
        for (var number = 2; number <= 60; number++)
            revisions.Add((number, number % 7 == 0 ? CaseEditorRevisionKinds.BeforeRestore : CaseEditorRevisionKinds.Checkpoint));

        var prune = CaseEditorService.RevisionsToPrune(revisions);

        Assert.Equal(Enumerable.Range(2, 9), prune.OrderBy(number => number));
        Assert.DoesNotContain(1, prune);
        Assert.Empty(CaseEditorService.RevisionsToPrune(revisions.Take(51)));
    }

    [Fact]
    public void Validate_ACompleteDraftCanBePublished()
    {
        var validation = Editor().Validate(EditableDraft(), draft: null);

        Assert.True(validation.CanPublish, string.Join(Environment.NewLine, validation.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}")));
        Assert.Empty(validation.Errors);
    }

    [Fact]
    public void Validate_MissingHintsBlockPublishing_E3()
    {
        var gameCase = EditableDraft();
        gameCase.Hints.Clear();

        var validation = Editor().Validate(gameCase, draft: null);

        Assert.False(validation.CanPublish);
        Assert.Contains(validation.Errors, error => SirLocked.Api.DTOs.Case.CaseHintCodes.All.Contains(error.Code));
        Assert.DoesNotContain(validation.Warnings, warning => SirLocked.Api.DTOs.Case.CaseHintCodes.All.Contains(warning.Code));
    }

    [Fact]
    public void Validate_PixelLayoutBlocksABotCase_AndOnlyWarnsForAHandMadeOne()
    {
        var gameCase = EditableDraft();
        var scene = Scenes(gameCase).First(entry => entry.Runtime?.ItemPlacements.Count > 0);
        var placement = scene.Runtime!.ItemPlacements[0];
        placement.Hotspot = new RuntimeBox { X = 2000, Y = 2000, Width = 200, Height = 200 };
        var path = $"scene:{scene.SceneId}.runtime.itemPlacements[{placement.ItemId}].hotspot";

        var handMade = Editor().Validate(gameCase, draft: null);
        var botCase = Editor().Validate(gameCase, new AiCaseDraft { Id = "66aa00000000000000000002", ImportedCaseId = gameCase.CaseId });

        Assert.Contains(handMade.Warnings, warning => warning.Code == "HotspotOutOfBounds" && warning.Path == path);
        Assert.DoesNotContain(handMade.Errors, error => error.Code == "HotspotOutOfBounds");
        Assert.Contains(botCase.Errors, error => error.Code == "HotspotOutOfBounds" && error.Path == path && error.RefId == scene.SceneId);
        Assert.False(botCase.CanPublish);
    }

    [Fact]
    public void Validate_TheTutorialIsShownButNeverPublishedFromTheEditor()
    {
        var tutorial = Load(TutorialRules.CaseFile);
        PuzzleKindRegistry.FillMissing(tutorial);

        var validation = Editor().Validate(tutorial, draft: null);

        Assert.False(validation.CanPublish);
        Assert.Contains(validation.Warnings, warning => warning.Code == "TUTORIAL_READ_ONLY");
        Assert.False(CaseEditorService.IsEditable(tutorial));
        Assert.True(CaseEditorService.IsEditable(EditableDraft()));
        var published = EditableDraft();
        published.Status = CaseStatus.Published;
        Assert.False(CaseEditorService.IsEditable(published));
    }

    [Fact]
    public void PlaytestStartScene_OpenCoopStartsThereWithEveryPlaceOpen()
    {
        var gameCase = EditableDraft();
        var scenes = Scenes(gameCase).ToList();
        var target = scenes.Last();

        var state = RoomService.CreateInitialGameplayState(gameCase, new[] { "a", "b" }, target.SceneId);

        Assert.Equal(target.SceneId, state.CurrentSceneId);
        Assert.All(state.PlayerSceneIds.Values, sceneId => Assert.Equal(target.SceneId, sceneId));
        Assert.Equal(new[] { target.SceneId }, state.VisitedSceneIds);
        Assert.Equal(scenes.Select(scene => scene.SceneId), state.UnlockedSceneIds);
        Assert.Equal(gameCase.Stages.First(stage => stage.Scenes.Contains(target)).StageId, state.CurrentStageId);
    }

    [Fact]
    public void PlaytestStartScene_ClassicCaseUnlocksTheFirstSceneAndTheStartScene()
    {
        var gameCase = Load("case-pixel-lo-thuoc-thu-nam-vi.json");
        gameCase.RuleSet = string.Empty;
        var scenes = Scenes(gameCase).ToList();
        Assert.True(scenes.Count >= 3);
        var target = scenes[2];

        var state = RoomService.CreateInitialGameplayState(gameCase, new[] { "a", "b" }, target.SceneId);
        var unknown = RoomService.CreateInitialGameplayState(gameCase, new[] { "a", "b" }, "scene-does-not-exist");
        var none = RoomService.CreateInitialGameplayState(gameCase, new[] { "a", "b" });

        Assert.Equal(target.SceneId, state.CurrentSceneId);
        Assert.Equal(new[] { scenes[0].SceneId, target.SceneId }, state.UnlockedSceneIds);
        Assert.Equal(scenes[0].SceneId, unknown.CurrentSceneId);
        Assert.Equal(new[] { scenes[0].SceneId }, unknown.UnlockedSceneIds);
        Assert.Equal(scenes[0].SceneId, none.CurrentSceneId);
        Assert.Equal(new[] { scenes[0].SceneId }, none.UnlockedSceneIds);
    }

    [Fact]
    public void SaveRequest_ReadsTheEditorsJson()
    {
        var json = """{"baseVersion":3,"checkpoint":true,"note":"sửa cửa","caseJson":{"caseId":"x"}}""";

        var request = JsonSerializer.Deserialize<CaseEditorSaveRequest>(json, Web)!;

        Assert.Equal(3, request.BaseVersion);
        Assert.True(request.Checkpoint);
        Assert.Equal("sửa cửa", request.Note);
        Assert.Equal(JsonValueKind.Object, request.CaseJson.ValueKind);
    }
}
