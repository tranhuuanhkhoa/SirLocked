using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// Open co-op "what's left?" hints computed from the shared state, so players are never stuck on a
/// vague "missing 1 open lead". Level 1 names the place, level 2 names the exact thing.
/// </summary>
public static class LeadHintRules
{
    public sealed record Lead(string Key, string Role, string General, string Specific);

    public static List<Lead> OpenLeads(GameCase gameCase, GameplayState state)
    {
        var leads = new List<Lead>();
        var unlocked = state.UnlockedClueIds.ToHashSet(StringComparer.Ordinal);
        var scenes = GameRules.GetAuthoredScenes(gameCase);
        string ItemName(string id) => gameCase.Items.FirstOrDefault(item => item.ItemId == id)?.Name ?? id;

        foreach (var scene in scenes.Where(scene => !state.VisitedSceneIds.Contains(scene.SceneId)))
            leads.Add(new Lead($"visit:{scene.SceneId}", "ANY", $"Chưa ai ghé {scene.Title}.", $"Hãy vào {scene.Title}: ở đó còn manh mối."));

        foreach (var scene in scenes)
        {
            var solvedTargets = gameCase.Puzzles.Where(p => state.SolvedPuzzleIds.Contains(p.PuzzleId)).Select(p => p.TargetId).ToHashSet();
            foreach (var puzzle in gameCase.Puzzles.Where(p => !state.SolvedPuzzleIds.Contains(p.PuzzleId)
                         && scene.Hotspots.Any(h => h.TargetId == p.TargetId)
                         && p.RequiredClueIds.All(unlocked.Contains)
                         && p.RequiredItemIds.All(state.CollectedItemIds.Contains)))
                leads.Add(new Lead($"puzzle:{puzzle.PuzzleId}", "ANY", $"{scene.Title} còn một câu đố chưa giải.",
                    $"Giải câu đố ở \"{ItemName(puzzle.TargetId)}\" ({scene.Title})."));

            var puzzleTargets = gameCase.Puzzles.Select(p => p.TargetId).ToHashSet();
            foreach (var hotspot in scene.Hotspots.Where(h => !h.Type.Equals("CHARACTER", StringComparison.OrdinalIgnoreCase)
                         && h.RequiredClueIds.All(unlocked.Contains) && !puzzleTargets.Contains(h.TargetId)))
            {
                var interaction = gameCase.Interactions.FirstOrDefault(i => i.InteractionId == hotspot.TargetId || i.TargetId == hotspot.TargetId);
                var done = hotspot.Type.Equals("ENVIRONMENT", StringComparison.OrdinalIgnoreCase)
                    ? interaction is null || state.UsedInteractionIds.Contains(interaction.InteractionId)
                    : state.InspectedItemIds.Contains(hotspot.TargetId);
                if (done) continue;
                var label = string.IsNullOrWhiteSpace(hotspot.Label) ? ItemName(hotspot.TargetId) : hotspot.Label;
                leads.Add(new Lead($"inspect:{hotspot.HotspotId}", "INVESTIGATOR", $"{scene.Title} còn chỗ Watson chưa xem.",
                    $"Watson xem \"{label}\" ở {scene.Title}."));
            }

            foreach (var zone in scene.Runtime?.ClueZones ?? new List<ClueZone>())
            {
                if (unlocked.Contains(zone.ClueId) || !zone.RequiredClueIds.All(unlocked.Contains)) continue;
                leads.Add(new Lead($"photo:{zone.ClueId}", "INVESTIGATOR", $"Ở {scene.Title} có một chi tiết nên chụp ảnh.",
                    $"Watson dùng máy ảnh chụp \"{zone.Label}\" ở {scene.Title}."));
            }

            foreach (var characterId in scene.CharacterIds)
            {
                var name = gameCase.Characters.FirstOrDefault(c => c.CharacterId == characterId)?.Name ?? characterId;
                var pending = gameCase.Dialogues.Count(d => d.CharacterId == characterId
                    && !state.AskedDialogueIds.Contains(d.DialogueId)
                    && d.RequiredClueIds.All(unlocked.Contains)
                    && GameplayConversationRules.IsSourceDialogueAvailable(gameCase, state.VisitedConversationNodeIds, d.DialogueId));
                if (pending > 0)
                    leads.Add(new Lead($"talk:{characterId}", "INTERROGATOR", $"Sherlock còn điều chưa hỏi ở {scene.Title}.",
                        $"Sherlock hỏi {name} ({pending} câu mới)."));
            }
        }

        if (gameCase.Timeline is { } timeline)
        {
            var open = timeline.Events.Count(item => !item.IsFixed && TimelineRules.IsKnown(item, state) && !state.PlacedTimelineEventIds.Contains(item.EventId));
            if (open > 0)
                leads.Add(new Lead("timeline", "ANY", $"Dòng thời gian còn {open} thẻ chưa xếp.", "Mở Hồ sơ › Dòng thời gian và kéo thẻ vào đúng khe giờ."));
        }

        var resolved = state.ResolvedConfrontationRecords.Select(r => r.ChallengeId).ToHashSet();
        foreach (var challenge in gameCase.EvidenceChallenges.Where(c => !resolved.Contains(c.ChallengeId)))
        {
            var fragment = gameCase.TestimonyFragments.FirstOrDefault(f => f.Id == challenge.TestimonyFragmentId);
            var heard = state.TestimonyDiscoveries.Any(d => d.TestimonyFragmentId == challenge.TestimonyFragmentId);
            if (fragment is null || !heard || !unlocked.Contains(challenge.CorrectEvidenceId)) continue;
            var evidence = gameCase.Clues.FirstOrDefault(c => c.ClueId == challenge.CorrectEvidenceId)?.Title ?? string.Empty;
            leads.Add(new Lead($"crack:{challenge.ChallengeId}", "ANY", "Có một lời khai đang mâu thuẫn với chứng cứ.",
                $"Crack the Lie: \"{fragment.Text}\" ↔ {evidence}."));
        }
        return leads;
    }

    public static (string Text, int Level, int Remaining) Next(GameCase gameCase, GameplayState state, string role, int level)
    {
        var leads = OpenLeads(gameCase, state);
        if (leads.Count == 0)
            return ("Hai bạn đã có đủ manh mối. Mở Hồ sơ và buộc tội khi đã chắc chắn.", 1, 0);
        // Prefer something this detective can do, then team leads.
        var lead = leads.FirstOrDefault(l => l.Role == role) ?? leads.FirstOrDefault(l => l.Role == "ANY") ?? leads[0];
        var text = level >= 2 ? lead.Specific : lead.General;
        return (text, level >= 2 ? 2 : 1, leads.Count);
    }
}
