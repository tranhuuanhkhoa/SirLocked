using System.Text.Json;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public static class AiAssetPhases
{
    public const string SceneLayout = "SCENE_LAYOUT";
    public const string FinalAssets = "FINAL_ASSETS";
}

public static class AiAssetSlotKinds
{
    public const string Cover = "cover";
    public const string Background = "background";
    public const string CharacterSprite = "character-sprite";
    public const string CharacterPortrait = "character-portrait";
    public const string Item = "item";
}

/// <summary>One picture a draft needs, with the art direction the image model used to receive.</summary>
public sealed record AiAssetSlot(
    string SlotId,
    string Kind,
    string TargetId,
    string Name,
    string Phase,
    string ArtDirection,
    int Width,
    int Height,
    bool Transparent,
    bool Required,
    string CurrentUrl);

public partial class AiCaseService
{
    // ----- Phase 3-7: images uploaded by Claude, layout and runtime built by the server -----
    public const string ClaudeUploadPipelineVersion = "claude-upload-v1";

    internal static string SlotId(string kind, string targetId) => $"{kind}:{targetId}";

    /// <summary>Every image slot of one asset phase, with its art direction, target size and current picture.</summary>
    internal static List<AiAssetSlot> BuildAssetSlots(AiCaseDraft draft, GameCase gameCase, string phase)
    {
        if (PixelCasePipeline.IsPixel(draft)) return BuildPixelAssetSlots(draft, gameCase, phase);
        var uploads = LatestUploads(draft);
        string Current(string slotId, string fallback) =>
            uploads.TryGetValue(slotId, out var upload) ? upload.Url : fallback ?? string.Empty;

        var slots = new List<AiAssetSlot>();
        if (phase == AiAssetPhases.SceneLayout)
        {
            var coverId = SlotId(AiAssetSlotKinds.Cover, gameCase.CaseId);
            slots.Add(new AiAssetSlot(coverId, AiAssetSlotKinds.Cover, gameCase.CaseId, gameCase.Title, phase,
                BuildCoverImagePrompt(draft, gameCase), 1024, 1024, false, true, Current(coverId, gameCase.CoverImageUrl)));
            foreach (var scene in OrderedScenes(gameCase))
            {
                var id = SlotId(AiAssetSlotKinds.Background, scene.SceneId);
                slots.Add(new AiAssetSlot(id, AiAssetSlotKinds.Background, scene.SceneId, scene.Title, phase,
                    BuildBackgroundImagePrompt(draft, gameCase, scene), RuntimeWidth, RuntimeHeight, false, true,
                    Current(id, scene.BackgroundUrl)));
            }
            return slots;
        }

        foreach (var character in gameCase.Characters)
        {
            var spriteId = SlotId(AiAssetSlotKinds.CharacterSprite, character.CharacterId);
            slots.Add(new AiAssetSlot(spriteId, AiAssetSlotKinds.CharacterSprite, character.CharacterId, character.Name, phase,
                BuildCharacterMasterSpritePrompt(character), 1024, 1536, true, true, Current(spriteId, string.Empty)));
            var portraitId = SlotId(AiAssetSlotKinds.CharacterPortrait, character.CharacterId);
            slots.Add(new AiAssetSlot(portraitId, AiAssetSlotKinds.CharacterPortrait, character.CharacterId, character.Name, phase,
                $"Dialogue portrait of {character.Name}: the same character as its sprite, head and shoulders, transparent background. Optional: the sprite is used when no portrait is uploaded.",
                512, 512, true, false, Current(portraitId, character.ImageUrl)));
        }
        foreach (var scene in OrderedScenes(gameCase))
        {
            foreach (var item in scene.ItemIds
                         .Select(itemId => gameCase.Items.FirstOrDefault(entry => entry.ItemId == itemId))
                         .Where(item => item is not null && ShouldGenerateItemAsset(gameCase, item))
                         .Select(item => item!))
            {
                var id = SlotId(AiAssetSlotKinds.Item, item.ItemId);
                if (slots.Any(slot => slot.SlotId == id)) continue;
                string art;
                try
                {
                    var plan = scene.PlacementPlan ?? throw ApiException.BadGateway("no placement plan");
                    art = BuildItemImagePrompt(draft, item, scene, FindPlannedPlacement(plan, "item", item.ItemId));
                }
                catch (ApiException)
                {
                    art = $"{item.Name}: {FirstNonBlank(item.VisualDescription, item.Description)}. Isolated cut-out on a transparent background, {AiVisualStyleDefaults.PixelArtContract}";
                }
                slots.Add(new AiAssetSlot(id, AiAssetSlotKinds.Item, item.ItemId, item.Name, phase, art,
                    1024, 1024, true, true, Current(id, item.ImageUrl)));
            }
        }
        return slots;
    }

