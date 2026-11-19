using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Bridge;

namespace SirLocked.Api.Services;

/// <summary>
/// VIP orders wait for an admin. Approval queues the story preview for Claude; rejection closes the order and frees
/// the VIP's weekly slot. ADMIN orders never pass through here.
/// </summary>
public partial class AiCaseService
{
    public const int MaxRejectReasonLength = 500;

    public async Task<AiDraftResponse> ApproveOrderAsync(CurrentUser user, string draftId)
    {
        EnsureAdmin(user);
        var draft = await _db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("AI draft not found.");
        if (draft.OrderStatus != AiOrderStatuses.AwaitingOwnerApproval)
        {
            if (draft.OrderStatus is AiOrderStatuses.QueuedForClaude or AiOrderStatuses.ClaudeWorking)
                return AiDraftResponse.From(draft, includeJson: false); // A repeated click is harmless.
            throw ApiException.Conflict("Only an order waiting for approval can be approved.",
                "AI_ORDER_NOT_AWAITING_APPROVAL", "ai.order.notAwaitingApproval");
        }

        var now = DateTime.UtcNow;
        var approved = await _db.AiCaseDrafts.FindOneAndUpdateAsync(
            item => item.Id == draft.Id
                && item.WorkflowVersion == draft.WorkflowVersion
                && item.OrderStatus == AiOrderStatuses.AwaitingOwnerApproval
                && item.Status == AiDraftStatus.GeneratingStory,
            Builders<AiCaseDraft>.Update
                .Set(item => item.QueuedOperation, AiQueuedOperations.StoryPreview)
                .Set(item => item.QueueState, AiQueueStates.Pending)
                .Set(item => item.GenerationPhase, "STORY_PREVIEW")
                .Set(item => item.GenerationRunId, string.Empty)
                .Set(item => item.OperationRunId, Guid.NewGuid().ToString("N"))
                .Set(item => item.NextAttemptAt, now)
                .Set(item => item.OrderStatus, AiOrderStatuses.QueuedForClaude)
                .Push(item => item.OrderStatusHistory, new AiOrderStatusChange
                {
                    Status = AiOrderStatuses.QueuedForClaude, At = now, ByUserId = user.Id
                })
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, now),
            new FindOneAndUpdateOptions<AiCaseDraft> { ReturnDocument = ReturnDocument.After })
            ?? throw ApiException.Conflict("The order changed before it could be approved.",
                "AI_WORKFLOW_CONFLICT", "ai.workflow.conflict");
        return AiDraftResponse.From(approved, includeJson: false);
    }

    public async Task<AiDraftResponse> RejectOrderAsync(CurrentUser user, string draftId, string reason)
    {
        EnsureAdmin(user);
        var trimmed = (reason ?? string.Empty).Trim();
        if (trimmed.Length == 0 || trimmed.Length > MaxRejectReasonLength)
            throw ApiException.BadRequest($"A rejection needs a reason of at most {MaxRejectReasonLength} characters.",
                new ApiErrorDetails("AI_ORDER_REASON_REQUIRED", "ai.order.reasonRequired"));
        var draft = await _db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("AI draft not found.");
        if (draft.OrderStatus == AiOrderStatuses.Rejected) return AiDraftResponse.From(draft, includeJson: false);
        if (draft.OrderStatus != AiOrderStatuses.AwaitingOwnerApproval)
            throw ApiException.Conflict("Only an order waiting for approval can be rejected. Cancel the draft instead.",
                "AI_ORDER_NOT_AWAITING_APPROVAL", "ai.order.notAwaitingApproval");

        var now = DateTime.UtcNow;
        var rejected = await _db.AiCaseDrafts.FindOneAndUpdateAsync(
            item => item.Id == draft.Id
                && item.WorkflowVersion == draft.WorkflowVersion
                && item.OrderStatus == AiOrderStatuses.AwaitingOwnerApproval,
            Builders<AiCaseDraft>.Update
                .Set(item => item.Status, AiDraftStatus.Cancelled)
                .Set(item => item.QueueState, AiQueueStates.Cancelled)
                .Set(item => item.QueuedOperation, AiQueuedOperations.None)
                .Set(item => item.NextAttemptAt, null)
                // A rejected order does not count against the VIP's week or active drafts.
                .Set(item => item.WeeklyQuotaKey, null)
                .Set(item => item.ActiveQuotaKey, null)
                .Set(item => item.OrderStatus, AiOrderStatuses.Rejected)
                .Set(item => item.OrderRejectReason, trimmed)
                .Push(item => item.OrderStatusHistory, new AiOrderStatusChange
                {
                    Status = AiOrderStatuses.Rejected, At = now, ByUserId = user.Id, Reason = trimmed
                })
                .Set(item => item.CancelledAt, now)
                .Set(item => item.CancelledByUserId, user.Id)
                .Inc(item => item.WorkflowVersion, 1)
                .Set(item => item.UpdatedAt, now),
            new FindOneAndUpdateOptions<AiCaseDraft> { ReturnDocument = ReturnDocument.After })
            ?? throw ApiException.Conflict("The order changed before it could be rejected.",
                "AI_WORKFLOW_CONFLICT", "ai.workflow.conflict");
        await new AiBridgeRequestStore(_db, TimeProvider.System, _bridgeNotifier).CancelOwnerAsync(AiBridgeOwnerTypes.CaseDraft, rejected.Id);
        if (rejected.VipBilling is not null && _vipBilling is not null)
        {
            // VUAN-7: a rejected paid VIP order gets every held coin back at once.
            await _vipBilling.SettleAsync(rejected.Id);
            rejected = await _db.AiCaseDrafts.Find(item => item.Id == rejected.Id).FirstOrDefaultAsync() ?? rejected;
        }
        return AiDraftResponse.From(rejected, includeJson: false);
    }

    /// <summary>
    /// The caller's weekly order allowance, for the order form. ADMIN orders have no weekly limit; a VIP sees the
    /// limit, the orders that count against it this week (rejected ones do not) and what is left.
    /// </summary>
    public async Task<AiOrderQuotaResponse> GetOrderQuotaAsync(CurrentUser user)
    {
        var week = VietnamQuotaWeek(DateTime.UtcNow);
        if (string.Equals(user.Role, UserRole.Admin, StringComparison.OrdinalIgnoreCase))
            return new AiOrderQuotaResponse { Role = UserRole.Admin, Unlimited = true, WeekStart = week };
        var limit = (await new AiCaseSettingsStore(_db).GetAsync()).VipWeeklyOrderLimit;
        var used = (int)await _db.AiCaseDrafts.CountDocumentsAsync(item => item.CreatedByUserId == user.Id
            && item.QuotaWeek == week && item.WeeklyQuotaKey != null);
        return new AiOrderQuotaResponse
        {
            Role = user.Role,
            WeeklyLimit = limit,
            UsedThisWeek = used,
            Remaining = Math.Max(0, limit - used),
            WeekStart = week
        };
    }

    private static void EnsureOrderApproved(AiCaseDraft draft)
    {
        if (draft.OrderStatus == AiOrderStatuses.AwaitingOwnerApproval)
            throw ApiException.Conflict("This order is waiting for an admin to approve it.",
                "AI_ORDER_AWAITING_APPROVAL", "ai.order.awaitingApproval");
        if (draft.OrderStatus == AiOrderStatuses.Rejected)
            throw ApiException.Conflict("This order was rejected.", "AI_ORDER_REJECTED", "ai.order.rejected");
    }
}
