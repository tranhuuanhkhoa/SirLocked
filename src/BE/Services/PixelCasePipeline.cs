using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// The fixed numbers of a pixel scene, measured from "Tram hong ngoc mat tich" (case-pixel-tram-hong-ngoc-vi.json):
/// one 512x512 PixelLab picture drawn at x4 (2048x2048 runtime units), topdown outside and isometric 2:1 rooms.
/// </summary>
public sealed record PixelSceneProfile(
    string Projection,
    double CameraZoom,
    double ActorScale,
    double WalkSpeed,
    double InteractRadius,
    string BackdropColor,
    double CaptureWidth,
    double CaptureHeight)
{
    public const int NativeSize = 512;
    public const double PixelScale = 4;
    public const int RuntimeSize = 2048;
    public const int CellSize = 16;
    public const int GridCells = RuntimeSize / CellSize;
    public const int FrameSize = 128;
    public const int FrameCount = 9;
    public const int Fps = 6;
    public const int SheetWidth = FrameSize * FrameCount;
    public const int PortraitSize = 288;
    public const int IconSize = 64;

    public static readonly PixelSceneProfile TopDown =
        new(SceneRenderModes.TopDown, 1.0, 1.5, 300, 120, "#3c4a55", 200, 156);
    public static readonly PixelSceneProfile Isometric =
        new(SceneRenderModes.Isometric, 0.5, 4, 520, 104, "#11100e", 360, 280);

    public static PixelSceneProfile For(string projection) =>
        projection == SceneRenderModes.TopDown ? TopDown : Isometric;

    /// <summary>NPC sprites: 128px frames drawn at actorScale (512 in rooms, 192 outside).</summary>
    public double ActorSize => FrameSize * ActorScale;

    /// <summary>Talk box above the feet, as in the bundled cases (36x86 sprite pixels; 144x344 in rooms).</summary>
    public RuntimeBox NpcHotspot(double feetX, double feetY)
    {
        var width = Math.Round(36 * ActorScale);
        var height = Math.Round(86 * ActorScale);
        return new RuntimeBox { X = feetX - width / 2, Y = feetY - (height - 2 * ActorScale), Width = width, Height = height };
    }

    public SceneRenderSettings Render(SceneWalkGrid? walkGrid, List<SceneForegroundLayer> foreground, string? backdropColor) => new()
    {
        Mode = SceneRenderModes.Pixel,
        Projection = Projection,
        NativeWidth = NativeSize,
        NativeHeight = NativeSize,
        PixelScale = PixelScale,
        CameraZoom = CameraZoom,
        ActorScale = ActorScale,
        WalkSpeed = WalkSpeed,
        InteractRadius = InteractRadius,
        BackdropColor = string.IsNullOrWhiteSpace(backdropColor) ? BackdropColor : backdropColor,
        WalkGrid = walkGrid,
        Foreground = foreground
    };
}

/// <summary>Walk-grid geometry shared by the runtime builder and the pixel validator (same rules as the game's navigation.ts).</summary>
public static class PixelWalkGrid
{
    public static bool Walkable(SceneWalkGrid grid, int col, int row) =>
        row >= 0 && col >= 0 && row < grid.Rows && col < grid.Cols && row < grid.Data.Count
        && col < grid.Data[row].Length && grid.Data[row][col] == '1';

    public static (int Col, int Row) Cell(SceneWalkGrid grid, double x, double y) =>
        ((int)Math.Floor(x / grid.CellSize), (int)Math.Floor(y / grid.CellSize));

    public static RuntimePoint CellCentre(SceneWalkGrid grid, int col, int row) =>
        new() { X = col * grid.CellSize + grid.CellSize / 2.0, Y = row * grid.CellSize + grid.CellSize / 2.0, Anchor = "bottom-center" };

    /// <summary>The walkable cell whose centre is nearest to a point (the game's gridNearest), or null.</summary>
    public static (int Col, int Row, double Distance)? Nearest(SceneWalkGrid grid, double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return null;
        var (col0, row0) = Cell(grid, x, y);
        if (Walkable(grid, col0, row0)) return (col0, row0, 0);
        (int, int, double)? best = null;
        for (var row = 0; row < grid.Rows; row++)
        {
            for (var col = 0; col < grid.Cols; col++)
            {
                if (!Walkable(grid, col, row)) continue;
                var centre = CellCentre(grid, col, row);
                var distance = Math.Sqrt((centre.X - x) * (centre.X - x) + (centre.Y - y) * (centre.Y - y));
                if (best is null || distance < best.Value.Item3) best = (col, row, distance);
            }
        }
        return best;
    }

