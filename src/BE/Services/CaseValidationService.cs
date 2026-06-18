using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class CaseValidationService : ICaseValidationService
{
    public CaseValidationResult Validate(GameCase gameCase) => Validate(gameCase, CaseValidationStage.Publish);

    public CaseValidationResult ValidateFullLogic(GameCase gameCase) => Validate(gameCase, CaseValidationStage.FullLogic);

    public CaseValidationResult ValidateSceneLayout(GameCase gameCase) => Validate(gameCase, CaseValidationStage.SceneLayout);

    private static CaseValidationResult Validate(GameCase gameCase, CaseValidationStage stage)
    {
        var result = new CaseValidationResult();

        ValidateRequiredFields(gameCase, result);
        ValidateDuplicateIds(gameCase, result);
        ValidateReferences(gameCase, result, stage);
        ValidateCameraEmbeddedItems(gameCase, result);
        ValidateClues(gameCase, result, stage);
        ValidateFinalLogic(gameCase, result);
        ValidateInvestigationV2(gameCase, result);

        // Only simulate progression when the structure itself is sound; otherwise the
        // reference errors above already explain what is broken.
        if (result.IsValid && stage == CaseValidationStage.Publish)
        {
            ValidatePlaythroughReachability(gameCase, result);
        }

        return result;
    }

    private enum CaseValidationStage
    {
        FullLogic,
        SceneLayout,
        Publish
    }

    private static void ValidateRequiredFields(GameCase c, CaseValidationResult result)
    {
        if (c.MechanicsVersion is not (CaseMechanicsVersions.Legacy or CaseMechanicsVersions.InvestigationV2))
            result.Add("InvalidValue", "mechanicsVersion", "mechanicsVersion must be 1 or 2.");

        if (string.IsNullOrWhiteSpace(c.CaseId))
            result.Add("MissingField", "caseId", "caseId is required.");
        if (string.IsNullOrWhiteSpace(c.Title))
            result.Add("MissingField", "title", "title is required.");
        if (c.Stages.Count == 0)
            result.Add("MissingField", "stages", "At least one stage is required.");

        for (var s = 0; s < c.Stages.Count; s++)
        {
            var stage = c.Stages[s];
            if (string.IsNullOrWhiteSpace(stage.StageId))
                result.Add("MissingField", $"stages[{s}].stageId", "stageId is required.");
            if (stage.Scenes.Count == 0)
                result.Add("MissingField", $"stages[{s}].scenes", $"Stage '{stage.StageId}' must contain at least one scene.", stage.StageId);

            for (var sc = 0; sc < stage.Scenes.Count; sc++)
            {
                var scene = stage.Scenes[sc];
                if (string.IsNullOrWhiteSpace(scene.SceneId))
                    result.Add("MissingField", $"stages[{s}].scenes[{sc}].sceneId", "sceneId is required.");

                var logic = scene.CompleteCondition.Logic?.ToUpperInvariant();
                if (logic is not ("AND" or "OR"))
                {
                    result.Add("InvalidValue", $"stages[{s}].scenes[{sc}].completeCondition.logic",
                        "completeCondition.logic must be AND or OR.", scene.SceneId);
                }
                else if (logic == "OR"
                    && scene.CompleteCondition.RequiredItemIds.Count == 0
                    && scene.CompleteCondition.RequiredClueIds.Count == 0
                    && scene.CompleteCondition.RequiredDialogueIds.Count == 0)
                {
                    result.Add("InvalidValue", $"stages[{s}].scenes[{sc}].completeCondition",
                        "OR completion logic requires at least one non-empty requirement group.", scene.SceneId);
                }
            }
        }

        // Stage order must be unique and usable for linear progression.
        var duplicatedOrders = c.Stages.GroupBy(s => s.Order).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        foreach (var order in duplicatedOrders)
            result.Add("InvalidValue", "stages", $"Stage order {order} is used more than once.");
    }

    private static void ValidateDuplicateIds(GameCase c, CaseValidationResult result)
    {
        CheckDuplicates(result, "stages", c.Stages.Select(s => s.StageId), "stageId");
        CheckDuplicates(result, "scenes", c.Stages.SelectMany(s => s.Scenes).Select(s => s.SceneId), "sceneId");
        CheckDuplicates(result, "characters", c.Characters.Select(x => x.CharacterId), "characterId");
        CheckDuplicates(result, "items", c.Items.Select(x => x.ItemId), "itemId");
        CheckDuplicates(result, "clues", c.Clues.Select(x => x.ClueId), "clueId");
        CheckDuplicates(result, "dialogues", c.Dialogues.Select(x => x.DialogueId), "dialogueId");
        CheckDuplicates(result, "evidenceChallenges", c.EvidenceChallenges.Select(x => x.ChallengeId), "challengeId");
        CheckDuplicates(result, "deductions", c.Deductions.Select(x => x.DeductionId), "deductionId");
        CheckDuplicates(result, "requiredTeamworkChains", c.RequiredTeamworkChains.Select(x => x.ChainId), "chainId");
        CheckDuplicates(result, "hints", c.Hints.Select(x => x.HintId), "hintId");
        CheckDuplicates(result, "finalLogic.motiveOptions", c.FinalLogic.MotiveOptions.Select(x => x.Id), "motive option id");
        CheckDuplicates(result, "finalLogic.methodOptions", c.FinalLogic.MethodOptions.Select(x => x.Id), "method option id");
        CheckDuplicates(result, "hotspots", c.Stages.SelectMany(s => s.Scenes).SelectMany(s => s.Hotspots).Select(h => h.HotspotId), "hotspotId");
    }

    private static void CheckDuplicates(CaseValidationResult result, string path, IEnumerable<string> ids, string label)
    {
        foreach (var dup in ids.Where(id => !string.IsNullOrWhiteSpace(id))
                     .GroupBy(id => id).Where(g => g.Count() > 1).Select(g => g.Key))
        {
            result.Add("DuplicateId", path, $"Duplicate {label} '{dup}'.", dup);
        }
    }

    private static void ValidateReferences(GameCase c, CaseValidationResult result, CaseValidationStage stage)
    {
        var itemIds = c.Items.Select(i => i.ItemId).ToHashSet();
        var characterIds = c.Characters.Select(x => x.CharacterId).ToHashSet();
        var sceneIds = c.Stages.SelectMany(stage => stage.Scenes).Select(scene => scene.SceneId).ToHashSet();
        var clueIds = c.Clues.Select(x => x.ClueId).ToHashSet();
        var dialogueIds = c.Dialogues.Select(x => x.DialogueId).ToHashSet();

        for (var s = 0; s < c.Stages.Count; s++)
        {
            for (var sc = 0; sc < c.Stages[s].Scenes.Count; sc++)
            {
                var scene = c.Stages[s].Scenes[sc];
                var scenePath = $"stages[{s}].scenes[{sc}]";

                for (var i = 0; i < scene.ItemIds.Count; i++)
                {
                    if (!itemIds.Contains(scene.ItemIds[i]))
                        result.Add("MissingReference", $"{scenePath}.itemIds[{i}]", "Item does not exist.", scene.ItemIds[i]);
                }

                for (var i = 0; i < scene.CharacterIds.Count; i++)
                {
                    if (!characterIds.Contains(scene.CharacterIds[i]))
                        result.Add("MissingReference", $"{scenePath}.characterIds[{i}]", "Character does not exist.", scene.CharacterIds[i]);
                }

                for (var h = 0; h < scene.Hotspots.Count; h++)
                {
                    var hotspot = scene.Hotspots[h];
                    var hotspotPath = $"{scenePath}.hotspots[{h}]";
                    var type = hotspot.Type?.ToUpperInvariant();

                    if (type is not ("ITEM" or "CHARACTER"))
                    {
                        result.Add("InvalidValue", $"{hotspotPath}.type", "Hotspot type must be ITEM or CHARACTER.", hotspot.HotspotId);
                    }
                    else
                    {
                        var exists = type == "ITEM" ? itemIds.Contains(hotspot.TargetId) : characterIds.Contains(hotspot.TargetId);
                        if (!exists)
                            result.Add("MissingReference", $"{hotspotPath}.targetId", $"Hotspot target {type} does not exist.", hotspot.TargetId);
                        if (type == "ITEM" && !scene.ItemIds.Contains(hotspot.TargetId))
                            result.Add("MissingReference", $"{hotspotPath}.targetId", "Hotspot item is not listed in the scene's itemIds.", hotspot.TargetId);
                    }

                    foreach (var clueId in hotspot.RequiredClueIds.Where(id => !clueIds.Contains(id)))
                        result.Add("MissingReference", $"{hotspotPath}.requiredClueIds", "Required clue does not exist.", clueId);

                    if (hotspot.X is < 0 or > 100 || hotspot.Y is < 0 or > 100 || hotspot.Width is <= 0 or > 100 || hotspot.Height is <= 0 or > 100)
                        result.Add("InvalidValue", hotspotPath, "Hotspot coordinates must be percentages (x/y 0-100, width/height 1-100).", hotspot.HotspotId);
                }

                if (stage != CaseValidationStage.FullLogic)
                {
                    ValidateRuntimeLayout(scene, scenePath, itemIds, characterIds, sceneIds, clueIds, result);
                }

                var condition = scene.CompleteCondition;
                foreach (var id in condition.RequiredItemIds.Where(id => !itemIds.Contains(id)))
                    result.Add("MissingReference", $"{scenePath}.completeCondition.requiredItemIds", "Required item does not exist.", id);
                foreach (var id in condition.RequiredClueIds.Where(id => !clueIds.Contains(id)))
                    result.Add("MissingReference", $"{scenePath}.completeCondition.requiredClueIds", "Required clue does not exist.", id);
                foreach (var id in condition.RequiredDialogueIds.Where(id => !dialogueIds.Contains(id)))
                    result.Add("MissingReference", $"{scenePath}.completeCondition.requiredDialogueIds", "Required dialogue does not exist.", id);
            }
        }

        for (var i = 0; i < c.Items.Count; i++)
        {
            foreach (var clueId in c.Items[i].UnlockClueIds.Where(id => !clueIds.Contains(id)))
                result.Add("MissingReference", $"items[{i}].unlockClueIds", "Unlock clue does not exist.", clueId);
        }

        for (var d = 0; d < c.Dialogues.Count; d++)
        {
            var dialogue = c.Dialogues[d];
            if (!characterIds.Contains(dialogue.CharacterId))
                result.Add("MissingReference", $"dialogues[{d}].characterId", "Dialogue character does not exist.", dialogue.CharacterId);
            foreach (var clueId in dialogue.RequiredClueIds.Where(id => !clueIds.Contains(id)))
                result.Add("MissingReference", $"dialogues[{d}].requiredClueIds", "Required clue does not exist.", clueId);
            foreach (var clueId in dialogue.UnlockClueIds.Where(id => !clueIds.Contains(id)))
                result.Add("MissingReference", $"dialogues[{d}].unlockClueIds", "Unlock clue does not exist.", clueId);
        }

        for (var i = 0; i < c.EvidenceChallenges.Count; i++)
        {
            var challenge = c.EvidenceChallenges[i];
            var path = $"evidenceChallenges[{i}]";
            if (!dialogueIds.Contains(challenge.DialogueId))
                result.Add("MissingReference", $"{path}.dialogueId", "Challenge dialogue does not exist.", challenge.DialogueId);
            if (!clueIds.Contains(challenge.CorrectEvidenceId))
                result.Add("MissingReference", $"{path}.correctEvidenceId", "Challenge evidence clue does not exist.", challenge.CorrectEvidenceId);
            foreach (var clueId in challenge.UnlockClueIds.Where(id => !clueIds.Contains(id)))
                result.Add("MissingReference", $"{path}.unlockClueIds", "Challenge unlock clue does not exist.", clueId);
        }

        for (var i = 0; i < c.Deductions.Count; i++)
        {
            var deduction = c.Deductions[i];
            var path = $"deductions[{i}]";
            foreach (var clueId in deduction.RequiredClueIds.Where(id => !clueIds.Contains(id)))
                result.Add("MissingReference", $"{path}.requiredClueIds", "Deduction required clue does not exist.", clueId);
            foreach (var challengeId in deduction.RequiredChallengeIds.Where(id => c.EvidenceChallenges.All(challenge => challenge.ChallengeId != id)))
                result.Add("MissingReference", $"{path}.requiredChallengeIds", "Deduction required challenge does not exist.", challengeId);
            foreach (var clueId in deduction.UnlockClueIds.Where(id => !clueIds.Contains(id)))
                result.Add("MissingReference", $"{path}.unlockClueIds", "Deduction unlock clue does not exist.", clueId);
        }
    }

    private static void ValidateRuntimeLayout(
        CaseScene scene,
        string scenePath,
        IReadOnlySet<string> itemIds,
        IReadOnlySet<string> characterIds,
        IReadOnlySet<string> sceneIds,
        IReadOnlySet<string> clueIds,
        CaseValidationResult result)
    {
        var runtime = scene.Runtime;
        if (runtime is null)
        {
            return;
        }

        if (runtime.Width <= 0 || runtime.Height <= 0)
        {
            result.Add("InvalidValue", $"{scenePath}.runtime", "runtime.width and runtime.height must be positive.", scene.SceneId);
            return;
        }

        if (runtime.WalkableArea is not null)
        {
            ValidateRuntimeBox(runtime.WalkableArea, $"{scenePath}.runtime.walkableArea", runtime.Width, runtime.Height, result, scene.SceneId);
        }

        foreach (var (name, spawn) in runtime.SpawnPoints)
        {
            ValidateRuntimePoint(spawn, $"{scenePath}.runtime.spawnPoints.{name}", runtime.Width, runtime.Height, result, scene.SceneId);
        }

        for (var i = 0; i < runtime.ItemPlacements.Count; i++)
        {
            var placement = runtime.ItemPlacements[i];
            var path = $"{scenePath}.runtime.itemPlacements[{i}]";
            if (!itemIds.Contains(placement.ItemId))
            {
                result.Add("MissingReference", $"{path}.itemId", "Runtime item placement target does not exist.", placement.ItemId);
            }
            if (!scene.ItemIds.Contains(placement.ItemId))
            {
                result.Add("MissingReference", $"{path}.itemId", "Runtime item placement target is not listed in this scene's itemIds.", placement.ItemId);
            }
            ValidateRuntimePoint(placement.Position, $"{path}.position", runtime.Width, runtime.Height, result, placement.ItemId);
            ValidateRuntimeSize(placement.Size, $"{path}.size", result, placement.ItemId);
            ValidateRuntimeBox(placement.Hotspot, $"{path}.hotspot", runtime.Width, runtime.Height, result, placement.ItemId);
            if (placement.ReservedSlot is not null)
            {
                ValidateRuntimeBox(placement.ReservedSlot, $"{path}.reservedSlot", runtime.Width, runtime.Height, result, placement.ItemId);
            }
        }

        for (var i = 0; i < runtime.CharacterPlacements.Count; i++)
        {
            var placement = runtime.CharacterPlacements[i];
            var path = $"{scenePath}.runtime.characterPlacements[{i}]";
            if (!characterIds.Contains(placement.CharacterId))
            {
                result.Add("MissingReference", $"{path}.characterId", "Runtime character placement target does not exist.", placement.CharacterId);
            }
            if (!scene.CharacterIds.Contains(placement.CharacterId))
            {
                result.Add("MissingReference", $"{path}.characterId", "Runtime character placement target is not listed in this scene's characterIds.", placement.CharacterId);
            }
            ValidateRuntimePoint(placement.Position, $"{path}.position", runtime.Width, runtime.Height, result, placement.CharacterId);
            ValidateRuntimeSize(placement.Size, $"{path}.size", result, placement.CharacterId);
            ValidateRuntimeBox(placement.Hotspot, $"{path}.hotspot", runtime.Width, runtime.Height, result, placement.CharacterId);
            if (placement.ReservedSlot is not null)
            {
                ValidateRuntimeBox(placement.ReservedSlot, $"{path}.reservedSlot", runtime.Width, runtime.Height, result, placement.CharacterId);
            }
        }

        for (var i = 0; i < runtime.ClueZones.Count; i++)
        {
            var zone = runtime.ClueZones[i];
            var path = $"{scenePath}.runtime.clueZones[{i}]";
            if (!clueIds.Contains(zone.ClueId))
            {
                result.Add("MissingReference", $"{path}.clueId", "Runtime clue zone target does not exist.", zone.ClueId);
            }
            ValidateRuntimeBox(zone.Bounds, $"{path}.bounds", runtime.Width, runtime.Height, result, zone.ClueId);
            if (zone.Bounds.Width < 16 || zone.Bounds.Height < 16)
            {
                result.Add("InvalidValue", $"{path}.bounds", "Clue zone must be at least 16x16 runtime pixels.", zone.ClueId);
            }
            if (!string.IsNullOrWhiteSpace(zone.DetectionStatus)
                && zone.DetectionStatus.ToUpperInvariant() is not ("FOUND" or "AMBIGUOUS" or "NOT_FOUND" or "OCCLUDED" or "TOO_SMALL"))
            {
                result.Add("InvalidValue", $"{path}.detectionStatus", "Clue zone detectionStatus is invalid.", zone.ClueId);
            }
            if (zone.Confidence < 0 || zone.Confidence > 1)
            {
                result.Add("InvalidValue", $"{path}.confidence", "Clue zone confidence must be between 0 and 1.", zone.ClueId);
            }
            foreach (var clueId in zone.RequiredClueIds.Where(id => !clueIds.Contains(id)))
            {
                result.Add("MissingReference", $"{path}.requiredClueIds", "Required clue does not exist.", clueId);
            }
        }

        if (runtime.CameraRules.CaptureRectWidth <= 0 || runtime.CameraRules.CaptureRectHeight <= 0)
        {
            result.Add("InvalidValue", $"{scenePath}.runtime.cameraRules", "Camera capture rectangle width and height must be positive.", scene.SceneId);
        }
        if (runtime.CameraRules.MinClueCoverage <= 0 || runtime.CameraRules.MinClueCoverage > 1
            || runtime.CameraRules.NearMissCoverage <= 0 || runtime.CameraRules.NearMissCoverage > 1
            || runtime.CameraRules.NearMissCoverage > runtime.CameraRules.MinClueCoverage)
        {
            result.Add("InvalidValue", $"{scenePath}.runtime.cameraRules", "Camera coverage thresholds must be 0..1 and nearMiss must be <= minClueCoverage.", scene.SceneId);
        }

        for (var i = 0; i < runtime.Transitions.Count; i++)
        {
            var transition = runtime.Transitions[i];
            var path = $"{scenePath}.runtime.transitions[{i}]";
            if (string.IsNullOrWhiteSpace(transition.TargetSceneId))
            {
                result.Add("MissingField", $"{path}.targetSceneId", "Transition targetSceneId is required.", transition.TransitionId);
            }
            else if (!sceneIds.Contains(transition.TargetSceneId))
            {
                result.Add("MissingReference", $"{path}.targetSceneId", "Transition target scene does not exist.", transition.TargetSceneId);
            }
            ValidateRuntimeBox(transition.Hotspot, $"{path}.hotspot", runtime.Width, runtime.Height, result, transition.TransitionId);
        }
    }

    private static void ValidateRuntimePoint(RuntimePoint point, string path, int width, int height, CaseValidationResult result, string id)
    {
        if (point.X < 0 || point.X > width || point.Y < 0 || point.Y > height)
        {
            result.Add("InvalidValue", path, "Runtime point must fit within runtime.width/runtime.height.", id);
        }
    }

    private static void ValidateRuntimeSize(RuntimeSize size, string path, CaseValidationResult result, string id)
    {
        if (size.Width <= 0 || size.Height <= 0)
        {
            result.Add("InvalidValue", path, "Runtime size width/height must be positive.", id);
        }
    }

    private static void ValidateRuntimeBox(RuntimeBox box, string path, int width, int height, CaseValidationResult result, string id)
    {
        if (box.Width <= 0 || box.Height <= 0 || box.X < 0 || box.Y < 0 || box.X + box.Width > width || box.Y + box.Height > height)
        {
            result.Add("InvalidValue", path, "Runtime box must fit within runtime.width/runtime.height.", id);
        }
    }

    private static void ValidateCameraEmbeddedItems(GameCase c, CaseValidationResult result)
    {
        if (!IsCameraEmbeddedCase(c))
        {
            return;
        }

        var referencedItemIds = c.Stages
            .SelectMany(stage => stage.Scenes)
            .SelectMany(scene => scene.ItemIds)
            .Distinct(StringComparer.Ordinal)
            .ToHashSet(StringComparer.Ordinal);

        for (var i = 0; i < c.Items.Count; i++)
        {
            var item = c.Items[i];
            if (!referencedItemIds.Contains(item.ItemId))
            {
                continue;
            }

            if (!IsAllowedCameraModePuzzleItem(item))
            {
                result.Add(
                    "InvalidCameraEmbeddedItem",
                    $"items[{i}]",
                    "CAMERA_EMBEDDED cases may only keep scene items when they are true interactive puzzle objects with interactionPurpose and interactionReason.",
                    item.ItemId);
            }
        }
    }

    private static void ValidateClues(GameCase c, CaseValidationResult result, CaseValidationStage stage)
    {
        var itemIds = c.Items.Select(i => i.ItemId).ToHashSet();
        var itemById = c.Items
            .Where(i => !string.IsNullOrWhiteSpace(i.ItemId))
            .GroupBy(i => i.ItemId, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var dialogueIds = c.Dialogues.Select(d => d.DialogueId).ToHashSet();
        var sceneIds = c.Stages.SelectMany(s => s.Scenes).Select(s => s.SceneId).ToHashSet();
        var characterIds = c.Characters.Select(ch => ch.CharacterId).ToHashSet();
        var cameraZoneCounts = c.Stages
            .SelectMany(stage => stage.Scenes)
            .SelectMany(scene => scene.Runtime?.ClueZones ?? new List<ClueZone>())
            .GroupBy(zone => zone.ClueId)
            .ToDictionary(g => g.Key, g => g.Count());
        var cameraZoneByClue = c.Stages
            .SelectMany(stage => stage.Scenes)
            .SelectMany(scene => scene.Runtime?.ClueZones ?? new List<ClueZone>())
            .Where(zone => !string.IsNullOrWhiteSpace(zone.ClueId))
            .GroupBy(zone => zone.ClueId)
            .ToDictionary(g => g.Key, g => g.First());
        var finalEvidenceIds = c.FinalLogic.RequiredEvidenceIds
            .Concat(c.FinalLogic.RequiredEvidenceLinks.Select(link => link.EvidenceId)).ToHashSet();
        var requiresCameraLayout = stage is CaseValidationStage.SceneLayout or CaseValidationStage.Publish;
        var isCameraEmbedded = IsCameraEmbeddedCase(c);

        for (var i = 0; i < c.Clues.Count; i++)
        {
            var clue = c.Clues[i];
            var sourceType = clue.SourceType?.ToLowerInvariant();
            var discoverMethod = DiscoverMethod(clue);

            if (discoverMethod is not ("item" or "dialogue" or "camera"))
            {
                result.Add("InvalidValue", $"clues[{i}].discoverMethod", "Clue discoverMethod must be 'item', 'dialogue', or 'camera'.", clue.ClueId);
            }

            if (sourceType is not ("item" or "dialogue" or "camera"))
            {
                result.Add("InvalidValue", $"clues[{i}].sourceType", "Clue sourceType must be 'item', 'dialogue', or 'camera'.", clue.ClueId);
                continue;
            }

            if (sourceType == "item" && !itemIds.Contains(clue.Source))
            {
                result.Add("MissingReference", $"clues[{i}].source", "Clue source item does not exist.", clue.Source);
            }
            if (sourceType == "dialogue" && !dialogueIds.Contains(clue.Source))
            {
                result.Add("MissingReference", $"clues[{i}].source", "Clue source dialogue does not exist.", clue.Source);
            }

            var isFinalEvidence = finalEvidenceIds.Contains(clue.ClueId);
            if (isCameraEmbedded
                && (isFinalEvidence || clue.IsEvidence || clue.IsCritical)
                && (sourceType == "item" || discoverMethod == "item"))
            {
                if (!itemById.TryGetValue(clue.Source, out var sourceItem) || !IsAllowedCameraModePuzzleItem(sourceItem))
                {
                    result.Add("InvalidCameraEvidenceSource", $"clues[{i}].source",
                        "CAMERA_EMBEDDED evidence may use item discovery only when the source item is a true interactive puzzle object with a clear interactionReason.",
                        clue.ClueId);
                }
            }

            if (discoverMethod == "camera")
            {
                if (string.IsNullOrWhiteSpace(clue.VisualDescription))
                {
                    result.Add("MissingField", $"clues[{i}].visualDescription", "Camera clue needs a visualDescription for background generation.", clue.ClueId);
                }
                if (string.IsNullOrWhiteSpace(clue.InventoryDescription))
                {
                    result.Add("MissingField", $"clues[{i}].inventoryDescription", "Camera clue needs an inventoryDescription for photo evidence.", clue.ClueId);
                }
                if (string.IsNullOrWhiteSpace(clue.SceneId) || !sceneIds.Contains(clue.SceneId))
                {
                    result.Add("MissingReference", $"clues[{i}].sceneId", "Camera clue must reference an existing sceneId.", clue.ClueId);
                }

                if (string.IsNullOrWhiteSpace(clue.NarrativeMeaning))
                {
                    result.Add("MissingField", $"clues[{i}].narrativeMeaning", "Camera clue needs a narrativeMeaning for evidence reasoning.", clue.ClueId);
                }

                var count = cameraZoneCounts.GetValueOrDefault(clue.ClueId);
                if (requiresCameraLayout && count != 1)
                {
                    result.Add("InvalidValue", $"clues[{i}].clueZone",
                        $"Camera clue must have exactly one runtime clue zone; found {count}.", clue.ClueId);
                }

                var requiresVerifiedZone = clue.IsEvidence || clue.IsCritical || finalEvidenceIds.Contains(clue.ClueId);
                if (requiresCameraLayout && requiresVerifiedZone && cameraZoneByClue.TryGetValue(clue.ClueId, out var zone))
                {
                    if (zone.IsFallback || string.Equals(zone.Source, "fallback", StringComparison.OrdinalIgnoreCase))
                    {
                        result.Add("InvalidValue", $"clues[{i}].clueZone", "Required camera clue cannot use a fallback clue zone.", clue.ClueId);
                    }
                    if (!string.Equals(zone.DetectionStatus, "FOUND", StringComparison.OrdinalIgnoreCase))
                    {
                        result.Add("InvalidValue", $"clues[{i}].clueZone.detectionStatus", "Required camera clue zone must have detectionStatus FOUND.", clue.ClueId);
                    }
                    if (zone.Confidence < 0.65)
                    {
                        result.Add("InvalidValue", $"clues[{i}].clueZone.confidence", "Required camera clue zone confidence must be at least 0.65.", clue.ClueId);
                    }
                }
            }

            foreach (var characterId in clue.RelatedCharacterIds.Where(id => !characterIds.Contains(id)))
            {
                result.Add("MissingReference", $"clues[{i}].relatedCharacterIds", "Related character does not exist.", characterId);
            }
        }
    }

    private static bool IsCameraEmbeddedCase(GameCase c) =>
        string.Equals(c.GenerationMode, CaseGenerationModes.CameraEmbedded, StringComparison.OrdinalIgnoreCase);

    private static bool IsAllowedCameraModePuzzleItem(CaseItem item)
    {
        if (!item.IsInteractivePuzzleObject || string.IsNullOrWhiteSpace(item.InteractionReason))
        {
            return false;
        }

        return item.InteractionPurpose is CaseItemInteractionPurposes.UnlockDoor
            or CaseItemInteractionPurposes.CombineItem
            or CaseItemInteractionPurposes.OperateMechanism;
    }

    private static void ValidateFinalLogic(GameCase c, CaseValidationResult result)
    {
        var final = c.FinalLogic;
        var clueById = c.Clues.ToDictionary(x => x.ClueId, x => x);
        var itemIds = c.Items.Select(x => x.ItemId).ToHashSet();

        if (string.IsNullOrWhiteSpace(final.CulpritId))
            result.Add("MissingField", "finalLogic.culpritId", "finalLogic.culpritId is required.");
        else if (c.Characters.All(x => x.CharacterId != final.CulpritId))
            result.Add("MissingReference", "finalLogic.culpritId", "Culprit character does not exist.", final.CulpritId);

        if (string.IsNullOrWhiteSpace(final.WinEnding))
            result.Add("MissingField", "finalLogic.winEnding", "finalLogic.winEnding is required.");
        if (string.IsNullOrWhiteSpace(final.FailEnding))
            result.Add("MissingField", "finalLogic.failEnding", "finalLogic.failEnding is required.");
        if (c.MechanicsVersion < CaseMechanicsVersions.InvestigationV2 && final.RequiredEvidenceIds.Count == 0)
            result.Add("MissingField", "finalLogic.requiredEvidenceIds", "At least one required evidence clue is needed.");

        for (var i = 0; i < final.RequiredEvidenceIds.Count; i++)
        {
            var evidenceId = final.RequiredEvidenceIds[i];
            if (!clueById.TryGetValue(evidenceId, out var clue))
            {
                var message = itemIds.Contains(evidenceId)
                    ? "Final required evidence must be a clue ID, not an item ID."
                    : "Final required evidence clue does not exist.";
                result.Add("InvalidEvidenceReference", $"finalLogic.requiredEvidenceIds[{i}]", message, evidenceId);
            }
            else if (!clue.IsEvidence)
            {
                result.Add("InvalidEvidenceFlag", $"finalLogic.requiredEvidenceIds[{i}]",
                    $"Clue '{evidenceId}' is used as final evidence but does not set isEvidence: true.", evidenceId);
            }
        }
    }

    /// <summary>
    /// Simulates a greedy linear playthrough (stages by order, scenes by array order) and checks that
    /// every scene can be completed and all final evidence is discoverable. This subsumes
    /// unlock-cycle and unreachable-requirement checks: anything locked behind a cycle never
    /// enters the unlocked set and surfaces as a deadlocked scene or undiscoverable evidence.
    /// </summary>
    private static void ValidatePlaythroughReachability(GameCase c, CaseValidationResult result)
    {
        var itemById = c.Items.ToDictionary(x => x.ItemId, x => x);
        var dialogueById = c.Dialogues.ToDictionary(x => x.DialogueId, x => x);
        var clueById = c.Clues.ToDictionary(x => x.ClueId, x => x);
        var hasCameraLayout = c.Stages.SelectMany(s => s.Scenes).Any(scene => scene.Runtime?.ClueZones.Count > 0);

        var unlockedClues = new HashSet<string>();
        var inspectedItems = new HashSet<string>();
        var askedDialogues = new HashSet<string>();

        var orderedStages = c.Stages.OrderBy(s => s.Order).ToList();

        foreach (var stage in orderedStages)
        {
            foreach (var scene in stage.Scenes)
            {
                // Fixpoint: keep applying every available unlock until nothing changes.
                bool progressed;
                do
                {
                    progressed = false;

                    foreach (var itemId in scene.ItemIds)
                    {
                        if (inspectedItems.Contains(itemId) || !itemById.TryGetValue(itemId, out var item)) continue;

                        var hotspot = scene.Hotspots.FirstOrDefault(h =>
                            h.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase) && h.TargetId == itemId);
                        if (hotspot is not null && !hotspot.RequiredClueIds.All(unlockedClues.Contains)) continue;

                        inspectedItems.Add(itemId);
                        foreach (var clue in item.UnlockClueIds) unlockedClues.Add(clue);
                        progressed = true;
                    }

                    foreach (var dialogue in c.Dialogues)
                    {
                        if (askedDialogues.Contains(dialogue.DialogueId)) continue;
                        if (!scene.CharacterIds.Contains(dialogue.CharacterId)) continue;
                        if (!dialogue.RequiredClueIds.All(unlockedClues.Contains)) continue;

                        askedDialogues.Add(dialogue.DialogueId);
                        foreach (var clue in dialogue.UnlockClueIds) unlockedClues.Add(clue);
                        progressed = true;
                    }

                    foreach (var challenge in c.EvidenceChallenges)
                    {
                        if (!askedDialogues.Contains(challenge.DialogueId)) continue;
                        if (!unlockedClues.Contains(challenge.CorrectEvidenceId)) continue;
                        foreach (var clueId in challenge.UnlockClueIds)
                        {
                            if (unlockedClues.Add(clueId)) progressed = true;
                        }
                    }

                    foreach (var deduction in c.Deductions)
                    {
                        if (!deduction.RequiredClueIds.All(unlockedClues.Contains)) continue;
                        if (!deduction.RequiredChallengeIds.All(challengeId =>
                            c.EvidenceChallenges.Where(challenge => challenge.ChallengeId == challengeId)
                                .SelectMany(challenge => challenge.UnlockClueIds)
                                .All(unlockedClues.Contains))) continue;
                        foreach (var clueId in deduction.UnlockClueIds)
                        {
                            if (unlockedClues.Add(clueId)) progressed = true;
                        }
                    }

                    foreach (var zone in scene.Runtime?.ClueZones ?? new List<ClueZone>())
                    {
                        if (unlockedClues.Contains(zone.ClueId)) continue;
                        if (!clueById.TryGetValue(zone.ClueId, out var clue)) continue;
                        if (DiscoverMethod(clue) != "camera") continue;
                        if (!zone.RequiredClueIds.All(unlockedClues.Contains)) continue;

                        unlockedClues.Add(zone.ClueId);
                        progressed = true;
                    }

                    if (!hasCameraLayout)
                    {
                        foreach (var clue in c.Clues.Where(cl => DiscoverMethod(cl) == "camera" && cl.SceneId == scene.SceneId))
                        {
                            if (unlockedClues.Add(clue.ClueId))
                            {
                                progressed = true;
                            }
                        }
                    }
                } while (progressed);

                if (!IsConditionSatisfied(scene.CompleteCondition, inspectedItems, unlockedClues, askedDialogues))
                {
                    var missing = DescribeMissing(scene.CompleteCondition, inspectedItems, unlockedClues, askedDialogues);
                    result.Add("UnreachableScene", $"scene:{scene.SceneId}",
                        $"Scene '{scene.SceneId}' can never be completed with a linear playthrough. Missing: {missing}. " +
                        "Check unlock chains for cycles or requirements that only become available later.",
                        scene.SceneId);
                }
            }
        }

        foreach (var evidenceId in c.FinalLogic.RequiredEvidenceIds.Where(id => !unlockedClues.Contains(id)))
        {
            result.Add("UndiscoverableEvidence", "finalLogic.requiredEvidenceIds",
                $"Final evidence clue '{evidenceId}' is never unlocked by any reachable item or dialogue.", evidenceId);
        }

        // Dialogues referenced by clue sources must actually unlock those clues somewhere.
        foreach (var clue in c.Clues)
        {
            var unlockedByItem = c.Items.Any(i => i.UnlockClueIds.Contains(clue.ClueId));
            var unlockedByDialogue = c.Dialogues.Any(d => d.UnlockClueIds.Contains(clue.ClueId));
            var unlockedByChallenge = c.EvidenceChallenges.Any(challenge => challenge.UnlockClueIds.Contains(clue.ClueId));
            var unlockedByDeduction = c.Deductions.Any(deduction => deduction.UnlockClueIds.Contains(clue.ClueId));
            var unlockedByCamera = DiscoverMethod(clue) == "camera"
                && (!hasCameraLayout || c.Stages.SelectMany(s => s.Scenes).Any(scene =>
                    scene.Runtime?.ClueZones.Any(zone => zone.ClueId == clue.ClueId) == true));
            if (!unlockedByItem && !unlockedByDialogue && !unlockedByChallenge && !unlockedByDeduction && !unlockedByCamera)
            {
                result.Add("OrphanClue", $"clue:{clue.ClueId}",
                    $"Clue '{clue.ClueId}' is not unlocked by any item, dialogue, challenge, deduction, or camera clue zone.", clue.ClueId);
            }
        }

        foreach (var evidenceId in c.FinalLogic.RequiredEvidenceLinks.Select(link => link.EvidenceId).Where(id => !unlockedClues.Contains(id)))
        {
            result.Add("UndiscoverableEvidence", "finalLogic.requiredEvidenceLinks",
                $"Final evidence clue '{evidenceId}' is never unlocked by any reachable action.", evidenceId);
        }
    }

    private static void ValidateInvestigationV2(GameCase c, CaseValidationResult result)
    {
        if (c.MechanicsVersion < CaseMechanicsVersions.InvestigationV2) return;

        var clueById = c.Clues.Where(clue => !string.IsNullOrWhiteSpace(clue.ClueId))
            .GroupBy(clue => clue.ClueId).ToDictionary(group => group.Key, group => group.First());
        var sceneIds = c.Stages.SelectMany(stage => stage.Scenes).Select(scene => scene.SceneId).ToHashSet();
        var challengeIds = c.EvidenceChallenges.Select(challenge => challenge.ChallengeId).ToHashSet();
        var deductionIds = c.Deductions.Select(deduction => deduction.DeductionId).ToHashSet();

        if (c.EvidenceChallenges.Count < 2)
            result.Add("MissingField", "evidenceChallenges", "V2 cases require at least two evidence challenges.");
        if (c.Deductions.Count == 0)
            result.Add("MissingField", "deductions", "Full V2 cases require at least one deduction.");
        if (c.RequiredTeamworkChains.Count == 0)
            result.Add("MissingField", "requiredTeamworkChains", "Full V2 cases require at least one cross-role teamwork chain.");

        for (var i = 0; i < c.EvidenceChallenges.Count; i++)
        {
            var challenge = c.EvidenceChallenges[i];
            var path = $"evidenceChallenges[{i}]";
            if (string.IsNullOrWhiteSpace(challenge.ChallengeId)) result.Add("MissingField", $"{path}.challengeId", "challengeId is required.");
            if (string.IsNullOrWhiteSpace(challenge.Prompt)) result.Add("MissingField", $"{path}.prompt", "Challenge prompt is required.", challenge.ChallengeId);
            if (string.IsNullOrWhiteSpace(challenge.SuccessResponse)) result.Add("MissingField", $"{path}.successResponse", "Challenge successResponse is required.", challenge.ChallengeId);
            if (string.IsNullOrWhiteSpace(challenge.FailureResponse)) result.Add("MissingField", $"{path}.failureResponse", "Challenge failureResponse is required.", challenge.ChallengeId);
            if (challenge.UnlockClueIds.Count == 0) result.Add("MissingField", $"{path}.unlockClueIds", "Challenge must unlock at least one clue.", challenge.ChallengeId);
            if (clueById.TryGetValue(challenge.CorrectEvidenceId, out var evidence) && !evidence.IsEvidence)
                result.Add("InvalidEvidenceFlag", $"{path}.correctEvidenceId", "Challenge evidence must set isEvidence: true.", challenge.CorrectEvidenceId);
        }

        for (var i = 0; i < c.Deductions.Count; i++)
        {
            var deduction = c.Deductions[i];
            var path = $"deductions[{i}]";
            if (string.IsNullOrWhiteSpace(deduction.DeductionId)) result.Add("MissingField", $"{path}.deductionId", "deductionId is required.");
            if (string.IsNullOrWhiteSpace(deduction.Prompt)) result.Add("MissingField", $"{path}.prompt", "Deduction prompt is required.", deduction.DeductionId);
            if (deduction.RequiredClueIds.Count == 0) result.Add("MissingField", $"{path}.requiredClueIds", "Deduction must require at least one clue.", deduction.DeductionId);
            if (deduction.RequiredChallengeIds.Count == 0) result.Add("MissingField", $"{path}.requiredChallengeIds", "Deduction must require at least one resolved challenge.", deduction.DeductionId);
            ValidateOptions(deduction.Options, $"{path}.options", result);
            if (deduction.Options.All(option => option.Id != deduction.CorrectOptionId))
                result.Add("MissingReference", $"{path}.correctOptionId", "Deduction correct option must reference one option.", deduction.CorrectOptionId);
            if (string.IsNullOrWhiteSpace(deduction.SuccessResponse)) result.Add("MissingField", $"{path}.successResponse", "Deduction successResponse is required.", deduction.DeductionId);
            if (string.IsNullOrWhiteSpace(deduction.FailureResponse)) result.Add("MissingField", $"{path}.failureResponse", "Deduction failureResponse is required.", deduction.DeductionId);
        }

        foreach (var chain in c.RequiredTeamworkChains)
        {
            if (string.IsNullOrWhiteSpace(chain.ChainId))
                result.Add("MissingField", "requiredTeamworkChains.chainId", "chainId is required.");
            if (!clueById.ContainsKey(chain.InvestigatorClueId))
                result.Add("MissingReference", "requiredTeamworkChains.investigatorClueId", "Teamwork chain investigator clue does not exist.", chain.InvestigatorClueId);
            if (!challengeIds.Contains(chain.InterrogatorChallengeId))
                result.Add("MissingReference", "requiredTeamworkChains.interrogatorChallengeId", "Teamwork chain challenge does not exist.", chain.InterrogatorChallengeId);
            if (!deductionIds.Contains(chain.DeductionId))
                result.Add("MissingReference", "requiredTeamworkChains.deductionId", "Teamwork chain deduction does not exist.", chain.DeductionId);
        }

        ValidateOptions(c.FinalLogic.MotiveOptions, "finalLogic.motiveOptions", result);
        ValidateOptions(c.FinalLogic.MethodOptions, "finalLogic.methodOptions", result);
        if (c.FinalLogic.MotiveOptions.All(option => option.Id != c.FinalLogic.CorrectMotiveId))
            result.Add("MissingReference", "finalLogic.correctMotiveId", "Correct motive must reference a motive option.", c.FinalLogic.CorrectMotiveId);
        if (c.FinalLogic.MethodOptions.All(option => option.Id != c.FinalLogic.CorrectMethodId))
            result.Add("MissingReference", "finalLogic.correctMethodId", "Correct method must reference a method option.", c.FinalLogic.CorrectMethodId);

        var links = c.FinalLogic.RequiredEvidenceLinks;
        var claims = links.Select(link => link.ClaimType.Trim().ToUpperInvariant()).ToList();
        if (links.Count != 3 || claims.Distinct().Count() != 3 || !EvidenceClaimTypes.All.SetEquals(claims))
            result.Add("InvalidValue", "finalLogic.requiredEvidenceLinks", "V2 final logic requires exactly one MOTIVE, METHOD, and OPPORTUNITY evidence link.");
        if (links.Select(link => link.EvidenceId).Distinct().Count() != links.Count)
            result.Add("InvalidValue", "finalLogic.requiredEvidenceLinks", "Each final claim must use a different evidence clue.");

        for (var i = 0; i < links.Count; i++)
        {
            var link = links[i];
            if (!clueById.TryGetValue(link.EvidenceId, out var clue))
                result.Add("MissingReference", $"finalLogic.requiredEvidenceLinks[{i}].evidenceId", "Final evidence clue does not exist.", link.EvidenceId);
            else if (!clue.IsEvidence)
                result.Add("InvalidEvidenceFlag", $"finalLogic.requiredEvidenceLinks[{i}].evidenceId", "Final evidence clue must set isEvidence: true.", link.EvidenceId);
        }
        foreach (var deductionId in c.FinalLogic.RequiredDeductionIds.Where(id => !deductionIds.Contains(id)))
            result.Add("MissingReference", "finalLogic.requiredDeductionIds", "Required deduction does not exist.", deductionId);
        foreach (var chainId in c.FinalLogic.RequiredTeamworkChainIds.Where(id => c.RequiredTeamworkChains.All(chain => chain.ChainId != id)))
            result.Add("MissingReference", "finalLogic.requiredTeamworkChainIds", "Required teamwork chain does not exist.", chainId);
        if (c.FinalLogic.RequiredDeductionIds.Count == 0)
            result.Add("MissingField", "finalLogic.requiredDeductionIds", "Full V2 final logic requires at least one deduction.");
        if (c.FinalLogic.RequiredTeamworkChainIds.Count == 0)
            result.Add("MissingField", "finalLogic.requiredTeamworkChainIds", "Full V2 final logic requires at least one teamwork chain.");

        foreach (var hint in c.Hints)
        {
            var context = hint.ContextType?.Trim().ToUpperInvariant();
            if (context == HintContextTypes.Scene && !sceneIds.Contains(hint.TargetId))
                result.Add("MissingReference", "hints.targetId", "SCENE hint target must be an existing scene.", hint.TargetId);
            else if (context == HintContextTypes.Confrontation && !challengeIds.Contains(hint.TargetId))
                result.Add("MissingReference", "hints.targetId", "CONFRONTATION hint target must be an existing challenge.", hint.TargetId);
            else if (context == HintContextTypes.Deduction && !deductionIds.Contains(hint.TargetId))
                result.Add("MissingReference", "hints.targetId", "DEDUCTION hint target must be an existing deduction.", hint.TargetId);
            else if (context is not (HintContextTypes.Scene or HintContextTypes.Confrontation or HintContextTypes.Deduction))
                result.Add("InvalidValue", "hints.contextType", "V2 hints only support SCENE, CONFRONTATION, and DEDUCTION.", hint.HintId);
            if (string.IsNullOrWhiteSpace(hint.HintId) || string.IsNullOrWhiteSpace(hint.Text) || hint.Order < 1)
                result.Add("InvalidValue", "hints", "Each hint requires hintId, text, and order >= 1.", hint.HintId);
        }

        foreach (var sceneId in sceneIds.Where(id => !c.Hints.Any(h => h.ContextType.Equals(HintContextTypes.Scene, StringComparison.OrdinalIgnoreCase) && h.TargetId == id)))
            result.Add("MissingField", "hints", "Every V2 scene requires at least one SCENE hint.", sceneId);
        foreach (var challengeId in challengeIds.Where(id => !c.Hints.Any(h => h.ContextType.Equals(HintContextTypes.Confrontation, StringComparison.OrdinalIgnoreCase) && h.TargetId == id)))
            result.Add("MissingField", "hints", "Every V2 challenge requires at least one CONFRONTATION hint.", challengeId);
        foreach (var deductionId in deductionIds.Where(id => !c.Hints.Any(h => h.ContextType.Equals(HintContextTypes.Deduction, StringComparison.OrdinalIgnoreCase) && h.TargetId == id)))
            result.Add("MissingField", "hints", "Every V2 deduction requires at least one DEDUCTION hint.", deductionId);
    }

    private static void ValidateOptions(List<AccusationOption> options, string path, CaseValidationResult result)
    {
        if (options.Count < 3) result.Add("MissingField", path, "V2 accusation requires at least three options.");
        for (var i = 0; i < options.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(options[i].Id) || string.IsNullOrWhiteSpace(options[i].Label))
                result.Add("MissingField", $"{path}[{i}]", "Accusation options require id and label.", options[i].Id);
        }
    }

    private static string DiscoverMethod(CaseClue clue)
    {
        if (!string.IsNullOrWhiteSpace(clue.DiscoverMethod))
        {
            return clue.DiscoverMethod.Trim().ToLowerInvariant();
        }
        return clue.SourceType.Trim().ToLowerInvariant();
    }

    public static bool IsConditionSatisfied(
        CompleteCondition condition,
        IReadOnlySet<string> inspectedItems,
        IReadOnlySet<string> unlockedClues,
        IReadOnlySet<string> askedDialogues)
    {
        var itemsOk = condition.RequiredItemIds.All(inspectedItems.Contains);
        var cluesOk = condition.RequiredClueIds.All(unlockedClues.Contains);
        var dialoguesOk = condition.RequiredDialogueIds.All(askedDialogues.Contains);

        if (condition.Logic.Equals("OR", StringComparison.OrdinalIgnoreCase))
        {
            return (condition.RequiredItemIds.Count > 0 && itemsOk)
                || (condition.RequiredClueIds.Count > 0 && cluesOk)
                || (condition.RequiredDialogueIds.Count > 0 && dialoguesOk);
        }

        return itemsOk && cluesOk && dialoguesOk;
    }

    private static string DescribeMissing(
        CompleteCondition condition,
        IReadOnlySet<string> inspectedItems,
        IReadOnlySet<string> unlockedClues,
        IReadOnlySet<string> askedDialogues)
    {
        var parts = new List<string>();
        var items = condition.RequiredItemIds.Where(id => !inspectedItems.Contains(id)).ToList();
        var clues = condition.RequiredClueIds.Where(id => !unlockedClues.Contains(id)).ToList();
        var dialogues = condition.RequiredDialogueIds.Where(id => !askedDialogues.Contains(id)).ToList();
        if (items.Count > 0) parts.Add($"items [{string.Join(", ", items)}]");
        if (clues.Count > 0) parts.Add($"clues [{string.Join(", ", clues)}]");
        if (dialogues.Count > 0) parts.Add($"dialogues [{string.Join(", ", dialogues)}]");
        return parts.Count == 0 ? "nothing" : string.Join("; ", parts);
    }
}
