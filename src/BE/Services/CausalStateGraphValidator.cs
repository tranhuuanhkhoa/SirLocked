using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Contract-v2 path proof. Unlike the greedy validator, this explores alternative action orders,
/// including inventory consumption, and proves that at least one complete accusation state exists.
/// </summary>
internal static class CausalStateGraphValidator
{
    private const int StateLimit = 100_000;

    public static CaseValidationResult Validate(GameCase gameCase)
    {
        var result = new CaseValidationResult();
        if (gameCase.LogicContractVersion < CaseLogicContractVersions.CausalFiveClaim) return result;
        var scenes = GameRules.GetAuthoredScenes(gameCase);
        if (scenes.Count == 0) return result;

        var initial = new SearchState();
        initial.UnlockedScenes.Add(scenes[0].SceneId);
        initial.VisitedScenes.Add(scenes[0].SceneId);
        var queue = new PriorityQueue<SearchState, int>();
        var visited = new HashSet<string>(StringComparer.Ordinal) { initial.Signature() };
        var reachablePuzzles = new HashSet<string>(StringComparer.Ordinal);
        queue.Enqueue(initial, 0);
        var winFound = false;
        var limitReached = false;
        var optionalPuzzleCount = gameCase.Puzzles.Count(item =>
            item.ProgressionRole == PuzzleProgressionRoles.Optional);

        while (queue.Count > 0)
        {
            if (visited.Count >= StateLimit)
            {
                limitReached = true;
                break;
            }
            var state = queue.Dequeue();
            if (IsWin(gameCase, state))
            {
                winFound = true;
                // reachablePuzzles also contains required puzzles.  Compare only the
                // optional subset so a required puzzle cannot make this search stop
                // before every optional branch has been explored.
                var reachableOptionalPuzzleCount = gameCase.Puzzles.Count(puzzle =>
                    puzzle.ProgressionRole == PuzzleProgressionRoles.Optional
                    && reachablePuzzles.Contains(puzzle.PuzzleId));
                if (reachableOptionalPuzzleCount >= optionalPuzzleCount) break;
            }
            foreach (var next in Expand(gameCase, scenes, state, reachablePuzzles))
            {
                var signature = next.Signature();
                if (visited.Add(signature)) queue.Enqueue(next, -ProgressScore(next));
            }
        }

        if (!winFound)
            result.Add("NoCanonicalWinPath", "stateGraph", limitReached
                ? $"No canonical win path was found before the {StateLimit:N0}-state safety limit."
                : "No action ordering reaches a complete accusation state.");
        foreach (var puzzle in gameCase.Puzzles.Where(item => item.ProgressionRole == PuzzleProgressionRoles.Optional
                     && !reachablePuzzles.Contains(item.PuzzleId)))
            result.Add("UnreachableOptionalMechanic", "stateGraph", "Optional puzzle is unreachable in every explored path.", puzzle.PuzzleId);
        return result;
    }

    private static int ProgressScore(SearchState state) =>
        state.CompletedScenes.Count * 10_000
        + state.VisitedScenes.Count * 1_000
        + state.Deductions.Count * 200
        + state.Challenges.Count * 150
        + state.Puzzles.Count * 100
        + state.Clues.Count * 20
        + state.Dialogues.Count * 10
        + state.ConversationNodes.Count * 10
        + state.Interactions.Count * 5
        + state.InspectedItems.Count;

