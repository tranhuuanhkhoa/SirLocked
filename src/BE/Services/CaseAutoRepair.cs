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
    /// <summary>
    /// Contract-v2 safe repair: fills presentation metadata only. It never changes sources,
    /// unlocks, requirements, evidence flags, culprit, proof, or progression semantics.
    /// </summary>
    public static List<string> RepairMechanicalMetadata(GameCase c)
    {
        var fixes = new List<string>();
        NormalizeVisualMetadata(c, fixes);
        return fixes;
    }

    public static List<string> Repair(GameCase c)
    {
        var fixes = new List<string>();

        NormalizeVisualMetadata(c, fixes);
        NormalizeUnsupportedHotspots(c, fixes);
        EnsureSourceUnlocks(c, fixes);
        EnsureHotspots(c, fixes);
        EnsureEvidenceFlags(c, fixes);
        if (!HasCameraClues(c))
        {
            RelaxUnreachableRequirements(c, fixes);
            EnsureDiscoverableFinalEvidence(c, fixes);
        }

        return fixes;
    }

    private static void NormalizeVisualMetadata(GameCase c, List<string> fixes)
    {
        foreach (var character in c.Characters.Where(character => string.IsNullOrWhiteSpace(character.VisualDescription)))
        {
            character.VisualDescription = FirstNonBlank(character.Description, character.Role, character.Name);
            fixes.Add($"Added visualDescription to character '{character.CharacterId}'.");
        }

        foreach (var item in c.Items)
        {
            if (string.IsNullOrWhiteSpace(item.VisualDescription))
            {
                item.VisualDescription = FirstNonBlank(item.Description, item.Name, item.ItemId);
                fixes.Add($"Added visualDescription to item '{item.ItemId}'.");
            }
            if (!CaseItemRenderModes.All.Contains(item.RenderMode))
            {
                item.RenderMode = CaseItemRenderModes.Infer(item);
                fixes.Add($"Set renderMode '{item.RenderMode}' on item '{item.ItemId}'.");
            }
        }
    }

    private static bool HasCameraClues(GameCase c) =>
        c.Clues.Any(cl =>
            string.Equals(cl.DiscoverMethod, "camera", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(cl.SourceType, "camera", StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// LLMs sometimes invent hotspot type TARGET for physical puzzle targets such as hatches,
    /// panels, or dials. Runtime hotspots only support ITEM/CHARACTER, so convert those targets
    /// into non-collectible interactive items and retarget interactions/puzzles to the item.
    /// </summary>
    private static void NormalizeUnsupportedHotspots(GameCase c, List<string> fixes)
    {
        var existingItemIds = c.Items
            .Where(item => !string.IsNullOrWhiteSpace(item.ItemId))
            .Select(item => item.ItemId)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var scene in c.Stages.SelectMany(stage => stage.Scenes))
        {
            foreach (var hotspot in scene.Hotspots)
            {
                var type = hotspot.Type?.Trim();
                if (type is null || type.Equals("ITEM", StringComparison.OrdinalIgnoreCase) || type.Equals("CHARACTER", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (type.Equals("TARGET", StringComparison.OrdinalIgnoreCase)
                    || type.Equals("OBJECT", StringComparison.OrdinalIgnoreCase)
                    || type.Equals("DOOR", StringComparison.OrdinalIgnoreCase)
                    || type.Equals("MECHANISM", StringComparison.OrdinalIgnoreCase)
                    || type.Equals("LOCATION", StringComparison.OrdinalIgnoreCase))
                {
                    var oldTargetId = hotspot.TargetId;
                    var newItemId = ExistingOrNewItemId(c, existingItemIds, oldTargetId, hotspot.HotspotId);
                    var label = FirstNonBlank(hotspot.Label, HumanizeId(oldTargetId), HumanizeId(hotspot.HotspotId), "Interactive target");

                    if (c.Items.All(item => item.ItemId != newItemId))
                    {
                        c.Items.Add(new CaseItem
                        {
                            ItemId = newItemId,
                            Name = label,
                            Description = $"Interactive target in {scene.Title}.",
                            InspectText = $"This {label.ToLowerInvariant()} can be examined and used by the investigation.",
                            VisualDescription = $"Built-in {label.ToLowerInvariant()} integrated into the scene architecture, operated through one clear physical control with no letters, numbers, labels or display text.",
                            RenderMode = CaseItemRenderModes.Embedded,
                            ImageUrl = string.Empty,
                            IsCollectible = false,
                            IsInteractivePuzzleObject = true,
                            InteractionPurpose = CaseItemInteractionPurposes.OperateMechanism,
                            InteractionReason = "AI generated this as a scene target; the game engine represents clickable targets as interactive items."
                        });
                        existingItemIds.Add(newItemId);
                        fixes.Add($"Converted unsupported hotspot target '{oldTargetId}' into item '{newItemId}'.");
                    }

                    if (!scene.ItemIds.Contains(newItemId))
                    {
                        scene.ItemIds.Add(newItemId);
                    }

                    hotspot.Type = "ITEM";
                    hotspot.TargetId = newItemId;
                    hotspot.Label = label;

                    RetargetMechanicTargets(c, oldTargetId, hotspot.HotspotId, newItemId, fixes);
                    continue;
                }

                hotspot.Type = "ITEM";
                fixes.Add($"Normalized unsupported hotspot type '{type}' on '{hotspot.HotspotId}' to ITEM.");
            }
        }
    }

    private static string ExistingOrNewItemId(GameCase c, HashSet<string> existingItemIds, string targetId, string hotspotId)
    {
        if (!string.IsNullOrWhiteSpace(targetId) && existingItemIds.Contains(targetId))
        {
            return targetId;
        }

        var source = FirstNonBlank(targetId, hotspotId, "target");
        var baseId = source.StartsWith("item-", StringComparison.OrdinalIgnoreCase)
            ? SlugId(source)
            : $"item-{SlugId(source.StartsWith("hotspot-", StringComparison.OrdinalIgnoreCase) ? source["hotspot-".Length..] : source)}";

        if (!existingItemIds.Contains(baseId) && c.Items.All(item => item.ItemId != baseId))
        {
            return baseId;
        }

        for (var i = 2; i < 1000; i++)
        {
            var candidate = $"{baseId}-{i}";
            if (!existingItemIds.Contains(candidate) && c.Items.All(item => item.ItemId != candidate))
            {
                return candidate;
            }
        }

        return $"item-target-{Guid.NewGuid():N}";
    }

    private static void RetargetMechanicTargets(GameCase c, string oldTargetId, string hotspotId, string newItemId, List<string> fixes)
    {
        var oldIds = new[] { oldTargetId, hotspotId }
            .Where(id => !string.IsNullOrWhiteSpace(id) && id != newItemId)
            .Distinct(StringComparer.Ordinal)
            .ToHashSet(StringComparer.Ordinal);
        if (oldIds.Count == 0) return;

        foreach (var interaction in c.Interactions.Where(interaction => oldIds.Contains(interaction.TargetId)))
        {
            var old = interaction.TargetId;
            interaction.TargetId = newItemId;
            fixes.Add($"Interaction '{interaction.InteractionId}' target changed from '{old}' to '{newItemId}'.");
        }

        foreach (var puzzle in c.Puzzles.Where(puzzle => oldIds.Contains(puzzle.TargetId)))
        {
            var old = puzzle.TargetId;
            puzzle.TargetId = newItemId;
            fixes.Add($"Puzzle '{puzzle.PuzzleId}' target changed from '{old}' to '{newItemId}'.");
        }
    }

    private static string SlugId(string value)
    {
        var chars = value.Trim().ToLowerInvariant()
            .Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')
            .ToArray();
        var slug = string.Join('-', new string(chars)
            .Split('-', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return string.IsNullOrWhiteSpace(slug) ? "target" : slug;
    }

    private static string HumanizeId(string value)
    {
        var source = value;
        if (source.StartsWith("hotspot-", StringComparison.OrdinalIgnoreCase)) source = source["hotspot-".Length..];
        if (source.StartsWith("item-", StringComparison.OrdinalIgnoreCase)) source = source["item-".Length..];
        var words = source.Split(new[] { '-', '_' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return words.Length == 0
            ? string.Empty
            : string.Join(' ', words.Select(word => char.ToUpperInvariant(word[0]) + word[1..]));
    }

    private static string FirstNonBlank(params string[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

    /// <summary>A clue that nothing unlocks but that declares a valid source gets attached to that source.</summary>
    private static void EnsureSourceUnlocks(GameCase c, List<string> fixes)
    {
        foreach (var clue in c.Clues)
        {
            var unlockedAnywhere = c.Items.Any(i => i.UnlockClueIds.Contains(clue.ClueId))
                || c.Dialogues.Any(d => d.UnlockClueIds.Contains(clue.ClueId))
                || c.ConversationNodes.Any(node => node.UnlockClueIds.Contains(clue.ClueId))
                || c.EvidenceChallenges.Any(challenge => challenge.UnlockClueIds.Contains(clue.ClueId))
                || c.Deductions.Any(deduction => deduction.UnlockClueIds.Contains(clue.ClueId));
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
        foreach (var evidenceId in c.FinalLogic.RequiredEvidenceLinks.Select(link => link.EvidenceId))
        {
            var clue = c.Clues.FirstOrDefault(candidate => candidate.ClueId == evidenceId);
            if (clue is not null && !clue.IsEvidence)
            {
                clue.IsEvidence = true;
                fixes.Add($"Marked V2 final evidence clue '{clue.ClueId}' with isEvidence: true.");
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
        var visitedConversationNodes = new HashSet<string>();
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
                foreach (var clue in challenge.UnlockClueIds)
                {
                    if (unlockedClues.Add(clue)) progressed = true;
                }
            }

            foreach (var deduction in c.Deductions)
            {
                if (!deduction.RequiredClueIds.All(unlockedClues.Contains)) continue;
                if (!deduction.RequiredChallengeIds.All(challengeId =>
                    c.EvidenceChallenges.Where(challenge => challenge.ChallengeId == challengeId)
                        .SelectMany(challenge => challenge.UnlockClueIds)
                        .All(unlockedClues.Contains))) continue;
                foreach (var clue in deduction.UnlockClueIds)
                {
                    if (unlockedClues.Add(clue)) progressed = true;
                }
            }

            foreach (var node in c.ConversationNodes)
            {
                if (visitedConversationNodes.Contains(node.NodeId)) continue;
                if (!scene.CharacterIds.Contains(node.CharacterId)) continue;
                if (!node.RequiredClueIds.All(unlockedClues.Contains)) continue;
                visitedConversationNodes.Add(node.NodeId);
                foreach (var clue in node.UnlockClueIds)
                {
                    if (unlockedClues.Add(clue)) progressed = true;
                }
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
