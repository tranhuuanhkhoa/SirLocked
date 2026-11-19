using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public interface IAiDraftAutopilot
{
    /// <summary>Passes the gate an autopilot draft waits at, if any. Never throws for a lost race.</summary>
    Task AdvanceAsync(string draftId, CancellationToken ct);

    /// <summary>Safety net: passes every autopilot draft left waiting at a gate (a restart, a missed hook).</summary>
    Task SweepAsync(CancellationToken ct);
}

/// <summary>
/// Runs an <see cref="AiCaseReviewModes.Auto"/> order from A to Z: whenever such a draft reaches the story, truth,
/// logic or layout gate with nothing queued, the server approves it at once, as an admin would on /admin/ai. Quality
/// still comes from the server validators (a draft that fails them never reaches a gate) and from the bot's own
/// checks before it submits; people edit the finished case in the editor. FULL and FAST orders are left alone.
/// </summary>
public sealed class AiDraftAutopilot(
    MongoDbContext db, IAiCaseService cases, IAiDraftWorkflowCoordinator workflow, ILogger<AiDraftAutopilot> logger)
    : IAiDraftAutopilot
{
    public static readonly CurrentUser AutopilotUser = new("ai-autopilot", "AI autopilot", UserRole.Admin);
    private const int SweepLimit = 20;

    private static readonly IReadOnlyDictionary<string, string> Gates = new Dictionary<string, string>
    {
        [AiDraftStatus.StoryAwaitingApproval] = BridgeGates.Story,
        [AiDraftStatus.CaseTruthAwaitingApproval] = BridgeGates.Truth,
        [AiDraftStatus.FullLogicAwaitingApproval] = BridgeGates.Logic,
        [AiDraftStatus.SceneLayoutAwaitingApproval] = BridgeGates.Layout
    };

    /// <summary>The gate to pass now, or null: not an autopilot order, busy, still waiting for its owner, or a repair candidate is pending.</summary>
    public static string? GateToPass(AiCaseDraft draft)
    {
        if (draft.Order?.ReviewMode != AiCaseReviewModes.Auto) return null;
        if (draft.QueueState is not (AiQueueStates.None or "" or null)) return null;
        if (draft.OrderStatus is AiOrderStatuses.AwaitingOwnerApproval or AiOrderStatuses.Rejected) return null;
        if (draft.TruthRepairStatus == AiRepairStatus.CandidateReady || draft.RepairStatus == AiRepairStatus.CandidateReady) return null;
        return Gates.TryGetValue(draft.Status, out var gate) ? gate : null;
    }

    /// <summary>Approves the draft's gate as <see cref="AutopilotUser"/>. Returns the gate passed, or null (nothing to pass, or another approval won the race).</summary>
    public static async Task<string?> AdvanceAsync(AiCaseDraft draft, IAiCaseService cases)
    {
        var gate = GateToPass(draft);
        if (gate is null) return null;
        try
        {
            _ = gate switch
            {
                BridgeGates.Story => await cases.ApproveDraftAsync(AutopilotUser, draft.Id),
                BridgeGates.Truth => await cases.ApproveTruthAsync(AutopilotUser, draft.Id),
                BridgeGates.Logic => await cases.ApproveFullLogicAsync(AutopilotUser, draft.Id),
                _ => await cases.ApproveSceneLayoutAsync(AutopilotUser, draft.Id)
            };
            return gate;
        }
        catch (ApiException)
        {
            return null;
        }
    }

    public async Task AdvanceAsync(string draftId, CancellationToken ct)
    {
        var draft = await db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(ct);
        if (draft is null) return;
        var gate = await AdvanceAsync(draft, cases);
        if (gate is null) return;
        logger.LogInformation("Autopilot passed the {Gate} gate of draft {DraftId}.", gate, draftId);
        await workflow.SyncOrderStatusAsync(draftId, ct);
    }

    public async Task SweepAsync(CancellationToken ct)
    {
        var statuses = Gates.Keys.ToList();
        var waiting = await db.AiCaseDrafts
            .Find(item => item.Order != null && item.Order.ReviewMode == AiCaseReviewModes.Auto && statuses.Contains(item.Status))
            .Project(item => item.Id)
            .Limit(SweepLimit)
            .ToListAsync(ct);
        foreach (var draftId in waiting)
            await AdvanceAsync(draftId, ct);
    }
}