    private static IEnumerable<SearchState> Expand(
        GameCase gameCase,
        IReadOnlyList<CaseScene> scenes,
        SearchState state,
        HashSet<string> reachablePuzzles)
    {
        foreach (var scene in scenes.Where(scene => CanEnter(gameCase, state, scene.SceneId) && !state.VisitedScenes.Contains(scene.SceneId)))
        {
            var next = state.Clone();
            next.VisitedScenes.Add(scene.SceneId);
            next.UnlockedScenes.Add(scene.SceneId);
            yield return next;
        }

        foreach (var scene in scenes.Where(scene => state.VisitedScenes.Contains(scene.SceneId)))
        {
            foreach (var itemId in scene.ItemIds.Where(id => !state.InspectedItems.Contains(id)))
            {
                var item = gameCase.Items.FirstOrDefault(value => value.ItemId == itemId);
                if (item is null) continue;
                var hotspot = scene.Hotspots.FirstOrDefault(value => value.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase) && value.TargetId == itemId);
                if (hotspot is not null && !hotspot.RequiredClueIds.All(state.Clues.Contains)) continue;
                var next = state.Clone();
                next.InspectedItems.Add(itemId);
                if (item.IsCollectible) next.Items.Add(itemId);
                next.Clues.UnionWith(item.UnlockClueIds);
                yield return next;
            }

            foreach (var clue in gameCase.Clues.Where(clue => !state.Clues.Contains(clue.ClueId)
                         && clue.SceneId == scene.SceneId
                         && (clue.DiscoverMethod.Equals("camera", StringComparison.OrdinalIgnoreCase)
                             || clue.SourceType.Equals("camera", StringComparison.OrdinalIgnoreCase))))
            {
                var zone = scene.Runtime?.ClueZones.FirstOrDefault(value => value.ClueId == clue.ClueId);
                if (zone is not null && !zone.RequiredClueIds.All(state.Clues.Contains)) continue;
                var next = state.Clone();
                next.Clues.Add(clue.ClueId);
                yield return next;
            }

            foreach (var dialogue in gameCase.Dialogues.Where(dialogue => !state.Dialogues.Contains(dialogue.DialogueId)
                         && scene.CharacterIds.Contains(dialogue.CharacterId)
                         && dialogue.AvailableSceneIds.Contains(scene.SceneId)
                         && dialogue.RequiredClueIds.All(state.Clues.Contains)))
            {
                var next = state.Clone();
                next.Dialogues.Add(dialogue.DialogueId);
                next.Clues.UnionWith(dialogue.UnlockClueIds);
                yield return next;
            }

            foreach (var node in gameCase.ConversationNodes.Where(node => !state.ConversationNodes.Contains(node.NodeId)
                         && scene.CharacterIds.Contains(node.CharacterId)
                         && node.AvailableSceneIds.Contains(scene.SceneId)
                         && node.RequiredClueIds.All(state.Clues.Contains)
                         && (node.IsRoot || HasReachableConversationParent(gameCase, state, node))))
            {
                var next = state.Clone();
                next.ConversationNodes.Add(node.NodeId);
                next.Clues.UnionWith(node.UnlockClueIds);
                yield return next;
            }

            foreach (var interaction in gameCase.Interactions.Where(interaction =>
                         (!interaction.SingleUse || !state.Interactions.Contains(interaction.InteractionId))
                         && interaction.RequiredItemIds.All(state.Items.Contains)
                         && interaction.RequiredClueIds.All(state.Clues.Contains)
                         && IsInteractionInScene(scene, interaction)))
            {
                var next = state.Clone();
                next.Interactions.Add(interaction.InteractionId);
                next.Items.ExceptWith(interaction.ConsumeItemIds);
                next.Items.UnionWith(interaction.UnlockItemIds);
                next.Clues.UnionWith(interaction.UnlockClueIds);
                next.UnlockedScenes.UnionWith(interaction.UnlockSceneIds);
                yield return next;
            }

            foreach (var puzzle in gameCase.Puzzles.Where(puzzle => !state.Puzzles.Contains(puzzle.PuzzleId)
                         && IsTargetInScene(scene, puzzle.TargetId)
                         && puzzle.RequiredItemIds.All(state.Items.Contains)
                         && puzzle.RequiredClueIds.All(state.Clues.Contains)))
            {
                reachablePuzzles.Add(puzzle.PuzzleId);
                var next = state.Clone();
                next.Puzzles.Add(puzzle.PuzzleId);
                next.Items.UnionWith(puzzle.UnlockItemIds);
                next.Clues.UnionWith(puzzle.UnlockClueIds);
                next.UnlockedScenes.UnionWith(puzzle.UnlockSceneIds);
                yield return next;
            }

            foreach (var challenge in gameCase.EvidenceChallenges.Where(challenge => !state.Challenges.Contains(challenge.ChallengeId)
                         && state.Clues.Contains(challenge.CorrectEvidenceId)
                         && ChallengeAvailable(gameCase, scene, state, challenge)))
            {
                var next = state.Clone();
                next.Challenges.Add(challenge.ChallengeId);
                next.Clues.UnionWith(challenge.UnlockClueIds);
                yield return next;
            }

            foreach (var deduction in gameCase.Deductions.Where(deduction => !state.Deductions.Contains(deduction.DeductionId)
                         && deduction.RequiredClueIds.All(state.Clues.Contains)
                         && deduction.RequiredChallengeIds.All(state.Challenges.Contains)))
            {
                var next = state.Clone();
                next.Deductions.Add(deduction.DeductionId);
                next.Clues.UnionWith(deduction.UnlockClueIds);
                yield return next;
            }

            if (!state.CompletedScenes.Contains(scene.SceneId)
                && CompleteConditionProgress.Evaluate(scene.CompleteCondition, state.InspectedItems, state.Clues, state.Dialogues).IsSatisfied)
            {
                var next = state.Clone();
                next.CompletedScenes.Add(scene.SceneId);
                UnlockSuccessor(gameCase, next, scene.SceneId);
                yield return next;
            }
        }
    }

    private static bool IsWin(GameCase gameCase, SearchState state)
    {
        if (gameCase.Stages.SelectMany(stage => stage.Scenes).Any(scene => !state.CompletedScenes.Contains(scene.SceneId))) return false;
        if (gameCase.FinalLogic.RequiredEvidenceLinks.Any(link => !state.Clues.Contains(link.EvidenceId))) return false;
        if (gameCase.FinalLogic.RequiredDeductionIds.Any(id => !state.Deductions.Contains(id))) return false;
        if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation
            && gameCase.EvidenceChallenges.Any(item => !state.Challenges.Contains(item.ChallengeId))) return false;
        if (gameCase.Puzzles.Any(item => item.ProgressionRole == PuzzleProgressionRoles.Required && !state.Puzzles.Contains(item.PuzzleId))) return false;
        return gameCase.FinalLogic.RequiredTeamworkChainIds.All(id =>
        {
            var chain = gameCase.RequiredTeamworkChains.FirstOrDefault(item => item.ChainId == id);
            return chain is not null && state.Clues.Contains(chain.InvestigatorClueId)
                   && state.Challenges.Contains(chain.InterrogatorChallengeId)
                   && state.Deductions.Contains(chain.DeductionId);
        });
    }

    private static bool CanEnter(GameCase gameCase, SearchState state, string sceneId)
    {
        var runtime = ToGameplayState(gameCase, state);
        return GameRules.CanEnterScene(gameCase, runtime, sceneId);
    }

    private static void UnlockSuccessor(GameCase gameCase, SearchState state, string sceneId)
    {
        var runtime = ToGameplayState(gameCase, state);
        GameRules.UnlockAuthoredSuccessor(gameCase, runtime, sceneId);
        state.UnlockedScenes.UnionWith(runtime.UnlockedSceneIds);
        state.CompletedScenes.UnionWith(runtime.CompletedSceneIds);
    }

    private static GameplayState ToGameplayState(GameCase gameCase, SearchState state) => new()
    {
        GameStatus = GameStatus.InProgress,
        CurrentStageId = gameCase.Stages.OrderBy(stage => stage.Order).First().StageId,
        CurrentSceneId = state.VisitedScenes.LastOrDefault() ?? gameCase.Stages.OrderBy(stage => stage.Order).First().Scenes.First().SceneId,
        UnlockedSceneIds = state.UnlockedScenes.ToList(),
        VisitedSceneIds = state.VisitedScenes.ToList(),
        CompletedSceneIds = state.CompletedScenes.ToList(),
        UnlockedClueIds = state.Clues.ToList()
    };

    private static bool HasReachableConversationParent(GameCase gameCase, SearchState state, ConversationNode target) =>
        gameCase.ConversationNodes.Any(parent => parent.CharacterId == target.CharacterId
            && state.ConversationNodes.Contains(parent.NodeId)
            && parent.Choices.Any(choice => choice.NextNodeId == target.NodeId && choice.RequiredClueIds.All(state.Clues.Contains)));

    private static bool ChallengeAvailable(GameCase gameCase, CaseScene scene, SearchState state, EvidenceChallenge challenge)
    {
        var dialogue = gameCase.Dialogues.FirstOrDefault(item => item.DialogueId == challenge.DialogueId);
        if (dialogue is null || !dialogue.AvailableSceneIds.Contains(scene.SceneId)) return false;
        return state.Dialogues.Contains(dialogue.DialogueId)
               || gameCase.ConversationNodes.Any(node => node.ChallengeId == challenge.ChallengeId
                                                         && state.ConversationNodes.Contains(node.NodeId));
    }

    private static bool IsInteractionInScene(CaseScene scene, CaseInteraction interaction) =>
        interaction.Type.Equals(CaseInteractionTypes.CombineItems, StringComparison.OrdinalIgnoreCase)
        || IsTargetInScene(scene, interaction.TargetId);

    private static bool IsTargetInScene(CaseScene scene, string targetId) =>
        scene.ItemIds.Contains(targetId)
        || scene.CharacterIds.Contains(targetId)
        || scene.Hotspots.Any(hotspot => hotspot.TargetId == targetId);

    private sealed class SearchState
    {
        public HashSet<string> UnlockedScenes { get; } = new(StringComparer.Ordinal);
        public HashSet<string> VisitedScenes { get; } = new(StringComparer.Ordinal);
        public HashSet<string> CompletedScenes { get; } = new(StringComparer.Ordinal);
        public HashSet<string> InspectedItems { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Items { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Clues { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Dialogues { get; } = new(StringComparer.Ordinal);
        public HashSet<string> ConversationNodes { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Interactions { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Puzzles { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Challenges { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Deductions { get; } = new(StringComparer.Ordinal);

        public SearchState Clone()
        {
            var copy = new SearchState();
            copy.UnlockedScenes.UnionWith(UnlockedScenes);
            copy.VisitedScenes.UnionWith(VisitedScenes);
            copy.CompletedScenes.UnionWith(CompletedScenes);
            copy.InspectedItems.UnionWith(InspectedItems);
            copy.Items.UnionWith(Items);
            copy.Clues.UnionWith(Clues);
            copy.Dialogues.UnionWith(Dialogues);
            copy.ConversationNodes.UnionWith(ConversationNodes);
            copy.Interactions.UnionWith(Interactions);
            copy.Puzzles.UnionWith(Puzzles);
            copy.Challenges.UnionWith(Challenges);
            copy.Deductions.UnionWith(Deductions);
            return copy;
        }

        public string Signature() => string.Join('|',
            Part(UnlockedScenes), Part(VisitedScenes), Part(CompletedScenes), Part(InspectedItems), Part(Items), Part(Clues),
            Part(Dialogues), Part(ConversationNodes), Part(Interactions), Part(Puzzles), Part(Challenges), Part(Deductions));

        private static string Part(IEnumerable<string> values) => string.Join(',', values.OrderBy(value => value, StringComparer.Ordinal));
    }
}