    /// <summary>Cells reachable on foot (4-neighbour) from the cell under a point; empty when that cell is blocked.</summary>
    public static HashSet<(int Col, int Row)> Component(SceneWalkGrid grid, double x, double y)
    {
        var result = new HashSet<(int, int)>();
        var start = Cell(grid, x, y);
        if (!Walkable(grid, start.Col, start.Row)) return result;
        var queue = new Queue<(int, int)>();
        queue.Enqueue(start);
        result.Add(start);
        while (queue.Count > 0)
        {
            var (col, row) = queue.Dequeue();
            foreach (var (dc, dr) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
            {
                var next = (col + dc, row + dr);
                if (Walkable(grid, next.Item1, next.Item2) && result.Add(next)) queue.Enqueue(next);
            }
        }
        return result;
    }

    /// <summary>The floor point a player walks to before using an object: the walkable cell nearest its base.</summary>
    public static (int Col, int Row, double Distance)? Approach(SceneWalkGrid grid, RuntimeBox box) =>
        Nearest(grid, box.X + box.Width / 2, box.Y + box.Height - 1);

    public static bool BoxTouchesComponent(SceneWalkGrid grid, RuntimeBox box, HashSet<(int Col, int Row)> component)
    {
        var (c0, r0) = Cell(grid, box.X, box.Y);
        var (c1, r1) = Cell(grid, box.X + box.Width - 1, box.Y + box.Height - 1);
        for (var row = Math.Max(0, r0); row <= Math.Min(grid.Rows - 1, r1); row++)
        for (var col = Math.Max(0, c0); col <= Math.Min(grid.Cols - 1, c1); col++)
            if (component.Contains((col, row))) return true;
        return false;
    }

    /// <summary>Bounding box of the walkable cells (runtime units).</summary>
    public static RuntimeBox? WalkableBounds(SceneWalkGrid grid)
    {
        int minCol = int.MaxValue, minRow = int.MaxValue, maxCol = -1, maxRow = -1;
        for (var row = 0; row < grid.Rows; row++)
        for (var col = 0; col < grid.Cols; col++)
        {
            if (!Walkable(grid, col, row)) continue;
            minCol = Math.Min(minCol, col); maxCol = Math.Max(maxCol, col);
            minRow = Math.Min(minRow, row); maxRow = Math.Max(maxRow, row);
        }
        return maxCol < 0
            ? null
            : new RuntimeBox
            {
                X = minCol * grid.CellSize, Y = minRow * grid.CellSize,
                Width = (maxCol - minCol + 1) * grid.CellSize, Height = (maxRow - minRow + 1) * grid.CellSize
            };
    }
}

/// <summary>
/// Pixel drafts (VUAN-6B): decides each scene's projection, turns the bot's placement plan into the runtime of a pixel
/// scene in the exact shape of the bundled pixel cases, and fills in the pictures uploaded for NPCs and items.
/// </summary>
public static class PixelCasePipeline
{
    /// <summary>The seven interface sounds every scene names (docs/case-audio-weather.md).</summary>
    public static readonly IReadOnlyList<string> DefaultCues = ["interact", "discovery", "reveal", "error", "ping", "scene", "dialogue"];

    public static bool IsPixel(AiCaseDraft draft) => draft.VisualPipeline == AiVisualPipelines.PixelV1;

    /// <summary>
    /// Topdown for an outdoor scene, isometric for a room. The writer's <c>indoor</c> flag decides; without one the first
    /// scene is the outdoor map and the others are rooms (the same assumption as scripts/build_pixellab_requests.mjs).
    /// </summary>
    public static string ProjectionFor(GameCase gameCase, CaseScene scene)
    {
        if (scene.Runtime?.Indoor is bool indoor) return indoor ? SceneRenderModes.Isometric : SceneRenderModes.TopDown;
        var first = OrderedScenes(gameCase).FirstOrDefault();
        return first?.SceneId == scene.SceneId ? SceneRenderModes.TopDown : SceneRenderModes.Isometric;
    }

    public static IEnumerable<CaseScene> OrderedScenes(GameCase gameCase) =>
        gameCase.Stages.OrderBy(stage => stage.Order).SelectMany(stage => stage.Scenes);

