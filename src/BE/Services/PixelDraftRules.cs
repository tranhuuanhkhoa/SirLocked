using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// Strict checks for a new AI draft in the pixel pipeline (VUAN-6B): the case must have the shape of
/// "Tram hong ngoc mat tich". Errors here block the draft; classic drafts and hand-made cases never run them.
/// </summary>
public static class PixelDraftRules
{
    /// <summary>Layout gate: every scene is a pixel scene with the bundled numbers, a walk grid and reachable targets.</summary>
    public static void ValidateLayout(GameCase gameCase, CaseValidationResult result)
    {
        var scenes = PixelCasePipeline.OrderedScenes(gameCase).ToList();
        if (scenes.Count == 0 || !CaseCatalogRules.IsPixel(gameCase))
            result.Add("PixelSceneRequired", "stages[].scenes[].runtime.render",
                "A new AI case must render every scene in pixel mode (CaseCatalog PixelOnly shows nothing else).");
        foreach (var scene in scenes) ValidateScene(gameCase, scene, result);
    }

    /// <summary>Final gate: layout rules plus NPC sheets, portraits and inventory icons.</summary>
    public static void ValidateFinal(GameCase gameCase, IReadOnlyDictionary<string, AiBridgeAssetUpload> uploads, CaseValidationResult result)
    {
        ValidateLayout(gameCase, result);
        var placed = PixelCasePipeline.OrderedScenes(gameCase).SelectMany(scene => scene.CharacterIds).ToHashSet(StringComparer.Ordinal);
        for (var index = 0; index < gameCase.Characters.Count; index++)
        {
            var character = gameCase.Characters[index];
            var path = $"characters[{index}]";
            if (!placed.Contains(character.CharacterId)) continue;
            if (character.Presentation?.SpriteSheet is not { } sheet || string.IsNullOrWhiteSpace(sheet.Url))
            {
                result.Add("SpriteSheetMissing", $"{path}.presentation.spriteSheet",
                    "A pixel NPC needs its idle sprite sheet (1152x128: 9 frames of 128x128).", character.CharacterId);
            }
            else if (sheet.FrameWidth != PixelSceneProfile.FrameSize || sheet.FrameHeight != PixelSceneProfile.FrameSize
                     || sheet.FrameCount != PixelSceneProfile.FrameCount || sheet.Fps != PixelSceneProfile.Fps
                     || Math.Abs(sheet.AnchorX - 0.5) > 0.0001 || sheet.AnchorY is <= 0.5 or > 1)
            {
                result.Add("SpriteSheetSize", $"{path}.presentation.spriteSheet",
                    "The idle sheet must be 9 frames of 128x128 at 6 fps, anchorX 0.5 and anchorY at the feet (0.5..1).", character.CharacterId);
            }
            if (string.IsNullOrWhiteSpace(character.ImageUrl))
                result.Add("PortraitMissing", $"{path}.imageUrl", "A pixel NPC needs its 288x288 portrait.", character.CharacterId);
            CheckUpload(uploads, $"character-sprite:{character.CharacterId}", PixelSceneProfile.SheetWidth, PixelSceneProfile.FrameSize,
                "SpriteSheetSize", $"{path}.presentation.spriteSheet", character.CharacterId, result);
            CheckUpload(uploads, $"character-portrait:{character.CharacterId}", PixelSceneProfile.PortraitSize, PixelSceneProfile.PortraitSize,
                "PortraitSize", $"{path}.imageUrl", character.CharacterId, result);
        }
        for (var index = 0; index < gameCase.Items.Count; index++)
        {
            var item = gameCase.Items[index];
            if (!item.IsCollectible) continue;
            if (string.IsNullOrWhiteSpace(item.ImageUrl))
                result.Add("IconMissing", $"items[{index}].imageUrl", "A collectible item needs its 64x64 inventory icon.", item.ItemId);
            CheckUpload(uploads, $"item:{item.ItemId}", PixelSceneProfile.IconSize, PixelSceneProfile.IconSize,
                "IconSize", $"items[{index}].imageUrl", item.ItemId, result);
        }
        foreach (var scene in PixelCasePipeline.OrderedScenes(gameCase))
            CheckUpload(uploads, $"background:{scene.SceneId}", PixelSceneProfile.NativeSize, PixelSceneProfile.NativeSize,
                "BackgroundSize", $"scene:{scene.SceneId}.backgroundUrl", scene.SceneId, result);
    }

