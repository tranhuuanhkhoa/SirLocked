using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// VUAN-6B: pictures of a new AI draft follow the PixelLab workflow and land in the shape of "Tram hong ngoc mat tich"
/// (see <see cref="PixelCasePipeline"/>). Drafts made before (classic 1600x900) keep the old path untouched.
/// </summary>
public partial class AiCaseService
{
    public const string PixelUploadPipelineVersion = "claude-pixel-v1";
    internal const string PixelRuntimeSpace = "2048x2048 runtime space: the 512x512 native picture x pixelScale 4";

    /// <summary>One pixel subject (a scene, an NPC or an inventory icon) and the slots its pictures fill.</summary>
    internal sealed record PixelSubject(string Subject, string Kind, string TargetId, string Name, List<string> SlotIds, string? Projection);

    internal static List<PixelSubject> PixelSubjects(GameCase gameCase)
    {
        var subjects = new List<PixelSubject>();
        foreach (var scene in PixelCasePipeline.OrderedScenes(gameCase))
            subjects.Add(new PixelSubject($"scene:{scene.SceneId}", "scene", scene.SceneId, scene.Title,
                [SlotId(AiAssetSlotKinds.Background, scene.SceneId)], PixelCasePipeline.ProjectionFor(gameCase, scene)));
        foreach (var character in gameCase.Characters)
            subjects.Add(new PixelSubject($"character:{character.CharacterId}", "character", character.CharacterId, character.Name,
                [SlotId(AiAssetSlotKinds.CharacterSprite, character.CharacterId), SlotId(AiAssetSlotKinds.CharacterPortrait, character.CharacterId)], null));
        foreach (var item in gameCase.Items.Where(PixelCasePipeline.HasInventoryIcon))
            subjects.Add(new PixelSubject($"item:{item.ItemId}", "item", item.ItemId, item.Name,
                [SlotId(AiAssetSlotKinds.Item, item.ItemId)], null));
        return subjects;
    }

    /// <summary>The image slots of a pixel draft, sized as in the bundled pixel cases (no cover slot: the cover is a scene).</summary>
    internal static List<AiAssetSlot> BuildPixelAssetSlots(AiCaseDraft draft, GameCase gameCase, string phase)
    {
        var uploads = LatestUploads(draft);
        string Current(string slotId, string fallback) =>
            uploads.TryGetValue(slotId, out var upload) ? upload.Url : fallback ?? string.Empty;
        var slots = new List<AiAssetSlot>();
        if (phase == AiAssetPhases.SceneLayout)
        {
            foreach (var scene in PixelCasePipeline.OrderedScenes(gameCase))
            {
                var id = SlotId(AiAssetSlotKinds.Background, scene.SceneId);
                var projection = PixelCasePipeline.ProjectionFor(gameCase, scene);
                slots.Add(new AiAssetSlot(id, AiAssetSlotKinds.Background, scene.SceneId, scene.Title, phase,
                    PixelBackgroundArt(gameCase, scene, projection), PixelSceneProfile.NativeSize, PixelSceneProfile.NativeSize,
                    projection == SceneRenderModes.Isometric, true, Current(id, scene.BackgroundUrl)));
            }
            return slots;
        }
        var placed = PixelCasePipeline.OrderedScenes(gameCase).SelectMany(scene => scene.CharacterIds).ToHashSet(StringComparer.Ordinal);
        foreach (var character in gameCase.Characters)
        {
            var spriteId = SlotId(AiAssetSlotKinds.CharacterSprite, character.CharacterId);
            slots.Add(new AiAssetSlot(spriteId, AiAssetSlotKinds.CharacterSprite, character.CharacterId, character.Name, phase,
                $"Idle sprite sheet {PixelSceneProfile.SheetWidth}x{PixelSceneProfile.FrameSize}, transparent: {PixelSceneProfile.FrameCount} frames of "
                + $"{PixelSceneProfile.FrameSize}x{PixelSceneProfile.FrameSize}, feet near y=104 (asset_process npc_bundle on a PixelLab character zip, "
                + "or the 'idle' file of a library NPC). NPC style: made with the templates.json PixelLab workflow (character-front with the "
                + "Sherlock style reference), a 96x96 south sprite with natural proportions like Sherlock and Watson; height is the character's own, "
                + "never chibi or big-headed. "
                + $"{character.Name}, {character.Role}. {character.VisualDescription}".Trim(),
                PixelSceneProfile.SheetWidth, PixelSceneProfile.FrameSize, true, placed.Contains(character.CharacterId),
                Current(spriteId, character.Presentation?.SpriteSheet?.Url ?? string.Empty)));
            var portraitId = SlotId(AiAssetSlotKinds.CharacterPortrait, character.CharacterId);
            slots.Add(new AiAssetSlot(portraitId, AiAssetSlotKinds.CharacterPortrait, character.CharacterId, character.Name, phase,
                $"Portrait {PixelSceneProfile.PortraitSize}x{PixelSceneProfile.PortraitSize}, transparent: the 96x96 south sprite x3, nearest neighbour "
                + "(asset_process portrait or npc_bundle, or the 'portrait' file of a library NPC).",
                PixelSceneProfile.PortraitSize, PixelSceneProfile.PortraitSize, true, true, Current(portraitId, character.ImageUrl)));
        }
        foreach (var item in gameCase.Items.Where(PixelCasePipeline.HasInventoryIcon))
        {
            var id = SlotId(AiAssetSlotKinds.Item, item.ItemId);
            slots.Add(new AiAssetSlot(id, AiAssetSlotKinds.Item, item.ItemId, item.Name, phase,
                $"Inventory icon {PixelSceneProfile.IconSize}x{PixelSceneProfile.IconSize}, transparent (a library ITEM, or one cell of a PixelLab icon-sheet "
                + $"cut with asset_process icon_sheet): {item.Name}. {item.VisualDescription}".Trim(),
                PixelSceneProfile.IconSize, PixelSceneProfile.IconSize, true, true, Current(id, item.ImageUrl)));
        }
        return slots;
    }

