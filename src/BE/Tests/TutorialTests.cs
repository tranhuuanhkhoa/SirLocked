using System.Text.Json;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Cutscene;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// Màn tân thủ: the Kỳ cựu / Nhập môn rules, the solo room's single confirmation, the result that is never stored,
/// and the bundled tutorial case itself.
/// </summary>
public sealed class TutorialTests
{
    private static readonly DateTime Now = new(2026, 11, 17, 9, 0, 0, DateTimeKind.Utc);
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static GameCase LoadTutorialCase() => JsonSerializer.Deserialize<GameCase>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", TutorialRules.CaseFile)), Web)!;

    private static User Account(string? path = null, DateTime? createdAt = null, DateTime? completedAt = null, string role = UserRole.Player) => new()
    {
        Id = "user-1",
        Role = role,
        ExperiencePath = path,
        TutorialCompletedAt = completedAt,
        CreatedAt = createdAt ?? TutorialRules.LaunchUtc.AddDays(1)
    };

    // ---------------------------------------------------------------- Kỳ cựu / Nhập môn

    [Fact]
    public void OlderAccounts_CountAsVeterans_AndAreNeverAsked()
    {
        var old = Account(createdAt: TutorialRules.LaunchUtc.AddDays(-30));
        Assert.Equal(TutorialRules.PathVeteran, TutorialRules.EffectivePath(old));
        Assert.False(TutorialRules.NeedsChoice(old));
        Assert.False(TutorialRules.IsRequired(old));
    }

    [Fact]
    public void NewAccounts_MustChooseOnce()
    {
        var fresh = Account();
        Assert.Null(TutorialRules.EffectivePath(fresh));
        Assert.True(TutorialRules.NeedsChoice(fresh));
        // Not chosen yet is not "beginner": the server never blocks before the choice.
        Assert.False(TutorialRules.IsRequired(fresh));
    }

    [Fact]
    public void Beginner_IsBlockedUntilTheTutorialIsFinished()
    {
        Assert.True(TutorialRules.IsRequired(Account(TutorialRules.PathBeginner)));
        Assert.False(TutorialRules.IsRequired(Account(TutorialRules.PathBeginner, completedAt: Now)));
        Assert.False(TutorialRules.IsRequired(Account(TutorialRules.PathVeteran)));
        Assert.False(TutorialRules.IsRequired(Account(TutorialRules.PathBeginner, role: UserRole.Admin)));

        var refusal = Assert.Throws<ApiException>(() => TutorialRules.EnsureNotRequired(Account(TutorialRules.PathBeginner)));
        Assert.Equal(403, refusal.StatusCode);
        Assert.Equal(TutorialRules.RequiredCode, Assert.IsType<ApiErrorDetails>(refusal.Errors).Code);
        TutorialRules.EnsureNotRequired(Account(TutorialRules.PathVeteran));
        TutorialRules.EnsureNotRequired(null);
    }

    [Theory]
    [InlineData("beginner", true, TutorialRules.PathBeginner)]
    [InlineData(" VETERAN ", true, TutorialRules.PathVeteran)]
    [InlineData("expert", false, "EXPERT")]
    [InlineData(null, false, "")]
    public void Paths_AreNormalized(string? input, bool ok, string expected)
    {
        Assert.Equal(ok, TutorialRules.TryNormalizePath(input, out var path));
        Assert.Equal(expected, path);
    }

    [Fact]
    public void OnlyTutorialRooms_AskForASingleConfirmation()
    {
        Assert.Equal(1, TutorialRules.RequiredConfirmations(new GameRoom { Mode = TutorialRules.RoomMode }));
        Assert.Equal(2, TutorialRules.RequiredConfirmations(new GameRoom()));
        Assert.Equal(2, TutorialRules.RequiredConfirmations(new GameRoom { Mode = "SOMETHING" }));
        Assert.Equal(2, TutorialRules.RequiredConfirmations(null));
    }