    /// <summary>Scenes a door of <paramref name="scene"/> may lead to: the neighbours in play order and, for pixel
    /// maps, every room (rooms open onto every outdoor map), as the bundled cases are laid out.</summary>
    public static List<CaseScene> AllowedTransitionTargets(GameCase gameCase, CaseScene scene)
    {
        var ordered = OrderedScenes(gameCase).ToList();
        var index = ordered.FindIndex(entry => entry.SceneId == scene.SceneId);
        var projection = ProjectionFor(gameCase, scene);
        var result = new List<CaseScene>();
        void Add(CaseScene? target)
        {
            if (target is not null && target.SceneId != scene.SceneId && result.All(entry => entry.SceneId != target.SceneId))
                result.Add(target);
        }
        Add(index > 0 ? ordered[index - 1] : null);
        Add(index >= 0 && index < ordered.Count - 1 ? ordered[index + 1] : null);
        foreach (var other in ordered.Where(other => ProjectionFor(gameCase, other) != projection)) Add(other);
        return result;
    }

    /// <summary>Items that get a 64x64 inventory icon: the collectible ones (and any item that already has an icon).</summary>
    public static bool HasInventoryIcon(CaseItem item) => item.IsCollectible || !string.IsNullOrWhiteSpace(item.ImageUrl);

    /// <summary>Builds the pixel runtime of a scene from its sanitized plan. Atmosphere (music, weather, indoor, time of day) is kept.</summary>
    public static SceneRuntime BuildRuntime(CaseScene scene, GameCase gameCase, ScenePlacementPlan plan, SceneRuntime? previousRuntime)
    {
        var profile = PixelSceneProfile.For(plan.Projection ?? ProjectionFor(gameCase, scene));
        var grid = plan.WalkGrid;
        var bounds = grid is null ? null : PixelWalkGrid.WalkableBounds(grid);
        var size = PixelSceneProfile.RuntimeSize;
        var itemMap = gameCase.Items.ToDictionary(item => item.ItemId, StringComparer.Ordinal);
        var runtime = new SceneRuntime
        {
            Width = size,
            Height = size,
            FloorY = bounds is null ? size - PixelSceneProfile.CellSize : bounds.Y + bounds.Height,
            WalkableArea = bounds ?? new RuntimeBox { X = 0, Y = 0, Width = size, Height = size },
            NavigationObstacles = new List<RuntimeBox>(),
            SpawnPoints = plan.SpawnPoints.ToDictionary(pair => pair.Key, pair => new SpawnPoint
            {
                X = pair.Value.X, Y = pair.Value.Y, Anchor = "bottom-center",
                Direction = string.IsNullOrWhiteSpace(pair.Value.Direction) ? "right" : pair.Value.Direction
            }, StringComparer.OrdinalIgnoreCase),
            ClueZones = plan.ClueZones,
            CameraRules = new CameraRules { CaptureRectWidth = profile.CaptureWidth, CaptureRectHeight = profile.CaptureHeight },
            Transitions = plan.Transitions,
            Render = profile.Render(grid, plan.Foreground ?? new List<SceneForegroundLayer>(), plan.BackdropColor)
        };
        foreach (var placement in plan.Placements)
        {
            if (placement.Type == "npc")
            {
                runtime.CharacterPlacements.Add(new CharacterPlacement
                {
                    CharacterId = placement.Id,
                    Asset = string.Empty,
                    Position = new RuntimePoint { X = placement.X, Y = placement.Y, Anchor = "bottom-center" },
                    Size = new RuntimeSize { Width = profile.ActorSize, Height = profile.ActorSize },
                    Hotspot = profile.NpcHotspot(placement.X, placement.Y),
                    Anchor = "bottom-center",
                    Direction = placement.Facing
                });
                continue;
            }
            if (!itemMap.ContainsKey(placement.Id)) continue;
            var box = new RuntimeBox
            {
                X = placement.X - placement.Width / 2, Y = placement.Y - placement.Height / 2,
                Width = placement.Width, Height = placement.Height
            };
            // Painted into the background: no overlay picture, a box where the object is drawn (as the bundled cases).
            runtime.ItemPlacements.Add(new ItemPlacement
            {
                ItemId = placement.Id,
                Asset = string.Empty,
                Position = new RuntimePoint { X = box.X + box.Width / 2, Y = box.Y + box.Height, Anchor = "bottom-center" },
                Size = new RuntimeSize { Width = 160, Height = 160 },
                Hotspot = box,
                Anchor = "bottom-center",
                Depth = 5
            });
        }
        // Music comes from the writer's atmosphere; the interface sounds are the CC0 pack (as the sample case of VUAN-4).
        runtime.Audio = previousRuntime?.Audio ?? new SceneAudioConfig();
        if (runtime.Audio.Cues.Count == 0)
            foreach (var cue in DefaultCues) runtime.Audio.Cues[cue] = $"/assets/audio/sfx/ui/{cue}.ogg";
        runtime.Weather = previousRuntime?.Weather;
        runtime.TimeOfDay = previousRuntime?.TimeOfDay;
        runtime.Indoor = previousRuntime?.Indoor ?? profile.Projection == SceneRenderModes.Isometric;
        return runtime;
    }