    private static string PixelBackgroundArt(GameCase gameCase, CaseScene scene, string projection)
    {
        var painted = gameCase.Items.Where(item => scene.ItemIds.Contains(item.ItemId) && ShouldPlaceItem(gameCase, item))
            .Select(item => $"{item.Name} ({item.VisualDescription})")
            .Concat(gameCase.Clues.Where(clue => IsCameraClue(clue) && clue.SceneId == scene.SceneId)
                .Select(clue => $"{clue.Title} ({clue.VisualDescription})"))
            .ToList();
        var kind = projection == SceneRenderModes.TopDown
            ? "Outdoor map, topdown (PixelLab template outdoor-map)"
            : "Interior room, isometric 2:1 cutaway, transparent outside the room (PixelLab template interior)";
        return $"{kind}: one {PixelSceneProfile.NativeSize}x{PixelSceneProfile.NativeSize} native picture, shown at x4 (2048x2048 runtime). "
               + "Library first, then a variant, PixelLab last (see the asset plan). No people, no animals, no readable text. "
               + (painted.Count == 0 ? string.Empty : $"Paint these investigation targets into the picture: {string.Join("; ", painted)}. "
                   + "A library or variant picture that lacks one gets it painted in with PixelLab inpaint (asset_plan inpaintItems, asset_process inpaint_prep / inpaint_merge), "
                   + "the free-form mask drawn wide along the whole surface it rests on; never paste an item picture onto the scene. ")
               + $"Scene: {scene.Title}. {scene.VisualDescription}".Trim();
    }

    private static bool HasUsablePixelPlan(CaseScene scene) =>
        scene.PlacementPlan is { Projection: not null, WalkGrid: not null };

    private async Task<AiAssetManifest> GeneratePixelAssetsAndRuntimeAsync(
        AiCaseDraft draft,
        GameCase gameCase,
        bool forceRegenerate,
        bool includeFinalAssets,
        IReadOnlySet<string>? forceAssetIds)
    {
        var phase = includeFinalAssets ? AiAssetPhases.FinalAssets : AiAssetPhases.SceneLayout;
        var status = includeFinalAssets ? AiDraftStatus.GeneratingFinalAssets : AiDraftStatus.GeneratingSceneLayout;
        var slots = BuildPixelAssetSlots(draft, gameCase, phase);
        HashSet<string>? forcedSlots = null;
        if (forceRegenerate)
        {
            forcedSlots = slots
                .Where(slot => forceAssetIds is null || forceAssetIds.Count == 0
                               || forceAssetIds.Contains(slot.TargetId) || forceAssetIds.Contains(slot.SlotId))
                .Select(slot => slot.SlotId)
                .ToHashSet(StringComparer.Ordinal);
        }
        var uploads = await RequireClaudeAssetsAsync(draft, phase, slots, forcedSlots);
        var manifest = draft.AssetManifest ?? new AiAssetManifest();
        manifest.AssetPipelineVersion = PixelUploadPipelineVersion;
        manifest.LogicModel = ProviderName;
        manifest.ImageModel = "claude-upload-pixellab";
        manifest.AssetRootPath = string.Empty;
        manifest.GeneratedAt = DateTime.UtcNow;
        ApplyPixelUploadedAssets(gameCase, manifest, slots, uploads);
        await SaveAssetCheckpointAsync(draft, gameCase, manifest, status);

        var orderedScenes = PixelCasePipeline.OrderedScenes(gameCase).ToList();
        if (!includeFinalAssets)
        {
            var scenesToPlan = orderedScenes
                .Where(scene => forcedSlots?.Contains(SlotId(AiAssetSlotKinds.Background, scene.SceneId)) == true || !HasUsablePixelPlan(scene))
                .ToList();
            await ForEachAwaitingClaudeAsync(scenesToPlan, async scene =>
            {
                var planPrompt = BuildPixelPlacementPlanPrompt(gameCase, scene);
                var background = new SceneImageReference($"BACKGROUND {scene.SceneId}: {scene.Title} (512x512 native)", scene.BackgroundUrl);
                var planJson = await GenerateVisionJsonAsync(draft, $"PlanScenePlacement:{scene.SceneId}", planPrompt, [background], 9000,
                    () => BuildMockPixelPlacementPlanJson(gameCase, scene), PixelRuntimeSpace);
                var qa = ParseBackgroundQa(planJson);
                if (!qa.Passed)
                {
                    var retrySlot = SlotId(AiAssetSlotKinds.Background, scene.SceneId);
                    var retryUploads = await RequireClaudeAssetsAsync(draft, phase, slots,
                        new HashSet<string>(StringComparer.Ordinal) { retrySlot },
                        $"RetryVisualQa:{scene.SceneId}",
                        $"Background QA of {scene.SceneId} failed: {qa.FailureSummary}. Upload a corrected 512x512 picture "
                        + "(a reroll on PixelLab needs Yen's consent first).");
                    ApplyPixelUploadedAssets(gameCase, manifest, slots, retryUploads);
                    background = new SceneImageReference($"BACKGROUND {scene.SceneId}: {scene.Title} (512x512 native)", scene.BackgroundUrl);
                    planJson = await GenerateVisionJsonAsync(draft, $"PlanScenePlacement:{scene.SceneId}:RetryVisualQa", planPrompt, [background], 9000,
                        () => BuildMockPixelPlacementPlanJson(gameCase, scene), PixelRuntimeSpace);
                    qa = ParseBackgroundQa(planJson);
                    if (!qa.Passed)
                    {
                        var failure = $"Scene {scene.SceneId} failed visual QA after one retry: {qa.FailureSummary}";
                        await MarkDraftFailedAsync(draft, failure, AiFailurePhases.VisualQa, new[] { scene.SceneId });
                        throw ApiException.BadGateway(failure);
                    }
                }
                scene.PlacementPlan = ParsePixelPlacementPlan(planJson, gameCase, scene);
                // The bot gets its own layout errors back once (walk grid, spawn, doors, reachable boxes) before the gate.
                var layoutErrors = PixelLayoutErrors(gameCase, scene);
                if (layoutErrors.Count > 0)
                {
                    var retryPrompt = planPrompt.TrimEnd()
                                      + "\n\nYOUR PREVIOUS LAYOUT FOR THIS SCENE BROKE THESE PIXEL RULES. Fix every one and return the whole JSON again:\n"
                                      + string.Join("\n", layoutErrors.Select(error => $"- {error}"));
                    planJson = await GenerateVisionJsonAsync(draft, $"PlanScenePlacement:{scene.SceneId}:RetryLayout", retryPrompt, [background], 9000,
                        () => BuildMockPixelPlacementPlanJson(gameCase, scene), PixelRuntimeSpace);
                    scene.PlacementPlan = ParsePixelPlacementPlan(planJson, gameCase, scene);
                }
                var backgroundAsset = manifest.Assets.FirstOrDefault(asset =>
                    asset.AssetType == AiAssetSlotKinds.Background && asset.TargetId == scene.SceneId);
                if (backgroundAsset is not null) backgroundAsset.QaPassed = true;
            });
        }
        foreach (var scene in orderedScenes.Where(scene => scene.PlacementPlan is { Projection: not null }))
        {
            scene.Runtime = PixelCasePipeline.BuildRuntime(scene, gameCase, scene.PlacementPlan!, scene.Runtime);
            PixelCasePipeline.SyncSceneHotspots(scene);
        }
        await SaveAssetCheckpointAsync(draft, gameCase, manifest, status);
        return manifest;
    }

