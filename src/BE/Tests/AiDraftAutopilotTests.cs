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

    // ------------------------------------------------------------ automatic repairs (bounded)

    private static AiCaseDraft Failed(string status, string truthRepair = AiRepairStatus.None, int repairs = 0)
    {
        var draft = Draft(status);
        draft.TruthRepairStatus = truthRepair;
        draft.AutopilotRepairs = repairs;
        return draft;
    }

    [Theory]
    [InlineData(AiDraftStatus.CaseTruthInvalid, AiRepairStatus.None, AiDraftAutopilot.RepairTruth)]
    [InlineData(AiDraftStatus.CaseTruthInvalid, AiRepairStatus.Rejected, AiDraftAutopilot.RepairTruth)]
    [InlineData(AiDraftStatus.CaseTruthInvalid, AiRepairStatus.CandidateInvalid, AiDraftAutopilot.RepairTruthCandidate)]
    [InlineData(AiDraftStatus.CaseTruthInvalid, AiRepairStatus.CandidateReady, AiDraftAutopilot.AcceptTruthRepair)]
    [InlineData(AiDraftStatus.CaseTruthAwaitingApproval, AiRepairStatus.CandidateReady, AiDraftAutopilot.AcceptTruthRepair)]
    [InlineData(AiDraftStatus.GeneratedInvalid, AiRepairStatus.None, AiDraftAutopilot.RetryJson)]
    public void AFailedStep_IsRepairedOnAutopilot(string status, string truthRepair, string step) =>
        Assert.Equal(step, AiDraftAutopilot.NextStep(Failed(status, truthRepair))?.Name);

    [Fact]
    public void Repairs_StopAfterTheBudget()
    {
        Assert.Null(AiDraftAutopilot.NextStep(Failed(AiDraftStatus.CaseTruthInvalid, repairs: AiDraftAutopilot.MaxRepairs)));
        Assert.Null(AiDraftAutopilot.NextStep(Failed(AiDraftStatus.GeneratedInvalid, repairs: AiDraftAutopilot.MaxRepairs)));
        // Accepting a valid candidate is free: it is the end of a repair, not a new one.
        Assert.Equal(AiDraftAutopilot.AcceptTruthRepair,
            AiDraftAutopilot.NextStep(Failed(AiDraftStatus.CaseTruthInvalid, AiRepairStatus.CandidateReady, AiDraftAutopilot.MaxRepairs))?.Name);
    }

    [Fact]
    public void ALogicRetry_IsTriedOnce_BecauseItRebuildsFromTheSameInputs()
    {
        var draft = Failed(AiDraftStatus.GeneratedInvalid, repairs: 1);
        draft.AutopilotJsonRetries = AiDraftAutopilot.MaxJsonRetries;
        Assert.Null(AiDraftAutopilot.NextStep(draft));
        var truth = Failed(AiDraftStatus.CaseTruthInvalid, repairs: 1);
        truth.AutopilotJsonRetries = AiDraftAutopilot.MaxJsonRetries;
        Assert.Equal(AiDraftAutopilot.RepairTruth, AiDraftAutopilot.NextStep(truth)?.Name);
    }

    [Fact]
    public void RepairsCost_GatesAndAcceptsDoNot()
    {
        Assert.True(AiDraftAutopilot.NextStep(Failed(AiDraftStatus.CaseTruthInvalid))!.CostsRepair);
        Assert.True(AiDraftAutopilot.NextStep(Failed(AiDraftStatus.GeneratedInvalid))!.CostsRepair);
        Assert.False(AiDraftAutopilot.NextStep(Failed(AiDraftStatus.CaseTruthInvalid, AiRepairStatus.CandidateReady))!.CostsRepair);
        Assert.False(AiDraftAutopilot.NextStep(Draft(AiDraftStatus.StoryAwaitingApproval))!.CostsRepair);
    }

    [Theory]
    [InlineData(AiCaseReviewModes.Full)]
    [InlineData(AiCaseReviewModes.Fast)]
    public void OlderDrafts_AreNeverRepairedOnAutopilot(string mode)
    {
        var draft = Draft(AiDraftStatus.CaseTruthInvalid, mode);
        Assert.Null(AiDraftAutopilot.NextStep(draft));
    }

    [Fact]
    public void ABusyFailedDraft_IsNotRepaired()
    {
        var draft = Failed(AiDraftStatus.GeneratedInvalid);
        draft.QueueState = AiQueueStates.Pending;
        Assert.Null(AiDraftAutopilot.NextStep(draft));
    }

    [Theory]
    [InlineData(AiDraftStatus.CaseTruthInvalid, AiRepairStatus.None, nameof(IAiCaseService.RepairTruthAsync), false)]
    [InlineData(AiDraftStatus.CaseTruthInvalid, AiRepairStatus.CandidateInvalid, nameof(IAiCaseService.RepairTruthAsync), true)]
    [InlineData(AiDraftStatus.CaseTruthInvalid, AiRepairStatus.CandidateReady, nameof(IAiCaseService.AcceptTruthRepairAsync), false)]
    [InlineData(AiDraftStatus.GeneratedInvalid, AiRepairStatus.None, nameof(IAiCaseService.RetryJsonAsync), false)]
    public async Task Advance_RunsTheRepairAsTheAutopilot(string status, string truthRepair, string method, bool fromCandidate)
    {
        var cases = RecordingCases.Create();
        Assert.NotNull(await AiDraftAutopilot.AdvanceAsync(Failed(status, truthRepair), cases));
        var recorder = (RecordingCases)(object)cases;
        var call = Assert.Single(recorder.Calls);
        Assert.Equal(method, call.Method);
        Assert.Equal(AiDraftAutopilot.AutopilotUser.Id, call.User.Id);
        if (method == nameof(IAiCaseService.RepairTruthAsync))
        {
            var request = Assert.IsType<RepairCaseTruthRequest>(recorder.Requests.Single());
            Assert.Equal(fromCandidate, request.UseRepairCandidate);
            Assert.False(string.IsNullOrWhiteSpace(request.RepairInstructions));
        }
    }

    /// <summary>Records the approval and repair calls; any other member is a test failure.</summary>
    public class RecordingCases : DispatchProxy
    {
        private static readonly string[] Allowed =
        [
            nameof(IAiCaseService.RepairTruthAsync), nameof(IAiCaseService.AcceptTruthRepairAsync), nameof(IAiCaseService.RetryJsonAsync)
        ];
        public List<(string Method, CurrentUser User, string DraftId)> Calls { get; } = [];
        public List<object?> Requests { get; } = [];
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
            var approval = name.StartsWith("Approve", StringComparison.Ordinal) && name != nameof(IAiCaseService.ApproveOrderAsync);
            if (!approval && !Allowed.Contains(name))
                throw new InvalidOperationException($"Unexpected call {name}.");
            Calls.Add((name, (CurrentUser)args![0]!, (string)args[1]!));
            if (args.Length > 2) Requests.Add(args[2]);
            if (_throw is not null) return Task.FromException<AiDraftResponse>(_throw);
            return Task.FromResult(new AiDraftResponse());
        }
    }
}
