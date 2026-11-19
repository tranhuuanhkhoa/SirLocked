using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// Import re-checks the compiled case against the reviewed V3 Crack content. A source-linked conversation leaf quotes the
/// approved ledger (the compiler replaces the model's prose with the ledger's line and its reviewed testimony fragments),
/// so it is checked against that quote, not against the prose the model wrote for it. Since every new (OPEN_COOP_1) order
/// has Crack the Lie, comparing it with the prose refused the import of every new order.
/// </summary>
public sealed class AcceptedCrackContentTests
{
    private const string Leaf = "conversation-char-a-dialogue-statement-1";

    private static (GameplayProjectionPlan Plan, V3CrackContent Content, GameCase Compiled) Reviewed(string? sourceDialogueId)
    {
        var skeletonNode = new ConversationNode
        {
            NodeId = Leaf, CharacterId = "char-a", SourceDialogueId = sourceDialogueId,
            Lines = [new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "I went back to the study alone." }],
            Choices = [new ConversationChoice { ChoiceId = $"choice-{Leaf}-return" }]
        };
        var plan = new GameplayProjectionPlan { Skeleton = new GameCase { ConversationNodes = [skeletonNode] } };
        plan.ConversationNodes[Leaf] = new ConversationProjectionSlot();
        var content = new V3CrackContent();
        content.ConversationNodes[Leaf] = new ConversationProjectionContent
        {
            NodeId = Leaf, Lines = ["The witness answers carefully."],
            ChoiceLabels = new Dictionary<string, string> { [$"choice-{Leaf}-return"] = "Continue questioning" }
        };
        var compiled = new GameCase
        {
            TestimonyFragments = [new TestimonyFragment { Id = "fragment-1", DialogueId = "dialogue-statement-1", Text = "The clock had stopped at nine." }],
            ConversationNodes =
            [
                new ConversationNode
                {
                    NodeId = Leaf, CharacterId = "char-a", SourceDialogueId = sourceDialogueId,
                    Lines = [new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "I went back to the study alone." }],
                    Choices = [new ConversationChoice { ChoiceId = $"choice-{Leaf}-return", Label = "Continue questioning" }]
                }
            ]
        };
        var node = compiled.ConversationNodes[0];
        node.Lines = sourceDialogueId is null
            ? [new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "The witness answers carefully." }]
            : ProjectionConversationPresentation.SourceLines(node, compiled.TestimonyFragments);
        return (plan, content, compiled);
    }

    private static bool Flags(List<string> errors) =>
        errors.Any(error => error.Contains($"conversation node '{Leaf}'", StringComparison.Ordinal));

    [Fact]
    public void ASourceLinkedLeaf_QuotesTheLedger_AndPassesTheImportCheck()
    {
        var (plan, content, compiled) = Reviewed("dialogue-statement-1");
        Assert.Contains("The clock had stopped at nine.", compiled.ConversationNodes[0].Lines[0].Text);

        Assert.False(Flags(AiCaseService.ValidateAcceptedV3CrackContent(plan, content, compiled)));
    }

    [Fact]
    public void ASourceLinkedLeaf_ChangedAfterReview_IsStillRefused()
    {
        var (plan, content, compiled) = Reviewed("dialogue-statement-1");
        compiled.ConversationNodes[0].Lines[0].Text = "I was never in the study.";

        Assert.True(Flags(AiCaseService.ValidateAcceptedV3CrackContent(plan, content, compiled)));
    }

    [Fact]
    public void AModelWrittenNode_StillHasToMatchTheReviewedProse()
    {
        var (plan, content, compiled) = Reviewed(null);
        Assert.False(Flags(AiCaseService.ValidateAcceptedV3CrackContent(plan, content, compiled)));

        compiled.ConversationNodes[0].Lines[0].Text = "Something the reviewer never read.";
        Assert.True(Flags(AiCaseService.ValidateAcceptedV3CrackContent(plan, content, compiled)));
    }
}