    /// <summary>Pixel rule errors of one scene's layout, as short lines for the bot (empty when the layout is fine).</summary>
    internal static List<string> PixelLayoutErrors(GameCase gameCase, CaseScene scene)
    {
        if (scene.PlacementPlan is null) return new List<string>();
        var previous = scene.Runtime;
        scene.Runtime = PixelCasePipeline.BuildRuntime(scene, gameCase, scene.PlacementPlan, previous);
        var errors = PixelDraftRules.ValidateSceneLayout(gameCase, scene).Errors
            .Where(error => error.Code is not ("BackgroundMissing" or "PixelSceneRequired"))
            .Select(error => $"{error.Code} {error.Path}: {error.Message}")
            .Distinct()
            .Take(40)
            .ToList();
        scene.Runtime = previous;
        return errors;
    }

    /// <summary>Writes the uploaded pictures into the case: backgrounds, NPC idle sheets, portraits, icons; the cover is a scene.</summary>
    private static void ApplyPixelUploadedAssets(
        GameCase gameCase,
        AiAssetManifest manifest,
        IReadOnlyList<AiAssetSlot> slots,
        IReadOnlyDictionary<string, AiBridgeAssetUpload> uploads)
    {
        foreach (var slot in slots)
        {
            if (!uploads.TryGetValue(slot.SlotId, out var upload)) continue;
            switch (slot.Kind)
            {
                case AiAssetSlotKinds.Background:
                    var scene = gameCase.Stages.SelectMany(stage => stage.Scenes).FirstOrDefault(entry => entry.SceneId == slot.TargetId);
                    if (scene is not null) scene.BackgroundUrl = upload.Url;
                    break;
                case AiAssetSlotKinds.CharacterSprite:
                    var npc = gameCase.Characters.FirstOrDefault(entry => entry.CharacterId == slot.TargetId);
                    if (npc is not null)
                        npc.Presentation = new CharacterVisualPresentation { SpriteSheet = PixelCasePipeline.SpriteSheet(upload.Url, upload.FeetAnchorY) };
                    break;
                case AiAssetSlotKinds.CharacterPortrait:
                    var character = gameCase.Characters.FirstOrDefault(entry => entry.CharacterId == slot.TargetId);
                    if (character is not null) character.ImageUrl = upload.Url;
                    break;
                case AiAssetSlotKinds.Item:
                    var item = gameCase.Items.FirstOrDefault(entry => entry.ItemId == slot.TargetId);
                    if (item is not null) item.ImageUrl = upload.Url;
                    break;
            }
            RecordUploadedAsset(manifest, slot, upload, PixelUploadPipelineVersion);
        }
        if (slots.Any(slot => slot.Kind == AiAssetSlotKinds.Background && uploads.ContainsKey(slot.SlotId)))
            gameCase.CoverImageUrl = PixelCasePipeline.CoverFrom(gameCase);
    }

    // ---------------------------------------------------------------- layout step

