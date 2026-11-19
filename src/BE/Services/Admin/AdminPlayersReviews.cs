using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Admin;

public sealed record AdminReviewQuery(
    string? CaseId = null,
    bool? Hidden = null,
    int Page = 1,
    int PageSize = AdminPlayersRules.DefaultPageSize);

/// <summary>
/// Reviews as an admin sees them, hidden ones included. A hidden review stays in the database and comes back when unhidden;
/// <see cref="ReviewService"/> leaves it out of the list and the averages players see.
/// </summary>
public sealed class AdminReviewsService
{
    private readonly MongoDbContext _db;
    private readonly IAdminAudit _audit;

    public AdminReviewsService(MongoDbContext db, IAdminAudit audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<AdminPageDto<AdminReviewRowDto>> ListAsync(AdminReviewQuery query, CancellationToken ct = default)
    {
        var (page, pageSize) = AdminPlayersRules.Paging(query.Page, query.PageSize);
        var filter = Builders<CaseReview>.Filter;
        var where = filter.Empty;
        if (!string.IsNullOrWhiteSpace(query.CaseId)) where &= filter.Eq(r => r.CaseId, query.CaseId.Trim());
        if (query.Hidden == true) where &= filter.Eq(r => r.Hidden, true);
        if (query.Hidden == false) where &= filter.Ne(r => r.Hidden, true);

        var total = await _db.Reviews.CountDocumentsAsync(where, cancellationToken: ct);
        var reviews = await _db.Reviews.Find(where)
            .SortByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id)
            .Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        var titles = await TitlesAsync(reviews.Select(r => r.CaseId), ct);
        return new AdminPageDto<AdminReviewRowDto>(reviews.Select(r => ToRow(r, titles)).ToList(), page, pageSize, total);
    }

    private async Task<Dictionary<string, string>> TitlesAsync(IEnumerable<string> caseIds, CancellationToken ct)
    {
        var ids = caseIds.Distinct(StringComparer.Ordinal).ToList();
        var cases = await _db.Cases.Find(c => ids.Contains(c.CaseId)).Project(c => new { c.CaseId, c.Title }).ToListAsync(ct);
        return cases.ToDictionary(c => c.CaseId, c => c.Title, StringComparer.Ordinal);
    }

    private static AdminReviewRowDto ToRow(CaseReview review, IReadOnlyDictionary<string, string> titles) => new(
        review.Id, review.CaseId, titles.GetValueOrDefault(review.CaseId, review.CaseId), review.UserId, review.AuthorDisplay, review.Rating,
        review.ReviewText, review.ContainsSpoiler, review.ResultLabel, review.Hidden, review.HiddenReason, review.HiddenAt, review.CreatedAt, review.UpdatedAt);

    private async Task<CaseReview> RequireAsync(string reviewId, CancellationToken ct)
    {
        var review = ObjectId.TryParse(reviewId, out _) ? await _db.Reviews.Find(r => r.Id == reviewId).FirstOrDefaultAsync(ct) : null;
        return review ?? throw AdminPlayersRules.Error(404, AdminPlayerErrors.ReviewNotFound, "Không tìm thấy đánh giá này.");
    }

    public async Task<AdminReviewRowDto> HideAsync(CurrentUser admin, string reviewId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        var review = await RequireAsync(reviewId, ct);
        var now = DateTime.UtcNow;
        var hidden = await _db.Reviews.UpdateOneAsync(
            Builders<CaseReview>.Filter.Eq(r => r.Id, review.Id) & Builders<CaseReview>.Filter.Ne(r => r.Hidden, true),
            Builders<CaseReview>.Update
                .Set(r => r.Hidden, true)
                .Set(r => r.HiddenReason, note)
                .Set(r => r.HiddenAt, now)
                .Set(r => r.HiddenBy, admin.Id),
            cancellationToken: ct);
        if (hidden.ModifiedCount == 0)
            throw AdminPlayersRules.Error(409, AdminPlayerErrors.ReviewUnchanged, "Đánh giá này đã bị ẩn rồi.");
        await _audit.LogAsync(admin, "review.hide", "review", review.Id, review, new { hidden = true }, note, CancellationToken.None);
        return ToRow(await RequireAsync(reviewId, ct), await TitlesAsync(new[] { review.CaseId }, ct));
    }

    public async Task<AdminReviewRowDto> UnhideAsync(CurrentUser admin, string reviewId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        var review = await RequireAsync(reviewId, ct);
        var shown = await _db.Reviews.UpdateOneAsync(
            r => r.Id == review.Id && r.Hidden,
            Builders<CaseReview>.Update
                .Set(r => r.Hidden, false)
                .Set(r => r.HiddenReason, null)
                .Set(r => r.HiddenAt, null)
                .Set(r => r.HiddenBy, null),
            cancellationToken: ct);
        if (shown.ModifiedCount == 0)
            throw AdminPlayersRules.Error(409, AdminPlayerErrors.ReviewUnchanged, "Đánh giá này đang hiển thị.");
        await _audit.LogAsync(admin, "review.unhide", "review", review.Id,
            new { userId = review.UserId, hidden = true, hiddenReason = review.HiddenReason }, new { hidden = false }, note, CancellationToken.None);
        return ToRow(await RequireAsync(reviewId, ct), await TitlesAsync(new[] { review.CaseId }, ct));
    }

    /// <summary>The audit keeps the whole review: it is the only copy left.</summary>
    public async Task DeleteAsync(CurrentUser admin, string reviewId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        var review = await RequireAsync(reviewId, ct);
        var deleted = await _db.Reviews.DeleteOneAsync(r => r.Id == review.Id, ct);
        if (deleted.DeletedCount == 0)
            throw AdminPlayersRules.Error(404, AdminPlayerErrors.ReviewNotFound, "Không tìm thấy đánh giá này.");
        await _audit.LogAsync(admin, "review.delete", "review", review.Id, review, null, note, CancellationToken.None);
    }
}
