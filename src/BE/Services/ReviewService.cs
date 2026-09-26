using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Review;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class ReviewService : IReviewService
{
    public const int DefaultPageSize = 10;
    public const int MaxPageSize = 50;

    private readonly MongoDbContext _db;

    public ReviewService(MongoDbContext db) => _db = db;

    public async Task<ReviewEligibilityDto> CheckEligibilityAsync(CurrentUser user, string caseId, CancellationToken ct = default)
    {
        var hasPlayed = await HasPlayedAsync(user.Id, caseId, ct);
        var isAuthor = await IsAuthorAsync(user.Id, caseId, ct);
        var existing = await FindReviewAsync(user.Id, caseId, ct);

        var reason = ReviewRules.ResolveEligibility(hasPlayed, isAuthor, existing is not null);
        return new ReviewEligibilityDto
        {
            CanReview = ReviewRules.CanSubmit(reason),
            Reason = reason,
            AlreadyReviewed = existing is not null,
            ExistingReview = existing is null ? null : ReviewDto.From(existing)
        };
    }

    public async Task<ReviewDto> SubmitReviewAsync(CurrentUser user, string caseId, SubmitReviewDto dto, CancellationToken ct = default)
    {
        // Validate the payload server-side; never trust the client.
        var rating = ReviewRules.ValidateRating(dto.Rating);
        var difficulty = ReviewRules.ValidateSubRating(dto.Difficulty, "Difficulty");
        var fairness = ReviewRules.ValidateSubRating(dto.Fairness, "Fairness");
        var story = ReviewRules.ValidateSubRating(dto.Story, "Story");
        var twist = ReviewRules.ValidateSubRating(dto.Twist, "Twist");
        var text = ReviewRules.NormalizeText(dto.ReviewText);

        // Re-enforce the gate on the server (the FE check is advisory only).
        var results = await ResultsForAsync(user.Id, caseId, ct);
        var isAuthor = await IsAuthorAsync(user.Id, caseId, ct);
        var reason = ReviewRules.ResolveEligibility(results.Count > 0, isAuthor, alreadyReviewed: false);
        ReviewRules.EnsureSubmittable(reason);

        var resultLabel = ReviewRules.ResultLabel(results.Any(r => r.Success));
        var now = DateTime.UtcNow;

        // Upsert by (caseId, userId): reuse the existing document so we update in place
        // (preserves _id + createdAt) and never create a duplicate.
        var existing = await FindReviewAsync(user.Id, caseId, ct);
        var review = ReviewRules.BuildReview(
            existing, caseId, user.Id, user.FullName,
            rating, difficulty, fairness, story, twist,
            text, dto.ContainsSpoiler, resultLabel, now,
            newId: ObjectId.GenerateNewId().ToString());

        await _db.Reviews.ReplaceOneAsync(
            PairFilter(caseId, user.Id),
            review,
            new ReplaceOptions { IsUpsert = true },
            ct);

        return ReviewDto.From(review);
    }

    public async Task<ReviewPageDto> GetReviewsAsync(string caseId, int page, int pageSize, CancellationToken ct = default)
    {
        page = page < 1 ? 1 : page;
        pageSize = pageSize < 1 ? DefaultPageSize : Math.Min(pageSize, MaxPageSize);

        var filter = Builders<CaseReview>.Filter.Eq(r => r.CaseId, caseId);
        var total = await _db.Reviews.CountDocumentsAsync(filter, cancellationToken: ct);
        var items = await _db.Reviews.Find(filter)
            .SortByDescending(r => r.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Limit(pageSize)
            .ToListAsync(ct);

        return new ReviewPageDto
        {
            Items = items.Select(ReviewDto.From).ToList(),
            Page = page,
            PageSize = pageSize,
            Total = total,
            HasMore = (long)page * pageSize < total
        };
    }

    public async Task<ReviewSummaryDto> GetSummaryAsync(string caseId, CancellationToken ct = default)
    {
        var reviews = await _db.Reviews
            .Find(Builders<CaseReview>.Filter.Eq(r => r.CaseId, caseId))
            .ToListAsync(ct);
        return ReviewRules.Summarize(reviews);
    }

    public async Task<bool> DeleteOwnReviewAsync(string userId, string caseId, CancellationToken ct = default)
    {
        var result = await _db.Reviews.DeleteOneAsync(PairFilter(caseId, userId), ct);
        return result.DeletedCount > 0;
    }

    private static FilterDefinition<CaseReview> PairFilter(string caseId, string userId) =>
        Builders<CaseReview>.Filter.And(
            Builders<CaseReview>.Filter.Eq(r => r.CaseId, caseId),
            Builders<CaseReview>.Filter.Eq(r => r.UserId, userId));

    private Task<CaseReview?> FindReviewAsync(string userId, string caseId, CancellationToken ct) =>
        _db.Reviews.Find(PairFilter(caseId, userId)).FirstOrDefaultAsync(ct)!;

    private Task<bool> HasPlayedAsync(string userId, string caseId, CancellationToken ct) =>
        _db.GameResults.Find(PlayedFilter(caseId, userId)).AnyAsync(ct);

    private Task<List<GameResult>> ResultsForAsync(string userId, string caseId, CancellationToken ct) =>
        _db.GameResults.Find(PlayedFilter(caseId, userId)).ToListAsync(ct);

    private static FilterDefinition<GameResult> PlayedFilter(string caseId, string userId) =>
        Builders<GameResult>.Filter.And(
            Builders<GameResult>.Filter.Eq(r => r.CaseId, caseId),
            Builders<GameResult>.Filter.AnyEq(r => r.Players, userId));

    /// <summary>
    /// GameCase has no author field; the only authorship signal is the AI draft that produced the case
    /// (<see cref="AiCaseDraft.CreatedByUserId"/>). Cases without a matching draft (seeded/imported) are
    /// treated as authorless, so the own-case rule simply does not apply to them.
    /// </summary>
    private async Task<bool> IsAuthorAsync(string userId, string caseId, CancellationToken ct)
    {
        var authorId = await _db.AiCaseDrafts
            .Find(d => d.CaseId == caseId)
            .Project(d => d.CreatedByUserId)
            .FirstOrDefaultAsync(ct);
        return !string.IsNullOrEmpty(authorId) && authorId == userId;
    }
}