    /// <summary>Doors a scene must have: rooms open onto the outdoor maps and maps onto every room; without both kinds, the neighbours in play order.</summary>
    internal static List<CaseScene> RequiredPixelTransitionTargets(GameCase gameCase, CaseScene scene)
    {
        var ordered = PixelCasePipeline.OrderedScenes(gameCase).ToList();
        var projection = PixelCasePipeline.ProjectionFor(gameCase, scene);
        var maps = ordered.Where(entry => PixelCasePipeline.ProjectionFor(gameCase, entry) == SceneRenderModes.TopDown).ToList();
        var rooms = ordered.Where(entry => PixelCasePipeline.ProjectionFor(gameCase, entry) == SceneRenderModes.Isometric).ToList();
        if (maps.Count == 0 || rooms.Count == 0)
        {
            var index = ordered.FindIndex(entry => entry.SceneId == scene.SceneId);
            return new[] { PreviousScene(ordered, index), NextScene(ordered, index) }.Where(entry => entry is not null).Select(entry => entry!).ToList();
        }
        if (projection == SceneRenderModes.Isometric) return maps;
        var mapIndex = maps.FindIndex(entry => entry.SceneId == scene.SceneId);
        return rooms.Concat(new[] { mapIndex > 0 ? maps[mapIndex - 1] : null, mapIndex < maps.Count - 1 ? maps[mapIndex + 1] : null }
            .Where(entry => entry is not null).Select(entry => entry!)).ToList();
    }

    internal static string BuildPixelPlacementPlanPrompt(GameCase gameCase, CaseScene scene)
    {
        var projection = PixelCasePipeline.ProjectionFor(gameCase, scene);
        var profile = PixelSceneProfile.For(projection);
        var outdoor = projection == SceneRenderModes.TopDown;
        var visualContract = BuildSceneVisualContract(gameCase, scene);
        var items = gameCase.Items
            .Where(item => scene.ItemIds.Contains(item.ItemId) && ShouldPlaceItem(gameCase, item))
            .Select(item => new { id = item.ItemId, name = item.Name, description = item.Description, visualDescription = item.VisualDescription });
        var characters = gameCase.Characters
            .Where(character => scene.CharacterIds.Contains(character.CharacterId))
            .Select(character => new { id = character.CharacterId, name = character.Name, role = character.Role });
        var cameraClues = gameCase.Clues
            .Where(clue => IsCameraClue(clue) && clue.SceneId == scene.SceneId)
            .Select(clue => new { id = clue.ClueId, visualDescription = clue.VisualDescription, hintLevel = clue.HintLevel });
        var required = RequiredPixelTransitionTargets(gameCase, scene);
        var doors = PixelCasePipeline.AllowedTransitionTargets(gameCase, scene)
            .Select(target => new { targetSceneId = target.SceneId, label = target.Title, required = required.Any(entry => entry.SceneId == target.SceneId) });
        var size = profile.ActorSize.ToString("0", CultureInfo.InvariantCulture);
        var scale = profile.ActorScale.ToString(CultureInfo.InvariantCulture);

        return $$"""
        Inspect the supplied 512x512 PixelLab background of scene {{scene.SceneId}} and return its pixel-mode layout as JSON.

        PIXEL CASE CONTRACT (the shape of "Tram hong ngoc mat tich"):
        - Coordinates are runtime units in a 2048x2048 space: the 512x512 native picture drawn at pixelScale 4 (native pixel x 4).
        - This scene is {{(outdoor ? "an OUTDOOR MAP, topdown projection" : "an INDOOR ROOM, isometric 2:1 projection")}}. The server writes runtime.render: mode pixel,
          projection {{projection}}, nativeWidth/nativeHeight 512, pixelScale 4, cameraZoom {{profile.CameraZoom.ToString(CultureInfo.InvariantCulture)}}, actorScale {{scale}}, walkSpeed {{profile.WalkSpeed.ToString(CultureInfo.InvariantCulture)}}, interactRadius {{profile.InteractRadius.ToString(CultureInfo.InvariantCulture)}}.
        - Investigation items and camera clues are PAINTED INTO this background. Give a tight box over each where it is drawn; never ask for an overlay picture.
          An item missing from the picture is painted in with PixelLab inpaint (asset_process inpaint_prep / inpaint_merge) and the new background uploaded before this answer; never paste an item picture.
          Inpaint properly: a free-form mask drawn wide along the whole surface the item rests on (the whole table top, seat or shelf), never a small box around it.
        - NPCs are 128x128 idle sprites drawn at actorScale {{scale}} ({{size}}x{{size}} runtime units): give their feet point on walkable floor.
        - walkGrid: build it from a walk mask (white = walkable feet position) with asset_process walkable: cellSize 16, cols 128, rows 128,
          data = 128 strings of 128 characters '0'/'1'. {{(outdoor
              ? "Outdoors: paving and squares walkable, water and buildings blocked, trees and lamp posts block only at their base (mask from PixelLab object-mask, or asset_process mask_from_shapes)."
              : "Indoors: the floor diamond minus furniture blocks (asset_process mask_from_shapes with a diamond and block rects, then walkable).")}}
        - foreground: {{(outdoor
              ? "layers cut from the NATIVE map where actors can pass behind (lamps, trees, carts, posts) with asset_process foreground: {id, url, x, y, width, height, baseY}, runtime units, url uploaded to the library (POST /api/bridge/library/files), baseY = ground-contact line between y and y + height."
              : "rooms normally have none: []. Same layer shape if a tall piece of furniture must cover the actors.")}}
        - Spawn points default, INVESTIGATOR, INTERROGATOR and "from:<sceneId>" (where a player appears after coming through that door) and every door
          must be on walkable cells reachable from the default spawn. The floor cell nearest the bottom edge of every item and NPC box must be reachable too.

        CANONICAL SCENE VISUAL CONTRACT (SOURCE OF TRUTH):
        Internal art direction: {{visualContract.ArtDirection}}
        Authoritative player-facing scene state (literal, preserve exactly): {{visualContract.AuthoritativeStoryState}}

        Items painted into the background (one box each):
        {{JsonSerializer.Serialize(items, PrettyJson)}}

        NPCs (feet points):
        {{JsonSerializer.Serialize(characters, PrettyJson)}}

        Camera clues painted into the background (one clue zone each):
        {{JsonSerializer.Serialize(cameraClues, PrettyJson)}}

        Doors (allowed transition targets; required ones must exist):
        {{JsonSerializer.Serialize(doors, PrettyJson)}}

        Return exactly one JSON object:
        {
          "sceneId": "{{scene.SceneId}}",
          "projection": "{{projection}}",
          "backgroundQa": {
            "pixelArtMatch": true,
            "prohibitedTextFound": false,
            "prohibitedUiFound": false,
            "duplicateEmbeddedTargetFound": false,
            "unexpectedForegroundContentFound": false,
            "unexpectedCutoutItemIds": [],
            "sceneMatch": true,
            "notes": "brief visual QA notes"
          },
          "walkGrid": { "cellSize": 16, "cols": 128, "rows": 128, "data": ["0000...", "..."] },
          "foreground": [ { "id": "lamp-1", "url": "https://.../fg-lamp-1.png", "x": 904, "y": 544, "width": 64, "height": 296, "baseY": 840 } ],
          "spawnPoints": {
            "default": { "x": 1024, "y": 1776, "anchor": "bottom-center", "direction": "right" },
            "INVESTIGATOR": { "x": 968, "y": 1776, "anchor": "bottom-center", "direction": "right" },
            "INTERROGATOR": { "x": 1080, "y": 1776, "anchor": "bottom-center", "direction": "right" },
            "from:other-scene-id": { "x": 1024, "y": 1776, "anchor": "bottom-center", "direction": "right" }
          },
          "placements": [
            { "type": "npc", "id": "character-id", "x": 904, "y": 1496, "facing": "left", "reason": "feet on the floor behind the counter" },
            { "type": "item", "id": "item-id", "x": 296, "y": 1229, "width": 225, "height": 246, "surface": "iron chest by the door", "reason": "box over the painted chest" }
          ],
          "clueZones": [
            { "clueId": "clue-id", "label": "short player-facing label", "bounds": { "x": 1310, "y": 1188, "width": 246, "height": 205 },
              "shape": "rect", "surface": "cabinet", "visibility": "easy|medium|hard", "detectionDifficulty": "easy|medium|hard",
              "detectionStatus": "FOUND|AMBIGUOUS|NOT_FOUND|OCCLUDED|TOO_SMALL", "confidence": 0.9, "source": "vision", "isFallback": false,
              "requiredClueIds": [], "reason": "why this box tightly contains the painted clue" }
          ],
          "transitions": [
            { "transitionId": "transition-a-to-b", "targetSceneId": "target-scene-id", "label": "Door label", "hotspot": { "x": 848, "y": 1696, "width": 352, "height": 192 }, "depth": 22 }
          ]
        }

        Rules:
        - backgroundQa.pixelArtMatch is true only for crisp pixel art in the PixelLab style of this world.
        - backgroundQa.prohibitedTextFound is true for any readable word, letter, number or pseudo-text; prohibitedUiFound for any UI, arrow or annotation.
        - backgroundQa.unexpectedForegroundContentFound is true when a person, NPC or animal is baked into the background. Investigation items and camera clues belong in it.
        - backgroundQa.sceneMatch is true only when the picture matches the canonical scene state and shows every listed item and camera clue exactly once.
        - Return exactly one placement for every listed item and NPC. Item x/y is the CENTRE of the box over the painted object, width/height its size (32..480).
        - NPC x/y is the feet point on a walkable cell; facing is left or right.
        - clueZones: exactly one per listed camera clue, a tight box of at least 16x16 over the painted clue, source "vision", isFallback false.
        - transitions: one door per required target (and optional ones for the other allowed targets) with the hotspot over the doorway, touching the walkable floor.
        - Every box lies inside 0..2048 on both axes.
        - Output JSON only.
        """;
    }

