using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.Review;

/// <summary>Review as returned to clients.</summary>
public class ReviewDto
{
    public string Id { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string AuthorDisplay { get; set; } = string.Empty;
    public int Rating { get; set; }
    public int? Difficulty { get; set; }
    public int? Fairness { get; set; }
    public int? Story { get; set; }
    public int? Twist { get; set; }
    public string ReviewText { get; set; } = string.Empty;
    public bool ContainsSpoiler { get; set; }
    public string ResultLabel { get; set; } = ReviewResultLabels.WrongAccusation;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public static ReviewDto From(CaseReview review) => new()
    {
        Id = review.Id,
        CaseId = review.CaseId,
        UserId = review.UserId,
        AuthorDisplay = review.AuthorDisplay,
        Rating = review.Rating,
        Difficulty = review.Difficulty,
        Fairness = review.Fairness,
        Story = review.Story,
        Twist = review.Twist,
        ReviewText = review.ReviewText,
        ContainsSpoiler = review.ContainsSpoiler,
        ResultLabel = review.ResultLabel,
        CreatedAt = review.CreatedAt,
        UpdatedAt = review.UpdatedAt
    };
}

/// <summary>Payload accepted when submitting (creating or updating) a review.</summary>
public class SubmitReviewDto
{
    public int Rating { get; set; }
    public int? Difficulty { get; set; }
    public int? Fairness { get; set; }
    public int? Story { get; set; }
    public int? Twist { get; set; }
    public string? ReviewText { get; set; }
    public bool ContainsSpoiler { get; set; }
}

/// <summary>Aggregate ratings for a case. Sub-rating averages are null when nobody scored that aspect.</summary>
public class ReviewSummaryDto
{
    public int TotalReviews { get; set; }
    public double AvgRating { get; set; }
    public double? AvgDifficulty { get; set; }
    public double? AvgFairness { get; set; }
    public double? AvgStory { get; set; }
    public double? AvgTwist { get; set; }
}

/// <summary>Whether the caller may review the case, and their existing review if any.</summary>
public class ReviewEligibilityDto
{
    public bool CanReview { get; set; }
    /// <summary>One of <see cref="ReviewEligibilityReasons"/>.</summary>
    public string Reason { get; set; } = ReviewEligibilityReasons.NotPlayed;
    public bool AlreadyReviewed { get; set; }
    public ReviewDto? ExistingReview { get; set; }
}

/// <summary>A page of reviews, newest first.</summary>
public class ReviewPageDto
{
    public List<ReviewDto> Items { get; set; } = new();
    public int Page { get; set; }
    public int PageSize { get; set; }
    public long Total { get; set; }
    public bool HasMore { get; set; }
}
