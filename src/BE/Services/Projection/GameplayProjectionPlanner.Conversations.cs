using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public sealed partial class GameplayProjectionPlanner
{
    // A tree is another delivery surface for approved atomic dialogue slots, not a
    // new source of facts or rewards. Its identities and edges exist before schema
    // assembly so model output may only supply bounded presentation text.
    private static void CreateConversationTrees(
        GameCase skeleton, CaseTruthPackage truth, AiGenerationContract contract)
    {
        if (contract.MinConversationCharacters == 0) return;
        var vietnamese = skeleton.Language == CaseLanguages.Vietnamese;
        string T(string english, string translated) => vietnamese ? translated : english;
        var statements = truth.StatementLedger.ToDictionary(statement => statement.StatementId,
            StringComparer.Ordinal);
        var challengeDialogueIds = skeleton.EvidenceChallenges.Select(challenge => challenge.DialogueId)
            .ToHashSet(StringComparer.Ordinal);
        var candidates = skeleton.Dialogues.GroupBy(dialogue => dialogue.CharacterId, StringComparer.Ordinal)
            .SelectMany(group => group.SelectMany(first => group
                .Where(second => string.CompareOrdinal(first.DialogueId, second.DialogueId) < 0)
                .Select(second => new
                {
                    CharacterId = group.Key, First = first, Second = second,
                    Scenes = first.AvailableSceneIds.Intersect(second.AvailableSceneIds, StringComparer.Ordinal)
                        .OrderBy(id => id, StringComparer.Ordinal).ToList()
                })))
            .Where(pair => pair.Scenes.Count > 0
                && !pair.First.StatementIds.ToHashSet(StringComparer.Ordinal).SetEquals(pair.Second.StatementIds))
            .OrderBy(pair => challengeDialogueIds.Contains(pair.First.DialogueId)
                || challengeDialogueIds.Contains(pair.Second.DialogueId) ? 0 : 1)
            .ThenBy(pair => pair.CharacterId, StringComparer.Ordinal)
            .ThenBy(pair => pair.First.DialogueId, StringComparer.Ordinal)
            .ThenBy(pair => pair.Second.DialogueId, StringComparer.Ordinal)
            .GroupBy(pair => pair.CharacterId, StringComparer.Ordinal)
            .Select(group => group.First())
            .Take(contract.MinConversationCharacters).ToList();
        if (candidates.Count != contract.MinConversationCharacters)
            throw new ProjectionPlanningException(
                [$"PROJECTABILITY conversations: this preset needs {contract.MinConversationCharacters} speakers with two distinct approved dialogue slots available in the same scene. Add scene-grounded statements rather than inventing branches."]);
        if (skeleton.GenerationPreset == AiGenerationPresets.ShortDemo && skeleton.ShortDemoProfileVersion > 0
            && !candidates.Any(pair => challengeDialogueIds.Contains(pair.First.DialogueId)
                || challengeDialogueIds.Contains(pair.Second.DialogueId)))
            throw new ProjectionPlanningException(
                ["PROJECTABILITY conversations: the short sampler needs two distinct approved accounts from its confrontation speaker in one shared scene, so branching dialogue is part of required progression."]);

        foreach (var candidate in candidates)
        {
            var rootId = $"conversation-{candidate.CharacterId}-root";
            var root = new ConversationNode
            {
                NodeId = rootId, CharacterId = candidate.CharacterId, IsRoot = true,
                AvailableSceneIds = candidate.Scenes.ToList(),
                StatementIds = candidate.First.StatementIds.Concat(candidate.Second.StatementIds)
                    .Distinct(StringComparer.Ordinal).ToList(),
                Lines = [new ConversationLine
                {
                    Speaker = ConversationSpeakers.Detective,
                    Text = T("Which part of your account should we clarify?", "Chúng tôi muốn làm rõ từng phần lời khai của ông/bà.")
                }]
            };
            skeleton.ConversationNodes.Add(root);
            foreach (var (dialogue, index) in new[] { candidate.First, candidate.Second }.Select((value, index) => (value, index)))
            {
                // Keep the atomic source available exactly where its delivery tree is
                // available; otherwise a flat question in another room could bypass it.
                dialogue.AvailableSceneIds = candidate.Scenes.ToList();
                var leafId = $"conversation-{candidate.CharacterId}-{dialogue.DialogueId}";
                root.Choices.Add(new ConversationChoice
                {
                    ChoiceId = $"choice-{rootId}-{index + 1:00}", NextNodeId = leafId,
                    Label = T($"Clarify account {index + 1}", $"Làm rõ lời khai {index + 1}"),
                    RequiredClueIds = dialogue.RequiredClueIds.ToList()
                });
                skeleton.ConversationNodes.Add(new ConversationNode
                {
                    NodeId = leafId, CharacterId = candidate.CharacterId, SourceDialogueId = dialogue.DialogueId,
                    AvailableSceneIds = candidate.Scenes.ToList(),
                    StatementIds = dialogue.StatementIds.ToList(),
                    RequiredClueIds = dialogue.RequiredClueIds.ToList(),
                    UnlockClueIds = dialogue.UnlockClueIds.ToList(),
                    ChallengeId = skeleton.EvidenceChallenges.FirstOrDefault(challenge =>
                        challenge.DialogueId == dialogue.DialogueId)?.ChallengeId,
                    Lines = dialogue.StatementIds.Select(id => new ConversationLine
                    {
                        Speaker = ConversationSpeakers.Npc, Text = statements[id].Content
                    }).ToList(),
                    Choices = [new ConversationChoice
                    {
                        ChoiceId = $"choice-{leafId}-return", NextNodeId = null,
                        Label = T("Ask about another part of the account", "Hỏi về phần khác của lời khai")
                    }]
                });
            }
        }
    }
}