    /// <summary>
    /// Deterministic answer to a pixel layout step (mock mode, bridge smoke tests): a rectangular walk grid, a door per
    /// required target on the floor, items painted on the back wall or the street edge, NPCs on the floor.
    /// </summary>
    internal static string BuildMockPixelPlacementPlanJson(GameCase gameCase, CaseScene scene)
    {
        var projection = PixelCasePipeline.ProjectionFor(gameCase, scene);
        var outdoor = projection == SceneRenderModes.TopDown;
        // Walkable rectangle in cells: rows/cols inclusive.
        var (rowTop, rowBottom, colLeft, colRight) = outdoor ? (24, 125, 4, 123) : (64, 120, 16, 111);
        var data = new JsonArray();
        for (var row = 0; row < PixelSceneProfile.GridCells; row++)
        {
            var text = new StringBuilder(PixelSceneProfile.GridCells);
            for (var col = 0; col < PixelSceneProfile.GridCells; col++)
                text.Append(row >= rowTop && row <= rowBottom && col >= colLeft && col <= colRight ? '1' : '0');
            data.Add(text.ToString());
        }
        var spawnY = outdoor ? 1600 : 1840;
        JsonObject Spawn(double x, double y) => new() { ["x"] = x, ["y"] = y, ["anchor"] = "bottom-center", ["direction"] = "right" };
        var spawns = new JsonObject { ["default"] = Spawn(1024, spawnY), ["INVESTIGATOR"] = Spawn(968, spawnY), ["INTERROGATOR"] = Spawn(1080, spawnY) };
        var transitions = new JsonArray();
        var doors = RequiredPixelTransitionTargets(gameCase, scene);
        for (var i = 0; i < doors.Count; i++)
        {
            // Rooms: doors along the front edge of the floor; maps: doors along the top of the street.
            var x = 320 + i % 4 * 400;
            var y = outdoor ? 400 + i / 4 * 200 : 1800 - i / 4 * 160;
            transitions.Add(new JsonObject
            {
                ["transitionId"] = $"transition-{Slugify(scene.SceneId)}-to-{Slugify(doors[i].SceneId)}",
                ["targetSceneId"] = doors[i].SceneId,
                ["label"] = doors[i].Title,
                ["hotspot"] = new JsonObject { ["x"] = x, ["y"] = y, ["width"] = 160, ["height"] = 120 },
                ["depth"] = 22
            });
            spawns[$"from:{doors[i].SceneId}"] = Spawn(x + 80, outdoor ? y + 160 : y - 16);
        }
        var placements = new JsonArray();
        var items = gameCase.Items.Where(item => scene.ItemIds.Contains(item.ItemId) && ShouldPlaceItem(gameCase, item)).ToList();
        for (var i = 0; i < items.Count; i++)
        {
            // Painted on the back wall (rooms) or along the top pavement (maps): the floor cell under the box is reachable.
            var x = 260 + i % 5 * 340;
            var y = outdoor ? 900 + i / 5 * 220 : 900 - i / 5 * 160;
            placements.Add(new JsonObject
            {
                ["type"] = "item", ["id"] = items[i].ItemId, ["x"] = x, ["y"] = y, ["width"] = 140, ["height"] = 120,
                ["surface"] = outdoor ? "street edge" : "back wall shelf", ["reason"] = "Deterministic mock layout."
            });
        }
        var characters = gameCase.Characters.Where(character => scene.CharacterIds.Contains(character.CharacterId)).ToList();
        for (var i = 0; i < characters.Count; i++)
        {
            placements.Add(new JsonObject
            {
                ["type"] = "npc", ["id"] = characters[i].CharacterId,
                ["x"] = 420 + i % 4 * 400, ["y"] = (outdoor ? 1200 : 1500) + i / 4 * 120,
                ["facing"] = i % 2 == 0 ? "left" : "right", ["reason"] = "Deterministic mock layout."
            });
        }
        var clueZones = new JsonArray(gameCase.Clues.Where(clue => IsCameraClue(clue) && clue.SceneId == scene.SceneId)
            .Select((clue, index) => (JsonNode)new JsonObject
            {
                ["clueId"] = clue.ClueId, ["label"] = clue.Title,
                ["bounds"] = new JsonObject { ["x"] = 220 + index % 4 * 420, ["y"] = (outdoor ? 1300 : 1100) + index / 4 * 150, ["width"] = 120, ["height"] = 90 },
                ["shape"] = "rect", ["visibility"] = "medium", ["detectionDifficulty"] = "medium", ["detectionStatus"] = "FOUND",
                ["confidence"] = 0.95, ["source"] = "mock-layout", ["isFallback"] = false, ["requiredClueIds"] = new JsonArray(),
                ["reason"] = "Deterministic mock layout."
            }).ToArray());
        var foreground = new JsonArray();
        if (outdoor)
            foreground.Add(new JsonObject
            {
                // A lamp post of the bundled street map: 16x74 native -> 64x296 runtime, baseY at its foot.
                ["id"] = "lamp-1", ["url"] = "/assets/pixel/lo-thuoc-thu-nam/fg/pho-lamp-1.png",
                ["x"] = 1760, ["y"] = 980, ["width"] = 64, ["height"] = 296, ["baseY"] = 1276
            });
        return new JsonObject
        {
            ["sceneId"] = scene.SceneId,
            ["projection"] = projection,
            ["backgroundQa"] = new JsonObject
            {
                ["pixelArtMatch"] = true, ["prohibitedTextFound"] = false, ["prohibitedUiFound"] = false,
                ["duplicateEmbeddedTargetFound"] = false, ["unexpectedForegroundContentFound"] = false,
                ["unexpectedCutoutItemIds"] = new JsonArray(), ["sceneMatch"] = true, ["notes"] = "Deterministic mock layout."
            },
            ["walkGrid"] = new JsonObject
            {
                ["cellSize"] = PixelSceneProfile.CellSize, ["cols"] = PixelSceneProfile.GridCells, ["rows"] = PixelSceneProfile.GridCells, ["data"] = data
            },
            ["foreground"] = foreground,
            ["spawnPoints"] = spawns,
            ["placements"] = placements,
            ["clueZones"] = clueZones,
            ["transitions"] = transitions
        }.ToJsonString(PrettyJson);
    }

