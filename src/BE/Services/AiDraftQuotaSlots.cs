using MongoDB.Bson;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

internal enum AiDraftInsertCollision { None, ActiveQuota, DailyQuota, OtherDuplicate }

/// <summary>Bounded claims through the existing unique quota indexes; no quota migration or provider work.</summary>
internal static class AiDraftQuotaSlots
{
    internal static string ActiveKey(string userId, int slot)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(slot, 1);
        // Slot one must collide with the original single-draft key.
        return slot == 1 ? userId : $"{userId}:active:{slot}";
    }

    internal static AiDraftInsertCollision ClassifyDuplicate(BsonDocument? details, string message)
    {
        if (details?.TryGetValue("keyPattern", out var value) == true)
        {
            if (!value.IsBsonDocument || value.AsBsonDocument.ElementCount != 1)
                return AiDraftInsertCollision.OtherDuplicate;
            return value.AsBsonDocument.GetElement(0).Name switch
            {
                "activeQuotaKey" => AiDraftInsertCollision.ActiveQuota,
                "dailyQuotaKey" => AiDraftInsertCollision.DailyQuota,
                _ => AiDraftInsertCollision.OtherDuplicate
            };
        }
        // Some supported driver/server combinations omit keyPattern. Match only
        // the exact named index, never the duplicated value or a field substring.
        if (message.Contains("index: ux_aiCaseDrafts_activeQuotaKey dup key:", StringComparison.Ordinal))
            return AiDraftInsertCollision.ActiveQuota;
        if (message.Contains("index: ux_aiCaseDrafts_dailyQuotaKey dup key:", StringComparison.Ordinal))
            return AiDraftInsertCollision.DailyQuota;
        return AiDraftInsertCollision.OtherDuplicate;
    }

    internal static async Task<AiCaseDraft> InsertAsync(
        AiCaseDraft draft,
        int maximumSlots,
        Func<AiCaseDraft, Task<AiDraftInsertCollision>> insert,
        Func<Task<AiCaseDraft?>> findIdempotentWinner,
        Func<Task> releaseReservation)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(maximumSlots);
        var attempts = Math.Max(1, maximumSlots); // Zero keeps mock/dry-run quota exemptions.
        for (var index = 0; index < attempts; index++)
        {
            draft.ActiveQuotaKey = maximumSlots == 0 ? null : ActiveKey(draft.CreatedByUserId, index + 1);
            var collision = await insert(draft);
            if (collision == AiDraftInsertCollision.None) return draft;

            AiCaseDraft? winner;
            try { winner = await findIdempotentWinner(); }
            catch
            {
                await releaseReservation();
                throw;
            }
            if (winner is not null)
            {
                await releaseReservation();
                return winner;
            }
            if (collision == AiDraftInsertCollision.ActiveQuota && index + 1 < attempts)
                continue; // Keep this request's single admission reservation across slot retries.

            await releaseReservation();
            throw collision switch
            {
                AiDraftInsertCollision.ActiveQuota => ActiveLimitReached(),
                AiDraftInsertCollision.DailyQuota => DailyLimitReached(),
                _ => ApiException.Conflict(
                    "The AI quota was claimed by another request. Continue or cancel the existing draft before creating another.",
                    "AI_QUOTA_RACE", "ai.quota.concurrentCreate")
            };
        }
        throw new InvalidOperationException("The bounded quota claim ended without a result.");
    }

    internal static ApiException ActiveLimitReached() => ApiException.Conflict(
        "You have reached the active AI draft limit. Continue or cancel an existing draft before creating another.",
        "AI_ACTIVE_DRAFT_LIMIT", "ai.quota.activeDraftLimit");

    internal static ApiException DailyLimitReached() => ApiException.Conflict(
        "You have reached today's AI case creation limit.", "AI_DAILY_LIMIT", "ai.quota.dailyLimit");
}
