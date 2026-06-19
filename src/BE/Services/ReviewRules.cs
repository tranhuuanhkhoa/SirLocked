using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Review;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// Pure decision logic for the review feature (eligibility gate, result label, validation, summary).
/// Kept free of I/O so the gate can be unit-tested without a database.
/// </summary>
public static class ReviewRules
{
    public const int MaxReviewTextLength = 2000;
    private const int MinScore = 1;
    private const int MaxScore = 5;

    /// <summary>
    /// Decides why (or whether) a player may review a case. Ownership is the hardest block and wins
    /// over "not played"; an existing review still allows editing.
    /// </summary>
    public static string ResolveEligibility(bool hasPlayed, bool isAuthor, bool alreadyReviewed)
    {
        if (isAuthor) return ReviewEligibilityReasons.OwnCase;
        if (!hasPlayed) return ReviewEligibilityReasons.NotPlayed;
        if (alreadyReviewed) return ReviewEligibilityReasons.AlreadyReviewed;
        return ReviewEligibilityReasons.Ok;
    }

    /// <summary>True when the caller can submit (create or update) given the resolved reason.</summary>
    public static bool CanSubmit(string reason) =>
        reason is ReviewEligibilityReasons.Ok or ReviewEligibilityReasons.AlreadyReviewed;

    /// <summary>Throws a clear API error when the gate forbids submitting. No-op when allowed.</summary>
    public static void EnsureSubmittable(string reason)
    {
        switch (reason)
        {
            case ReviewEligibilityReasons.OwnCase:
                throw ApiException.Forbidden("You cannot review a case you created.");
            case ReviewEligibilityReasons.NotPlayed:
                throw ApiException.Forbidden("You must finish this case before you can review it.");
        }
    }

    public static string ResultLabel(bool everSucceeded) =>
        everSucceeded ? ReviewResultLabels.Solved : ReviewResultLabels.WrongAccusation;

    /// <summary>
    /// Produces the document to persist for an upsert. When <paramref name="existing"/> is supplied the
    /// same document is updated in place (preserving its id and createdAt) so a second submit never
    /// creates a duplicate; otherwise a fresh document with a new id is returned.
    /// </summary>
    public static CaseReview BuildReview(
        CaseReview? existing,
        string caseId,
        string userId,
        string authorDisplay,
        int rating,
        int? difficulty,
        int? fairness,
        int? story,
        int? twist,
        string reviewText,
        bool containsSpoiler,
        string resultLabel,
        DateTime now,
        string newId)
    {
        var review = existing ?? new CaseReview
        {
            Id = newId,
            CaseId = caseId,
            UserId = userId,
            CreatedAt = now
        };

        review.AuthorDisplay = authorDisplay;
        review.Rating = rating;
        review.Difficulty = difficulty;
        review.Fairness = fairness;
        review.Story = story;
        review.Twist = twist;
        review.ReviewText = reviewText;
        review.ContainsSpoiler = containsSpoiler;
        review.ResultLabel = resultLabel;
        review.UpdatedAt = now;
        return review;
    }

    public static int ValidateRating(int rating)
    {
        if (rating < MinScore || rating > MaxScore)
        {
            throw ApiException.BadRequest("Rating must be between 1 and 5.");
        }
        return rating;
    }

    public static int? ValidateSubRating(int? value, string label)
    {
        if (value is null) return null;
        if (value < MinScore || value > MaxScore)
        {
            throw ApiException.BadRequest($"{label} rating must be between 1 and 5.");
        }
        return value;
    }

    public static string NormalizeText(string? text)
    {
        var trimmed = (text ?? string.Empty).Trim();
        if (trimmed.Length > MaxReviewTextLength)
        {
            throw ApiException.BadRequest($"Review text must be {MaxReviewTextLength} characters or fewer.");
        }
        return trimmed;
    }

    /// <summary>
    /// Averages overall + sub-ratings. Sub-rating averages only count reviews that scored that aspect;
    /// an empty input yields zeroes/nulls without dividing by zero.
    /// </summary>
    public static ReviewSummaryDto Summarize(IReadOnlyCollection<CaseReview> reviews)
    {
        if (reviews.Count == 0)
        {
            return new ReviewSummaryDto { TotalReviews = 0, AvgRating = 0 };
        }

        return new ReviewSummaryDto
        {
            TotalReviews = reviews.Count,
            AvgRating = Math.Round(reviews.Average(r => (double)r.Rating), 2),
            AvgDifficulty = AverageOf(reviews, r => r.Difficulty),
            AvgFairness = AverageOf(reviews, r => r.Fairness),
            AvgStory = AverageOf(reviews, r => r.Story),
            AvgTwist = AverageOf(reviews, r => r.Twist)
        };
    }

    private static double? AverageOf(IEnumerable<CaseReview> reviews, Func<CaseReview, int?> selector)
    {
        var scored = reviews.Select(selector).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return scored.Count == 0 ? null : Math.Round(scored.Average(), 2);
    }
}
