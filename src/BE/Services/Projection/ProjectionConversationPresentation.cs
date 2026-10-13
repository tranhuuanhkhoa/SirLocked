using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

internal static class ProjectionConversationPresentation
{
    // A source visit discovers its candidate testimonies atomically. Put their
    // exact quotations on the same delivery surface as the approved account,
    // without changing the line count locked before content schema assembly.
    public static List<ConversationLine> SourceLines(
        ConversationNode approvedNode, IEnumerable<TestimonyFragment> fragments)
    {
        var lines = approvedNode.Lines.Select(line => new ConversationLine
        {
            Speaker = line.Speaker, Text = line.Text
        }).ToList();
        var spokenLine = lines.LastOrDefault(line => line.Speaker == ConversationSpeakers.Npc);
        if (spokenLine is null) return lines;
        foreach (var fragment in fragments.Where(fragment => fragment.DialogueId == approvedNode.SourceDialogueId))
            if (!string.IsNullOrWhiteSpace(fragment.Text)
                && !lines.Any(line => line.Text.Contains(fragment.Text, StringComparison.Ordinal)))
                spokenLine.Text = $"{spokenLine.Text.Trim()}\n\n{fragment.Text}".Trim();
        return lines;
    }
}
