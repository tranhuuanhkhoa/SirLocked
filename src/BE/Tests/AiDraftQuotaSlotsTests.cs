using MongoDB.Bson;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiDraftQuotaSlotsTests
{
    [Fact]
    public void SlotOne_PreservesLegacyKey_AndAdditionalSlotsAreBoundedByCaller()
    {
        Assert.Equal("owner", AiDraftQuotaSlots.ActiveKey("owner", 1));
        Assert.Equal("owner:active:2", AiDraftQuotaSlots.ActiveKey("owner", 2));
        Assert.Equal("owner:active:3", AiDraftQuotaSlots.ActiveKey("owner", 3));
        Assert.Throws<ArgumentOutOfRangeException>(() => AiDraftQuotaSlots.ActiveKey("owner", 0));
    }

    [Fact]
    public void DuplicateClassifier_DistinguishesQuotaIndexes_WithoutMatchingUnrelatedKeys()
    {
        Assert.Equal(AiDraftInsertCollision.ActiveQuota, Classify("activeQuotaKey"));
        Assert.Equal(AiDraftInsertCollision.DailyQuota, Classify("dailyQuotaKey"));
        Assert.Equal(AiDraftInsertCollision.OtherDuplicate, Classify("idempotencyKey"));
        const string activeMessage = "E11000 index: ux_aiCaseDrafts_activeQuotaKey dup key: { activeQuotaKey: owner }";
        Assert.Equal(AiDraftInsertCollision.ActiveQuota, AiDraftQuotaSlots.ClassifyDuplicate(null, activeMessage));
        Assert.Equal(AiDraftInsertCollision.DailyQuota, AiDraftQuotaSlots.ClassifyDuplicate(null,
            "E11000 index: ux_aiCaseDrafts_dailyQuotaKey dup key: { dailyQuotaKey: owner:day }"));
        Assert.Equal(AiDraftInsertCollision.OtherDuplicate, AiDraftQuotaSlots.ClassifyDuplicate(null,
            "E11000 index: unrelated dup key: { idempotencyKey: ux_aiCaseDrafts_activeQuotaKey }"));
        Assert.Equal(AiDraftInsertCollision.OtherDuplicate, AiDraftQuotaSlots.ClassifyDuplicate(
            new BsonDocument("keyPattern", new BsonDocument { ["createdByUserId"] = 1, ["activeQuotaKey"] = 1 }), activeMessage));

        static AiDraftInsertCollision Classify(string field) => AiDraftQuotaSlots.ClassifyDuplicate(
            new BsonDocument("keyPattern", new BsonDocument(field, 1)), "");
    }

    [Fact]
    public async Task LegacyAndSecondSlotOccupied_ClaimsThird_WithSameDraftAndOneReservation()
    {
        var draft = Draft();
        var keys = new List<string?>();
        var ids = new List<string>();
        var releases = 0;
        var result = await AiDraftQuotaSlots.InsertAsync(draft, 3, candidate =>
        {
            keys.Add(candidate.ActiveQuotaKey);
            ids.Add(candidate.Id);
            Assert.Equal(2m, candidate.ReservedBudgetUsd);
            return Task.FromResult(keys.Count < 3 ? AiDraftInsertCollision.ActiveQuota : AiDraftInsertCollision.None);
        }, () => Task.FromResult<AiCaseDraft?>(null), () => { releases++; return Task.CompletedTask; });

        Assert.Same(draft, result);
        Assert.Equal(new[] { "owner", "owner:active:2", "owner:active:3" }, keys);
        Assert.All(ids, id => Assert.Equal(draft.Id, id));
        Assert.Equal(0, releases);
    }

    [Theory]
    [InlineData((int)AiDraftInsertCollision.ActiveQuota, 3, "AI_ACTIVE_DRAFT_LIMIT")]
    [InlineData((int)AiDraftInsertCollision.DailyQuota, 1, "AI_DAILY_LIMIT")]
    [InlineData((int)AiDraftInsertCollision.OtherDuplicate, 1, "AI_QUOTA_RACE")]
    public async Task FailedClaim_ReleasesExactlyOnce_AndRetriesOnlyActiveIndex(
        int collisionValue, int expectedAttempts, string expectedCode)
    {
        var attempts = 0;
        var releases = 0;
        var error = await Assert.ThrowsAsync<ApiException>(() => AiDraftQuotaSlots.InsertAsync(Draft(), 3,
            _ => { attempts++; return Task.FromResult((AiDraftInsertCollision)collisionValue); },
            () => Task.FromResult<AiCaseDraft?>(null),
            () => { releases++; return Task.CompletedTask; }));

        Assert.Equal(expectedAttempts, attempts);
        Assert.Equal(expectedCode, Assert.IsType<ApiErrorDetails>(error.Errors).Code);
        Assert.Equal(1, releases);
    }

    [Theory]
    [InlineData((int)AiDraftInsertCollision.ActiveQuota)]
    [InlineData((int)AiDraftInsertCollision.DailyQuota)]
    [InlineData((int)AiDraftInsertCollision.OtherDuplicate)]
    public async Task SameKeyRace_RecoversWinnerBeforeRetryOrQuotaFailure(int collisionValue)
    {
        var winner = Draft();
        var attempts = 0;
        var releases = 0;
        var result = await AiDraftQuotaSlots.InsertAsync(Draft(), 3,
            _ => { attempts++; return Task.FromResult((AiDraftInsertCollision)collisionValue); },
            () => Task.FromResult<AiCaseDraft?>(winner),
            () => { releases++; return Task.CompletedTask; });

        Assert.Same(winner, result);
        Assert.Equal(1, attempts);
        Assert.Equal(1, releases);
    }

    [Fact]
    public async Task IncompatibleIdempotentWinner_ReleasesReservationWithoutRetry()
    {
        var attempts = 0;
        var releases = 0;
        var error = await Assert.ThrowsAsync<ApiException>(() => AiDraftQuotaSlots.InsertAsync(Draft(), 3,
            _ => { attempts++; return Task.FromResult(AiDraftInsertCollision.ActiveQuota); },
            () => throw ApiException.Conflict("different constraints", "AI_IDEMPOTENCY_CONFLICT", "ai.idempotency.conflict"),
            () => { releases++; return Task.CompletedTask; }));

        Assert.Equal("AI_IDEMPOTENCY_CONFLICT", Assert.IsType<ApiErrorDetails>(error.Errors).Code);
        Assert.Equal(1, attempts);
        Assert.Equal(1, releases);
    }

    [Fact]
    public async Task ExemptRequest_DoesNotClaimAnyActiveSlot()
    {
        var draft = Draft();
        draft.ActiveQuotaKey = "previous-key";
        var attempts = 0;
        await AiDraftQuotaSlots.InsertAsync(draft, 0, candidate =>
        {
            attempts++;
            Assert.Null(candidate.ActiveQuotaKey);
            return Task.FromResult(AiDraftInsertCollision.None);
        }, () => throw new InvalidOperationException("No duplicate lookup expected"),
            () => throw new InvalidOperationException("No release expected"));
        Assert.Equal(1, attempts);
    }

    private static AiCaseDraft Draft() => new()
    {
        Id = ObjectId.GenerateNewId().ToString(), CreatedByUserId = "owner", ReservedBudgetUsd = 2m
    };
}
