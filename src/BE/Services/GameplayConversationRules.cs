using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public sealed record ConversationRuleResult(
    ConversationNode Node,
    ConversationChoice? SelectedChoice,
    bool Changed,
    IReadOnlyList<string> UnlockedClueIds);

internal enum ConversationTransitionStatus
{
    Available,
    CurrentLocked,
    ChoiceLocked,
    TargetUnavailable,
    TargetLocked
}

public static class GameplayConversationRules
{
    private const string LockedMessage = "This conversation option is not available yet.";

    public static ConversationRuleResult Apply(
        GameCase gameCase,
        GameplayState state,
        CaseScene scene,
        ConverseRequest request,
        string userId,
        string role,
        DateTime visitedAt)
    {
        var characterNodes = gameCase.ConversationNodes
            .Where(node => node.CharacterId == request.CharacterId)
            .Where(node => gameCase.LogicContractVersion < CaseLogicContractVersions.CausalFiveClaim
                || node.AvailableSceneIds.Contains(scene.SceneId))
            .ToList();
        if (gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV2 || characterNodes.Count == 0)
            throw ApiException.BadRequest("This case has no conversation tree.");

        if (!scene.CharacterIds.Contains(request.CharacterId))
            throw ApiException.BadRequest("This character is not in the current scene.");

        if (!string.IsNullOrWhiteSpace(request.ChoiceId) && string.IsNullOrWhiteSpace(request.NodeId))
            throw ApiException.BadRequest("nodeId is required when selecting a conversation choice.");

        var root = characterNodes.Single(node => node.IsRoot);
        var current = string.IsNullOrWhiteSpace(request.NodeId)
            ? ResolveDefaultNode(characterNodes, state, root)
            : gameCase.ConversationNodes.FirstOrDefault(node => node.NodeId == request.NodeId)
                ?? throw ApiException.BadRequest("This conversation node is not available.");

        if (current.CharacterId != request.CharacterId)
            throw ApiException.BadRequest("This conversation node is not available.");
        if (!current.IsRoot && !state.VisitedConversationNodeIds.Contains(current.NodeId))
            throw ApiException.BadRequest("This conversation node is not available.");

        ConversationChoice? selectedChoice = null;
        var reached = current;
        if (!string.IsNullOrWhiteSpace(request.ChoiceId))
        {
            selectedChoice = current.Choices.FirstOrDefault(choice => choice.ChoiceId == request.ChoiceId)
                ?? throw ApiException.BadRequest("This conversation choice is not available.");
            var nodeById = characterNodes.ToDictionary(node => node.NodeId);
            var transition = ResolveTransition(
                current,
                selectedChoice,
                root,
                nodeById,
                state.UnlockedClueIds,
                out reached);
            if (transition is ConversationTransitionStatus.CurrentLocked
                or ConversationTransitionStatus.ChoiceLocked
                or ConversationTransitionStatus.TargetLocked)
                throw ApiException.BadRequest(LockedMessage);
            if (transition == ConversationTransitionStatus.TargetUnavailable)
                throw ApiException.BadRequest("This conversation node is not available.");
        }
        else
        {
            EnsureUnlocked(current.RequiredClueIds, state);
        }

        if (state.VisitedConversationNodeIds.Contains(reached.NodeId))
            return new ConversationRuleResult(reached, selectedChoice, false, Array.Empty<string>());

        state.VisitedConversationNodeIds.Add(reached.NodeId);
        var newClues = reached.UnlockClueIds.Where(id => !state.UnlockedClueIds.Contains(id)).ToList();
        state.UnlockedClueIds.AddRange(newClues);
        foreach (var clueId in newClues)
        {
            if (state.ClueDiscoveries.Any(record => record.ClueId == clueId)) continue;
            state.ClueDiscoveries.Add(new ClueDiscoveryRecord
            {
                ClueId = clueId,
                DiscoveredByUserId = userId,
                DiscoveredByRole = role,
                SourceAction = ClueDiscoverySources.Conversation,
                DiscoveredAt = visitedAt
            });
        }

        return new ConversationRuleResult(reached, selectedChoice, true, newClues);
    }

    /// <summary>
    /// Shared runtime/publish-time transition contract. Keep the reachability simulator on this
    /// helper so choice and target clue gates cannot drift from live conversation traversal.
    /// </summary>
    internal static ConversationTransitionStatus ResolveTransition(
        ConversationNode current,
        ConversationChoice choice,
        ConversationNode root,
        IReadOnlyDictionary<string, ConversationNode> nodeById,
        IReadOnlyCollection<string> unlockedClueIds,
        out ConversationNode reached)
    {
        reached = root;
        if (current.RequiredClueIds.Any(id => !unlockedClueIds.Contains(id)))
            return ConversationTransitionStatus.CurrentLocked;
        if (choice.RequiredClueIds.Any(id => !unlockedClueIds.Contains(id)))
            return ConversationTransitionStatus.ChoiceLocked;

        if (!string.IsNullOrWhiteSpace(choice.NextNodeId))
        {
            if (!nodeById.TryGetValue(choice.NextNodeId, out var target))
                return ConversationTransitionStatus.TargetUnavailable;
            reached = target;
        }
        if (reached.CharacterId != current.CharacterId)
            return ConversationTransitionStatus.TargetUnavailable;
        if (reached.RequiredClueIds.Any(id => !unlockedClueIds.Contains(id)))
            return ConversationTransitionStatus.TargetLocked;

        return ConversationTransitionStatus.Available;
    }

    public static IReadOnlyList<ConversationChoice> VisibleChoices(ConversationNode node, GameplayState state)
    {
        // Visited branches stay selectable: revisiting is idempotent, and hiding them used to
        // strand the player on a node whose only remaining choice was "leave" while gated
        // follow-ups lived deeper in an already-visited branch.
        return node.Choices.ToList();
    }