    private static void CheckUpload(IReadOnlyDictionary<string, AiBridgeAssetUpload> uploads, string slotId, int width, int height,
        string code, string path, string id, CaseValidationResult result)
    {
        if (uploads.TryGetValue(slotId, out var upload) && (upload.Width != width || upload.Height != height))
            result.Add(code, path, $"{slotId} is {upload.Width}x{upload.Height}; a pixel case needs {width}x{height}.", id);
    }

    /// <summary>The layout rules of one scene (used to send the bot its own layout errors once before the gate).</summary>
    public static CaseValidationResult ValidateSceneLayout(GameCase gameCase, CaseScene scene)
    {
        var result = new CaseValidationResult();
        ValidateScene(gameCase, scene, result);
        return result;
    }

    private static void ValidateScene(GameCase gameCase, CaseScene scene, CaseValidationResult result)
    {
        var path = $"scene:{scene.SceneId}.runtime";
        void Add(string code, string field, string message) => result.Add(code, $"{path}{field}", message, scene.SceneId);
        if (string.IsNullOrWhiteSpace(scene.BackgroundUrl))
            result.Add("BackgroundMissing", $"scene:{scene.SceneId}.backgroundUrl", "A pixel scene needs its 512x512 background.", scene.SceneId);
        if (scene.Runtime is not { } runtime) { Add("PixelSceneRequired", string.Empty, "The scene has no runtime."); return; }
        if (runtime.Render is not { } render || render.Mode != SceneRenderModes.Pixel)
        {
            Add("PixelSceneRequired", ".render.mode", "Every scene of a new AI case renders in pixel mode.");
            return;
        }
        var expected = PixelSceneProfile.For(PixelCasePipeline.ProjectionFor(gameCase, scene));
        if (render.Projection != expected.Projection)
            Add("PixelProjection", ".render.projection",
                $"An {(expected.Projection == SceneRenderModes.TopDown ? "outdoor scene is topdown" : "indoor scene is isometric")}, not {render.Projection}.");
        if (runtime.Width != PixelSceneProfile.RuntimeSize || runtime.Height != PixelSceneProfile.RuntimeSize
            || render.NativeWidth != PixelSceneProfile.NativeSize || render.NativeHeight != PixelSceneProfile.NativeSize
            || Math.Abs(render.PixelScale - PixelSceneProfile.PixelScale) > 0.0001)
            Add("PixelProfileMismatch", ".render", "A pixel scene is 512x512 native at pixelScale 4 (runtime 2048x2048).");
        if (Math.Abs(render.CameraZoom - expected.CameraZoom) > 0.0001 || Math.Abs(render.ActorScale - expected.ActorScale) > 0.0001
            || Math.Abs(render.WalkSpeed - expected.WalkSpeed) > 0.0001 || Math.Abs(render.InteractRadius - expected.InteractRadius) > 0.0001)
            Add("PixelProfileMismatch", ".render",
                $"{expected.Projection}: cameraZoom {expected.CameraZoom}, actorScale {expected.ActorScale}, walkSpeed {expected.WalkSpeed}, interactRadius {expected.InteractRadius}.");

        var size = PixelSceneProfile.RuntimeSize;
        bool Inside(RuntimeBox box) => double.IsFinite(box.X) && double.IsFinite(box.Y) && box.Width > 0 && box.Height > 0
                                       && box.X >= 0 && box.Y >= 0 && box.X + box.Width <= size && box.Y + box.Height <= size;
        foreach (var placement in runtime.ItemPlacements)
        {
            if (!Inside(placement.Hotspot))
                Add("HotspotOutOfBounds", $".itemPlacements[{placement.ItemId}].hotspot", "The item box must lie inside the 2048x2048 scene.");
            if (!string.IsNullOrWhiteSpace(placement.Asset))
                Add("PixelItemOverlay", $".itemPlacements[{placement.ItemId}].asset",
                    "Investigation items are painted into the pixel background: no overlay picture, only a box over the drawn object.");
        }
        foreach (var placement in runtime.CharacterPlacements)
        {
            if (!Inside(placement.Hotspot))
                Add("HotspotOutOfBounds", $".characterPlacements[{placement.CharacterId}].hotspot", "The NPC box must lie inside the 2048x2048 scene.");
            if (Math.Abs(placement.Size.Width - expected.ActorSize) > 0.5 || Math.Abs(placement.Size.Height - expected.ActorSize) > 0.5)
                Add("PixelActorSize", $".characterPlacements[{placement.CharacterId}].size",
                    $"NPCs are drawn at actorScale {expected.ActorScale}: size {expected.ActorSize}x{expected.ActorSize}.");
        }
        foreach (var transition in runtime.Transitions.Where(transition => !Inside(transition.Hotspot)))
            Add("HotspotOutOfBounds", $".transitions[{transition.TargetSceneId}].hotspot", "The door box must lie inside the 2048x2048 scene.");
        foreach (var zone in runtime.ClueZones.Where(zone => !Inside(zone.Bounds)))
            Add("HotspotOutOfBounds", $".clueZones[{zone.ClueId}].bounds", "The clue box must lie inside the 2048x2048 scene.");

        for (var i = 0; i < render.Foreground.Count; i++)
        {
            var layer = render.Foreground[i];
            if (!double.IsFinite(layer.BaseY) || layer.BaseY <= layer.Y || layer.BaseY > layer.Y + layer.Height + 0.5)
                Add("ForegroundBaseY", $".render.foreground[{i}].baseY",
                    $"Foreground layer '{layer.Id}' needs baseY at its ground contact, between y and y + height (runtime units).");
        }

        if (render.WalkGrid is not { } grid)
        {
            Add("MissingWalkGrid", ".render.walkGrid", "A pixel scene needs runtime.render.walkGrid (asset_process walkable: 128x128 cells of 16).");
            return;
        }
        if (grid.CellSize != PixelSceneProfile.CellSize || grid.Cols != PixelSceneProfile.GridCells || grid.Rows != PixelSceneProfile.GridCells
            || grid.Data.Count != grid.Rows || grid.Data.Any(row => row is null || row.Length != grid.Cols || row.Any(cell => cell is not ('0' or '1'))))
        {
            Add("MissingWalkGrid", ".render.walkGrid", "walkGrid is cellSize 16, 128 cols, 128 rows of '0'/'1'.");
            return;
        }
        if (!runtime.SpawnPoints.TryGetValue("default", out var origin))
        {
            Add("SpawnNotWalkable", ".spawnPoints.default", "A pixel scene needs a default spawn point.");
            return;
        }
        var component = PixelWalkGrid.Component(grid, origin.X, origin.Y);
        if (component.Count == 0)
        {
            Add("SpawnNotWalkable", ".spawnPoints.default", "The default spawn point is not on a walkable cell.");
            return;
        }
        foreach (var (name, spawn) in runtime.SpawnPoints)
        {
            if (!component.Contains(PixelWalkGrid.Cell(grid, spawn.X, spawn.Y)))
                Add("SpawnNotWalkable", $".spawnPoints.{name}", $"Spawn point '{name}' is not on a walkable cell reachable from the default spawn.");
        }
        foreach (var transition in runtime.Transitions)
        {
            var approach = PixelWalkGrid.Approach(grid, transition.Hotspot);
            var touches = PixelWalkGrid.BoxTouchesComponent(grid, transition.Hotspot, component);
            var near = approach is { } point && component.Contains((point.Col, point.Row)) && point.Distance <= render.InteractRadius;
            if (!touches && !near)
                Add("DoorNotWalkable", $".transitions[{transition.TargetSceneId}].hotspot",
                    "The door must sit on (or within interactRadius of) the walkable floor reachable from the spawn.");
        }
        foreach (var placement in runtime.ItemPlacements)
            CheckReachable(grid, component, placement.Hotspot, $".itemPlacements[{placement.ItemId}]", Add);
        foreach (var placement in runtime.CharacterPlacements)
            CheckReachable(grid, component, placement.Hotspot, $".characterPlacements[{placement.CharacterId}]", Add);
    }

    private static void CheckReachable(SceneWalkGrid grid, HashSet<(int Col, int Row)> component, RuntimeBox box, string field,
        Action<string, string, string> add)
    {
        var approach = PixelWalkGrid.Approach(grid, box);
        if (approach is not { } point || !component.Contains((point.Col, point.Row)))
            add("HotspotUnreachable", field,
                "The floor cell nearest the bottom of this box is not reachable from the spawn: the player cannot walk up to it.");
    }
}
