using System.Reflection;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

/// <summary>A new order runs from A to Z: the server passes every review gate itself; people edit the case afterwards.</summary>
public sealed class AiDraftAutopilotTests
{
    private static AiCaseDraft Draft(string status, string reviewMode = AiCaseReviewModes.Auto) => new()
    {
        Id = "64b64c0f0f0f0f0f0f0f0f31", Status = status, QueueState = AiQueueStates.None,
        OrderStatus = AiOrderStatuses.AwaitingGate, Order = new AiCaseOrder { ReviewMode = reviewMode }
    };

    [Theory]
    [InlineData("FULL")]
    [InlineData("FAST")]
    [InlineData("AUTO")]
    public void NewOrder_AlwaysRunsOnAutopilot(string requested)
    {
        foreach (var role in new[] { "ADMIN", "VIP" })
            Assert.Equal(AiCaseReviewModes.Auto,
                AiCaseOrderPolicy.Normalize(new AiCaseOrder { ReviewMode = requested }, role, AiDifficultyProfiles.For("easy")).ReviewMode);
    }

    [Fact]
    public void OldOrderNormalize_DoesNotAcceptAuto() =>
        Assert.Throws<ApiException>(() => AiCaseOrderPolicy.Normalize(new AiCaseOrder { ReviewMode = AiCaseReviewModes.Auto }, "ADMIN"));

    [Theory]
    [InlineData(AiDraftStatus.StoryAwaitingApproval, BridgeGates.Story)]
    [InlineData(AiDraftStatus.CaseTruthAwaitingApproval, BridgeGates.Truth)]
    [InlineData(AiDraftStatus.FullLogicAwaitingApproval, BridgeGates.Logic)]
    [InlineData(AiDraftStatus.SceneLayoutAwaitingApproval, BridgeGates.Layout)]
    public void EveryGate_IsPassedOnAutopilot(string status, string gate) =>
        Assert.Equal(gate, AiDraftAutopilot.GateToPass(Draft(status)));

    [Theory]
    [InlineData(AiCaseReviewModes.Full)]
    [InlineData(AiCaseReviewModes.Fast)]
    public void OlderReviewModes_KeepTheirPeople(string mode) =>
        Assert.Null(AiDraftAutopilot.GateToPass(Draft(AiDraftStatus.StoryAwaitingApproval, mode)));

    [Fact]
    public void ADraftWithoutAnOrder_IsLeftAlone()
    {
        var draft = Draft(AiDraftStatus.StoryAwaitingApproval);
        draft.Order = null;
        Assert.Null(AiDraftAutopilot.GateToPass(draft));
    }

    [Theory]
    [InlineData(AiQueueStates.Pending)]
    [InlineData(AiQueueStates.Running)]
    [InlineData(AiQueueStates.AwaitingClaude)]
    public void ABusyDraft_IsNotPassed(string queue)
    {
        var draft = Draft(AiDraftStatus.FullLogicAwaitingApproval);
        draft.QueueState = queue;
        Assert.Null(AiDraftAutopilot.GateToPass(draft));
    }

    [Fact]
    public void AnOrderStillWaitingForItsOwner_IsNotPassed()
    {
        var draft = Draft(AiDraftStatus.StoryAwaitingApproval);
        draft.OrderStatus = AiOrderStatuses.AwaitingOwnerApproval;
        Assert.Null(AiDraftAutopilot.GateToPass(draft));
    }

    [Fact]
    public void APendingRepairCandidate_IsNotPassed()
    {
        var draft = Draft(AiDraftStatus.CaseTruthAwaitingApproval);
        draft.TruthRepairStatus = AiRepairStatus.CandidateReady;
        Assert.Null(AiDraftAutopilot.GateToPass(draft));
        var logic = Draft(AiDraftStatus.FullLogicAwaitingApproval);
        logic.RepairStatus = AiRepairStatus.CandidateReady;
        Assert.Null(AiDraftAutopilot.GateToPass(logic));
    }

    [Theory]
    [InlineData(AiDraftStatus.StoryAwaitingApproval, nameof(IAiCaseService.ApproveDraftAsync))]
    [InlineData(AiDraftStatus.CaseTruthAwaitingApproval, nameof(IAiCaseService.ApproveTruthAsync))]
    [InlineData(AiDraftStatus.FullLogicAwaitingApproval, nameof(IAiCaseService.ApproveFullLogicAsync))]
    [InlineData(AiDraftStatus.SceneLayoutAwaitingApproval, nameof(IAiCaseService.ApproveSceneLayoutAsync))]
    public async Task Advance_ApprovesTheGateAsTheAutopilot(string status, string method)
    {
        var cases = RecordingCases.Create();
        var gate = await AiDraftAutopilot.AdvanceAsync(Draft(status), cases);
        Assert.NotNull(gate);
        var call = Assert.Single(((RecordingCases)(object)cases).Calls);
        Assert.Equal(method, call.Method);
        Assert.Equal(AiDraftAutopilot.AutopilotUser.Id, call.User.Id);
        Assert.Equal("64b64c0f0f0f0f0f0f0f0f31", call.DraftId);
    }

    [Fact]
    public async Task Advance_LeavesAFullReviewDraftAlone()
    {
        var cases = RecordingCases.Create();
        Assert.Null(await AiDraftAutopilot.AdvanceAsync(Draft(AiDraftStatus.StoryAwaitingApproval, AiCaseReviewModes.Full), cases));
        Assert.Empty(((RecordingCases)(object)cases).Calls);
    }

    [Fact]
    public async Task Advance_SwallowsARaceWithAnotherApproval()
    {
        var cases = RecordingCases.Create(ApiException.Conflict("The draft moved on.", "X", "x"));
        Assert.Null(await AiDraftAutopilot.AdvanceAsync(Draft(AiDraftStatus.StoryAwaitingApproval), cases));
    }

    [Fact]
    public void AutopilotOrders_MayNotAskTheCreator() =>
        Assert.Throws<ApiException>(() => AiDecisionService.EnsureMayAsk(Draft(AiDraftStatus.GeneratingCaseTruth)));

    [Fact]
    public void FullReviewOrders_MayStillAsk() =>
        AiDecisionService.EnsureMayAsk(Draft(AiDraftStatus.GeneratingCaseTruth, AiCaseReviewModes.Full));

    /// <summary>Records the approval calls; any other member is a test failure.</summary>
    public class RecordingCases : DispatchProxy
    {
        public List<(string Method, CurrentUser User, string DraftId)> Calls { get; } = [];
        private Exception? _throw;

        public static IAiCaseService Create(Exception? toThrow = null)
        {
            var proxy = Create<IAiCaseService, RecordingCases>();
            ((RecordingCases)(object)proxy)._throw = toThrow;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            var name = targetMethod!.Name;
            if (!name.StartsWith("Approve", StringComparison.Ordinal) || name == nameof(IAiCaseService.ApproveOrderAsync))
                throw new InvalidOperationException($"Unexpected call {name}.");
            Calls.Add((name, (CurrentUser)args![0]!, (string)args[1]!));
            if (_throw is not null) return Task.FromException<AiDraftResponse>(_throw);
            return Task.FromResult(new AiDraftResponse());
        }
    }
}
