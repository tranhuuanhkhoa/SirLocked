using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public partial class AiCaseService
{
    // ----- Phase 3-7 asset and runtime generation -----

    private async Task<AiAssetManifest> GenerateAssetsAndRuntimeAsync(
        AiCaseDraft draft,
        GameCase gameCase,
        bool forceRegenerate,
        bool includeFinalAssets,
        IReadOnlySet<string>? forceAssetIds = null)
    {
        bool ForceTarget(string targetId) => forceRegenerate
            && (forceAssetIds is null || forceAssetIds.Count == 0 || forceAssetIds.Contains(targetId));
        var assetsRoot = FindUpwards("src/FE/public/assets")
            ?? throw ApiException.BadRequest("Frontend public assets folder was not found. Expected src/FE/public/assets.");

        var caseSlug = ResolveAssetSlug(draft, gameCase, assetsRoot);
        var caseAssetsRoot = Path.Combine(assetsRoot, "ai-generated", AssetPipelineVersion, caseSlug);
        Directory.CreateDirectory(caseAssetsRoot);
        Directory.CreateDirectory(Path.Combine(caseAssetsRoot, "cases"));
        Directory.CreateDirectory(Path.Combine(caseAssetsRoot, "scenes"));
        Directory.CreateDirectory(Path.Combine(caseAssetsRoot, "characters"));
        Directory.CreateDirectory(Path.Combine(caseAssetsRoot, "items"));
        Directory.CreateDirectory(Path.Combine(caseAssetsRoot, "references"));
        var characterStyleReferences = ResolveCharacterStyleReferences(assetsRoot);

        var manifest = new AiAssetManifest
        {
            AssetRootUrl = $"/assets/ai-generated/{AssetPipelineVersion}/{caseSlug}",
            AssetRootPath = caseAssetsRoot,
            AssetPipelineVersion = AssetPipelineVersion,
            LogicModel = _settings.LogicModel,
            ImageModel = _settings.ImageModel,
            GeneratedAt = DateTime.UtcNow
        };

        var coverPrompt = BuildCoverImagePrompt(draft, gameCase);
        var coverPath = Path.Combine(caseAssetsRoot, "cases", "cover.png");
        await GenerateImageFileAsync(draft.Id, "GenerateCoverImage", coverPrompt, "1024x1024", coverPath, forceRegenerate: ForceTarget(gameCase.CaseId));
        var coverInfo = await GeneratedImageProcessor.AnalyzeAsync(coverPath);
        gameCase.CoverImageUrl = $"{manifest.AssetRootUrl}/cases/cover.png";
        manifest.Assets.Add(NewAsset("cover", gameCase.CaseId, gameCase.CoverImageUrl, coverPath, coverPrompt, coverInfo));
        await SaveAssetCheckpointAsync(draft, gameCase, manifest);

        var orderedScenes = OrderedScenes(gameCase).ToList();
        var backgroundPrompts = orderedScenes.ToDictionary(
            scene => scene.SceneId,
            scene =>
            {
                var basePrompt = BuildBackgroundImagePrompt(draft, gameCase, scene);
                var previous = draft.AssetManifest.Assets.FirstOrDefault(asset =>
                    asset.AssetType == "background"
                    && asset.TargetId == scene.SceneId
                    && asset.QaPassed
                    && !string.IsNullOrWhiteSpace(asset.Prompt));
                var path = Path.Combine(caseAssetsRoot, "scenes", $"{Slugify(scene.SceneId)}.png");
                return previous is not null && CanReusePassedBackground(path, previous.Prompt)
                    ? previous.Prompt
                    : basePrompt;
            },
            StringComparer.Ordinal);
        var scenesRequiringBackgroundQa = orderedScenes
            .Where(scene =>
            {
                var prompt = backgroundPrompts[scene.SceneId];
                var path = Path.Combine(caseAssetsRoot, "scenes", $"{Slugify(scene.SceneId)}.png");
                return ForceTarget(scene.SceneId)
                       || !CanReusePassedBackground(path, prompt);
            })
            .Select(scene => scene.SceneId)
            .ToHashSet(StringComparer.Ordinal);
        var backgroundAssets = await RunBoundedAsync(
            orderedScenes,
            _settings.MaxConcurrentImageRequests,
            async scene =>
            {
                var backgroundPrompt = backgroundPrompts[scene.SceneId];
                var backgroundPath = Path.Combine(caseAssetsRoot, "scenes", $"{Slugify(scene.SceneId)}.png");
                await GenerateImageFileAsync(
                    draft.Id,
                    $"GenerateBackground:{scene.SceneId}",
                    backgroundPrompt,
                    $"{RuntimeWidth}x{GeneratedImageProcessor.SceneRequestHeight}",
                    backgroundPath,
                    forceRegenerate: scenesRequiringBackgroundQa.Contains(scene.SceneId));
                var backgroundInfo = await GeneratedImageProcessor.NormalizeBackgroundAsync(backgroundPath);
                scene.BackgroundUrl = $"{manifest.AssetRootUrl}/scenes/{Slugify(scene.SceneId)}.png";
                return NewAsset("background", scene.SceneId, scene.BackgroundUrl, backgroundPath, backgroundPrompt, backgroundInfo);
            });

        foreach (var backgroundAsset in backgroundAssets)
        {
            manifest.Assets.Add(backgroundAsset);
            await SaveAssetCheckpointAsync(draft, gameCase, manifest);
        }

        var scenesNeedingPlan = orderedScenes
            .Select((scene, index) => (Scene: scene, Index: index))
            .Where(entry => scenesRequiringBackgroundQa.Contains(entry.Scene.SceneId) || !HasUsablePlacementPlan(entry.Scene))
            .ToList();
        var plannedScenes = await RunBoundedAsync(
            scenesNeedingPlan,
            _settings.MaxConcurrentVisionRequests,
            async entry =>
            {
                var scene = entry.Scene;
                var backgroundPath = Path.Combine(caseAssetsRoot, "scenes", $"{Slugify(scene.SceneId)}.png");
                var previous = PreviousScene(orderedScenes, entry.Index);
                var next = NextScene(orderedScenes, entry.Index);
                var planPrompt = BuildPlacementPlanPrompt(gameCase, scene, previous, next);
                BackgroundQaResult? lastQaResult = null;
                for (var attempt = 1; attempt <= 2; attempt++)
                {
                    if (attempt > 1)
                    {
                        var retryPrompt = BuildBackgroundRetryPrompt(
                            draft,
                            gameCase,
                            scene,
                            lastQaResult ?? new BackgroundQaResult(
                                false, false, false, false, false, false, string.Empty,
                                "Visual QA did not return a result."));
                        await GenerateImageFileAsync(
                            draft.Id,
                            $"GenerateBackground:{scene.SceneId}:RetryVisualQa",
                            retryPrompt,
                            $"{RuntimeWidth}x{GeneratedImageProcessor.SceneRequestHeight}",
                            backgroundPath,
                            forceRegenerate: true);
                        await GeneratedImageProcessor.NormalizeBackgroundAsync(backgroundPath);
                        var asset = manifest.Assets.FirstOrDefault(candidate => candidate.AssetType == "background" && candidate.TargetId == scene.SceneId);
                        if (asset is not null)
                        {
                            asset.Prompt = retryPrompt;
                            asset.PromptSha256 = Sha256(retryPrompt);
                        }
                    }

                    var planJson = await GenerateJsonWithOpenAiVisionAsync(
                        draft.Id,
                        attempt == 1 ? $"PlanScenePlacement:{scene.SceneId}" : $"PlanScenePlacement:{scene.SceneId}:RetryVisualQa",
                        planPrompt,
                        new[] { new VisionImageInput($"BACKGROUND {scene.SceneId}: {scene.Title}", backgroundPath) },
                        maxOutputTokens: 5000);
                    var qaResult = ParseBackgroundQa(planJson);
                    if (qaResult.Passed)
                    {
                        scene.PlacementPlan = ParseAndSanitizePlacementPlan(planJson, gameCase, scene, previous, next);
                        var backgroundAsset = manifest.Assets
                            .First(asset => asset.AssetType == "background" && asset.TargetId == scene.SceneId);
                        backgroundAsset.QaPassed = true;
                        backgroundAsset.PromptSha256 = Sha256(backgroundAsset.Prompt);
                        await File.WriteAllTextAsync(
                            BackgroundQaMarkerPath(backgroundPath),
                            backgroundAsset.PromptSha256,
                            _operationCancellationToken);
                        return scene;
                    }

                    lastQaResult = qaResult;
                }

                var failure = $"Scene {scene.SceneId} failed visual QA after one retry: {lastQaResult?.FailureSummary ?? "Visual QA returned no result."}";
                await MarkDraftFailedAsync(draft, failure, AiFailurePhases.VisualQa, new[] { scene.SceneId });
                throw ApiException.BadGateway(failure);
            });

        foreach (var _ in plannedScenes)
        {
            await SaveAssetCheckpointAsync(draft, gameCase, manifest);
        }

        if (!includeFinalAssets)
        {
            foreach (var scene in orderedScenes)
            {
                scene.Runtime = BuildRuntimeFromPlacementPlan(scene, gameCase);
                await SaveAssetCheckpointAsync(draft, gameCase, manifest);
            }

            return manifest;
        }

        var characterAssets = await RunBoundedAsync(
            gameCase.Characters,
            _settings.MaxConcurrentImageRequests,
            async character =>
            {
                var spritePrompt = BuildCharacterMasterSpritePrompt(character);
                var spritePath = CharacterSpritePath(caseAssetsRoot, character.CharacterId);
                var spriteInfo = await GenerateCutoutFileAsync(
                    draft.Id,
                    $"GenerateCharacterSprite:{character.CharacterId}",
                    spritePrompt,
                    "1024x1536",
                    spritePath,
                    references: characterStyleReferences,
                    forceRegenerate: forceRegenerate,
                    quality: NormalizeImageQuality(_settings.CharacterImageQuality));
                var spriteUrl = CharacterSpriteUrl(manifest.AssetRootUrl, character.CharacterId);

                var portraitPath = Path.Combine(caseAssetsRoot, "characters", CharacterAssetStyleVersion, $"{Slugify(character.CharacterId)}-portrait.png");
                var portraitInfo = await GeneratedImageProcessor.CreateCharacterPortraitAsync(spritePath, portraitPath);
                character.ImageUrl = $"{manifest.AssetRootUrl}/characters/{CharacterAssetStyleVersion}/{Slugify(character.CharacterId)}-portrait.png";
                var portraitPrompt = $"Derived locally from canonical sprite {spriteUrl}.";

                return new[]
                {
                    NewAsset("character-sprite", character.CharacterId, spriteUrl, spritePath, spritePrompt, spriteInfo, CutoutImageModel),
                    NewAsset("character-portrait", character.CharacterId, character.ImageUrl, portraitPath, portraitPrompt, portraitInfo, CutoutImageModel)
                };
            });

        foreach (var assetGroup in characterAssets)
        {
            manifest.Assets.AddRange(assetGroup);
            await SaveAssetCheckpointAsync(draft, gameCase, manifest, AiDraftStatus.GeneratingFinalAssets);
        }

        var itemJobs = orderedScenes
            .SelectMany(scene =>
            {
                var plan = scene.PlacementPlan ?? throw ApiException.BadGateway($"Scene {scene.SceneId} has no placement plan.");
                var backgroundPath = Path.Combine(caseAssetsRoot, "scenes", $"{Slugify(scene.SceneId)}.png");
                return scene.ItemIds
                    .Select(itemId => gameCase.Items.First(item => item.ItemId == itemId))
                    .Where(item => ShouldGenerateItemAsset(gameCase, item))
                    .Select(item => (Scene: scene, Plan: plan, BackgroundPath: backgroundPath, Item: item));
            })
            .GroupBy(job => job.Item.ItemId, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToList();
        var itemAssets = await RunBoundedAsync(
            itemJobs,
            _settings.MaxConcurrentImageRequests,
            async job =>
            {
                var placement = FindPlannedPlacement(job.Plan, "item", job.Item.ItemId);
                var contextPath = await CreatePlacementContextAsync(caseAssetsRoot, job.BackgroundPath, job.Scene, placement);
                var itemPrompt = BuildItemImagePrompt(draft, job.Item, job.Scene, placement);
                var itemPath = Path.Combine(caseAssetsRoot, "items", $"{Slugify(job.Item.ItemId)}.png");
                var itemInfo = await GenerateCutoutFileAsync(
                    draft.Id,
                    $"GenerateItem:{job.Scene.SceneId}:{job.Item.ItemId}",
                    itemPrompt,
                    "1024x1024",
                    itemPath,
                    BuildAssetReferenceInputs(job.Scene, placement, job.BackgroundPath, contextPath),
                    forceRegenerate);
                job.Item.ImageUrl = $"{manifest.AssetRootUrl}/items/{Slugify(job.Item.ItemId)}.png";
                return NewAsset("item", job.Item.ItemId, job.Item.ImageUrl, itemPath, itemPrompt, itemInfo, CutoutImageModel);
            });

        foreach (var itemAsset in itemAssets)
        {
            manifest.Assets.Add(itemAsset);
            await SaveAssetCheckpointAsync(draft, gameCase, manifest, AiDraftStatus.GeneratingFinalAssets);
        }

        // Final asset verification must always run after the actual cutouts exist. Reusing the
        // pre-asset runtime would skip style/identity/scale QA entirely.
        var scenesNeedingVerification = orderedScenes.ToList();
        foreach (var scene in orderedScenes)
        {
            scene.Runtime = BuildRuntimeFromPlacementPlan(scene, gameCase);
        }

        var verifiedScenes = await RunBoundedAsync(
            scenesNeedingVerification,
            1,
            async scene =>
            {
                var backgroundPath = Path.Combine(caseAssetsRoot, "scenes", $"{Slugify(scene.SceneId)}.png");
                var verificationPrompt = BuildPlacementVerificationPrompt(scene);
                for (var attempt = 1; attempt <= 2; attempt++)
                {
                    var visionImages = BuildLayoutVisionInputs(scene, gameCase, caseAssetsRoot, backgroundPath);
                    var verificationJson = await GenerateJsonWithOpenAiVisionAsync(
                        draft.Id,
                        attempt == 1 ? $"VerifyScenePlacement:{scene.SceneId}" : $"VerifyScenePlacement:{scene.SceneId}:RetryVisualQa",
                        verificationPrompt,
                        visionImages,
                        maxOutputTokens: 3500);
                    var failures = ReadPlacementQaFailures(verificationJson, gameCase);
                    if (failures.Count == 0)
                    {
                        scene.PlacementPlan = ApplyPlacementVerification(scene.PlacementPlan!, verificationJson);
                        scene.Runtime = BuildRuntimeFromPlacementPlan(scene, gameCase);
                        return scene;
                    }

                    if (attempt == 2)
                    {
                        throw ApiException.BadGateway($"Scene {scene.SceneId} asset QA failed after one retry: {string.Join("; ", failures.Select(failure => $"{failure.Type}:{failure.Id} {failure.Reason}"))}");
                    }

                    await RegenerateFailedCutoutsAsync(
                        draft,
                        gameCase,
                        scene,
                        caseAssetsRoot,
                        backgroundPath,
                        characterStyleReferences,
                        manifest,
                        failures);
                }

                throw ApiException.BadGateway($"Scene {scene.SceneId} asset QA did not complete.");
            });

        foreach (var _ in verifiedScenes)
        {
            await SaveAssetCheckpointAsync(draft, gameCase, manifest, AiDraftStatus.GeneratingFinalAssets);
        }

        await UploadAssetsToCloudinaryAsync(draft, gameCase, manifest, caseSlug);
        return manifest;
    }
}