    /// <summary>Reads the bot's pixel layout; keeps only listed targets, clamps boxes into 2048x2048, fills gaps from the walk grid.</summary>
    internal static ScenePlacementPlan ParsePixelPlacementPlan(string json, GameCase gameCase, CaseScene scene)
    {
        JsonObject root;
        try
        {
            root = JsonNode.Parse(StripMarkdownFences(json)) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            throw ApiException.BadGateway("The pixel layout could not be parsed.");
        }
        var size = (double)PixelSceneProfile.RuntimeSize;
        var projection = PixelCasePipeline.ProjectionFor(gameCase, scene);
        var profile = PixelSceneProfile.For(projection);
        T? Read<T>(string name) where T : class
        {
            try { return root[name]?.Deserialize<T>(PrettyJson); }
            catch (JsonException) { return null; }
        }

        var grid = Read<SceneWalkGrid>("walkGrid");
        if (grid is null || grid.CellSize != PixelSceneProfile.CellSize || grid.Cols != PixelSceneProfile.GridCells
            || grid.Rows != PixelSceneProfile.GridCells || grid.Data is null || grid.Data.Count != grid.Rows
            || grid.Data.Any(row => row is null || row.Length != grid.Cols || row.Any(cell => cell is not ('0' or '1'))))
            grid = null; // the pixel validator reports MissingWalkGrid
        var bounds = grid is null ? null : PixelWalkGrid.WalkableBounds(grid);

        RuntimePoint FloorPoint(double x, double y)
        {
            if (grid is null) return new RuntimePoint { X = Clamp(x, 0, size), Y = Clamp(y, 0, size) };
            var nearest = PixelWalkGrid.Nearest(grid, x, y);
            return nearest is { } cell
                ? PixelWalkGrid.CellCentre(grid, cell.Col, cell.Row)
                : new RuntimePoint { X = Clamp(x, 0, size), Y = Clamp(y, 0, size) };
        }

        var spawns = new Dictionary<string, SpawnPoint>(StringComparer.OrdinalIgnoreCase);
        foreach (var (name, spawn) in Read<Dictionary<string, SpawnPoint>>("spawnPoints") ?? new())
        {
            if (string.IsNullOrWhiteSpace(name) || spawn is null) continue;
            spawns[name.Trim()] = new SpawnPoint
            {
                X = Clamp(spawn.X, 0, size), Y = Clamp(spawn.Y, 0, size), Anchor = "bottom-center", Direction = NormalizeDirection(spawn.Direction)
            };
        }
        if (!spawns.ContainsKey("default"))
        {
            var point = bounds is null
                ? FloorPoint(size / 2, size * 0.85)
                : FloorPoint(bounds.X + bounds.Width / 2, bounds.Y + bounds.Height - 2 * PixelSceneProfile.CellSize);
            spawns["default"] = new SpawnPoint { X = point.X, Y = point.Y, Direction = "right" };
        }
        var origin = spawns["default"];
        foreach (var (role, dx) in new[] { ("INVESTIGATOR", -56d), ("INTERROGATOR", 56d) })
        {
            if (spawns.ContainsKey(role)) continue;
            var point = FloorPoint(origin.X + dx, origin.Y);
            spawns[role] = new SpawnPoint { X = point.X, Y = point.Y, Direction = "right" };
        }

        var supplied = (root["placements"] as JsonArray ?? new JsonArray())
            .OfType<JsonObject>()
            .Select(node => (Type: NormalizePlacementType(Text(node, "type")), Id: Text(node, "id") ?? string.Empty, Node: node))
            .Where(entry => entry.Id.Length > 0)
            .GroupBy(entry => $"{entry.Type}:{entry.Id}", StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().Node, StringComparer.Ordinal);
        static string? Text(JsonObject? node, string name) =>
            node?[name] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
        double Number(JsonObject? node, string name, double fallback) =>
            node?[name] is JsonValue value && value.TryGetValue<double>(out var number) && double.IsFinite(number) ? number : fallback;

        var placements = new List<PlannedPlacement>();
        foreach (var item in gameCase.Items.Where(item => scene.ItemIds.Contains(item.ItemId) && ShouldPlaceItem(gameCase, item)))
        {
            supplied.TryGetValue($"item:{item.ItemId}", out var node);
            var hotspot = scene.Hotspots.FirstOrDefault(entry => entry.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase) && entry.TargetId == item.ItemId);
            var fallbackWidth = hotspot is null ? 140 : Math.Max(32, hotspot.Width / 100 * size);
            var fallbackHeight = hotspot is null ? 120 : Math.Max(32, hotspot.Height / 100 * size);
            var fallbackX = hotspot is null ? size * (0.2 + placements.Count * 0.15 % 0.6) : (hotspot.X + hotspot.Width / 2) / 100 * size;
            var fallbackY = hotspot is null ? size * 0.45 : (hotspot.Y + hotspot.Height / 2) / 100 * size;
            var width = Clamp(Number(node, "width", fallbackWidth), 32, 480);
            var height = Clamp(Number(node, "height", fallbackHeight), 32, 480);
            placements.Add(new PlannedPlacement
            {
                Type = "item", Id = item.ItemId,
                X = Clamp(Number(node, "x", fallbackX), width / 2, size - width / 2),
                Y = Clamp(Number(node, "y", fallbackY), height / 2, size - height / 2),
                Width = width, Height = height, Anchor = "center",
                Surface = Text(node, "surface") ?? string.Empty,
                Reason = Text(node, "reason") ?? (node is null ? "Fallback: the layout did not place this item." : string.Empty),
                Depth = 5
            });
        }
        var npcIndex = 0;
        foreach (var characterId in scene.CharacterIds)
        {
            supplied.TryGetValue($"npc:{characterId}", out var node);
            var fallback = FloorPoint(origin.X + 160 + npcIndex * 140, origin.Y - 96);
            var half = profile.NpcHotspot(0, 0).Width / 2;
            placements.Add(new PlannedPlacement
            {
                Type = "npc", Id = characterId,
                X = Clamp(Number(node, "x", fallback.X), half, size - half),
                Y = Clamp(Number(node, "y", fallback.Y), profile.NpcHotspot(0, 0).Height, size - 2 * profile.ActorScale),
                Width = profile.ActorSize, Height = profile.ActorSize, Anchor = "bottom-center",
                Facing = NormalizeDirection(Text(node, "facing")),
                Reason = Text(node, "reason") ?? (node is null ? "Fallback: the layout did not place this NPC." : string.Empty),
                Depth = 12
            });
            npcIndex++;
        }

