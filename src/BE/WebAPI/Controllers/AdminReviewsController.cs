using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Moderating case reviews. What players read stays on ReviewsController.</summary>
[Route("api/admin/reviews")]
[Authorize(Roles = UserRole.Admin)]
public class AdminReviewsController : BaseApiController
{
    private readonly AdminReviewsService _reviews;

    public AdminReviewsController(AdminReviewsService reviews) => _reviews = reviews;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminReviewRowDto>>>> List(
        [FromQuery] string? caseId,
        [FromQuery] bool? hidden,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = AdminPlayersRules.DefaultPageSize,
        CancellationToken ct = default) =>
        Ok(await _reviews.ListAsync(new AdminReviewQuery(caseId, hidden, page, pageSize), ct));

    [HttpPost("{reviewId}/hide")]
    public async Task<ActionResult<ApiResponse<AdminReviewRowDto>>> Hide(string reviewId, [FromBody] AdminReasonRequest request, CancellationToken ct) =>
        Ok(await _reviews.HideAsync(Caller, reviewId, request.Reason, ct), "Đã ẩn đánh giá.");

    [HttpPost("{reviewId}/unhide")]
    public async Task<ActionResult<ApiResponse<AdminReviewRowDto>>> Unhide(string reviewId, [FromBody] AdminReasonRequest request, CancellationToken ct) =>
        Ok(await _reviews.UnhideAsync(Caller, reviewId, request.Reason, ct), "Đã hiện lại đánh giá.");

    [HttpDelete("{reviewId}")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(string reviewId, [FromBody] AdminReasonRequest request, CancellationToken ct)
    {
        await _reviews.DeleteAsync(Caller, reviewId, request.Reason, ct);
        return Ok(true, "Đã xóa đánh giá.");
    }
}
