using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// VUAN-6B: new AI drafts make pixel cases in the shape of "Tram hong ngoc mat tich" (the reference case), plan their
/// pictures with the PixelLab templates (library first, within pixelLabCap) and let each accusation claim accept the
/// other evidence of the same conclusion.
/// </summary>
public sealed class PixelPipelineTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private const string Tram = "case-pixel-tram-hong-ngoc-vi.json";
    private const string LoThuoc = "case-pixel-lo-thuoc-thu-nam-vi.json";

    private static string SeedFile(string name) => Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", name);
    private static GameCase LoadSeed(string name) => JsonSerializer.Deserialize<GameCase>(File.ReadAllText(SeedFile(name)), Web)!;
    private static GameCase LoadFixture(string name) =>
        JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name)), Web)!;

    private static string RepoFile(params string[] parts)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "SirLocked.sln"))) directory = directory.Parent;
        return Path.Combine(new[] { directory!.FullName }.Concat(parts).ToArray());
    }

    private static string PublicAsset(string url) => RepoFile(new[] { "src", "FE", "public" }.Concat(url.TrimStart('/').Split('/')).ToArray());

    private static string Errors(CaseValidationResult validation) =>
        string.Join(Environment.NewLine, validation.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}"));

    private static IEnumerable<CaseScene> Scenes(GameCase gameCase) => gameCase.Stages.OrderBy(stage => stage.Order).SelectMany(stage => stage.Scenes);

    // ---------------------------------------------------------------- a new AI draft, built with the server mock

    /// <summary>
    /// The mock AI case as the bridge pipeline makes it: projection compile (mock content with music, rain outside,
    /// blips), the pixel layout answer of the server mock, then the uploads of a library-only order (pictures of the
    /// two bundled pixel cases, as e2e-local uses).
    /// </summary>
    internal static (AiCaseDraft Draft, GameCase Case, Dictionary<string, AiBridgeAssetUpload> Uploads) MockPixelDraft(
        string preset = AiGenerationPresets.ShortDemo)
    {
        var draft = AiPromptBenchmark.Fixture(preset, CaseLanguages.Vietnamese);
        draft.VisualPipeline = AiVisualPipelines.PixelV1;
        var content = ProjectionContentMockFactory.Build(draft.ProjectionPlan!);
        var gameCase = new GameCaseProjectionCompiler().Compile(draft.ProjectionPlan!, content, draft.Settings);
        gameCase.CaseId = "case-ai-mock-pixel-vi";
        AiV3GenerationProfile.ApplyServerOwnedFields(draft, gameCase, resetGeneratedAssets: true);
        AcceptedEvidencePolicy.Fill(gameCase, candidate => new CaseValidationService().ValidateFullLogic(candidate));

        var uploads = new Dictionary<string, AiBridgeAssetUpload>(StringComparer.Ordinal);
        var manifest = new AiAssetManifest();
        AiBridgeAssetUpload Upload(AiAssetSlot slot, string url)
        {
            var bytes = File.ReadAllBytes(PublicAsset(url));
            var info = BridgeAssetStorage.Inspect(bytes, 8 * 1024 * 1024);
            var upload = new AiBridgeAssetUpload
            {
                SlotId = slot.SlotId, Url = url, Width = info.Width, Height = info.Height, HasAlpha = info.HasAlpha,
                FeetAnchorY = slot.Kind == AiAssetSlotKinds.CharacterSprite ? PixelCasePipeline.MeasureFeetAnchorY(bytes) : null
            };
            uploads[slot.SlotId] = upload;
            return upload;
        }
        var rooms = new[] { "cam-do", "hieu-thuoc", "nha-so-7", "nha-xe", "hieu-anh" };
        var npcs = new[] { "dang-buu", "trinh-luc", "ly-hanh", "hoc-viec", "to-khanh", "lam-the-bao" };
        var roomIndex = 0;
        foreach (var slot in AiCaseService.BuildAssetSlots(draft, gameCase, AiAssetPhases.SceneLayout))
        {
            var url = PixelCasePipeline.ProjectionFor(gameCase, Scenes(gameCase).First(scene => scene.SceneId == slot.TargetId)) == SceneRenderModes.TopDown
                ? "/assets/pixel/lo-thuoc-thu-nam/scenes/pho.png"
                : $"/assets/pixel/lo-thuoc-thu-nam/scenes/{rooms[roomIndex++ % rooms.Length]}.png";
            Upload(slot, url);
        }
        Apply(gameCase, manifest, AiCaseService.BuildAssetSlots(draft, gameCase, AiAssetPhases.SceneLayout), uploads);
        foreach (var scene in Scenes(gameCase))
        {
            scene.PlacementPlan = AiCaseService.ParsePixelPlacementPlan(AiCaseService.BuildMockPixelPlacementPlanJson(gameCase, scene), gameCase, scene);
            scene.Runtime = PixelCasePipeline.BuildRuntime(scene, gameCase, scene.PlacementPlan, scene.Runtime);
            PixelCasePipeline.SyncSceneHotspots(scene);
        }
        var npcIndex = 0;
        var finalSlots = AiCaseService.BuildAssetSlots(draft, gameCase, AiAssetPhases.FinalAssets);
        foreach (var slot in finalSlots)
        {
            var npc = npcs[npcIndex % npcs.Length];
            switch (slot.Kind)
            {
                case AiAssetSlotKinds.CharacterSprite: Upload(slot, $"/assets/pixel/lo-thuoc-thu-nam/characters/{npc}-idle.png"); break;
                case AiAssetSlotKinds.CharacterPortrait: Upload(slot, $"/assets/pixel/lo-thuoc-thu-nam/characters/{npc}-portrait.png"); npcIndex++; break;
                default: Upload(slot, "/assets/pixel/lo-thuoc-thu-nam/items/kinh-lup.png"); break;
            }
        }
        Apply(gameCase, manifest, finalSlots, uploads);
        return (draft, gameCase, uploads);
    }

    private static void Apply(GameCase gameCase, AiAssetManifest manifest, List<AiAssetSlot> slots, Dictionary<string, AiBridgeAssetUpload> uploads) =>
        typeof(AiCaseService).GetMethod("ApplyPixelUploadedAssets", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!
            .Invoke(null, [gameCase, manifest, slots, uploads]);

    /// <summary>The rows of the A1 table, measured on a case.</summary>
    private static SortedSet<string> A1Shape(GameCase gameCase, IReadOnlyDictionary<string, (int Width, int Height)> pictureSizes)
    {
        var rows = new SortedSet<string>(StringComparer.Ordinal) { $"isPixel={CaseCatalogRules.IsPixel(gameCase)}" };
        foreach (var scene in Scenes(gameCase))
        {
            var runtime = scene.Runtime!;
            var render = runtime.Render!;
            rows.Add($"{render.Projection}: runtime {runtime.Width}x{runtime.Height}, mode {render.Mode}, native {render.NativeWidth}x{render.NativeHeight}, "
                     + $"pixelScale {render.PixelScale}, cameraZoom {render.CameraZoom}, actorScale {render.ActorScale}, walkSpeed {render.WalkSpeed}, interactRadius {render.InteractRadius}");
            rows.Add($"{render.Projection}: background {pictureSizes[scene.BackgroundUrl].Width}x{pictureSizes[scene.BackgroundUrl].Height}");
            rows.Add($"walkGrid cellSize {render.WalkGrid!.CellSize}, cols {render.WalkGrid.Cols}, rows {render.WalkGrid.Rows}");
            foreach (var layer in render.Foreground)
                rows.Add($"foreground: baseY at ground contact={layer.BaseY > layer.Y && layer.BaseY <= layer.Y + layer.Height}, x4 native={pictureSizes[layer.Url].Width * 4 == (int)layer.Width}");
            foreach (var placement in runtime.CharacterPlacements)
                rows.Add($"{render.Projection}: npc size {placement.Size.Width}x{placement.Size.Height}, asset '{placement.Asset}'");
            foreach (var placement in runtime.ItemPlacements)
                rows.Add($"item painted into background: asset '{placement.Asset}', hotspot inside={placement.Hotspot.X >= 0 && placement.Hotspot.Y >= 0 && placement.Hotspot.X + placement.Hotspot.Width <= runtime.Width && placement.Hotspot.Y + placement.Hotspot.Height <= runtime.Height}");
        }
        foreach (var character in gameCase.Characters.Where(character => Scenes(gameCase).Any(scene => scene.CharacterIds.Contains(character.CharacterId))))
        {
            var sheet = character.Presentation!.SpriteSheet!;
            rows.Add($"spriteSheet {pictureSizes[sheet.Url].Width}x{pictureSizes[sheet.Url].Height}, frame {sheet.FrameWidth}x{sheet.FrameHeight} x{sheet.FrameCount}, fps {sheet.Fps}, anchorX {sheet.AnchorX}, anchorY at feet={sheet.AnchorY is >= 0.78 and <= 0.85}");
            rows.Add($"portrait {pictureSizes[character.ImageUrl].Width}x{pictureSizes[character.ImageUrl].Height}");
        }
        return rows;
    }

    private static Dictionary<string, (int Width, int Height)> SizesOfPublicFiles(GameCase gameCase)
    {
        var urls = Scenes(gameCase).Select(scene => scene.BackgroundUrl)
            .Concat(Scenes(gameCase).SelectMany(scene => scene.Runtime?.Render?.Foreground ?? new()).Select(layer => layer.Url))
            .Concat(gameCase.Characters.Select(character => character.ImageUrl))
            .Concat(gameCase.Characters.Select(character => character.Presentation?.SpriteSheet?.Url ?? string.Empty))
            .Where(url => url.StartsWith("/assets/", StringComparison.Ordinal)).Distinct();
        return urls.ToDictionary(url => url, url =>
        {
            var info = BridgeAssetStorage.Inspect(File.ReadAllBytes(PublicAsset(url)), 8 * 1024 * 1024);
            return (info.Width, info.Height);
        });
    }

    [Fact]
    public void Tram_IsTheReference_ItPassesThePixelLayoutRules()
    {
        var tram = LoadSeed(Tram);
        var layout = new CaseValidationResult();
        PixelDraftRules.ValidateLayout(tram, layout);
        Assert.True(layout.IsValid, Errors(layout));
        // Final rules: the only gap of the hand-made reference is the inventory icon of its one collectible letter
        // (Tram has no icons; "Lo thuoc thu Nam" has the 64x64 ones the A1 table asks for).
        var final = new CaseValidationResult();
        PixelDraftRules.ValidateFinal(tram, new Dictionary<string, AiBridgeAssetUpload>(), final);
        Assert.Equal(["IconMissing"], final.Errors.Select(error => error.Code).Distinct());
        Assert.All(LoadSeed(LoThuoc).Items.Where(item => !string.IsNullOrWhiteSpace(item.ImageUrl)), item =>
        {
            var info = BridgeAssetStorage.Inspect(File.ReadAllBytes(PublicAsset(item.ImageUrl)), 1024 * 1024);
            Assert.Equal((64, 64), (info.Width, info.Height));
        });
    }

    [Fact]
    public void NewAiDraft_HasTheSameShapeAsTram_RowByRowOfTheA1Table()
    {
        var (_, draftCase, uploads) = MockPixelDraft();
        var tram = LoadSeed(Tram);

        var layout = new CaseValidationService().ValidateSceneLayout(draftCase);
        PixelDraftRules.ValidateLayout(draftCase, layout);
        Assert.True(layout.IsValid, Errors(layout));
        var final = new CaseValidationService().Validate(draftCase);
        PixelDraftRules.ValidateFinal(draftCase, uploads, final);
        Assert.True(final.IsValid, Errors(final));
        Assert.True(CaseCatalogRules.IsPixel(draftCase));

        var mine = A1Shape(draftCase, SizesOfPublicFiles(draftCase));
        var reference = A1Shape(tram, SizesOfPublicFiles(tram));
        // Tram has nobody standing outdoors; the same PixelLab art of "Lo thuoc thu Nam" places Ly Hanh on the street map.
        var loThuoc = LoadSeed(LoThuoc);
        reference.UnionWith(A1Shape(loThuoc, SizesOfPublicFiles(loThuoc)).Where(row => row.StartsWith("topdown: npc size", StringComparison.Ordinal)));
        // Every row the AI draft has exists in Tram, value for value.
        Assert.Empty(mine.Except(reference));
        Assert.Contains(mine, row => row.StartsWith("topdown: runtime 2048x2048", StringComparison.Ordinal));
        Assert.Contains(mine, row => row.StartsWith("isometric: runtime 2048x2048", StringComparison.Ordinal));
        Assert.Contains(mine, row => row.StartsWith("isometric: npc size 512x512", StringComparison.Ordinal));
        Assert.Contains(mine, row => row.StartsWith("spriteSheet 1152x128, frame 128x128 x9, fps 6", StringComparison.Ordinal));
        Assert.Contains("portrait 288x288", mine);
        Assert.Contains(mine, row => row.StartsWith("foreground: baseY at ground contact=True", StringComparison.Ordinal));

        // Painted items carry a box where they are drawn, the percent hotspots of the scene follow the same box.
        foreach (var scene in Scenes(draftCase))
        foreach (var placement in scene.Runtime!.ItemPlacements)
        {
            var hotspot = scene.Hotspots.First(entry => entry.TargetId == placement.ItemId);
            Assert.Equal(Math.Round(placement.Hotspot.X / 2048 * 100, 3), hotspot.X);
        }
        // Inventory icons are 64x64; the cover is one of the scenes; atmosphere from VUAN-4/5 is kept.
        Assert.All(draftCase.Items.Where(item => item.IsCollectible), item => Assert.Equal((64, 64), (uploads[$"item:{item.ItemId}"].Width, uploads[$"item:{item.ItemId}"].Height)));
        Assert.Contains(draftCase.CoverImageUrl, Scenes(draftCase).Select(scene => scene.BackgroundUrl));
        var outdoor = Scenes(draftCase).First(scene => scene.Runtime!.Render!.Projection == SceneRenderModes.TopDown);
        Assert.Equal(("RAIN", false), (outdoor.Runtime!.Weather!.Type, outdoor.Runtime.Indoor));
        Assert.All(Scenes(draftCase).Where(scene => scene.Runtime!.Render!.Projection == SceneRenderModes.Isometric),
            scene => Assert.True(scene.Runtime!.Indoor == true && scene.Runtime.Weather is null));
        Assert.All(Scenes(draftCase), scene => Assert.NotNull(scene.Runtime!.Audio!.Music));
        Assert.All(Scenes(draftCase), scene => Assert.Equal(7, scene.Runtime!.Audio!.Cues.Count));
        Assert.All(draftCase.Characters, character => Assert.NotNull(character.Voice?.Blip));
        Assert.Equal(draftCase.Characters.Count, draftCase.Characters.Select(character => (character.Voice!.Blip!.Pitch, character.Voice.Blip.Wave)).Distinct().Count());
    }

    [Fact]
    public void FeetAnchor_IsMeasuredFromFrameZero_AsTheBundledSheets()
    {
        double? Measure(string name) => PixelCasePipeline.MeasureFeetAnchorY(File.ReadAllBytes(PublicAsset($"/assets/pixel/lo-thuoc-thu-nam/characters/{name}-idle.png")));
        Assert.Equal(0.7891, Measure("dang-buu"));
        Assert.Equal(0.8203, Measure("trinh-luc"));
        var tram = LoadSeed(Tram);
        Assert.Equal(tram.Characters.Select(character => character.Presentation!.SpriteSheet!.AnchorY),
            new[] { Measure("dang-buu"), Measure("trinh-luc") }.Select(value => value!.Value));
    }

    // ---------------------------------------------------------------- the pixel validator (strict, new AI drafts only)

    private static (string Code, string Path)[] Codes(GameCase gameCase, Dictionary<string, AiBridgeAssetUpload>? uploads = null)
    {
        var result = new CaseValidationResult();
        if (uploads is null) PixelDraftRules.ValidateLayout(gameCase, result);
        else PixelDraftRules.ValidateFinal(gameCase, uploads, result);
        return result.Errors.Select(error => (error.Code, error.Path)).ToArray();
    }

    [Fact]
    public void Validator_ReportsEachBrokenRuleClearly()
    {
        var (_, baseline, uploads) = MockPixelDraft();
        string Json(GameCase value) => JsonSerializer.Serialize(value, Web);
        GameCase Copy() => JsonSerializer.Deserialize<GameCase>(Json(baseline), Web)!;
        CaseScene Room(GameCase value) => Scenes(value).First(scene => scene.Runtime!.Render!.Projection == SceneRenderModes.Isometric);
        CaseScene Map(GameCase value) => Scenes(value).First(scene => scene.Runtime!.Render!.Projection == SceneRenderModes.TopDown);
        Assert.Empty(Codes(baseline, uploads));

        var noGrid = Copy();
        Room(noGrid).Runtime!.Render!.WalkGrid = null;
        Assert.Contains(Codes(noGrid), error => error.Code == "MissingWalkGrid" && error.Path.EndsWith(".render.walkGrid"));

        var badSpawn = Copy();
        badSpawn.Stages.SelectMany(stage => stage.Scenes).First().Runtime!.SpawnPoints["INVESTIGATOR"].Y = 8;
        Assert.Contains(Codes(badSpawn), error => error.Code == "SpawnNotWalkable" && error.Path.EndsWith(".spawnPoints.INVESTIGATOR"));

        var badDoor = Copy();
        Room(badDoor).Runtime!.Transitions[0].Hotspot = new RuntimeBox { X = 10, Y = 10, Width = 60, Height = 60 };
        Assert.Contains(Codes(badDoor), error => error.Code == "DoorNotWalkable");

        CaseScene WithItem(GameCase value) => Scenes(value).First(scene => scene.Runtime!.ItemPlacements.Count > 0);
        var outside = Copy();
        WithItem(outside).Runtime!.ItemPlacements[0].Hotspot.X = 2000;
        Assert.Contains(Codes(outside), error => error.Code == "HotspotOutOfBounds");

        var unreachable = Copy();
        var grid = WithItem(unreachable).Runtime!.Render!.WalkGrid!;
        grid.Data[2] = "1" + grid.Data[2][1..];
        var island = WithItem(unreachable).Runtime!.ItemPlacements[0];
        island.Hotspot = new RuntimeBox { X = 0, Y = 0, Width = 40, Height = 40 };
        Assert.Contains(Codes(unreachable), error => error.Code == "HotspotUnreachable");

        var baseY = Copy();
        Map(baseY).Runtime!.Render!.Foreground[0].BaseY = 0;
        Assert.Contains(Codes(baseY), error => error.Code == "ForegroundBaseY" && error.Path.EndsWith(".render.foreground[0].baseY"));

        var classic = Copy();
        Room(classic).Runtime!.Render = null;
        Assert.Contains(Codes(classic), error => error.Code == "PixelSceneRequired");

        var overlay = Copy();
        WithItem(overlay).Runtime!.ItemPlacements[0].Asset = "/assets/pixel/lo-thuoc-thu-nam/items/kinh-lup.png";
        Assert.Contains(Codes(overlay), error => error.Code == "PixelItemOverlay");

        var placedId = Scenes(baseline).SelectMany(scene => scene.CharacterIds).First();
        var badSheet = Copy();
        badSheet.Characters.Single(character => character.CharacterId == placedId).Presentation!.SpriteSheet!.FrameWidth = 96;
        Assert.Contains(Codes(badSheet, uploads), error => error.Code == "SpriteSheetSize");

        var smallPortrait = new Dictionary<string, AiBridgeAssetUpload>(uploads);
        var portraitSlot = $"character-portrait:{placedId}";
        smallPortrait[portraitSlot] = new AiBridgeAssetUpload { SlotId = portraitSlot, Url = "x", Width = 512, Height = 512 };
        Assert.Contains(Codes(Copy(), smallPortrait), error => error.Code == "PortraitSize");

        var wrongSheet = new Dictionary<string, AiBridgeAssetUpload>(uploads);
        var sheetSlot = $"character-sprite:{placedId}";
        wrongSheet[sheetSlot] = new AiBridgeAssetUpload { SlotId = sheetSlot, Url = "x", Width = 1024, Height = 1536 };
        Assert.Contains(Codes(Copy(), wrongSheet), error => error.Code == "SpriteSheetSize");

        var actor = Copy();
        Room(actor).Runtime!.CharacterPlacements.ForEach(placement => placement.Size = new RuntimeSize { Width = 96, Height = 220 });
        if (Room(actor).Runtime!.CharacterPlacements.Count > 0)
            Assert.Contains(Codes(actor), error => error.Code == "PixelActorSize");
    }

    [Fact]
    public void LayoutErrors_GoBackToTheBotOnce_AsShortLines()
    {
        var (_, gameCase, _) = MockPixelDraft();
        var room = Scenes(gameCase).First(scene => scene.Runtime!.Render!.Projection == SceneRenderModes.Isometric);
        Assert.Empty(AiCaseService.PixelLayoutErrors(gameCase, room));
        var answer = JsonNode.Parse(AiCaseService.BuildMockPixelPlacementPlanJson(gameCase, room))!.AsObject();
        answer["spawnPoints"]!["INVESTIGATOR"]!["y"] = 8;
        answer.Remove("walkGrid");
        room.PlacementPlan = AiCaseService.ParsePixelPlacementPlan(answer.ToJsonString(), gameCase, room);
        var before = room.Runtime;
        var errors = AiCaseService.PixelLayoutErrors(gameCase, room);
        Assert.Contains(errors, line => line.StartsWith("MissingWalkGrid ", StringComparison.Ordinal));
        Assert.Same(before, room.Runtime); // checking does not replace the scene's runtime
    }

    [Fact]
    public void ClassicDrafts_KeepTheOldSlots_PixelDraftsGetTheTramSizes()
    {
        var (pixelDraft, gameCase, _) = MockPixelDraft();
        var classic = JsonSerializer.Deserialize<AiCaseDraft>(JsonSerializer.Serialize(pixelDraft, Web), Web)!;
        classic.VisualPipeline = AiVisualPipelines.Classic;
        classic.BridgeAssets.Clear();
        foreach (var scene in Scenes(gameCase)) scene.PlacementPlan = null;

        var old = AiCaseService.BuildAssetSlots(classic, gameCase, AiAssetPhases.SceneLayout)
            .Concat(AiCaseService.BuildAssetSlots(classic, gameCase, AiAssetPhases.FinalAssets)).ToList();
        Assert.Contains(old, slot => slot.Kind == AiAssetSlotKinds.Cover && (slot.Width, slot.Height) == (1024, 1024));
        Assert.All(old.Where(slot => slot.Kind == AiAssetSlotKinds.Background), slot => Assert.Equal((1600, 900), (slot.Width, slot.Height)));
        Assert.All(old.Where(slot => slot.Kind == AiAssetSlotKinds.CharacterSprite), slot => Assert.Equal((1024, 1536), (slot.Width, slot.Height)));

        var pixel = AiCaseService.BuildAssetSlots(pixelDraft, gameCase, AiAssetPhases.SceneLayout)
            .Concat(AiCaseService.BuildAssetSlots(pixelDraft, gameCase, AiAssetPhases.FinalAssets)).ToList();
        Assert.DoesNotContain(pixel, slot => slot.Kind == AiAssetSlotKinds.Cover);
        Assert.All(pixel.Where(slot => slot.Kind == AiAssetSlotKinds.Background), slot => Assert.Equal((512, 512), (slot.Width, slot.Height)));
        Assert.All(pixel.Where(slot => slot.Kind == AiAssetSlotKinds.CharacterSprite), slot => Assert.Equal((1152, 128), (slot.Width, slot.Height)));
        Assert.All(pixel.Where(slot => slot.Kind == AiAssetSlotKinds.CharacterPortrait), slot => Assert.Equal((288, 288), (slot.Width, slot.Height)));
        Assert.All(pixel.Where(slot => slot.Kind == AiAssetSlotKinds.Item), slot => Assert.Equal((64, 64), (slot.Width, slot.Height)));
        // The PixelLab-era prompts for 1600x900 backgrounds and 1024x1536 sprites are never asked for a pixel draft.
        Assert.DoesNotContain(pixel, slot => slot.ArtDirection.Contains("1600x9", StringComparison.Ordinal));

        // A stored draft from before VUAN-6B (no field) reads as classic.
        var legacyJson = JsonNode.Parse(JsonSerializer.Serialize(pixelDraft, Web))!.AsObject();
        legacyJson.Remove("visualPipeline");
        Assert.Equal(AiVisualPipelines.Classic, JsonSerializer.Deserialize<AiCaseDraft>(legacyJson.ToJsonString(), Web)!.VisualPipeline);
    }

    [Fact]
    public void MockLayout_PutsDoorsOnTheHubAndTheFallbackKeepsRequiredDoors()
    {
        var (_, gameCase, _) = MockPixelDraft();
        var map = Scenes(gameCase).First(scene => scene.Runtime!.Render!.Projection == SceneRenderModes.TopDown);
        var rooms = Scenes(gameCase).Where(scene => scene.Runtime!.Render!.Projection == SceneRenderModes.Isometric).ToList();
        Assert.Equal(rooms.Select(room => room.SceneId).Order(), map.Runtime!.Transitions.Select(door => door.TargetSceneId).Order());
        Assert.All(rooms, room => Assert.Contains(room.Runtime!.Transitions, door => door.TargetSceneId == map.SceneId));
        Assert.All(rooms, room => Assert.True(map.Runtime!.SpawnPoints.ContainsKey($"from:{room.SceneId}")));

        // A layout without doors still lets players leave: required doors are put on the spawn floor.
        var room0 = rooms[0];
        var answer = JsonNode.Parse(AiCaseService.BuildMockPixelPlacementPlanJson(gameCase, room0))!.AsObject();
        answer["transitions"] = new JsonArray();
        var plan = AiCaseService.ParsePixelPlacementPlan(answer.ToJsonString(), gameCase, room0);
        Assert.Contains(plan.Transitions, door => door.TargetSceneId == map.SceneId);
        // Unknown targets are dropped.
        answer["transitions"] = new JsonArray(new JsonObject { ["targetSceneId"] = "scene-elsewhere", ["hotspot"] = new JsonObject { ["x"] = 1, ["y"] = 1, ["width"] = 50, ["height"] = 50 } });
        Assert.DoesNotContain(AiCaseService.ParsePixelPlacementPlan(answer.ToJsonString(), gameCase, room0).Transitions, door => door.TargetSceneId == "scene-elsewhere");
    }

    // ---------------------------------------------------------------- PixelLab request plan

    private static AssetLibraryEntry Entry(string key, string kind) =>
        new() { Key = key, Kind = kind, World = AiCaseWorlds.HangDuongVictorian, Url = $"https://res.cloudinary.com/demo/{key}.webp" };

    private static (GameCase Case, List<AssetLibraryEntry> Library, List<AiAssetChoice> AllLibrary) TramWithLibrary()
    {
        var tram = LoadSeed(Tram);
        var library = new List<AssetLibraryEntry> { Entry("v-case-pho", AssetLibraryKinds.OutdoorMap), Entry("all-item-trang-giay-trang", AssetLibraryKinds.Item) };
        var choices = new List<AiAssetChoice>();
        foreach (var scene in Scenes(tram))
        {
            var key = scene.SceneId == "scene-tn-pho" ? "v-case-pho" : $"v-case-{scene.SceneId["scene-tn-".Length..]}";
            if (scene.SceneId != "scene-tn-pho") library.Add(Entry(key, AssetLibraryKinds.Interior));
            choices.Add(new AiAssetChoice { Subject = $"scene:{scene.SceneId}", Source = AiAssetSources.Library, LibraryKey = key });
        }
        foreach (var character in tram.Characters)
        {
            var key = $"v-case-npc-{character.CharacterId["char-tn-".Length..]}";
            library.Add(Entry(key, AssetLibraryKinds.Npc));
            choices.Add(new AiAssetChoice { Subject = $"character:{character.CharacterId}", Source = AiAssetSources.Library, LibraryKey = key });
        }
        choices.Add(new AiAssetChoice { Subject = "item:item-tn-la-thu-trang", Source = AiAssetSources.Library, LibraryKey = "all-item-trang-giay-trang" });
        return (tram, library, choices);
    }

    /// <summary>
    /// Yen 17/11/2026: an item is never pasted onto a scene. Objects are created first (in the scene prompt); a library
    /// scene that does not show them yet gets them painted in by PixelLab Inpaint Pro with a free-form mask drawn wide
    /// along the whole surface they rest on: one request per scene, all its objects in one description, against the cap.
    /// </summary>
    [Fact]
    public void Plan_LibrarySceneWithInpaintItems_PaintsThemWithOneWideMask()
    {
        var (tram, library, choices) = TramWithLibrary();
        tram.Items.First(item => item.ItemId == "item-tn-so-cam-do").VisualDescription = "A thick pawnbroker ledger bound in dark green cloth.";
        var shop = choices.First(choice => choice.Subject == "scene:scene-tn-cam-do");
        shop.InpaintItems = ["item-tn-so-cam-do", "item-tn-giay-xe"];

        var result = PixelAssetPlanning.Plan(tram, choices, library, pixelLabCap: 10);
        Assert.Empty(result.Errors);
        var requests = result.Plan["requests"]!.AsArray().Select(node => node!.AsObject()).ToList();
        var request = Assert.Single(requests);
        Assert.Equal("inpaint.tn-cam-do", request["id"]!.GetValue<string>());
        Assert.Equal("inpaint_image", request["tool"]!.GetValue<string>());
        Assert.Equal("item-inpaint", request["template"]!.GetValue<string>());
        Assert.Equal(10, request["estimatedGenerations"]!.GetValue<int>());
        Assert.Equal(["item-tn-so-cam-do", "item-tn-giay-xe"], request["subject"]!["itemIds"]!.AsArray().Select(node => node!.GetValue<string>()));
        Assert.False(request["params"]!["no_background"]!.GetValue<bool>());
        Assert.True(request["params"]!["crop_to_mask"]!.GetValue<bool>());
        Assert.Equal("{{inpaintMaskRef}}", request["params"]!["mask_image_url"]!.GetValue<string>());
        Assert.Null(request["params"]!["mask_x"]);
        Assert.Empty(request["references"]!.AsArray());
        Assert.Equal(["v-case-cam-do"], request["dependsOnLibrary"]!.AsArray().Select(node => node!.GetValue<string>()));
        Assert.Equal(["background:scene-tn-cam-do"], request["target"]!["slots"]!.AsArray().Select(node => node!.GetValue<string>()));
        Assert.Contains("inpaint_merge", request["target"]!["process"]!.GetValue<string>());
        Assert.Contains("WIDE along the whole surface", request["prepare"]!.GetValue<string>());
        Assert.Equal(512, request["fallback"]!["canvas"]!.GetValue<int>());
        Assert.Equal(25, request["fallback"]!["costGenerations"]!.GetValue<int>());
        Assert.Equal(2, request["placements"]!.AsArray().Count);
        Assert.Equal("ask-user-first", request["rerollPolicy"]!.GetValue<string>());
        var prompt = request["prompt"]!.GetValue<string>();
        Assert.Matches("^[\\x20-\\x7e]*$", prompt);
        Assert.Equal(PixelLabTemplates.Default.Render("item-inpaint", new Dictionary<string, object?>
        {
            ["objectList"] = "a thick pawnbroker ledger bound in dark green cloth and {{itemVisual:tn-giay-xe}}"
        }), prompt);
        Assert.StartsWith("{{surface}}, with a thick pawnbroker ledger bound in dark green cloth and {{itemVisual:tn-giay-xe}} on it.", prompt);
        Assert.Contains("No text, no letters.", prompt);
        // The bot names the surface its wide mask covers, and writes the missing English description.
        var missing = request["missingInputs"]!.AsArray().Select(node => node!["placeholder"]!.GetValue<string>()).ToList();
        Assert.Equal(["{{surface}}", "{{itemVisual:tn-giay-xe}}"], missing);
        Assert.Equal("items[itemId=item-tn-giay-xe].visualDescription", request["missingInputs"]![1]!["fillFrom"]!.GetValue<string>());
        Assert.Equal(["{{inpaintSourceRef}}", "{{inpaintMaskRef}}"], request["inputsFromDependencies"]!.AsArray().Select(node => node!["placeholder"]!.GetValue<string>()));
        Assert.Equal(10, result.EstimatedGenerations);
        Assert.True(result.WithinCap);
        Assert.Contains(result.Plan["rules"]!.AsArray(), rule => rule!.GetValue<string>().Contains("drawn wide along the whole surface", StringComparison.Ordinal));
        Assert.Contains(result.Plan["rules"]!.AsArray(), rule => rule!.GetValue<string>().Contains("Never paste an item picture", StringComparison.Ordinal));
        Assert.False(PixelAssetPlanning.Plan(tram, choices, library, pixelLabCap: 9).WithinCap);
        Assert.Equal(["item-tn-so-cam-do", "item-tn-giay-xe"], result.Subjects.First(subject => subject.Subject == shop.Subject).InpaintItems!);

        // Wrong uses are refused with a reason.
        shop.InpaintItems = ["item-tn-hop-nhac"];
        Assert.Contains(PixelAssetPlanning.Plan(tram, choices, library, 60).Errors, error => error.Contains("'item-tn-hop-nhac' is not an item of this scene", StringComparison.Ordinal));
        shop.InpaintItems = ["item-tn-so-cam-do"];
        shop.Source = AiAssetSources.PixelLab;
        shop.LibraryKey = string.Empty;
        Assert.Contains(PixelAssetPlanning.Plan(tram, choices, library, 60).Errors, error => error.Contains("paints its items from the scene's visualDescription", StringComparison.Ordinal));
        var npc = choices.First(choice => choice.Subject.StartsWith("character:", StringComparison.Ordinal));
        shop.InpaintItems = new();
        npc.InpaintItems = ["item-tn-so-cam-do"];
        Assert.Contains(PixelAssetPlanning.Plan(tram, choices, library, 60).Errors, error => error.Contains("inpaintItems is only for scene subjects", StringComparison.Ordinal));
    }

    [Fact]
    public void Plan_LibraryOnlyOrder_NeedsZeroGenerations()
    {
        var (tram, library, choices) = TramWithLibrary();
        var result = PixelAssetPlanning.Plan(tram, choices, library, pixelLabCap: 0);
        Assert.Empty(result.Errors);
        Assert.Equal(0, result.EstimatedGenerations);
        Assert.True(result.WithinCap);
        Assert.Empty(result.Plan["requests"]!.AsArray());
        Assert.Equal(choices.Count, result.Plan["reuse"]!.AsArray().Count);
        Assert.All(result.Plan["reuse"]!.AsArray(), node => Assert.Equal(0, node!["estimatedGenerations"]!.GetValue<int>()));

        // A variant of a library picture also costs nothing.
        choices[1] = new AiAssetChoice { Subject = choices[1].Subject, Source = AiAssetSources.Variant, ParentKey = choices[1].LibraryKey, Variant = "night" };
        Assert.Equal(0, PixelAssetPlanning.Plan(tram, choices, library, 0).EstimatedGenerations);
    }

    [Fact]
    public void Plan_OneNewRoomAndOneNewNpc_FollowsTheTemplatesInDependencyOrder()
    {
        var (tram, library, choices) = TramWithLibrary();
        var room = "scene:scene-tn-hieu-anh";
        var npc = "character:char-tn-trinh-luc";
        foreach (var choice in choices.Where(choice => choice.Subject is "scene:scene-tn-hieu-anh" or "character:char-tn-trinh-luc"))
        {
            choice.Source = AiAssetSources.PixelLab;
            choice.LibraryKey = string.Empty;
        }
        var templates = PixelLabTemplates.Default;
        var result = PixelAssetPlanning.Plan(tram, choices, library, pixelLabCap: 60);
        Assert.Empty(result.Errors);
        var requests = result.Plan["requests"]!.AsArray().Select(node => node!.AsObject()).ToList();
        Assert.Equal(["front.tn-trinh-luc", "rotate.tn-trinh-luc", "idle.tn-trinh-luc", "interior.tn-hieu-anh"],
            requests.Select(request => request["id"]!.GetValue<string>()));
        Assert.Equal([1, 2, 3, 4], requests.Select(request => request["order"]!.GetValue<int>()));
        Assert.Equal([10, 2, 2, 25], requests.Select(request => request["estimatedGenerations"]!.GetValue<int>()));
        Assert.Equal(39, result.EstimatedGenerations);
        Assert.True(result.WithinCap);
        string[] Depends(JsonObject request) => request["dependsOn"]!.AsArray().Select(node => node!.GetValue<string>()).ToArray();
        Assert.Empty(Depends(requests[0]));
        Assert.Equal(["front.tn-trinh-luc"], Depends(requests[1]));
        Assert.Equal(["rotate.tn-trinh-luc"], Depends(requests[2]));
        Assert.Empty(Depends(requests[3]));
        Assert.Equal(["v-case-pho"], requests[3]["dependsOnLibrary"]!.AsArray().Select(node => node!.GetValue<string>()));
        Assert.Contains("NATIVE 512 library map v-case-pho", requests[3]["references"]![0]!["prepare"]!.GetValue<string>());

        // Tools, sizes and wording come from templates.json, not from new prompts.
        Assert.Equal(("create_image_pro", "create_character", "animate_character", "create_image_pro"),
            (requests[0]["tool"]!.GetValue<string>(), requests[1]["tool"]!.GetValue<string>(), requests[2]["tool"]!.GetValue<string>(), requests[3]["tool"]!.GetValue<string>()));
        Assert.Equal(96, requests[0]["params"]!["width"]!.GetValue<int>());
        Assert.Equal(512, requests[3]["params"]!["width"]!.GetValue<int>());
        Assert.Equal(templates.StyleReferenceUrl, requests[0]["references"]![0]!["url"]!.GetValue<string>());
        Assert.Equal(templates.Render("character-idle", new Dictionary<string, object?>()), requests[2]["prompt"]!.GetValue<string>());
        Assert.Equal(templates.Render("interior", new Dictionary<string, object?> { ["era"] = "Victorian", ["roomSubject"] = "photographer's studio" }),
            requests[3]["prompt"]!.GetValue<string>());
        Assert.Contains("No people, no animals, no readable text", requests[3]["prompt"]!.GetValue<string>());
        Assert.Contains("facing the viewer (south-facing, straight-on)", requests[0]["prompt"]!.GetValue<string>());
        Assert.All(requests, request => Assert.Equal("ask-user-first", request["rerollPolicy"]!.GetValue<string>()));
        Assert.All(requests, request => Assert.Matches("^[\\x20-\\x7e]*$", request["prompt"]!.GetValue<string>()));
        Assert.All(requests, request => Assert.DoesNotContain("Trịnh", request["prompt"]!.GetValue<string>()));
        Assert.Equal(new[] { $"character-sprite:char-tn-trinh-luc", "character-portrait:char-tn-trinh-luc" },
            requests[2]["target"]!["slots"]!.AsArray().Select(node => node!.GetValue<string>()));
        Assert.Equal(["background:scene-tn-hieu-anh"], requests[3]["target"]!["slots"]!.AsArray().Select(node => node!.GetValue<string>()));
        Assert.Equal([room, npc], result.Plan["summary"]!["newSubjects"]!.AsArray().Select(node => node!.GetValue<string>()));

        // Over the cap: refused with a clear message naming the requests.
        var blocked = PixelAssetPlanning.Plan(tram, choices, library, pixelLabCap: 30);
        Assert.False(blocked.WithinCap);
        var message = PixelLabPlanBuilder.CapMessage(blocked.Plan);
        Assert.Contains("needs 39 PixelLab generations but this order allows 30", message);
        Assert.Contains("interior.tn-hieu-anh (25)", message);
        Assert.Contains("ask the creator with draft_ask", message);
    }

    [Fact]
    public void Plan_ChecksTheLibrary()
    {
        var (tram, library, choices) = TramWithLibrary();
        choices[0].LibraryKey = "no-such-key";
        choices[1].LibraryKey = "v-case-pho"; // a map for a room
        choices[2] = new AiAssetChoice { Subject = choices[2].Subject, Source = AiAssetSources.Library };
        choices.Add(new AiAssetChoice { Subject = "scene:unknown", Source = AiAssetSources.PixelLab });
        var errors = PixelAssetPlanning.Plan(tram, choices, library, 100).Errors;
        Assert.Contains(errors, error => error.Contains("'no-such-key' is not in the server library"));
        Assert.Contains(errors, error => error.Contains("is a OUTDOOR_MAP; this subject needs a INTERIOR"));
        Assert.Contains(errors, error => error.Contains("LIBRARY needs libraryKey"));
        Assert.Contains(errors, error => error.StartsWith("scene:unknown: not a picture subject"));
        // Undeclared subjects count as new PixelLab pictures (the plan is never optimistic).
        Assert.Equal(25 + 25 + 5 * 25 + 2 * 14 + 10, PixelAssetPlanning.Plan(tram, [], library, 0).EstimatedGenerations);
    }

    [Fact]
    public void Plan_AllNew_MatchesTheJsBuilderGolden()
    {
        var sample = LoadFixture("case-pixel-dong-ho-dem-mua-vi.json");
        var subjects = AiCaseService.PixelSubjects(sample).Select(subject => new PixelAssetSubject(subject.Subject, subject.Kind, subject.TargetId,
            subject.Name, subject.SlotIds, subject.Projection, AiAssetSources.PixelLab, string.Empty, string.Empty, string.Empty, string.Empty)).ToList();
        var plan = PixelLabPlanBuilder.Build(sample, subjects, 1000);
        var actual = new JsonArray(plan["requests"]!.AsArray().Select(node =>
        {
            var request = node!.AsObject();
            JsonArray Strings(string name) => new((request[name] as JsonArray ?? new JsonArray())
                .Select(entry => (JsonNode?)(entry is JsonObject value ? value["placeholder"]!.GetValue<string>() : entry!.GetValue<string>())).ToArray());
            return (JsonNode)new JsonObject
            {
                ["id"] = request["id"]!.DeepClone(), ["order"] = request["order"]!.DeepClone(), ["step"] = request["step"]!.DeepClone(),
                ["stage"] = request["stage"]!.DeepClone(), ["tool"] = request["tool"]!.DeepClone(), ["template"] = request["template"]!.DeepClone(),
                ["params"] = request["params"]!.DeepClone(), ["promptParam"] = request["promptParam"]!.DeepClone(), ["prompt"] = request["prompt"]!.DeepClone(),
                ["references"] = new JsonArray(request["references"]!.AsArray().Select(reference => (JsonNode)new JsonObject
                {
                    ["param"] = reference!["param"]!.DeepClone(), ["url"] = reference["url"]!.DeepClone(), ["usage"] = reference["usage"]!.DeepClone(),
                    ["usageSent"] = reference["usageSent"]!.DeepClone(), ["prepare"] = reference["prepare"]?.DeepClone()
                }).ToArray()),
                ["dependsOn"] = request["dependsOn"]!.DeepClone(), ["calls"] = request["calls"]!.DeepClone(),
                ["estimatedGenerations"] = request["estimatedGenerations"]!.DeepClone(),
                ["needsReview"] = request["needsReview"]?.GetValue<bool>() ?? false,
                ["missingInputs"] = Strings("missingInputs"),
                ["inputsFromDependencies"] = Strings("inputsFromDependencies"),
                ["buildings"] = new JsonArray((request["buildings"] as JsonArray ?? new JsonArray())
                    .Select(building => (JsonNode)$"{building!["sceneId"]!.GetValue<string>()}@{building["position"]!.GetValue<string>()}").ToArray()),
                ["grid"] = new JsonArray((request["grid"] as JsonArray ?? new JsonArray()).Select(cell => (JsonNode)new JsonObject
                {
                    ["cell"] = cell!["cell"]!.DeepClone(), ["row"] = cell["row"]!.DeepClone(), ["col"] = cell["col"]!.DeepClone(),
                    ["box"] = cell["box"]!.DeepClone(), ["icon"] = cell["icon"]!.DeepClone(), ["itemIds"] = cell["itemIds"]!.DeepClone(),
                    ["text"] = cell["text"]!.DeepClone()
                }).ToArray())
            };
        }).ToArray());
        var golden = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "pixellab-plan-dong-ho.golden.json")))!;
        Assert.Equal(golden.AsArray().Count, actual.Count);
        for (var index = 0; index < actual.Count; index++)
            Assert.True(JsonNode.DeepEquals(golden[index], actual[index]),
                $"request {index}:\nJS:  {golden[index]!.ToJsonString()}\nC#:  {actual[index]!.ToJsonString()}");
    }

    [Fact]
    public void Templates_AreEmbeddedFromTheSharedFile()
    {
        var shared = File.ReadAllText(RepoFile("ai-game-docs", "visual-style-templates", "pixellab", "templates.json"));
        var embedded = PixelLabTemplates.Default.Root.ToJsonString();
        Assert.Equal(JsonNode.Parse(shared)!.ToJsonString(), embedded);
        Assert.Equal(25, PixelLabTemplates.Default.Cost("outdoor-map"));
    }
}
