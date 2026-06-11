using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// Deterministic post-processor for AI-generated cases. LLMs frequently make small mechanical
/// mistakes (a clue whose declared source never unlocks it, an item without a hotspot, a
/// requirement that only becomes available later). This repairs those without changing the
/// story, so more generations survive strict validation. Admin-imported JSON is NOT repaired —
/// import stays strict.
/// </summary>
public static class CaseAutoRepair
{
    public static List<string> Repair(GameCase c)
    {
        var fixes = new List<string>();

        EnsureSourceUnlocks(c, fixes);
        EnsureHotspots(c, fixes);
        EnsureEvidenceFlags(c, fixes);
        RelaxUnreachableRequirements(c, fixes);
        EnsureDiscoverableFinalEvidence(c, fixes);

        return fixes;
    }

    /// <summary>A clue that nothing unlocks but that declares a valid source gets attached to that source.</summary>
    private static void EnsureSourceUnlocks(GameCase c, List<string> fixes)
    {
        foreach (var clue in c.Clues)
        {
            var unlockedAnywhere = c.Items.Any(i => i.UnlockClueIds.Contains(clue.ClueId))
                || c.Dialogues.Any(d => d.UnlockClueIds.Contains(clue.ClueId));
            if (unlockedAnywhere) continue;

            if (string.Equals(clue.SourceType, "item", StringComparison.OrdinalIgnoreCase))
            {
                var item = c.Items.FirstOrDefault(i => i.ItemId == clue.Source);
                if (item is not null)
                {
                    item.UnlockClueIds.Add(clue.ClueId);
                    fixes.Add($"Clue '{clue.ClueId}' is now unlocked by its source item '{item.ItemId}'.");
                }
            }
            else if (string.Equals(clue.SourceType, "dialogue", StringComparison.OrdinalIgnoreCase))
            {
                var dialogue = c.Dialogues.FirstOrDefault(d => d.DialogueId == clue.Source);
                if (dialogue is not null)
                {
                    dialogue.UnlockClueIds.Add(clue.ClueId);
                    fixes.Add($"Clue '{clue.ClueId}' is now unlocked by its source dialogue '{dialogue.DialogueId}'.");
                }
            }
        }
    }

    /// <summary>Scene items must be clickable: add hotspots for items without one and register hotspot targets in itemIds.</summary>
    private static void EnsureHotspots(GameCase c, List<string> fixes)
    {
        foreach (var scene in c.Stages.SelectMany(s => s.Scenes))
        {
            foreach (var hotspot in scene.Hotspots.Where(h =>
                         h.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase)
                         && c.Items.Any(i => i.ItemId == h.TargetId)
                         && !scene.ItemIds.Contains(h.TargetId)))
            {
                scene.ItemIds.Add(hotspot.TargetId);
                fixes.Add($"Scene '{scene.SceneId}' itemIds now includes hotspot target '{hotspot.TargetId}'.");
            }

            var missing = scene.ItemIds
                .Where(itemId => c.Items.Any(i => i.ItemId == itemId))
                .Where(itemId => !scene.Hotspots.Any(h =>
                    h.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase) && h.TargetId == itemId))
                .ToList();

            for (var i = 0; i < missing.Count; i++)
            {
                var item = c.Items.First(it => it.ItemId == missing[i]);
                scene.Hotspots.Add(new SceneHotspot
                {
                    HotspotId = $"hotspot-auto-{scene.SceneId}-{i + 1}",
                    Type = "ITEM",
                    TargetId = item.ItemId,
                    X = 18 + (i % 4) * 20,
                    Y = 55 + (i / 4) * 18,
                    Width = 10,
                    Height = 12,
                    ZIndex = 1,
                    Label = item.Name,
                    RequiredClueIds = new List<string>()
                });
                fixes.Add($"Added missing hotspot for item '{item.ItemId}' in scene '{scene.SceneId}'.");
            }