    internal static Dictionary<string, AiBridgeAssetUpload> LatestUploads(AiCaseDraft draft) =>
        draft.BridgeAssets
            .GroupBy(upload => upload.SlotId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.OrderBy(upload => upload.UploadedAt).Last(), StringComparer.Ordinal);

    private async Task<AiAssetManifest> GenerateAssetsAndRuntimeAsync(
        AiCaseDraft draft,
        GameCase gameCase,
        bool forceRegenerate,
        bool includeFinalAssets,
        IReadOnlySet<string>? forceAssetIds = null)
    {
        if (PixelCasePipeline.IsPixel(draft))
            return await GeneratePixelAssetsAndRuntimeAsync(draft, gameCase, forceRegenerate, includeFinalAssets, forceAssetIds);
        var phase = includeFinalAssets ? AiAssetPhases.FinalAssets : AiAssetPhases.SceneLayout;
        var status = includeFinalAssets ? AiDraftStatus.GeneratingFinalAssets : AiDraftStatus.GeneratingSceneLayout;
        var slots = BuildAssetSlots(draft, gameCase, phase);
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
        manifest.AssetPipelineVersion = ClaudeUploadPipelineVersion;
        manifest.LogicModel = ProviderName;
        manifest.ImageModel = "claude-upload";
        manifest.AssetRootPath = string.Empty;
        manifest.GeneratedAt = DateTime.UtcNow;
        ApplyUploadedAssets(gameCase, manifest, slots, uploads);
        await SaveAssetCheckpointAsync(draft, gameCase, manifest, status);

        var orderedScenes = OrderedScenes(gameCase).ToList();
        if (!includeFinalAssets)
        {
            var scenesToPlan = orderedScenes
                .Select((scene, index) => (Scene: scene, Index: index))
                .Where(entry => forcedSlots?.Contains(SlotId(AiAssetSlotKinds.Background, entry.Scene.SceneId)) == true
                                || !HasUsablePlacementPlan(entry.Scene))
                .ToList();
            await ForEachAwaitingClaudeAsync(scenesToPlan, async entry =>
            {
                var scene = entry.Scene;
                var previous = PreviousScene(orderedScenes, entry.Index);
                var next = NextScene(orderedScenes, entry.Index);
                var planPrompt = BuildPlacementPlanPrompt(gameCase, scene, previous, next);
                var background = new SceneImageReference($"BACKGROUND {scene.SceneId}: {scene.Title}", scene.BackgroundUrl);
                var planJson = await GenerateVisionJsonAsync(draft, $"PlanScenePlacement:{scene.SceneId}", planPrompt, [background], 5000,
                    () => BuildMockPlacementPlanJson(gameCase, scene));
                var qa = ParseBackgroundQa(planJson);
                if (!qa.Passed)
                {
                    // One bounded retry, as with the image model: Claude uploads a corrected background.
                    var retrySlot = SlotId(AiAssetSlotKinds.Background, scene.SceneId);
                    var retryUploads = await RequireClaudeAssetsAsync(draft, phase, slots,
                        new HashSet<string>(StringComparer.Ordinal) { retrySlot },
                        $"RetryVisualQa:{scene.SceneId}",
                        BuildBackgroundRetryPrompt(draft, gameCase, scene, qa));
                    ApplyUploadedAssets(gameCase, manifest, slots, retryUploads);
                    background = new SceneImageReference($"BACKGROUND {scene.SceneId}: {scene.Title}", scene.BackgroundUrl);
                    planJson = await GenerateVisionJsonAsync(draft, $"PlanScenePlacement:{scene.SceneId}:RetryVisualQa", planPrompt, [background], 5000,
                        () => BuildMockPlacementPlanJson(gameCase, scene));
                    qa = ParseBackgroundQa(planJson);
                    if (!qa.Passed)
                    {
                        var failure = $"Scene {scene.SceneId} failed visual QA after one retry: {qa.FailureSummary}";
                        await MarkDraftFailedAsync(draft, failure, AiFailurePhases.VisualQa, new[] { scene.SceneId });
                        throw ApiException.BadGateway(failure);
                    }
                }
                scene.PlacementPlan = ParseAndSanitizePlacementPlan(planJson, gameCase, scene, previous, next);
                var backgroundAsset = manifest.Assets.FirstOrDefault(asset =>
                    asset.AssetType == AiAssetSlotKinds.Background && asset.TargetId == scene.SceneId);
                if (backgroundAsset is not null) backgroundAsset.QaPassed = true;
            });
            foreach (var scene in orderedScenes)
                scene.Runtime = BuildRuntimeFromPlacementPlan(scene, gameCase, SpriteUrls(slots, uploads));
            await SaveAssetCheckpointAsync(draft, gameCase, manifest, status);
            return manifest;
        }

        var sprites = SpriteUrls(slots, uploads);
        foreach (var scene in orderedScenes)
            scene.Runtime = BuildRuntimeFromPlacementPlan(scene, gameCase, sprites);

        // Final verification always runs on the real cut-outs; skipping it would skip style, identity and scale QA.
        await ForEachAwaitingClaudeAsync(orderedScenes.Select((scene, index) => (Scene: scene, Index: index)).ToList(), async entry =>
        {
            var scene = entry.Scene;
            var verificationPrompt = BuildPlacementVerificationPrompt(scene);
            var effectiveSprites = sprites;
            var verificationJson = await GenerateVisionJsonAsync(draft, $"VerifyScenePlacement:{scene.SceneId}",
                verificationPrompt, BuildLayoutImageReferences(scene, gameCase, sprites), 3500,
                () => BuildMockPlacementVerificationJson(scene));
            var failures = ReadPlacementQaFailures(verificationJson, gameCase);
            if (failures.Count > 0)
            {
                var retrySlots = failures
                    .Select(failure => failure.Type.Contains("item", StringComparison.OrdinalIgnoreCase)
                        ? SlotId(AiAssetSlotKinds.Item, failure.Id)
                        : SlotId(AiAssetSlotKinds.CharacterSprite, failure.Id))
                    .Where(slotId => slots.Any(slot => slot.SlotId == slotId))
                    .ToHashSet(StringComparer.Ordinal);
                var summary = string.Join("; ", failures.Select(failure => $"{failure.Type}:{failure.Id} {failure.Reason}"));
                if (retrySlots.Count > 0)
                {
                    var retryUploads = await RequireClaudeAssetsAsync(draft, phase, slots, retrySlots,
                        $"RetryVisualQa:{scene.SceneId}", $"Placement QA failed: {summary}");
                    ApplyUploadedAssets(gameCase, manifest, slots, retryUploads);
                    effectiveSprites = SpriteUrls(slots, retryUploads);
                    scene.Runtime = BuildRuntimeFromPlacementPlan(scene, gameCase, effectiveSprites);
                    verificationJson = await GenerateVisionJsonAsync(draft, $"VerifyScenePlacement:{scene.SceneId}:RetryVisualQa",
                        verificationPrompt, BuildLayoutImageReferences(scene, gameCase, effectiveSprites), 3500,
                        () => BuildMockPlacementVerificationJson(scene));
                    failures = ReadPlacementQaFailures(verificationJson, gameCase);
                    summary = string.Join("; ", failures.Select(failure => $"{failure.Type}:{failure.Id} {failure.Reason}"));
                }
                if (failures.Count > 0)
                {
                    var message = $"Scene {scene.SceneId} asset QA failed after one retry: {summary}";
                    await MarkDraftFailedAsync(draft, message, AiFailurePhases.FinalAssets,
                        failures.Select(failure => failure.Id).Append(scene.SceneId));
                    throw ApiException.BadGateway(message);
                }
            }
            scene.PlacementPlan = ApplyPlacementVerification(scene.PlacementPlan!, verificationJson);
            scene.Runtime = BuildRuntimeFromPlacementPlan(scene, gameCase, effectiveSprites);
        });
        await SaveAssetCheckpointAsync(draft, gameCase, manifest, status);
        return manifest;
    }

