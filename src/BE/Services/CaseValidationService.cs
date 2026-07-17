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
        ValidateVisualContract(gameCase, result, stage);
        ValidateDuplicateIds(gameCase, result);
        ValidateReferences(gameCase, result, stage);
        ValidateCameraEmbeddedItems(gameCase, result);
        ValidateClues(gameCase, result, stage);
        ValidateFinalLogic(gameCase, result);
        ValidateInvestigationV2(gameCase, result);

        // Only simulate progression when the structure itself is sound; otherwise the
        // reference errors above already explain what is broken.
        if (result.IsValid)
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
        if (c.ConversationNodes.Count > 0 && c.MechanicsVersion < CaseMechanicsVersions.InvestigationV2)
            result.Add("InvalidValue", "conversationNodes", "conversationNodes require mechanicsVersion 2.");

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
        CheckDuplicates(result, "conversationNodes", c.ConversationNodes.Select(x => x.NodeId), "nodeId");
        CheckDuplicates(result, "evidenceChallenges", c.EvidenceChallenges.Select(x => x.ChallengeId), "challengeId");
        CheckDuplicates(result, "deductions", c.Deductions.Select(x => x.DeductionId), "deductionId");
        CheckDuplicates(result, "requiredTeamworkChains", c.RequiredTeamworkChains.Select(x => x.ChainId), "chainId");
        CheckDuplicates(result, "hints", c.Hints.Select(x => x.HintId), "hintId");
        CheckDuplicates(result, "interactions", c.Interactions.Select(x => x.InteractionId), "interactionId");
        CheckDuplicates(result, "puzzles", c.Puzzles.Select(x => x.PuzzleId), "puzzleId");
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
        var itemById = c.Items
            .Where(item => !string.IsNullOrWhiteSpace(item.ItemId))
            .GroupBy(item => item.ItemId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var characterIds = c.Characters.Select(x => x.CharacterId).ToHashSet();
        var sceneIds = c.Stages.SelectMany(stage => stage.Scenes).Select(scene => scene.SceneId).ToHashSet();
        var clueIds = c.Clues.Select(x => x.ClueId).ToHashSet();
        var dialogueIds = c.Dialogues.Select(x => x.DialogueId).ToHashSet();
        var conversationNodeIds = c.ConversationNodes.Select(x => x.NodeId).ToHashSet();
        var dialogueById = c.Dialogues
            .Where(dialogue => !string.IsNullOrWhiteSpace(dialogue.DialogueId))
            .GroupBy(dialogue => dialogue.DialogueId)
            .ToDictionary(group => group.Key, group => group.First());
        var challengeById = c.EvidenceChallenges
            .Where(challenge => !string.IsNullOrWhiteSpace(challenge.ChallengeId))
            .GroupBy(challenge => challenge.ChallengeId)
            .ToDictionary(group => group.Key, group => group.First());

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
                    ValidateRuntimeLayout(scene, scenePath, itemIds, itemById, characterIds, sceneIds, clueIds, result);
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

        for (var n = 0; n < c.ConversationNodes.Count; n++)
        {
            var node = c.ConversationNodes[n];
            var path = $"conversationNodes[{n}]";
            if (!characterIds.Contains(node.CharacterId))
                result.Add("MissingReference", $"{path}.characterId", "Conversation node character does not exist.", node.CharacterId);
            foreach (var clueId in node.RequiredClueIds.Where(id => !clueIds.Contains(id)))
                result.Add("MissingReference", $"{path}.requiredClueIds", "Conversation node required clue does not exist.", clueId);
            foreach (var clueId in node.UnlockClueIds.Where(id => !clueIds.Contains(id)))
                result.Add("MissingReference", $"{path}.unlockClueIds", "Conversation node unlock clue does not exist.", clueId);
            if (!string.IsNullOrWhiteSpace(node.ChallengeId))
            {
                if (!challengeById.TryGetValue(node.ChallengeId, out var challenge))
                {
                    result.Add("MissingReference", $"{path}.challengeId", "Conversation node challenge does not exist.", node.ChallengeId);
                }
                else if (dialogueById.TryGetValue(challenge.DialogueId, out var dialogue)
                    && dialogue.CharacterId != node.CharacterId)
                {
                    result.Add("InvalidValue", $"{path}.challengeId", "Conversation node challenge must belong to the same character.", node.ChallengeId);
                }
            }

            for (var ch = 0; ch < node.Choices.Count; ch++)
            {
                var choice = node.Choices[ch];
                var choicePath = $"{path}.choices[{ch}]";
                foreach (var clueId in choice.RequiredClueIds.Where(id => !clueIds.Contains(id)))
                    result.Add("MissingReference", $"{choicePath}.requiredClueIds", "Conversation choice required clue does not exist.", clueId);
                if (!string.IsNullOrWhiteSpace(choice.NextNodeId) && !conversationNodeIds.Contains(choice.NextNodeId))
                    result.Add("MissingReference", $"{choicePath}.nextNodeId", "Conversation choice target node does not exist.", choice.NextNodeId);
            }
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

        var visibleTargets = c.Stages
            .SelectMany(stage => stage.Scenes)
            .SelectMany(scene => scene.ItemIds
                .Concat(scene.CharacterIds)
                .Concat(scene.Hotspots.Select(hotspot => hotspot.TargetId))
                .Concat(scene.Runtime?.Transitions.SelectMany(t => new[] { t.TransitionId, t.TargetSceneId }) ?? Array.Empty<string>()))
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet();
        ValidateInteractions(c, itemIds, clueIds, sceneIds, visibleTargets, result);
        ValidatePuzzles(c, itemIds, clueIds, sceneIds, visibleTargets, result);
    }

    private static void ValidateVisualContract(GameCase c, CaseValidationResult result, CaseValidationStage stage)
    {
        if (!CaseLanguages.All.Contains(c.Language))
            result.Add("InvalidValue", "language", "language must be 'en' or 'vi'.", c.Language);
        if (c.ArtStyle != AiVisualStyleDefaults.ArtStyle)
            result.Add("InvalidValue", "art_style", $"art_style must be '{AiVisualStyleDefaults.ArtStyle}'.", c.ArtStyle);
        if (c.SubStyle != AiVisualStyleDefaults.SubStyle)
            result.Add("InvalidValue", "sub_style", $"sub_style must be '{AiVisualStyleDefaults.SubStyle}'.", c.SubStyle);
        if (c.CharacterStyle != AiVisualStyleDefaults.CharacterStyle)
            result.Add("InvalidValue", "character_style", $"character_style must be '{AiVisualStyleDefaults.CharacterStyle}'.", c.CharacterStyle);

        var usesV5Metadata = c.Characters.Any(character => !string.IsNullOrWhiteSpace(character.VisualDescription))
            || c.Items.Any(item => !string.IsNullOrWhiteSpace(item.RenderMode));
        if (!usesV5Metadata) return;

        for (var i = 0; i < c.Characters.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(c.Characters[i].VisualDescription))
                result.Add("MissingField", $"characters[{i}].visualDescription", "v5 characters require a visualDescription.", c.Characters[i].CharacterId);
        }

        for (var i = 0; i < c.Items.Count; i++)
        {
            var item = c.Items[i];
            if (string.IsNullOrWhiteSpace(item.VisualDescription))
                result.Add("MissingField", $"items[{i}].visualDescription", "v5 items require a visualDescription.", item.ItemId);
            if (!CaseItemRenderModes.All.Contains(item.RenderMode))
            {
                result.Add("InvalidValue", $"items[{i}].renderMode", "renderMode must be CUTOUT or EMBEDDED.", item.ItemId);
                continue;
            }

            if (item.RenderMode.Equals(CaseItemRenderModes.Embedded, StringComparison.OrdinalIgnoreCase))
            {
                if (item.IsCollectible || item.InteractionPurpose != CaseItemInteractionPurposes.OperateMechanism)
                    result.Add("InvalidValue", $"items[{i}].renderMode", "EMBEDDED items must be non-collectible operate-mechanism targets.", item.ItemId);
                if (stage == CaseValidationStage.Publish && !string.IsNullOrWhiteSpace(item.ImageUrl))
                    result.Add("InvalidValue", $"items[{i}].imageUrl", "EMBEDDED items must not have an overlay imageUrl.", item.ItemId);
            }
        }
    }

    private static void ValidateInteractions(
        GameCase c,
        IReadOnlySet<string> itemIds,
        IReadOnlySet<string> clueIds,
        IReadOnlySet<string> sceneIds,
        IReadOnlySet<string> visibleTargets,
        CaseValidationResult result)
    {
        for (var i = 0; i < c.Interactions.Count; i++)
        {
            var interaction = c.Interactions[i];
            var path = $"interactions[{i}]";
            if (string.IsNullOrWhiteSpace(interaction.InteractionId))
                result.Add("MissingField", $"{path}.interactionId", "interactionId is required.");
            if (!CaseInteractionTypes.All.Contains(interaction.Type))
                result.Add("InvalidValue", $"{path}.type", "Interaction type is not supported by the gameplay engine.", interaction.Type);

            var isCombine = interaction.Type.Equals(CaseInteractionTypes.CombineItems, StringComparison.OrdinalIgnoreCase);
            if (!isCombine && string.IsNullOrWhiteSpace(interaction.TargetId))
                result.Add("MissingField", $"{path}.targetId", "targetId is required for scene interactions.", interaction.InteractionId);
            if (!isCombine && !visibleTargets.Contains(interaction.TargetId))
                result.Add("MissingReference", $"{path}.targetId", "Interaction target must be visible in a scene hotspot, item list, character list, or transition.", interaction.TargetId);

            if (interaction.Type.Equals(CaseInteractionTypes.UseItemOnTarget, StringComparison.OrdinalIgnoreCase)
                && interaction.RequiredItemIds.Count == 0)
                result.Add("MissingField", $"{path}.requiredItemIds", "USE_ITEM_ON_TARGET requires at least one inventory item.", interaction.InteractionId);
            if (isCombine && interaction.RequiredItemIds.Count < 2)
                result.Add("MissingField", $"{path}.requiredItemIds", "COMBINE_ITEMS requires at least two inventory items.", interaction.InteractionId);

            AddMissingReferences(result, $"{path}.requiredItemIds", interaction.RequiredItemIds, itemIds, "Required item does not exist.");
            AddMissingReferences(result, $"{path}.unlockItemIds", interaction.UnlockItemIds, itemIds, "Unlock item does not exist.");
            AddMissingReferences(result, $"{path}.consumeItemIds", interaction.ConsumeItemIds, itemIds, "Consumed item does not exist.");
            AddMissingReferences(result, $"{path}.requiredClueIds", interaction.RequiredClueIds, clueIds, "Required clue does not exist.");
            AddMissingReferences(result, $"{path}.unlockClueIds", interaction.UnlockClueIds, clueIds, "Unlock clue does not exist.");
            AddMissingReferences(result, $"{path}.unlockSceneIds", interaction.UnlockSceneIds, sceneIds, "Unlock scene does not exist.");
        }
    }

    private static void ValidatePuzzles(
        GameCase c,
        IReadOnlySet<string> itemIds,
        IReadOnlySet<string> clueIds,
        IReadOnlySet<string> sceneIds,
        IReadOnlySet<string> visibleTargets,
        CaseValidationResult result)
    {
        for (var i = 0; i < c.Puzzles.Count; i++)
        {
            var puzzle = c.Puzzles[i];
            var path = $"puzzles[{i}]";
            if (string.IsNullOrWhiteSpace(puzzle.PuzzleId))
                result.Add("MissingField", $"{path}.puzzleId", "puzzleId is required.");
            if (!CasePuzzleTypes.All.Contains(puzzle.Type))
                result.Add("InvalidValue", $"{path}.type", "Puzzle type is not supported by the gameplay engine.", puzzle.Type);
            if (string.IsNullOrWhiteSpace(puzzle.TargetId))
                result.Add("MissingField", $"{path}.targetId", "targetId is required.", puzzle.PuzzleId);
            else if (!visibleTargets.Contains(puzzle.TargetId))
                result.Add("MissingReference", $"{path}.targetId", "Puzzle target must be visible in a scene hotspot, item list, character list, or transition.", puzzle.TargetId);
            if (string.IsNullOrWhiteSpace(puzzle.Prompt))
                result.Add("MissingField", $"{path}.prompt", "Puzzle prompt is required.", puzzle.PuzzleId);

            if (puzzle.Options.Count > 12)
                result.Add("InvalidValue", $"{path}.options", "Puzzle options are capped at 12.", puzzle.PuzzleId);
            if (puzzle.CorrectSequence.Count > 8)
                result.Add("InvalidValue", $"{path}.correctSequence", "Puzzle answer sequence is capped at 8 entries.", puzzle.PuzzleId);

            if (puzzle.Type.Equals(CasePuzzleTypes.CodePuzzle, StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(puzzle.CorrectCode) || puzzle.CorrectCode.Length > 32)
                    result.Add("InvalidValue", $"{path}.correctCode", "CODE_PUZZLE requires a non-empty code up to 32 characters.", puzzle.PuzzleId);
            }
            else if (CasePuzzleTypes.All.Contains(puzzle.Type))
            {
                if (puzzle.Options.Count is < 2 or > 12)
                    result.Add("InvalidValue", $"{path}.options", "Sequence and symbol puzzles require 2-12 bounded options.", puzzle.PuzzleId);
                if (puzzle.CorrectSequence.Count == 0)
                    result.Add("MissingField", $"{path}.correctSequence", "Sequence and symbol puzzles require a bounded answer sequence.", puzzle.PuzzleId);
                foreach (var answer in puzzle.CorrectSequence.Where(answer => !puzzle.Options.Contains(answer)))
                    result.Add("MissingReference", $"{path}.correctSequence", "Puzzle answer must reference one of the declared options.", answer);
            }

            AddMissingReferences(result, $"{path}.requiredItemIds", puzzle.RequiredItemIds, itemIds, "Required item does not exist.");
            AddMissingReferences(result, $"{path}.unlockItemIds", puzzle.UnlockItemIds, itemIds, "Unlock item does not exist.");
            AddMissingReferences(result, $"{path}.requiredClueIds", puzzle.RequiredClueIds, clueIds, "Required clue does not exist.");
            AddMissingReferences(result, $"{path}.unlockClueIds", puzzle.UnlockClueIds, clueIds, "Unlock clue does not exist.");
            AddMissingReferences(result, $"{path}.unlockSceneIds", puzzle.UnlockSceneIds, sceneIds, "Unlock scene does not exist.");
        }
    }

    private static void AddMissingReferences(
        CaseValidationResult result,
        string path,
        IEnumerable<string> references,
        IReadOnlySet<string> knownIds,
        string message)
    {
        foreach (var id in references.Where(id => !knownIds.Contains(id)))
            result.Add("MissingReference", path, message, id);
    }

    private static void ValidateRuntimeLayout(
        CaseScene scene,
        string scenePath,
        IReadOnlySet<string> itemIds,
        IReadOnlyDictionary<string, CaseItem> itemById,
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
            if (itemById.TryGetValue(placement.ItemId, out var item))
            {
                var hasExplicitRenderMode = CaseItemRenderModes.All.Contains(item.RenderMode);
                var renderMode = hasExplicitRenderMode
                    ? item.RenderMode.ToUpperInvariant()
                    : CaseItemRenderModes.Infer(item);
                if (renderMode == CaseItemRenderModes.Cutout
                    && (placement.Size.Width > 160 || placement.Size.Height > 160))
                {
                    result.Add("OversizedCutout", $"{path}.size", "CUTOUT item runtime size must not exceed 160x160 pixels.", placement.ItemId);
                }
                if (hasExplicitRenderMode
                    && renderMode == CaseItemRenderModes.Embedded
                    && !string.IsNullOrWhiteSpace(placement.Asset))
                {
                    result.Add("InvalidValue", $"{path}.asset", "EMBEDDED item placements must not use an overlay asset.", placement.ItemId);
                }
            }
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
            var captureWidth = runtime.CameraRules.CaptureRectWidth > 0 ? runtime.CameraRules.CaptureRectWidth : 180;
            var captureHeight = runtime.CameraRules.CaptureRectHeight > 0 ? runtime.CameraRules.CaptureRectHeight : 140;
            var captureArea = captureWidth * captureHeight;
            var zoneArea = zone.Bounds.Width * zone.Bounds.Height;
            if (zone.Bounds.Width > captureWidth * 3
                || zone.Bounds.Height > captureHeight * 3
                || zoneArea > captureArea * 6)
            {
                result.Add("OversizedClueZone", $"{path}.bounds",
                    "Clue zone must tightly cover the visible clue and stay within 3x each capture dimension and 6x capture area.", zone.ClueId);
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
        var conversationNodeIds = c.ConversationNodes.Select(node => node.NodeId).ToHashSet();
        var interactionIds = c.Interactions.Select(interaction => interaction.InteractionId).ToHashSet();
        var puzzleIds = c.Puzzles.Select(puzzle => puzzle.PuzzleId).ToHashSet();
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

            if (discoverMethod is not ("item" or "dialogue" or "camera" or "conversation" or "interaction" or "puzzle"))
            {
                result.Add("InvalidValue", $"clues[{i}].discoverMethod", "Clue discoverMethod must be 'item', 'dialogue', 'camera', 'conversation', 'interaction', or 'puzzle'.", clue.ClueId);
            }

            if (sourceType is not ("item" or "dialogue" or "camera" or "conversation" or "interaction" or "puzzle"))
            {
                result.Add("InvalidValue", $"clues[{i}].sourceType", "Clue sourceType must be 'item', 'dialogue', 'camera', 'conversation', 'interaction', or 'puzzle'.", clue.ClueId);
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
            if (sourceType == "conversation" && !conversationNodeIds.Contains(clue.Source))
            {
                result.Add("MissingReference", $"clues[{i}].source", "Clue source conversation node does not exist.", clue.Source);
            }
            if (sourceType == "interaction" && !interactionIds.Contains(clue.Source))
            {
                result.Add("MissingReference", $"clues[{i}].source", "Clue source interaction does not exist.", clue.Source);
            }
            if (sourceType == "puzzle" && !puzzleIds.Contains(clue.Source))
            {
                result.Add("MissingReference", $"clues[{i}].source", "Clue source puzzle does not exist.", clue.Source);
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
                if (!ClueVisualTextPolicies.All.Contains(clue.VisualTextPolicy))
                {
                    result.Add("InvalidValue", $"clues[{i}].visualTextPolicy",
                        "visualTextPolicy must be NO_TEXT or ABSTRACT_SYMBOLS.", clue.ClueId);
                }
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
        var collectedItems = new HashSet<string>();
        var askedDialogues = new HashSet<string>();
        var visitedConversationNodes = new HashSet<string>();
        var usedInteractions = new HashSet<string>();
        var solvedPuzzles = new HashSet<string>();
        var unlockedScenes = new HashSet<string>();

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
                        if (item.IsCollectible) collectedItems.Add(itemId);
                        foreach (var clue in item.UnlockClueIds) unlockedClues.Add(clue);
                        progressed = true;
                    }

                    foreach (var interaction in c.Interactions)
                    {
                        if (interaction.SingleUse && usedInteractions.Contains(interaction.InteractionId)) continue;
                        if (!CanApplyInteractionInScene(scene, interaction, collectedItems, unlockedClues)) continue;

                        usedInteractions.Add(interaction.InteractionId);
                        if (ApplyReachabilityEffects(interaction.UnlockClueIds, interaction.UnlockItemIds, interaction.UnlockSceneIds, interaction.ConsumeItemIds, unlockedClues, collectedItems, unlockedScenes))
                            progressed = true;
                    }

                    foreach (var puzzle in c.Puzzles)
                    {
                        if (solvedPuzzles.Contains(puzzle.PuzzleId)) continue;
                        if (!IsTargetInScene(scene, puzzle.TargetId)) continue;
                        if (!puzzle.RequiredItemIds.All(collectedItems.Contains)) continue;
                        if (!puzzle.RequiredClueIds.All(unlockedClues.Contains)) continue;

                        solvedPuzzles.Add(puzzle.PuzzleId);
                        if (ApplyReachabilityEffects(puzzle.UnlockClueIds, puzzle.UnlockItemIds, puzzle.UnlockSceneIds, Enumerable.Empty<string>(), unlockedClues, collectedItems, unlockedScenes))
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

                    foreach (var node in c.ConversationNodes)
                    {
                        if (visitedConversationNodes.Contains(node.NodeId)) continue;
                        if (!scene.CharacterIds.Contains(node.CharacterId)) continue;
                        if (!node.RequiredClueIds.All(unlockedClues.Contains)) continue;

                        visitedConversationNodes.Add(node.NodeId);
                        foreach (var clue in node.UnlockClueIds) unlockedClues.Add(clue);
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
            var unlockedByConversation = c.ConversationNodes.Any(node => node.UnlockClueIds.Contains(clue.ClueId));
            var unlockedByChallenge = c.EvidenceChallenges.Any(challenge => challenge.UnlockClueIds.Contains(clue.ClueId));
            var unlockedByDeduction = c.Deductions.Any(deduction => deduction.UnlockClueIds.Contains(clue.ClueId));
            var unlockedByInteraction = c.Interactions.Any(interaction => interaction.UnlockClueIds.Contains(clue.ClueId));
            var unlockedByPuzzle = c.Puzzles.Any(puzzle => puzzle.UnlockClueIds.Contains(clue.ClueId));
            var unlockedByCamera = DiscoverMethod(clue) == "camera"
                && (!hasCameraLayout || c.Stages.SelectMany(s => s.Scenes).Any(scene =>
                    scene.Runtime?.ClueZones.Any(zone => zone.ClueId == clue.ClueId) == true));
            if (!unlockedByItem && !unlockedByDialogue && !unlockedByConversation && !unlockedByChallenge && !unlockedByDeduction && !unlockedByInteraction && !unlockedByPuzzle && !unlockedByCamera)
            {
                result.Add("OrphanClue", $"clue:{clue.ClueId}",
                    $"Clue '{clue.ClueId}' is not unlocked by any item, dialogue, conversation node, challenge, deduction, interaction, puzzle, or camera clue zone.", clue.ClueId);
            }
        }

        foreach (var evidenceId in c.FinalLogic.RequiredEvidenceLinks.Select(link => link.EvidenceId).Where(id => !unlockedClues.Contains(id)))
        {
            result.Add("UndiscoverableEvidence", "finalLogic.requiredEvidenceLinks",
                $"Final evidence clue '{evidenceId}' is never unlocked by any reachable action.", evidenceId);
        }
    }

    private static bool CanApplyInteractionInScene(
        CaseScene scene,
        CaseInteraction interaction,
        IReadOnlySet<string> collectedItems,
        IReadOnlySet<string> unlockedClues)
    {
        if (!interaction.RequiredItemIds.All(collectedItems.Contains)) return false;
        if (!interaction.RequiredClueIds.All(unlockedClues.Contains)) return false;
        if (interaction.Type.Equals(CaseInteractionTypes.CombineItems, StringComparison.OrdinalIgnoreCase)) return true;
        if (interaction.Type.Equals(CaseInteractionTypes.UseItemOnTarget, StringComparison.OrdinalIgnoreCase)) return IsTargetInScene(scene, interaction.TargetId);
        return false;
    }

    private static bool ApplyReachabilityEffects(
        IEnumerable<string> unlockClueIds,
        IEnumerable<string> unlockItemIds,
        IEnumerable<string> unlockSceneIds,
        IEnumerable<string> consumeItemIds,
        HashSet<string> unlockedClues,
        HashSet<string> collectedItems,
        HashSet<string> unlockedScenes)
    {
        var progressed = false;
        foreach (var itemId in consumeItemIds)
        {
            if (collectedItems.Remove(itemId)) progressed = true;
        }
        foreach (var itemId in unlockItemIds)
        {
            if (collectedItems.Add(itemId)) progressed = true;
        }
        foreach (var sceneId in unlockSceneIds)
        {
            if (unlockedScenes.Add(sceneId)) progressed = true;
        }
        foreach (var clueId in unlockClueIds)
        {
            if (unlockedClues.Add(clueId)) progressed = true;
        }
        return progressed;
    }

    private static bool IsTargetInScene(CaseScene scene, string targetId) =>
        scene.ItemIds.Contains(targetId)
        || scene.CharacterIds.Contains(targetId)
        || scene.Hotspots.Any(hotspot => hotspot.TargetId == targetId)
        || (scene.Runtime?.Transitions.Any(transition => transition.TransitionId == targetId || transition.TargetSceneId == targetId) == true);

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

        if (c.ConversationNodes.Count > 0)
        {
            ValidateConversationTree(c, result);
        }

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

    private static void ValidateConversationTree(GameCase c, CaseValidationResult result)
    {
        var nodes = c.ConversationNodes;
        var nodeById = nodes
            .Where(node => !string.IsNullOrWhiteSpace(node.NodeId))
            .GroupBy(node => node.NodeId)
            .ToDictionary(group => group.Key, group => group.First());

        for (var i = 0; i < nodes.Count; i++)
        {
            var node = nodes[i];
            var path = $"conversationNodes[{i}]";
            if (string.IsNullOrWhiteSpace(node.NodeId))
                result.Add("MissingField", $"{path}.nodeId", "Conversation node nodeId is required.");
            if (string.IsNullOrWhiteSpace(node.CharacterId))
                result.Add("MissingField", $"{path}.characterId", "Conversation node characterId is required.", node.NodeId);
            if (node.Lines.Count == 0)
                result.Add("MissingField", $"{path}.lines", "Conversation node requires at least one line.", node.NodeId);

            for (var lineIndex = 0; lineIndex < node.Lines.Count; lineIndex++)
            {
                var line = node.Lines[lineIndex];
                var speaker = line.Speaker?.Trim().ToUpperInvariant();
                if (speaker is not (ConversationSpeakers.Npc or ConversationSpeakers.Detective))
                    result.Add("InvalidValue", $"{path}.lines[{lineIndex}].speaker", "Conversation line speaker must be NPC or DETECTIVE.", node.NodeId);
                if (string.IsNullOrWhiteSpace(line.Text))
                    result.Add("MissingField", $"{path}.lines[{lineIndex}].text", "Conversation line text is required.", node.NodeId);
            }

            CheckDuplicates(result, $"{path}.choices", node.Choices.Select(choice => choice.ChoiceId), "choiceId");
            for (var choiceIndex = 0; choiceIndex < node.Choices.Count; choiceIndex++)
            {
                var choice = node.Choices[choiceIndex];
                var choicePath = $"{path}.choices[{choiceIndex}]";
                if (string.IsNullOrWhiteSpace(choice.ChoiceId))
                    result.Add("MissingField", $"{choicePath}.choiceId", "Conversation choice choiceId is required.", node.NodeId);
                if (string.IsNullOrWhiteSpace(choice.Label))
                    result.Add("MissingField", $"{choicePath}.label", "Conversation choice label is required.", choice.ChoiceId);
                if (!string.IsNullOrWhiteSpace(choice.NextNodeId)
                    && nodeById.TryGetValue(choice.NextNodeId, out var target)
                    && target.CharacterId != node.CharacterId)
                {
                    result.Add("InvalidValue", $"{choicePath}.nextNodeId", "Conversation choice cannot target a node owned by another character.", choice.NextNodeId);
                }
            }
        }

        foreach (var group in nodes.GroupBy(node => node.CharacterId).Where(group => !string.IsNullOrWhiteSpace(group.Key)))
        {
            var roots = group.Where(node => node.IsRoot).ToList();
            if (roots.Count != 1)
            {
                result.Add("InvalidValue", "conversationNodes", $"Character '{group.Key}' must have exactly one root conversation node.", group.Key);
                continue;
            }

            var root = roots[0];
            if (root.Choices.Count == 0)
            {
                result.Add("MissingField", $"conversationNodes:{root.NodeId}.choices", "Root conversation node requires at least one topic choice.", root.NodeId);
            }

            var depths = ConversationDepths(root, group.ToList(), nodeById);
            foreach (var node in group)
            {
                if (!depths.TryGetValue(node.NodeId, out var depth))
                {
                    result.Add("UnreachableConversationNode", $"conversationNodes:{node.NodeId}", "Conversation node is not reachable from its character root.", node.NodeId);
                    continue;
                }

                if (depth > 2)
                {
                    result.Add("InvalidConversationDepth", $"conversationNodes:{node.NodeId}", "Conversation tree depth cannot exceed root -> topic -> follow-up.", node.NodeId);
                }

                if (depth >= 2 && node.Choices.Any(choice => !string.IsNullOrWhiteSpace(choice.NextNodeId)))
                {
                    result.Add("InvalidConversationDepth", $"conversationNodes:{node.NodeId}.choices", "Follow-up conversation nodes must return to root.", node.NodeId);
                }

                if (!ConversationCanReturnToRoot(node, nodeById, new HashSet<string>()))
                {
                    result.Add("ConversationSoftLock", $"conversationNodes:{node.NodeId}.choices", "Conversation node must have a path that returns to root.", node.NodeId);
                }
            }
        }
    }

    private static Dictionary<string, int> ConversationDepths(
        ConversationNode root,
        IReadOnlyCollection<ConversationNode> characterNodes,
        IReadOnlyDictionary<string, ConversationNode> nodeById)
    {
        var characterNodeIds = characterNodes.Select(node => node.NodeId).ToHashSet();
        var depths = new Dictionary<string, int>();
        var queue = new Queue<(ConversationNode Node, int Depth)>();
        queue.Enqueue((root, 0));

        while (queue.Count > 0)
        {
            var (node, depth) = queue.Dequeue();
            if (depths.TryGetValue(node.NodeId, out var currentDepth) && currentDepth <= depth) continue;
            depths[node.NodeId] = depth;

            foreach (var choice in node.Choices)
            {
                if (string.IsNullOrWhiteSpace(choice.NextNodeId)) continue;
                if (!characterNodeIds.Contains(choice.NextNodeId)) continue;
                if (nodeById.TryGetValue(choice.NextNodeId, out var next))
                {
                    queue.Enqueue((next, depth + 1));
                }
            }
        }

        return depths;
    }

    private static bool ConversationCanReturnToRoot(
        ConversationNode node,
        IReadOnlyDictionary<string, ConversationNode> nodeById,
        HashSet<string> seen)
    {
        if (!seen.Add(node.NodeId)) return false;
        if (node.Choices.Any(choice => string.IsNullOrWhiteSpace(choice.NextNodeId))) return true;

        foreach (var choice in node.Choices)
        {
            if (!string.IsNullOrWhiteSpace(choice.NextNodeId)
                && nodeById.TryGetValue(choice.NextNodeId, out var next)
                && ConversationCanReturnToRoot(next, nodeById, seen))
            {
                return true;
            }
        }

        return false;
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