    /// <summary>Public, spoiler-safe challenge projection (prompt + resolved + resolution only).</summary>
    public static EvidenceChallengeDto? BuildChallengeDto(GameCase gameCase, GameplayState state, string? challengeId)
    {
        if (string.IsNullOrWhiteSpace(challengeId)) return null;
        var challenge = gameCase.EvidenceChallenges.FirstOrDefault(c => c.ChallengeId == challengeId);
        if (challenge is null) return null;
        var resolved = state.ResolvedConfrontationRecords.Any(record => record.ChallengeId == challenge.ChallengeId);
        return new EvidenceChallengeDto
        {
            ChallengeId = challenge.ChallengeId,
            DialogueId = challenge.DialogueId,
            Prompt = challenge.Prompt,
            IsResolved = resolved,
            Resolution = resolved ? challenge.SuccessResponse : null
        };
    }

    /// <summary>
    /// Authoritative transcript of visited nodes for the given scene's characters, in visit order.
    /// Only visited nodes are projected, so unseen content never leaks.
    /// </summary>
    public static List<ConversationTranscriptEntryDto> BuildTranscript(
        GameCase gameCase,
        GameplayState state,
        IReadOnlyCollection<string> sceneCharacterIds)
    {
        var nodeById = gameCase.ConversationNodes
            .Where(node => !string.IsNullOrWhiteSpace(node.NodeId))
            .GroupBy(node => node.NodeId)
            .ToDictionary(group => group.Key, group => group.First());

        return state.VisitedConversationNodeIds
            .Select(id => nodeById.GetValueOrDefault(id))
            .Where(node => node is not null && sceneCharacterIds.Contains(node!.CharacterId))
            .Select(node => new ConversationTranscriptEntryDto
            {
                NodeId = node!.NodeId,
                CharacterId = node.CharacterId,
                Lines = node.Lines.Select(ConversationLineDto.From).ToList(),
                Challenge = BuildChallengeDto(gameCase, state, node.ChallengeId)
            })
            .ToList();
    }

    /// <summary>
    /// Choices on already-visited nodes whose gate just became satisfied by the supplied new clues.
    /// </summary>
    public static IReadOnlyList<(ConversationNode Node, ConversationChoice Choice)> NewlyUnlockedChoices(
        GameCase gameCase,
        GameplayState state,
        IReadOnlyCollection<string> newClueIds)
    {
        return gameCase.ConversationNodes
            .Where(node => state.VisitedConversationNodeIds.Contains(node.NodeId))
            .SelectMany(node => node.Choices.Select(choice => (Node: node, Choice: choice)))
            .Where(pair => pair.Choice.RequiredClueIds.Count > 0
                && pair.Choice.RequiredClueIds.All(state.UnlockedClueIds.Contains)
                && pair.Choice.RequiredClueIds.Any(newClueIds.Contains))
            .ToList();
    }

    public static bool IsChallengeAvailable(
        GameCase gameCase,
        GameplayState state,
        CaseScene scene,
        EvidenceChallenge challenge) =>
        IsChallengeAvailable(
            gameCase,
            state.AskedDialogueIds,
            state.VisitedConversationNodeIds,
            scene,
            challenge);

    /// <summary>
    /// Shared runtime/publish-time challenge availability contract. The simulator supplies its
    /// pure accumulated state so conversation-owned challenges stay aligned with live gameplay.
    /// </summary>
    internal static bool IsChallengeAvailable(
        GameCase gameCase,
        IReadOnlyCollection<string> askedDialogueIds,
        IReadOnlyCollection<string> visitedConversationNodeIds,
        CaseScene scene,
        EvidenceChallenge challenge)
    {
        var dialogue = gameCase.Dialogues.FirstOrDefault(item => item.DialogueId == challenge.DialogueId);
        if (dialogue is null || !scene.CharacterIds.Contains(dialogue.CharacterId))
            return false;
        if (gameCase.LogicContractVersion >= CaseLogicContractVersions.CausalFiveClaim
            && !dialogue.AvailableSceneIds.Contains(scene.SceneId))
            return false;

        return askedDialogueIds.Contains(dialogue.DialogueId)
            || gameCase.ConversationNodes.Any(node =>
                node.CharacterId == dialogue.CharacterId
                && node.ChallengeId == challenge.ChallengeId
                && visitedConversationNodeIds.Contains(node.NodeId));
    }

    private static void EnsureUnlocked(IEnumerable<string> requiredClueIds, GameplayState state)
    {
        if (requiredClueIds.Any(id => !state.UnlockedClueIds.Contains(id)))
            throw ApiException.BadRequest(LockedMessage);
    }

    private static ConversationNode ResolveDefaultNode(
        IReadOnlyCollection<ConversationNode> characterNodes,
        GameplayState state,
        ConversationNode root)
    {
        var nodeById = characterNodes
            .Where(node => !string.IsNullOrWhiteSpace(node.NodeId))
            .GroupBy(node => node.NodeId)
            .ToDictionary(group => group.Key, group => group.First());

        foreach (var nodeId in state.VisitedConversationNodeIds.AsEnumerable().Reverse())
        {
            if (!nodeById.TryGetValue(nodeId, out var node)) continue;
            var hasPendingBranch = node.Choices.Any(choice =>
                !string.IsNullOrWhiteSpace(choice.NextNodeId)
                && nodeById.ContainsKey(choice.NextNodeId)
                && !state.VisitedConversationNodeIds.Contains(choice.NextNodeId));
            if (hasPendingBranch) return node;
        }

        return root;
    }
}
