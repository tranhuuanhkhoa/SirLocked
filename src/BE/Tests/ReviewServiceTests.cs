using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// Covers the review gate, result label, upsert identity and summary maths through <see cref="ReviewRules"/>,
/// the pure decision core that <c>ReviewService</c> delegates to (DB I/O is the only part not exercised here).
/// </summary>
public class ReviewServiceTests
{
    private static readonly DateTime Now = new(2026, 6, 19, 10, 0, 0, DateTimeKind.Utc);

    // --- GATE: not played ---

    [Fact]
    public void ResolveEligibility_NotPlayed_WhenNoGameResults()
    {
        var reason = ReviewRules.ResolveEligibility(hasPlayed: false, isAuthor: false, alreadyReviewed: false);
        Assert.Equal(ReviewEligibilityReasons.NotPlayed, reason);
        Assert.False(ReviewRules.CanSubmit(reason));
    }

    [Fact]
    public void EnsureSubmittable_Throws_WhenNotPlayed()
    {
        var error = Assert.Throws<ApiException>(() => ReviewRules.EnsureSubmittable(ReviewEligibilityReasons.NotPlayed));
        Assert.Equal(403, error.StatusCode);
    }

    // --- GATE: own case ---

    [Fact]
    public void ResolveEligibility_OwnCase_WhenAuthor()
    {
        // Ownership blocks even a player who finished the case.
        var reason = ReviewRules.ResolveEligibility(hasPlayed: true, isAuthor: true, alreadyReviewed: false);
        Assert.Equal(ReviewEligibilityReasons.OwnCase, reason);
        Assert.False(ReviewRules.CanSubmit(reason));
    }

    [Fact]
    public void EnsureSubmittable_Throws_WhenOwnCase()
    {
        var error = Assert.Throws<ApiException>(() => ReviewRules.EnsureSubmittable(ReviewEligibilityReasons.OwnCase));
        Assert.Equal(403, error.StatusCode);
    }

    // --- GATE: ok / already reviewed both allow submitting ---

    [Fact]
    public void ResolveEligibility_Ok_WhenPlayedNotAuthorNoReview()
    {
        var reason = ReviewRules.ResolveEligibility(hasPlayed: true, isAuthor: false, alreadyReviewed: false);
        Assert.Equal(ReviewEligibilityReasons.Ok, reason);
        Assert.True(ReviewRules.CanSubmit(reason));
    }

    [Fact]
    public void ResolveEligibility_AlreadyReviewed_StillAllowsEditing()
    {
        var reason = ReviewRules.ResolveEligibility(hasPlayed: true, isAuthor: false, alreadyReviewed: true);
        Assert.Equal(ReviewEligibilityReasons.AlreadyReviewed, reason);
        Assert.True(ReviewRules.CanSubmit(reason));
        // No exception when the gate allows it.
        ReviewRules.EnsureSubmittable(reason);
    }

    // --- result label ---

    [Fact]
    public void ResultLabel_Solved_WhenEverSucceeded()
    {
        Assert.Equal(ReviewResultLabels.Solved, ReviewRules.ResultLabel(everSucceeded: true));
    }

    [Fact]
    public void ResultLabel_WrongAccusation_WhenNeverSucceeded()
    {
        Assert.Equal(ReviewResultLabels.WrongAccusation, ReviewRules.ResultLabel(everSucceeded: false));
    }

    // --- upsert: second submit updates the same record, never duplicates ---

    [Fact]
    public void BuildReview_Insert_WhenNoExisting()
    {
        var review = ReviewRules.BuildReview(
            existing: null, "case-1", "user-1", "Holmes",
            rating: 4, difficulty: 3, fairness: null, story: null, twist: null,
            reviewText: "Solid.", containsSpoiler: false,
            resultLabel: ReviewResultLabels.Solved, now: Now, newId: "id-new");

        Assert.Equal("id-new", review.Id);
        Assert.Equal(Now, review.CreatedAt);
        Assert.Equal(Now, review.UpdatedAt);
        Assert.Equal(4, review.Rating);
    }

    [Fact]
    public void BuildReview_Update_PreservesIdentity_NoDuplicate()
    {
        var created = new DateTime(2026, 6, 1, 8, 0, 0, DateTimeKind.Utc);
        var existing = new CaseReview
        {
            Id = "id-existing",
            CaseId = "case-1",
            UserId = "user-1",
            Rating = 2,
            CreatedAt = created,
            UpdatedAt = created
        };

        var updated = ReviewRules.BuildReview(
            existing, "case-1", "user-1", "Holmes",
            rating: 5, difficulty: null, fairness: null, story: null, twist: null,
            reviewText: "Changed my mind.", containsSpoiler: true,
            resultLabel: ReviewResultLabels.Solved, now: Now, newId: "id-should-be-ignored");

        Assert.Same(existing, updated);              // same document → ReplaceOne updates in place
        Assert.Equal("id-existing", updated.Id);     // identity preserved, no new row
        Assert.Equal(created, updated.CreatedAt);    // createdAt untouched
        Assert.Equal(Now, updated.UpdatedAt);        // updatedAt bumped
        Assert.Equal(5, updated.Rating);
        Assert.True(updated.ContainsSpoiler);
    }

    // --- summary maths ---

    [Fact]
    public void Summarize_EmptyList_NoDivideByZero()
    {
        var summary = ReviewRules.Summarize(Array.Empty<CaseReview>());

        Assert.Equal(0, summary.TotalReviews);
        Assert.Equal(0, summary.AvgRating);
        Assert.Null(summary.AvgDifficulty);
        Assert.Null(summary.AvgFairness);
        Assert.Null(summary.AvgStory);
        Assert.Null(summary.AvgTwist);
    }

    [Fact]
    public void Summarize_AveragesOverall_AndIgnoresNullSubRatings()
    {
        var reviews = new[]
        {
            new CaseReview { Rating = 4, Difficulty = 2, Fairness = null, Story = 5, Twist = null },
            new CaseReview { Rating = 5, Difficulty = 4, Fairness = null, Story = null, Twist = 3 },
            new CaseReview { Rating = 3, Difficulty = null, Fairness = null, Story = null, Twist = null }
        };

        var summary = ReviewRules.Summarize(reviews);

        Assert.Equal(3, summary.TotalReviews);
        Assert.Equal(4.0, summary.AvgRating);                 // (4+5+3)/3
        Assert.Equal(3.0, summary.AvgDifficulty);             // (2+4)/2, third is null
        Assert.Null(summary.AvgFairness);                     // nobody scored fairness
        Assert.Equal(5.0, summary.AvgStory);                  // only one score
        Assert.Equal(3.0, summary.AvgTwist);                  // only one score
    }

    // --- validation ---

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    public void ValidateRating_Rejects_OutOfRange(int rating)
    {
        var error = Assert.Throws<ApiException>(() => ReviewRules.ValidateRating(rating));
        Assert.Equal(400, error.StatusCode);
    }

    [Fact]
    public void ValidateSubRating_AllowsNull()
    {
        Assert.Null(ReviewRules.ValidateSubRating(null, "Difficulty"));
    }

    [Fact]
    public void NormalizeText_Rejects_TooLong()
    {
        var tooLong = new string('x', ReviewRules.MaxReviewTextLength + 1);
        var error = Assert.Throws<ApiException>(() => ReviewRules.NormalizeText(tooLong));
        Assert.Equal(400, error.StatusCode);
    }
}