    /// <summary>
    /// Runs independent steps so the bot sees every open question at once; parks after all of them were asked.
    /// </summary>
    private static async Task ForEachAwaitingClaudeAsync<T>(IReadOnlyList<T> entries, Func<T, Task> step)
    {
        AiAwaitingClaudeException? firstWait = null;
        foreach (var entry in entries)
        {
            try { await step(entry); }
            catch (AiAwaitingClaudeException wait) { firstWait ??= wait; }
        }
        if (firstWait is not null) throw firstWait;
    }

    private static Dictionary<string, string> SpriteUrls(IReadOnlyList<AiAssetSlot> slots, IReadOnlyDictionary<string, AiBridgeAssetUpload> uploads) =>
        slots.Where(slot => slot.Kind == AiAssetSlotKinds.CharacterSprite)
            .Select(slot => (slot.TargetId, Url: uploads.TryGetValue(slot.SlotId, out var upload) ? upload.Url : slot.CurrentUrl))
            .Where(entry => !string.IsNullOrWhiteSpace(entry.Url))
            .ToDictionary(entry => entry.TargetId, entry => entry.Url, StringComparer.Ordinal);

    /// <summary>Writes the uploaded URLs into the case and the asset manifest.</summary>
    private static void ApplyUploadedAssets(
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
                case AiAssetSlotKinds.Cover:
                    gameCase.CoverImageUrl = upload.Url;
                    break;
                case AiAssetSlotKinds.Background:
                    var scene = gameCase.Stages.SelectMany(stage => stage.Scenes).FirstOrDefault(entry => entry.SceneId == slot.TargetId);
                    if (scene is not null) scene.BackgroundUrl = upload.Url;
                    break;
                case AiAssetSlotKinds.CharacterSprite:
                case AiAssetSlotKinds.CharacterPortrait:
                    var character = gameCase.Characters.FirstOrDefault(entry => entry.CharacterId == slot.TargetId);
                    // The portrait wins; a character without one speaks with its sprite.
                    if (character is not null
                        && (slot.Kind == AiAssetSlotKinds.CharacterPortrait
                            || !uploads.ContainsKey(SlotId(AiAssetSlotKinds.CharacterPortrait, slot.TargetId))))
                        character.ImageUrl = upload.Url;
                    break;
                case AiAssetSlotKinds.Item:
                    var item = gameCase.Items.FirstOrDefault(entry => entry.ItemId == slot.TargetId);
                    if (item is not null) item.ImageUrl = upload.Url;
                    break;
            }
            RecordUploadedAsset(manifest, slot, upload, ClaudeUploadPipelineVersion);
        }
    }

    private static void RecordUploadedAsset(AiAssetManifest manifest, AiAssetSlot slot, AiBridgeAssetUpload upload, string pipelineVersion)
    {
        manifest.Assets.RemoveAll(asset => asset.AssetType == slot.Kind && asset.TargetId == slot.TargetId);
        manifest.Assets.Add(new AiGeneratedAsset
        {
            AssetType = slot.Kind,
            TargetId = slot.TargetId,
            Url = upload.Url,
            SecureUrl = upload.Url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? upload.Url : string.Empty,
            Prompt = slot.ArtDirection,
            PromptSha256 = Sha256(slot.ArtDirection),
            Model = "claude-upload",
            PipelineVersion = pipelineVersion,
            SourceWidth = upload.Width,
            SourceHeight = upload.Height,
            NormalizedWidth = upload.Width,
            NormalizedHeight = upload.Height,
            HasAlpha = upload.HasAlpha,
            ProcessingStatus = "UPLOADED",
            CloudinaryPublicId = upload.StorageId
        });
    }

    private static List<SceneImageReference> BuildLayoutImageReferences(
        CaseScene scene,
        GameCase gameCase,
        IReadOnlyDictionary<string, string> sprites)
    {
        var images = new List<SceneImageReference>
        {
            new($"BACKGROUND {scene.SceneId}: {scene.Title} (runtime space {RuntimeWidth}x{RuntimeHeight})", scene.BackgroundUrl)
        };
        foreach (var item in gameCase.Items.Where(item => scene.ItemIds.Contains(item.ItemId)
                     && ShouldGenerateItemAsset(gameCase, item) && !string.IsNullOrWhiteSpace(item.ImageUrl)))
            images.Add(new($"ITEM {item.ItemId}: {item.Name}. Use this exact cutout aspect when placing it.", item.ImageUrl));
        foreach (var character in gameCase.Characters.Where(character => scene.CharacterIds.Contains(character.CharacterId)))
        {
            if (sprites.TryGetValue(character.CharacterId, out var sprite))
                images.Add(new($"NPC {character.CharacterId}: {character.Name}. Full-body sprite, feet should sit on the floor.", sprite));
        }
        return images;
    }
}