        var zones = Read<List<ClueZone>>("clueZones") ?? new List<ClueZone>();
        var clueZones = gameCase.Clues.Where(clue => IsCameraClue(clue) && clue.SceneId == scene.SceneId).Select((clue, index) =>
        {
            var zone = zones.FirstOrDefault(entry => string.Equals(entry.ClueId, clue.ClueId, StringComparison.OrdinalIgnoreCase));
            var fallback = zone is null;
            var box = PixelBox(zone?.Bounds ?? new RuntimeBox { X = 220 + index % 4 * 420, Y = 1100 + index / 4 * 150, Width = 120, Height = 90 }, 16);
            return new ClueZone
            {
                ClueId = clue.ClueId,
                Label = string.IsNullOrWhiteSpace(zone?.Label) ? clue.Title : zone.Label,
                Bounds = box,
                Shape = string.IsNullOrWhiteSpace(zone?.Shape) ? "rect" : zone.Shape,
                Surface = zone?.Surface ?? string.Empty,
                Visibility = string.IsNullOrWhiteSpace(zone?.Visibility) ? "medium" : zone.Visibility,
                DetectionDifficulty = string.IsNullOrWhiteSpace(zone?.DetectionDifficulty) ? "medium" : zone.DetectionDifficulty,
                DetectionStatus = fallback ? "NOT_FOUND" : string.IsNullOrWhiteSpace(zone!.DetectionStatus) ? "FOUND" : zone.DetectionStatus,
                Confidence = fallback ? 0 : zone!.Confidence <= 0 ? 0.75 : Math.Clamp(zone.Confidence, 0, 1),
                Source = fallback ? "fallback" : string.IsNullOrWhiteSpace(zone!.Source) ? "vision" : zone.Source,
                IsFallback = fallback || zone!.IsFallback,
                RequiredClueIds = zone?.RequiredClueIds ?? new List<string>(),
                Reason = zone?.Reason ?? "Fallback clue region; verify before publishing."
            };
        }).ToList();