            // Hotspot percent coordinates that are out of range get clamped.
            foreach (var h in scene.Hotspots)
            {
                var clamped = (X: Math.Clamp(h.X, 0, 95), Y: Math.Clamp(h.Y, 0, 95),
                    W: Math.Clamp(h.Width <= 0 ? 8 : h.Width, 2, 40), H: Math.Clamp(h.Height <= 0 ? 8 : h.Height, 2, 40));
                if (Math.Abs(clamped.X - h.X) > 0.01 || Math.Abs(clamped.Y - h.Y) > 0.01
                    || Math.Abs(clamped.W - h.Width) > 0.01 || Math.Abs(clamped.H - h.Height) > 0.01)
                {
                    (h.X, h.Y, h.Width, h.Height) = clamped;
                    fixes.Add($"Clamped hotspot '{h.HotspotId}' coordinates to valid percentages.");
                }
            }
        }
    }

    private static void EnsureEvidenceFlags(GameCase c, List<string> fixes)
    {
        foreach (var evidenceId in c.FinalLogic.RequiredEvidenceIds)
        {
            var clue = c.Clues.FirstOrDefault(cl => cl.ClueId == evidenceId);
            if (clue is not null && !clue.IsEvidence)
            {
                clue.IsEvidence = true;
                fixes.Add($"Marked final evidence clue '{clue.ClueId}' with isEvidence: true.");
            }
        }
    }

    /// <summary>
    /// Simulates the linear playthrough and relaxes requirements that can never be met at the
    /// point they are needed (requirements referencing clues only discoverable later, or never).
    /// </summary>
    private static void RelaxUnreachableRequirements(GameCase c, List<string> fixes)
    {
        var itemById = c.Items.ToDictionary(x => x.ItemId, x => x);
        var unlockedClues = new HashSet<string>();
        var inspectedItems = new HashSet<string>();
        var askedDialogues = new HashSet<string>();

        foreach (var stage in c.Stages.OrderBy(s => s.Order))
        {
            foreach (var scene in stage.Scenes)
            {
                // Up to a few relaxation rounds per scene.
                for (var round = 0; round < 6; round++)
                {
                    RunFixpoint(c, scene, itemById, inspectedItems, unlockedClues, askedDialogues);
                    if (CaseValidationService.IsConditionSatisfied(scene.CompleteCondition, inspectedItems, unlockedClues, askedDialogues))
                    {
                        break;
                    }

                    var changed = false;

                    // Required dialogues blocked by clues that are not available: drop those clue requirements.
                    foreach (var dialogueId in scene.CompleteCondition.RequiredDialogueIds.Where(d => !askedDialogues.Contains(d)))
                    {
                        var dialogue = c.Dialogues.FirstOrDefault(d => d.DialogueId == dialogueId);
                        if (dialogue is null) continue;

                        if (!scene.CharacterIds.Contains(dialogue.CharacterId))
                        {
                            scene.CharacterIds.Add(dialogue.CharacterId);
                            fixes.Add($"Added character '{dialogue.CharacterId}' to scene '{scene.SceneId}' so required dialogue '{dialogueId}' is reachable.");
                            changed = true;
                            continue;
                        }

                        var blocked = dialogue.RequiredClueIds.Where(cl => !unlockedClues.Contains(cl)).ToList();
                        if (blocked.Count > 0)
                        {
                            dialogue.RequiredClueIds.RemoveAll(blocked.Contains);
                            fixes.Add($"Dialogue '{dialogueId}' no longer requires unavailable clue(s) {string.Join(", ", blocked)}.");
                            changed = true;
                        }
                    }

                    // Required items blocked by locked hotspots: unlock the hotspot requirements that cannot be met.
                    foreach (var itemId in scene.CompleteCondition.RequiredItemIds.Where(i => !inspectedItems.Contains(i)))
                    {
                        if (!scene.ItemIds.Contains(itemId) && itemById.ContainsKey(itemId))
                        {
                            scene.ItemIds.Add(itemId);
                            fixes.Add($"Scene '{scene.SceneId}' itemIds now includes required item '{itemId}'.");
                            changed = true;
                        }

                        var hotspot = scene.Hotspots.FirstOrDefault(h =>
                            h.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase) && h.TargetId == itemId);
                        var blocked = hotspot?.RequiredClueIds.Where(cl => !unlockedClues.Contains(cl)).ToList();
                        if (blocked is { Count: > 0 })
                        {
                            hotspot!.RequiredClueIds.RemoveAll(blocked.Contains);
                            fixes.Add($"Hotspot '{hotspot.HotspotId}' no longer requires unavailable clue(s) {string.Join(", ", blocked)}.");
                            changed = true;
                        }
                    }

                    if (changed) continue;

                    // Last resort: remove requirements that are simply unreachable.
                    var unreachableClues = scene.CompleteCondition.RequiredClueIds.Where(cl => !unlockedClues.Contains(cl)).ToList();
                    var unreachableItems = scene.CompleteCondition.RequiredItemIds.Where(i => !inspectedItems.Contains(i) && !scene.ItemIds.Contains(i)).ToList();
                    var unreachableDialogues = scene.CompleteCondition.RequiredDialogueIds.Where(d => !askedDialogues.Contains(d) && c.Dialogues.All(x => x.DialogueId != d)).ToList();

                    RunFixpoint(c, scene, itemById, inspectedItems, unlockedClues, askedDialogues);
                    unreachableClues = scene.CompleteCondition.RequiredClueIds.Where(cl => !unlockedClues.Contains(cl)).ToList();

                    if (unreachableClues.Count + unreachableItems.Count + unreachableDialogues.Count == 0)
                    {
                        break; // nothing left to relax; the validator will report what remains
                    }

                    scene.CompleteCondition.RequiredClueIds.RemoveAll(unreachableClues.Contains);
                    scene.CompleteCondition.RequiredItemIds.RemoveAll(unreachableItems.Contains);
                    scene.CompleteCondition.RequiredDialogueIds.RemoveAll(unreachableDialogues.Contains);
                    if (unreachableClues.Count > 0)
                        fixes.Add($"Scene '{scene.SceneId}' completion no longer requires unreachable clue(s) {string.Join(", ", unreachableClues)}.");
                    if (unreachableItems.Count > 0)
                        fixes.Add($"Scene '{scene.SceneId}' completion no longer requires unreachable item(s) {string.Join(", ", unreachableItems)}.");
                    if (unreachableDialogues.Count > 0)
                        fixes.Add($"Scene '{scene.SceneId}' completion no longer requires unknown dialogue(s) {string.Join(", ", unreachableDialogues)}.");
                }
            }
        }
    }

    private static void RunFixpoint(
        GameCase c,
        CaseScene scene,
        IReadOnlyDictionary<string, CaseItem> itemById,
        HashSet<string> inspectedItems,
        HashSet<string> unlockedClues,
        HashSet<string> askedDialogues)
    {
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
    }

    /// <summary>Final evidence that is still undiscoverable after repairs gets dropped (keeping at least one).</summary>
    private static void EnsureDiscoverableFinalEvidence(GameCase c, List<string> fixes)
    {
        var unlockedClues = new HashSet<string>();
        var inspectedItems = new HashSet<string>();
        var askedDialogues = new HashSet<string>();
        var itemById = c.Items.ToDictionary(x => x.ItemId, x => x);
        foreach (var stage in c.Stages.OrderBy(s => s.Order))
        {
            foreach (var scene in stage.Scenes)
            {
                RunFixpoint(c, scene, itemById, inspectedItems, unlockedClues, askedDialogues);
            }
        }

        var undiscoverable = c.FinalLogic.RequiredEvidenceIds.Where(id => !unlockedClues.Contains(id)).ToList();
        if (undiscoverable.Count == 0) return;

        var remaining = c.FinalLogic.RequiredEvidenceIds.Except(undiscoverable).ToList();
        if (remaining.Count == 0)
        {
            // Promote up to three discoverable critical clues to final evidence instead.
            var promoted = c.Clues
                .Where(cl => unlockedClues.Contains(cl.ClueId) && !cl.IsRedHerring)
                .OrderByDescending(cl => cl.IsEvidence)
                .ThenByDescending(cl => cl.IsCritical)
                .Take(3)
                .ToList();
            foreach (var clue in promoted) clue.IsEvidence = true;
            remaining = promoted.Select(cl => cl.ClueId).ToList();
            fixes.Add($"Replaced undiscoverable final evidence with discoverable clue(s) {string.Join(", ", remaining)}.");
        }
        else
        {
            fixes.Add($"Removed undiscoverable final evidence clue(s) {string.Join(", ", undiscoverable)}.");
        }

        c.FinalLogic.RequiredEvidenceIds = remaining;
    }
}