    // ---------------------------------------------------------------- solo room rules

    [Fact]
    public void SoloRoom_AccusationResolvesWithItsOnlyPlayer()
    {
        var state = ConsensusReadyState();
        var transition = AccusationConsensusRules.Propose(
            ConsensusCase(), state, "attempt-1", "solo", PlayerRole.Investigator, "scene-1", Content(),
            new[] { "solo" }, Now, requiredPlayers: 1);

        Assert.True(transition.ShouldResolve);
        Assert.Null(state.ActiveAccusation);
        Assert.Equal(AccusationProposalStatus.Resolved, Assert.Single(state.AccusationAttempts).Status);
    }

    [Fact]
    public void PairRoom_StillNeedsBothDetectives_EvenWithOnePlayerLeft()
    {
        var state = ConsensusReadyState();
        // A normal room whose partner left must not resolve on one confirmation (the old rule).
        var transition = AccusationConsensusRules.Propose(
            ConsensusCase(), state, "attempt-1", "inv", PlayerRole.Investigator, "scene-1", Content(), new[] { "inv" }, Now);

        Assert.False(transition.ShouldResolve);
        Assert.NotNull(state.ActiveAccusation);
    }

    [Fact]
    public void SoloRoom_ConfrontationResolvesOnOneConfirmation_PairStillWaits()
    {
        var solo = ConfrontationReadyState();
        var resolved = PairedConfrontationRules.Confirm(
            solo, "attempt-1", "solo", PlayerRole.Interrogator, 2, true, new[] { "reveal-1" }, Now.AddMinutes(2), requiredConfirmations: 1);
        Assert.Equal(PairedConfrontationStatus.ResolvedCorrect, resolved.Status);
        Assert.Contains("reveal-1", solo.UnlockedClueIds);
        Assert.Null(solo.ActiveConfrontation);

        var pair = ConfrontationReadyState();
        var waiting = PairedConfrontationRules.Confirm(
            pair, "attempt-1", "int", PlayerRole.Interrogator, 2, true, new[] { "reveal-1" }, Now.AddMinutes(2));
        Assert.Equal(PairedConfrontationStatus.AwaitingSecondConfirmation, waiting.Status);
        Assert.DoesNotContain("reveal-1", pair.UnlockedClueIds);
    }

    [Fact]
    public async Task TutorialResults_AreNeverStored()
    {
        var result = new GameResult { RoomId = "room-1", CaseId = TutorialRules.CaseId, Success = true };
        Assert.Null(await TutorialResultStore.Instance.FindByRoomIdAsync("room-1"));
        Assert.Same(result, await TutorialResultStore.Instance.UpsertAsync(result));
        Assert.Null(await TutorialResultStore.Instance.FindByRoomIdAsync("room-1"));
    }

    [Fact]
    public void SoloRoom_StartsWithOnePlayerAndEveryPlaceOpen()
    {
        var gameCase = LoadTutorialCase();
        var state = RoomService.CreateInitialGameplayState(gameCase, new[] { "solo", "solo" });

        Assert.Equal("scene-tt-tra-lau", state.CurrentSceneId);
        Assert.Equal("scene-tt-tra-lau", Assert.Single(state.PlayerSceneIds).Value);
        Assert.Equal(new[] { "scene-tt-tra-lau", "scene-tt-ngo" }, state.UnlockedSceneIds);
        Assert.Equal(GameStatus.InProgress, state.GameStatus);
        Assert.Equal(1, state.Version);
    }

    // ---------------------------------------------------------------- the bundled tutorial case