        var allowed = PixelCasePipeline.AllowedTransitionTargets(gameCase, scene).ToDictionary(target => target.SceneId, StringComparer.Ordinal);
        var transitions = (Read<List<TransitionZone>>("transitions") ?? new List<TransitionZone>())
            .Where(transition => transition is not null && allowed.ContainsKey(transition.TargetSceneId ?? string.Empty))
            .GroupBy(transition => transition.TargetSceneId, StringComparer.Ordinal)
            .Select(group => group.First())
            .Select(transition => new TransitionZone
            {
                TransitionId = string.IsNullOrWhiteSpace(transition.TransitionId) ? $"transition-{Slugify(scene.SceneId)}-to-{Slugify(transition.TargetSceneId)}" : transition.TransitionId,
                TargetSceneId = transition.TargetSceneId,
                Label = string.IsNullOrWhiteSpace(transition.Label) ? allowed[transition.TargetSceneId].Title : transition.Label,
                Hotspot = PixelBox(transition.Hotspot, 32),
                Depth = transition.Depth > 0 ? transition.Depth : 22
            }).ToList();
        foreach (var target in RequiredPixelTransitionTargets(gameCase, scene).Where(target => transitions.All(entry => entry.TargetSceneId != target.SceneId)))
        {
            // A missing required door is put on the spawn floor so the scene stays reachable; the bot should place it on the doorway.
            transitions.Add(new TransitionZone
            {
                TransitionId = $"transition-{Slugify(scene.SceneId)}-to-{Slugify(target.SceneId)}",
                TargetSceneId = target.SceneId,
                Label = target.Title,
                Hotspot = PixelBox(new RuntimeBox { X = origin.X - 80, Y = origin.Y - 112, Width = 160, Height = 120 }, 32),
                Depth = 22
            });
        }

        var foreground = (Read<List<SceneForegroundLayer>>("foreground") ?? new List<SceneForegroundLayer>())
            .Where(layer => layer is not null && !string.IsNullOrWhiteSpace(layer.Id) && !string.IsNullOrWhiteSpace(layer.Url))
            .Take(64)
            .ToList();
        var backdrop = Text(root, "backdropColor");
        return new ScenePlacementPlan
        {
            SceneId = scene.SceneId,
            Width = PixelSceneProfile.RuntimeSize,
            Height = PixelSceneProfile.RuntimeSize,
            FloorY = bounds is null ? size - PixelSceneProfile.CellSize : bounds.Y + bounds.Height,
            WalkableArea = bounds ?? new RuntimeBox { X = 0, Y = 0, Width = size, Height = size },
            SpawnPoints = spawns,
            Placements = placements,
            ClueZones = clueZones,
            Transitions = transitions,
            Projection = projection,
            WalkGrid = grid,
            Foreground = foreground,
            BackdropColor = backdrop is not null && System.Text.RegularExpressions.Regex.IsMatch(backdrop, "^#[0-9a-fA-F]{6}$") ? backdrop : null
        };
    }

    private static RuntimeBox PixelBox(RuntimeBox? box, double minimum)
    {
        var size = (double)PixelSceneProfile.RuntimeSize;
        var source = box ?? new RuntimeBox();
        var width = Clamp(double.IsFinite(source.Width) && source.Width > 0 ? source.Width : minimum, minimum, size);
        var height = Clamp(double.IsFinite(source.Height) && source.Height > 0 ? source.Height : minimum, minimum, size);
        return new RuntimeBox
        {
            X = Clamp(double.IsFinite(source.X) ? source.X : 0, 0, size - width),
            Y = Clamp(double.IsFinite(source.Y) ? source.Y : 0, 0, size - height),
            Width = width,
            Height = height
        };
    }
}
