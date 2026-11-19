using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public interface IAiDraftAutopilot
{
    /// <summary>Takes the next autopilot step of a draft (pass a gate, or repair a failed step), if any. Never throws for a lost race.</summary>
    Task AdvanceAsync(string draftId, CancellationToken ct);

    /// <summary>Safety net: advances every autopilot draft left waiting at a gate or a failure (a restart, a missed hook).</summary>
    Task SweepAsync(CancellationToken ct);
}

/// <summary>One thing the autopilot does next. <see cref="CostsRepair"/> steps count against <see cref="AiDraftAutopilot.MaxRepairs"/>.</summary>
public sealed record AutopilotStep(string Name, bool CostsRepair);

/// <summary>
/// Runs an <see cref="AiCaseReviewModes.Auto"/> order from A to Z, doing what an admin would do on /admin/ai:
/// <list type="bullet">
/// <item>a draft at the story, truth, logic or layout gate with nothing queued is approved at once;</item>
/// <item>a truth that fails validation is sent back for a scoped repair (from the last candidate when one failed),
/// and a valid repair candidate is accepted;</item>
/// <item>a logic step that fails validation is retried from its checkpoint.</item>
/// </list>
/// Repairs are bounded (<see cref="MaxRepairs"/> per draft); after that the draft stays where it is for a person.
/// Quality comes from the server validators and the bot's own checks before it submits; people edit the finished case
/// in the editor. FULL and FAST orders are left alone.
/// </summary>
public sealed class AiDraftAutopilot(
    MongoDbContext db, IAiCaseService cases, IAiDraftWorkflowCoordinator workflow, ILogger<AiDraftAutopilot> logger)
    : IAiDraftAutopilot
{
    public static readonly CurrentUser AutopilotUser = new("ai-autopilot", "AI autopilot", UserRole.Admin);
    public const int MaxRepairs = 3;
    /// <summary>A logic retry recompiles from the same truth and content, so a second one fails the same way.</summary>
    public const int MaxJsonRetries = 1;
    public const string RepairTruth = "REPAIR_TRUTH";
    public const string RepairTruthCandidate = "REPAIR_TRUTH_CANDIDATE";
    public const string AcceptTruthRepair = "ACCEPT_TRUTH_REPAIR";
    public const string RetryJson = "RETRY_JSON";
    private const int SweepLimit = 20;

    private const string RepairInstructions =
        "Autopilot repair: fix every error in the validation report with the smallest change, keep everything else, " +
        "and keep the order (level, world, suspects).";

    private static readonly IReadOnlyDictionary<string, string> Gates = new Dictionary<string, string>
    {
        [AiDraftStatus.StoryAwaitingApproval] = BridgeGates.Story,
        [AiDraftStatus.CaseTruthAwaitingApproval] = BridgeGates.Truth,
        [AiDraftStatus.FullLogicAwaitingApproval] = BridgeGates.Logic,
        [AiDraftStatus.SceneLayoutAwaitingApproval] = BridgeGates.Layout
    };

    private static readonly string[] FailedStatuses = [AiDraftStatus.CaseTruthInvalid, AiDraftStatus.GeneratedInvalid];

    private static bool Steerable(AiCaseDraft draft) =>
        draft.Order?.ReviewMode == AiCaseReviewModes.Auto
        && draft.QueueState is AiQueueStates.None or "" or null
        && draft.OrderStatus is not (AiOrderStatuses.AwaitingOwnerApproval or AiOrderStatuses.Rejected);

    /// <summary>The gate to pass now, or null: not an autopilot order, busy, still waiting for its owner, or a repair candidate is pending.</summary>
    public static string? GateToPass(AiCaseDraft draft)
    {
        if (!Steerable(draft)) return null;
        if (draft.TruthRepairStatus == AiRepairStatus.CandidateReady || draft.RepairStatus == AiRepairStatus.CandidateReady) return null;
        // The AI truth reviewer decides the TRUTH gate a person used to decide: a truth it failed is repaired, never passed.
        if (draft.Status == AiDraftStatus.CaseTruthAwaitingApproval && TruthReviewFailed(draft)) return null;
        // Likewise the AI blind detective decides the LOGIC gate: a logic it could not solve is repaired, never passed.
        if (draft.Status == AiDraftStatus.FullLogicAwaitingApproval && BlindReviewFailed(draft)) return null;
        return Gates.TryGetValue(draft.Status, out var gate) ? gate : null;
    }

    /// <summary>The blind detective named the wrong culprit or found more than one fit (not run or unavailable cannot judge).</summary>
    private static bool BlindReviewFailed(AiCaseDraft draft) =>
        draft.BlindReviewAssessment?.Status is BlindReviewAssessmentStatuses.Failed or BlindReviewAssessmentStatuses.Ambiguous;

    /// <summary>The independent AI review of the truth found a blocking defect (NOT_RUN means the reviewer could not run; the deterministic rules still passed).</summary>
    private static bool TruthReviewFailed(AiCaseDraft draft) =>
        draft.TruthReviewerResult?.Status is CaseTruthReviewStatuses.Failed or CaseTruthReviewStatuses.Ambiguous;

    /// <summary>The next step for an autopilot draft, or null when there is none (or the repair budget is spent).</summary>
    public static AutopilotStep? NextStep(AiCaseDraft draft)
    {
        if (GateToPass(draft) is { } gate) return new AutopilotStep(gate, false);
        if (!Steerable(draft)) return null;
        if (draft.TruthRepairStatus == AiRepairStatus.CandidateReady
            && draft.Status is AiDraftStatus.CaseTruthInvalid or AiDraftStatus.CaseTruthAwaitingApproval)
            return new AutopilotStep(AcceptTruthRepair, false);
        if (draft.AutopilotRepairs >= MaxRepairs) return null;
        return draft.Status switch
        {
            AiDraftStatus.CaseTruthInvalid => new AutopilotStep(
                draft.TruthRepairStatus == AiRepairStatus.CandidateInvalid ? RepairTruthCandidate : RepairTruth, true),
            // The repair prompt carries the reviewer's findings, and the repaired truth is reviewed again.
            AiDraftStatus.CaseTruthAwaitingApproval when TruthReviewFailed(draft) => new AutopilotStep(RepairTruth, true),
            // A causal case's logic is projected from its truth, so an unsolvable logic is repaired in the truth.
            AiDraftStatus.FullLogicAwaitingApproval when BlindReviewFailed(draft) => new AutopilotStep(RepairTruth, true),
            AiDraftStatus.GeneratedInvalid when draft.AutopilotJsonRetries < MaxJsonRetries => new AutopilotStep(RetryJson, true),
            _ => null
        };
    }

    /// <summary>Takes the draft's next step as <see cref="AutopilotUser"/>. Returns the step taken, or null (nothing to do, or another action won the race).</summary>
    public static async Task<string?> AdvanceAsync(AiCaseDraft draft, IAiCaseService cases, Action<string, ApiException>? refused = null)
    {
        var step = NextStep(draft);
        if (step is null) return null;
        try
        {
            _ = step.Name switch
            {
                BridgeGates.Story => await cases.ApproveDraftAsync(AutopilotUser, draft.Id),
                BridgeGates.Truth => await cases.ApproveTruthAsync(AutopilotUser, draft.Id),
                BridgeGates.Logic => await cases.ApproveFullLogicAsync(AutopilotUser, draft.Id),
                BridgeGates.Layout => await cases.ApproveSceneLayoutAsync(AutopilotUser, draft.Id),
                AcceptTruthRepair => await cases.AcceptTruthRepairAsync(AutopilotUser, draft.Id),
                RetryJson => await cases.RetryJsonAsync(AutopilotUser, draft.Id),
                _ => await cases.RepairTruthAsync(AutopilotUser, draft.Id, new RepairCaseTruthRequest
                {
                    UseRepairCandidate = step.Name == RepairTruthCandidate,
                    RepairInstructions = RepairInstructionsFor(draft)
                })
            };
            return step.Name;
        }
        catch (ApiException exception)
        {
            refused?.Invoke(step.Name, exception);
            return null;
        }
    }

    /// <summary>
    /// The repair's direction. A truth the validators or the truth reviewer failed already carries its findings into the
    /// repair prompt; a logic the blind detective could not solve carries the detective's findings here (at most 2,000
    /// characters, the request's limit).
    /// </summary>
    private static string RepairInstructionsFor(AiCaseDraft draft)
    {
        if (draft.Status != AiDraftStatus.FullLogicAwaitingApproval || !BlindReviewFailed(draft)) return RepairInstructions;
        var text = $"{RepairInstructions} The blind detective could not solve the case from the player's view; make exactly one suspect fit every claim through clues the players can find.\n{AiCaseService.BuildBlindReviewFeedback(draft.BlindSolvabilityReview)}";
        return text.Length <= 2000 ? text : text[..2000];
    }

    public async Task AdvanceAsync(string draftId, CancellationToken ct)
    {
        var draft = await db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(ct);
        if (draft is null) return;
        var step = NextStep(draft);
        if (step is null) return;
        if (step.CostsRepair)
        {
            // Claim one repair from the budget first, so two sweeps never repair the same failure twice. A draft that
            // was never repaired has no autopilotRepairs field at all (it is written only when not 0), and an equality
            // on 0 does not match a missing field in MongoDB.
            var filter = Builders<AiCaseDraft>.Filter;
            var used = draft.AutopilotRepairs == 0
                ? filter.Or(filter.Eq(item => item.AutopilotRepairs, 0), filter.Exists(item => item.AutopilotRepairs, false))
                : filter.Eq(item => item.AutopilotRepairs, draft.AutopilotRepairs);
            var claimed = await db.AiCaseDrafts.UpdateOneAsync(
                filter.And(filter.Eq(item => item.Id, draftId), filter.Eq(item => item.Status, draft.Status), used),
                step.Name == RetryJson
                    ? Builders<AiCaseDraft>.Update.Inc(item => item.AutopilotRepairs, 1).Inc(item => item.AutopilotJsonRetries, 1)
                    : Builders<AiCaseDraft>.Update.Inc(item => item.AutopilotRepairs, 1),
                cancellationToken: ct);
            if (claimed.ModifiedCount == 0) return;
        }
        var taken = await AdvanceAsync(draft, cases, (name, exception) =>
            logger.LogWarning("Autopilot step {Step} on draft {DraftId} was refused: {Reason}", name, draftId, exception.Message));
        if (taken is null) return;
        logger.LogInformation("Autopilot took step {Step} on draft {DraftId} (repairs used {Repairs}/{Max}).",
            taken, draftId, draft.AutopilotRepairs + (step.CostsRepair ? 1 : 0), MaxRepairs);
        await workflow.SyncOrderStatusAsync(draftId, ct);
    }

    public async Task SweepAsync(CancellationToken ct)
    {
        var statuses = Gates.Keys.Concat(FailedStatuses).ToList();
        var waiting = await db.AiCaseDrafts
            .Find(item => item.Order != null && item.Order.ReviewMode == AiCaseReviewModes.Auto && statuses.Contains(item.Status))
            .Project(item => item.Id)
            .Limit(SweepLimit)
            .ToListAsync(ct);
        foreach (var draftId in waiting)
            await AdvanceAsync(draftId, ct);
    }
}