    [Fact]
    public void TutorialCase_IsAValidPixelOpenCoopCase_WithEveryHint()
    {
        var gameCase = LoadTutorialCase();
        PuzzleKindRegistry.FillMissing(gameCase);
        var validation = new CaseValidationService().Validate(gameCase);
        validation.RequireHints();

        Assert.True(validation.IsValid, string.Join(Environment.NewLine, validation.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}")));
        Assert.Empty(validation.Warnings);
        Assert.Equal(TutorialRules.CaseId, gameCase.CaseId);
        Assert.True(CaseCatalogRules.IsPixel(gameCase));
        Assert.True(CaseRuleSets.IsOpenCoop(gameCase));
        Assert.Equal(CaseStatus.Draft, gameCase.Status);
    }

    [Fact]
    public void TutorialCase_TeachesEveryMechanicOnce()
    {
        var gameCase = LoadTutorialCase();
        var scenes = gameCase.Stages.SelectMany(stage => stage.Scenes).ToList();
        Assert.Equal(2, scenes.Count);
        Assert.Contains(scenes, scene => scene.Runtime!.Indoor == true && scene.Runtime.Weather?.Type == "NONE");
        Assert.Contains(scenes, scene => scene.Runtime!.Indoor == false && scene.Runtime.Weather?.Type == "RAIN");
        Assert.All(scenes, scene => Assert.False(string.IsNullOrEmpty(scene.Runtime!.Audio?.Music?.Url)));
        Assert.All(gameCase.Characters, character => Assert.NotNull(character.Voice?.Blip));
        Assert.Single(gameCase.Puzzles);
        Assert.Single(gameCase.EvidenceChallenges);
        Assert.Single(scenes.SelectMany(scene => scene.Runtime!.ClueZones));
        Assert.Contains(gameCase.Items, item => item.IsCollectible);
        Assert.Equal(3, gameCase.FinalLogic.RequiredEvidenceLinks.Count);
        Assert.Equal("char-tt-hamilton", gameCase.FinalLogic.CulpritId);
    }

    /// <summary>
    /// Like "Lo thuoc thu Nam" and "Tram hong ngoc": the objects are part of the scene art (PixelLab inpaint with a wide
    /// free-form mask, see ai-game-docs/pixel-case-tan-thu/inpaint/recipe.json), never a picture pasted on top. Each box sits
    /// over its drawn object.
    /// </summary>
    [Fact]
    public void TutorialCase_PaintsItsObjectsIntoTheScenes_LikeTram()
    {
        var gameCase = LoadTutorialCase();
        var layout = new CaseValidationResult();
        PixelDraftRules.ValidateLayout(gameCase, layout);
        Assert.True(layout.IsValid, string.Join(Environment.NewLine, layout.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}")));

        var scenes = gameCase.Stages.SelectMany(stage => stage.Scenes).ToList();
        var placements = scenes.SelectMany(scene => scene.Runtime!.ItemPlacements.Select(placement => (scene, placement))).ToList();
        Assert.Equal(3, placements.Count);
        foreach (var (scene, placement) in placements)
        {
            Assert.Equal(string.Empty, placement.Asset);
            var box = placement.Hotspot;
            Assert.Equal(box.X + box.Width / 2, placement.Position.X, 3);
            Assert.Equal(box.Y + box.Height, placement.Position.Y, 3);
            // The scene hotspot (percent of the scene) is the same box.
            var hotspot = scene.Hotspots.Single(candidate => candidate.TargetId == placement.ItemId);
            Assert.Equal(Math.Round(box.X / 2048 * 100, 2), hotspot.X, 2);
            Assert.Equal(Math.Round(box.Y / 2048 * 100, 2), hotspot.Y, 2);
        }

        // Every box comes from the recipe (native pixels x 4) and its object was drawn by that inpaint: the centre of the
        // box lies inside the mask. The counter is one wide mask over the whole counter top (Yen 17/11/2026), not a box per object.
        var recipe = JsonDocument.Parse(File.ReadAllText(InpaintFile("recipe.json"))).RootElement;
        var zones = scenes.SelectMany(scene => scene.Runtime!.ClueZones.Select(zone => (scene, zone))).ToList();
        var painted = new List<string>();
        foreach (var patch in recipe.GetProperty("patches").EnumerateArray())
        {
            var crop = patch.GetProperty("crop");
            int cropX = crop.GetProperty("x").GetInt32(), cropY = crop.GetProperty("y").GetInt32(), size = crop.GetProperty("size").GetInt32();
            Assert.True(File.Exists(InpaintFile(patch.GetProperty("output").GetString()!)));
            var masked = new bool[size, size];
            if (patch.TryGetProperty("maskFile", out var maskFile))
            {
                using var mask = SixLabors.ImageSharp.Image.Load<SixLabors.ImageSharp.PixelFormats.Rgba32>(InpaintFile(maskFile.GetString()!));
                Assert.Equal(size, mask.Width);
                Assert.Equal(size, mask.Height);
                for (var y = 0; y < size; y++)
                    for (var x = 0; x < size; x++) masked[x, y] = mask[x, y].R > 127;
            }
            else
            {
                var rect = patch.GetProperty("mask");
                for (var y = rect.GetProperty("y").GetInt32(); y < rect.GetProperty("y").GetInt32() + rect.GetProperty("height").GetInt32(); y++)
                    for (var x = rect.GetProperty("x").GetInt32(); x < rect.GetProperty("x").GetInt32() + rect.GetProperty("width").GetInt32(); x++) masked[x, y] = true;
            }
            var targets = 0;
            foreach (var group in new[] { "items", "clueZones" })
            {
                if (!patch.TryGetProperty(group, out var boxes)) continue;
                foreach (var entry in boxes.EnumerateObject())
                {
                    var b = entry.Value.EnumerateArray().Select(value => value.GetInt32()).ToArray();
                    var expected = new[] { b[0] * 4.0, b[1] * 4.0, (b[2] - b[0] + 1) * 4.0, (b[3] - b[1] + 1) * 4.0 };
                    if (group == "items")
                    {
                        var (scene, placement) = placements.Single(candidate => candidate.placement.ItemId == entry.Name);
                        Assert.EndsWith("/" + patch.GetProperty("scene").GetString(), scene.BackgroundUrl.Split('?')[0]); // ?v= only defeats the CDN cache
                        Assert.Equal(expected, new[] { placement.Hotspot.X, placement.Hotspot.Y, placement.Hotspot.Width, placement.Hotspot.Height });
                    }
                    else
                    {
                        var (scene, zone) = zones.Single(candidate => candidate.zone.ClueId == entry.Name);
                        Assert.EndsWith("/" + patch.GetProperty("scene").GetString(), scene.BackgroundUrl.Split('?')[0]); // ?v= only defeats the CDN cache
                        Assert.Equal(expected, new[] { zone.Bounds.X, zone.Bounds.Y, zone.Bounds.Width, zone.Bounds.Height });
                    }
                    int centreX = (b[0] + b[2]) / 2 - cropX, centreY = (b[1] + b[3]) / 2 - cropY;
                    Assert.True(centreX >= 0 && centreY >= 0 && centreX < size && centreY < size && masked[centreX, centreY], $"{entry.Name}: not drawn by inpaint {patch.GetProperty("id").GetString()}");
                    painted.Add(entry.Name);
                    targets++;
                }
            }
            if (patch.GetProperty("id").GetString() == "tra-lau-quay")
            {
                Assert.Equal(3, targets);
                Assert.True(masked.Cast<bool>().Count(value => value) > 4000, "the counter mask covers the whole counter top");
            }
        }
        Assert.Equal(new[] { "clue-tt-vong-nuoc", "item-tt-hom-go", "item-tt-so-khach", "item-tt-thu-xe" }, painted.Order().ToArray());
    }

    private static string InpaintFile(string name) => RepoFile("ai-game-docs", "pixel-case-tan-thu", "inpaint", name);

    private static string RepoFile(params string[] parts)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "SirLocked.sln"))) directory = directory.Parent;
        return Path.Combine(new[] { directory!.FullName }.Concat(parts).ToArray());
    }

    [Fact]
    public void TutorialCutscene_IsValidForTheCase()
    {
        var gameCase = LoadTutorialCase();
        var script = JsonSerializer.Deserialize<MotionComicScript>(File.ReadAllText(CutsceneService.SeedFilePath(TutorialRules.CaseId)), Web);
        Assert.Empty(CutsceneScriptValidator.Validate(script, gameCase));
    }

    // ---------------------------------------------------------------- helpers

    private static AccusationProposalContent Content() => new(
        "char-1", "motive-1", "method-1", new[] { "clue-1" },
        new[] { new SelectedEvidenceLink { ClaimType = "MOTIVE", EvidenceId = "clue-1" } });

    private static GameplayState ConsensusReadyState() => new()
    {
        CurrentStageId = "stage-1",
        CurrentSceneId = "scene-1",
        CompletedSceneIds = { "scene-1" },
        Version = 1
    };

    // ---------------------------------------------------------------- one player, both detectives

    /// <summary>
    /// The tutorial player switches between Sherlock and Watson by hand. As Sherlock they must still see the guestbook:
    /// touching it tells them it is Watson's job (gamePage onHotspot) instead of the click falling through to the floor
    /// ("Không có đường đi tới điểm này"). A real two-player room keeps the role-specific scene.
    /// </summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void TutorialRoom_ShowsSherlockTheObjects_PairRoomDoesNot(bool tutorial)
    {
        var gameCase = LoadTutorialCase();
        var scene = gameCase.Stages[0].Scenes.First(candidate => candidate.SceneId == "scene-tt-tra-lau");
        var unlocked = new HashSet<string>(StringComparer.Ordinal);
        var response = new GameStateResponse
        {
            IsTutorial = tutorial,
            VisibleScene = new VisibleSceneDto
            {
                SceneId = scene.SceneId,
                Runtime = scene.Runtime,
                Hotspots = scene.Hotspots.Select(hotspot => HotspotDto.From(hotspot, unlocked)).ToList(),
                Items = scene.ItemIds.Select(id => SceneItemDto.From(gameCase.Items.First(item => item.ItemId == id), false)).ToList()
            }
        };

        V3SceneProjectionPolicy.Apply(response, gameCase, new RoomPlayer { UserId = "solo", Role = PlayerRole.Interrogator });

        var visible = response.VisibleScene;
        Assert.Equal(tutorial, visible.Hotspots.Any(hotspot => hotspot.HotspotId == "hotspot-tt-so-khach"));
        Assert.Equal(tutorial, visible.Items.Any(item => item.ItemId == "item-tt-so-khach"));
        Assert.Equal(tutorial, visible.Runtime!.ItemPlacements.Any(placement => placement.ItemId == "item-tt-so-khach"));
        // Sherlock still gets no camera surface: photographing stays Watson's.
        Assert.Empty(visible.Runtime.ClueZones);
        Assert.Contains(visible.Hotspots, hotspot => hotspot.HotspotId == "hotspot-tt-ong-luu");
    }

    private static GameCase ConsensusCase() => new()
    {
        CaseId = "case-consensus",
        MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
        Stages = new List<CaseStage>
        {
            new() { StageId = "stage-1", Order = 1, Scenes = new List<CaseScene> { new() { SceneId = "scene-1" } } }
        }
    };

    private static GameplayState ConfrontationReadyState()
    {
        var state = new GameplayState();
        PairedConfrontationRules.Start(state, "attempt-1", "challenge-1", "fragment-1", "solo", PlayerRole.Interrogator, Now);
        PairedConfrontationRules.ProposeEvidence(state, "attempt-1", "evidence-1", "solo", PlayerRole.Investigator, 1, Now.AddMinutes(1));
        return state;
    }
}
