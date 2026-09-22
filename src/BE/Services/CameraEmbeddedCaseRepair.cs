using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public static class CameraEmbeddedCaseRepair
{
    public static List<string> RepairFinalItemEvidenceToCamera(GameCase gameCase)
    {
        gameCase.GenerationMode = CaseGenerationModes.CameraEmbedded;
        var fixes = new List<string>();
        var finalEvidenceIds = gameCase.FinalLogic.RequiredEvidenceIds.ToHashSet(StringComparer.Ordinal);

        foreach (var clue in gameCase.Clues.Where(clue => finalEvidenceIds.Contains(clue.ClueId)).ToList())
        {
            if (!IsItemClue(clue))
            {
                continue;
            }

            var item = gameCase.Items.FirstOrDefault(i => i.ItemId == clue.Source);
            if (item is not null && IsAllowedPuzzleItem(item))
            {
                continue;
            }

            var scene = FindSceneForItem(gameCase, clue.Source) ?? FindSceneById(gameCase, clue.SceneId);
            if (scene is null)
            {
                fixes.Add($"Skipped '{clue.ClueId}' because source item '{clue.Source}' could not be mapped to a scene.");
                continue;
            }

            var oldItemId = clue.Source;
            clue.Source = scene.SceneId;
            clue.SourceType = "camera";
            clue.DiscoverMethod = "camera";
            clue.SceneId = scene.SceneId;
            clue.IsEvidence = true;
            clue.VisualDescription = FirstNonBlank(
                clue.VisualDescription,
                item is null ? string.Empty : $"{item.Name}: {item.Description}".Trim(),
                clue.Content,
                clue.Title);
            clue.InventoryDescription = FirstNonBlank(
                clue.InventoryDescription,
                item is null ? string.Empty : $"A photograph of {item.Name}: {item.InspectText}".Trim(),
                clue.Content);
            clue.NarrativeMeaning = FirstNonBlank(clue.NarrativeMeaning, clue.Content, clue.Title);
            if (clue.HintLevel <= 0) clue.HintLevel = clue.IsCritical ? 2 : 1;
            AddTag(clue, "camera");
            AddTag(clue, "evidence");

            var requiredItemWasRemoved = scene.CompleteCondition.RequiredItemIds.Remove(oldItemId);
            if (requiredItemWasRemoved && !scene.CompleteCondition.RequiredClueIds.Contains(clue.ClueId))
            {
                scene.CompleteCondition.RequiredClueIds.Add(clue.ClueId);
            }

            RemoveItemSceneRefs(gameCase, oldItemId);
            if (item is not null)
            {
                item.UnlockClueIds.Remove(clue.ClueId);
                if (!IsAllowedPuzzleItem(item) && item.UnlockClueIds.Count == 0)
                {
                    gameCase.Items.Remove(item);
                    fixes.Add($"Removed non-puzzle item '{oldItemId}' after converting final evidence clue '{clue.ClueId}' to camera discovery.");
                }
            }

            fixes.Add($"Converted final evidence clue '{clue.ClueId}' from item '{oldItemId}' to camera clue in scene '{scene.SceneId}'.");
        }

        return fixes;
    }

    private static bool IsItemClue(CaseClue clue) =>
        string.Equals(clue.SourceType, "item", StringComparison.OrdinalIgnoreCase)
        || string.Equals(clue.DiscoverMethod, "item", StringComparison.OrdinalIgnoreCase)
        || string.IsNullOrWhiteSpace(clue.DiscoverMethod) && string.Equals(clue.SourceType, "item", StringComparison.OrdinalIgnoreCase);

    private static bool IsAllowedPuzzleItem(CaseItem item) =>
        item.IsInteractivePuzzleObject
        && !string.IsNullOrWhiteSpace(item.InteractionReason)
        && item.InteractionPurpose is CaseItemInteractionPurposes.UnlockDoor
            or CaseItemInteractionPurposes.CombineItem
            or CaseItemInteractionPurposes.OperateMechanism;

    private static CaseScene? FindSceneForItem(GameCase gameCase, string itemId) =>
        gameCase.Stages
            .SelectMany(stage => stage.Scenes)
            .FirstOrDefault(scene =>
                scene.ItemIds.Contains(itemId)
                || scene.Hotspots.Any(h => h.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase) && h.TargetId == itemId)
                || scene.CompleteCondition.RequiredItemIds.Contains(itemId));

    private static CaseScene? FindSceneById(GameCase gameCase, string sceneId) =>
        string.IsNullOrWhiteSpace(sceneId)
            ? null
            : gameCase.Stages.SelectMany(stage => stage.Scenes).FirstOrDefault(scene => scene.SceneId == sceneId);

    private static void RemoveItemSceneRefs(GameCase gameCase, string itemId)
    {
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
        {
            scene.ItemIds.RemoveAll(id => id == itemId);
            scene.Hotspots.RemoveAll(h => h.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase) && h.TargetId == itemId);
            scene.CompleteCondition.RequiredItemIds.RemoveAll(id => id == itemId);
            scene.Runtime?.ItemPlacements.RemoveAll(p => p.ItemId == itemId);
            scene.PlacementPlan?.Placements.RemoveAll(p =>
                p.Type.Equals("item", StringComparison.OrdinalIgnoreCase) && p.Id == itemId);
        }
    }

    private static string FirstNonBlank(params string[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

    private static void AddTag(CaseClue clue, string tag)
    {
        if (!clue.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase))
        {
            clue.Tags.Add(tag);
        }
    }
}
