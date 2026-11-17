using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Bridge;
using Xunit;

namespace SirLocked.Tests;

/// <summary>Questions the bot puts to the creator in the browser (draft_ask): validation and the order status.</summary>
public sealed class AiDecisionTests
{
    private static AiDecisionAskRequest Ask(params AiDecisionOption[] options) => new()
    {
        Key = "asset-budget",
        Question = "Màn này cần 180 lượt PixelLab. Làm sao?",
        Options = options.ToList()
    };

    private static AiDecisionOption Option(string id, int? generations = null) =>
        new() { Id = id, Label = $"Lựa chọn {id}", Detail = "Chi tiết", Generations = generations };

    [Fact]
    public void ValidateAsk_AcceptsTwoOptions()
    {
        AiDecisionService.ValidateAsk(Ask(Option("draw", 180), Option("library", 25)));
    }

    [Fact]
    public void ValidateAsk_RefusesBadInput()
    {
        var invalid = new List<AiDecisionAskRequest>
        {
            Ask(Option("only")),
            Ask(Option("a"), Option("b"), Option("c"), Option("d"), Option("e")),
            Ask(Option("same"), Option("same")),
            Ask(Option("a"), Option("b", -1)),
            Ask(Option("has space"), Option("b")),
            Mutate(Ask(Option("a"), Option("b")), item => item.Key = "asset budget"),
            Mutate(Ask(Option("a"), Option("b")), item => item.Question = "  "),
            Mutate(Ask(Option("a"), Option("b")), item => item.Options[0].Label = ""),
        };
        foreach (var request in invalid)
        {
            var error = Assert.Throws<ApiException>(() => AiDecisionService.ValidateAsk(request));
            Assert.Equal(400, error.StatusCode);
            Assert.Equal("AI_DECISION_INVALID", Assert.IsType<ApiErrorDetails>(error.Errors).Code);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Derive_OpenDecision_IsAwaitingDecision(bool inHand)
    {
        var draft = new AiCaseDraft
        {
            Status = AiDraftStatus.GeneratingStory, QueueState = AiQueueStates.AwaitingClaude,
            Decisions = [new AiDecision { Id = "q1", Key = "asset-budget", Status = AiDecisionStatuses.Open }]
        };
        Assert.Equal(AiOrderStatuses.AwaitingDecision, AiCaseOrderPolicy.Derive(draft, inHand));
    }

    [Fact]
    public void Derive_AnsweredDecision_FallsBackToQueue()
    {
        var draft = new AiCaseDraft
        {
            Status = AiDraftStatus.GeneratingStory, QueueState = AiQueueStates.AwaitingClaude,
            Decisions = [new AiDecision { Id = "q1", Key = "asset-budget", Status = AiDecisionStatuses.Answered }]
        };
        Assert.Equal(AiOrderStatuses.QueuedForClaude, AiCaseOrderPolicy.Derive(draft, false));
    }

    private static AiDecisionAskRequest Mutate(AiDecisionAskRequest request, Action<AiDecisionAskRequest> change)
    {
        change(request);
        return request;
    }
}