    /// <summary>Keeps the percent hotspots of the scene on the same boxes as the runtime (as the bundled cases do).</summary>
    public static void SyncSceneHotspots(CaseScene scene)
    {
        if (scene.Runtime is not { } runtime) return;
        double Percent(double value) => Math.Round(value / runtime.Width * 100, 3);
        foreach (var hotspot in scene.Hotspots)
        {
            var box = hotspot.Type.Equals("CHARACTER", StringComparison.OrdinalIgnoreCase)
                ? runtime.CharacterPlacements.FirstOrDefault(entry => entry.CharacterId == hotspot.TargetId)?.Hotspot
                : runtime.ItemPlacements.FirstOrDefault(entry => entry.ItemId == hotspot.TargetId)?.Hotspot;
            if (box is null) continue;
            hotspot.X = Percent(box.X);
            hotspot.Y = Percent(box.Y);
            hotspot.Width = Percent(box.Width);
            hotspot.Height = Percent(box.Height);
        }
    }

    /// <summary>The cover is one of the scenes (as "Tram hong ngoc" uses the pawnshop): the first room with someone in it.</summary>
    public static string CoverFrom(GameCase gameCase)
    {
        var scenes = OrderedScenes(gameCase).Where(scene => !string.IsNullOrWhiteSpace(scene.BackgroundUrl)).ToList();
        var rooms = scenes.Where(scene => ProjectionFor(gameCase, scene) == SceneRenderModes.Isometric).ToList();
        return (rooms.FirstOrDefault(scene => scene.CharacterIds.Count > 0) ?? rooms.FirstOrDefault() ?? scenes.FirstOrDefault())
            ?.BackgroundUrl ?? string.Empty;
    }

    /// <summary>The NPC idle sheet as the game reads it: 9 frames of 128x128 at 6 fps, anchored at the feet.</summary>
    public static CharacterSpriteSheet SpriteSheet(string url, double? feetAnchorY) => new()
    {
        Url = url,
        FrameWidth = PixelSceneProfile.FrameSize,
        FrameHeight = PixelSceneProfile.FrameSize,
        FrameCount = PixelSceneProfile.FrameCount,
        Fps = PixelSceneProfile.Fps,
        IdleFrames = new List<int>(),
        AnchorX = 0.5,
        AnchorY = feetAnchorY is > 0.5 and <= 1 ? feetAnchorY.Value : Math.Round(105d / PixelSceneProfile.FrameSize, 4)
    };

    /// <summary>
    /// Feet line of frame 0 of an idle sheet: (lowest row with an opaque pixel + 1) / 128, rounded to 4 decimals.
    /// Gives 0.7891 and 0.8203 for the two NPC sheets of "Tram hong ngoc"; null when the frame is empty.
    /// </summary>
    public static double? MeasureFeetAnchorY(byte[] bytes)
    {
        try
        {
            using var image = SixLabors.ImageSharp.Image.Load<SixLabors.ImageSharp.PixelFormats.Rgba32>(bytes);
            var frame = Math.Min(PixelSceneProfile.FrameSize, image.Width);
            var height = Math.Min(PixelSceneProfile.FrameSize, image.Height);
            var lowest = -1;
            image.ProcessPixelRows(accessor =>
            {
                for (var y = 0; y < height; y++)
                {
                    var row = accessor.GetRowSpan(y);
                    for (var x = 0; x < frame; x++)
                    {
                        if (row[x].A == 0) continue;
                        lowest = y;
                        break;
                    }
                }
            });
            return lowest < 0 ? null : Math.Round((lowest + 1d) / PixelSceneProfile.FrameSize, 4);
        }
        catch (Exception exception) when (exception is SixLabors.ImageSharp.UnknownImageFormatException
                                              or SixLabors.ImageSharp.InvalidImageContentException or NotSupportedException)
        {
            return null;
        }
    }
}
