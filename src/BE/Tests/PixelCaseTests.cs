using System.Text.Json;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The hand-authored PixelLab case and the pixel render-mode contract (runtime.render).</summary>
public sealed class PixelCaseTests
{
    private const string FileName = "case-pixel-lo-thuoc-thu-nam-vi.json";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static GameCase Load() =>
        JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", FileName)), JsonOptions)!;

    private static IEnumerable<CaseScene> Scenes(GameCase gameCase) => gameCase.Stages.OrderBy(stage => stage.Order).SelectMany(stage => stage.Scenes);

    private static string Errors(CaseValidationResult validation) =>
        string.Join(Environment.NewLine, validation.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}"));

    [Fact]
    public void PixelCase_IsPublishValidIncludingReachability()
    {
        var gameCase = Load();
        var validation = new CaseValidationService().Validate(gameCase);

        Assert.True(validation.IsValid, Errors(validation));
        Assert.Equal(Path.GetFileNameWithoutExtension(FileName), gameCase.CaseId);
        Assert.Equal("vi", gameCase.Language);
        Assert.Equal(3, gameCase.MechanicsVersion);
        Assert.Equal(6, Scenes(gameCase).Count());
        Assert.InRange(gameCase.Characters.Count, 1, 10);
    }

    [Fact]
    public void PixelCase_UsesEveryMechanic()
    {
        var gameCase = Load();
        Assert.Contains(gameCase.Interactions, interaction => interaction.Type == "COMBINE_ITEMS");
        Assert.Contains(gameCase.Interactions, interaction => interaction.Type == "USE_ITEM_ON_TARGET");
        Assert.Contains(gameCase.Interactions, interaction => interaction.Type == "INSPECT_ENVIRONMENT");
        Assert.Contains(gameCase.Puzzles, puzzle => puzzle.Type == "CODE_PUZZLE");
        Assert.Contains(gameCase.Puzzles, puzzle => puzzle.Type == "SEQUENCE_PUZZLE");
        Assert.Equal(2, gameCase.EvidenceChallenges.Count);
        Assert.Single(gameCase.EvidenceChallenges, challenge => challenge.IsSignature);
        Assert.Equal(2, gameCase.Deductions.Count);
        Assert.Equal(2, gameCase.RequiredTeamworkChains.Count);
        Assert.Contains(gameCase.ConversationNodes, node => node.IsRoot);
        Assert.Contains(gameCase.ConversationNodes, node => !string.IsNullOrEmpty(node.SourceDialogueId));
        Assert.Equal(2, Scenes(gameCase).Sum(scene => scene.Runtime!.ClueZones.Count));
        Assert.Equal(3, gameCase.FinalLogic.RequiredEvidenceLinks.Select(link => link.EvidenceId).Distinct().Count());
    }

    [Fact]
    public void PixelCase_EveryScene_HasAConsistentPixelRuntime()
    {
        var gameCase = Load();
        foreach (var scene in Scenes(gameCase))
        {
            var runtime = scene.Runtime!;
            var render = runtime.Render ?? throw new Xunit.Sdk.XunitException($"{scene.SceneId} has no render block.");
            Assert.Equal(SceneRenderModes.Pixel, render.Mode);
            Assert.Equal(runtime.Width, render.NativeWidth * render.PixelScale);
            var grid = render.WalkGrid!;
            Assert.Equal(runtime.Width, grid.Cols * grid.CellSize);
            foreach (var (name, spawn) in runtime.SpawnPoints)
                Assert.True(grid.IsWalkable(spawn.X, spawn.Y), $"{scene.SceneId} spawn {name} is blocked.");
            Assert.All(runtime.Transitions, transition => Assert.True(runtime.SpawnPoints.ContainsKey($"from:{transition.TargetSceneId}"),
                $"{scene.SceneId} has no arrival point for players coming back from {transition.TargetSceneId}."));
        }
        // The outdoor map links every room and each room links back to the map.
        var hub = Scenes(gameCase).First();
        Assert.Equal("topdown", hub.Runtime!.Render!.Projection);
        Assert.Equal(Scenes(gameCase).Skip(1).Select(scene => scene.SceneId).OrderBy(id => id, StringComparer.Ordinal).ToArray(),
            hub.Runtime.Transitions.Select(transition => transition.TargetSceneId).OrderBy(id => id, StringComparer.Ordinal).ToArray());
        Assert.All(Scenes(gameCase).Skip(1), scene => Assert.Equal(hub.SceneId, Assert.Single(scene.Runtime!.Transitions).TargetSceneId));
    }

    [Fact]
    public void RenderSettings_RejectsInconsistentPixelData()
    {
        var gameCase = Load();
        var scene = Scenes(gameCase).First();
        var render = scene.Runtime!.Render!;
        render.Projection = "side";
        render.PixelScale = 3;
        render.WalkGrid!.Data[0] = render.WalkGrid.Data[0][1..];
        render.Foreground.Add(new SceneForegroundLayer { Id = "bad", Url = "/assets/../secret.png", X = 0, Y = 0, Width = 8, Height = 8, BaseY = 4 });
        scene.Runtime.SpawnPoints["default"] = new SpawnPoint { X = 2, Y = 2 };

        var errors = new CaseValidationService().Validate(gameCase).Errors;

        Assert.Contains(errors, error => error.Code == "InvalidRenderSettings" && error.Path.EndsWith(".projection"));
        Assert.Contains(errors, error => error.Code == "InvalidRenderSettings" && error.Path.EndsWith(".pixelScale"));
        Assert.Contains(errors, error => error.Code == "InvalidRenderSettings" && error.Path.EndsWith(".walkGrid.data"));
        Assert.Contains(errors, error => error.Code == "InvalidRenderSettings" && error.Path.EndsWith(".url"));
    }

    [Fact]
    public void LegacyScenes_WithoutRender_AreUnchanged()
    {
        var legacy = JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,
            "SeedData", "V3", "case-point-click-night-ledger-vi.json")), JsonOptions)!;
        Assert.All(Scenes(legacy), scene => Assert.Null(scene.Runtime!.Render));
        Assert.True(new CaseValidationService().Validate(legacy).IsValid);
    }

    [Fact]
    public void WalkGrid_IsWalkable_ReadsRowsAndRejectsOutsidePoints()
    {
        var grid = new SceneWalkGrid { CellSize = 10, Cols = 3, Rows = 2, Data = ["101", "011"] };
        Assert.True(grid.IsWalkable(5, 5));
        Assert.False(grid.IsWalkable(15, 5));
        Assert.True(grid.IsWalkable(25, 15));
        Assert.False(grid.IsWalkable(-1, 5));
        Assert.False(grid.IsWalkable(5, 25));
        Assert.False(grid.IsWalkable(double.NaN, 5));
    }
}
