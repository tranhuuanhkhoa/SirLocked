using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class CaseValidationService : ICaseValidationService
{
    public CaseValidationResult Validate(GameCase gameCase)
    {
        var result = new CaseValidationResult();

        ValidateRequiredFields(gameCase, result);
        ValidateDuplicateIds(gameCase, result);
        ValidateReferences(gameCase, result);
        ValidateClues(gameCase, result);
        ValidateFinalLogic(gameCase, result);

        // Only simulate progression when the structure itself is sound; otherwise the
        // reference errors above already explain what is broken.
        if (result.IsValid)
        {
            ValidatePlaythroughReachability(gameCase, result);
        }

        return result;
    }

    private static void ValidateRequiredFields(GameCase c, CaseValidationResult result)
    {
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

    private static void ValidateReferences(GameCase c, CaseValidationResult result)
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

                ValidateRuntimeLayout(scene, scenePath, itemIds, characterIds, sceneIds, result);

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
    }

    private static void ValidateRuntimeLayout(
        CaseScene scene,
        string scenePath,
        IReadOnlySet<string> itemIds,
        IReadOnlySet<string> characterIds,
        IReadOnlySet<string> sceneIds,
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

    private static void ValidateClues(GameCase c, CaseValidationResult result)
    {
        var itemIds = c.Items.Select(i => i.ItemId).ToHashSet();
        var dialogueIds = c.Dialogues.Select(d => d.DialogueId).ToHashSet();

        for (var i = 0; i < c.Clues.Count; i++)
        {
            var clue = c.Clues[i];
            var sourceType = clue.SourceType?.ToLowerInvariant();

            if (sourceType is not ("item" or "dialogue"))
            {
                result.Add("InvalidValue", $"clues[{i}].sourceType", "Clue sourceType must be 'item' or 'dialogue'.", clue.ClueId);
                continue;
            }

            var sourceExists = sourceType == "item" ? itemIds.Contains(clue.Source) : dialogueIds.Contains(clue.Source);
            if (!sourceExists)
                result.Add("MissingReference", $"clues[{i}].source", $"Clue source {sourceType} does not exist.", clue.Source);
        }
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
        if (final.RequiredEvidenceIds.Count == 0)
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
            if (!unlockedByItem && !unlockedByDialogue)
            {
                result.Add("OrphanClue", $"clue:{clue.ClueId}",
                    $"Clue '{clue.ClueId}' is not unlocked by any item or dialogue.", clue.ClueId);
            }
        }
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
