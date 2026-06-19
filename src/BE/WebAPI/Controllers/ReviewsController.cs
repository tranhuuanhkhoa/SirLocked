using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Review;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// Case reviews. Standalone controller (does not touch the Workshop controller) sharing the
/// <c>api/workshop/cases/{caseId}/reviews</c> prefix. Listing and summary are public; writing requires auth.
/// </summary>
[Route("api/workshop/cases/{caseId}/reviews")]
[Authorize]
public class ReviewsController : BaseApiController
{
    private readonly IReviewService _reviews;

    public ReviewsController(IReviewService reviews) => _reviews = reviews;

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<ReviewPageDto>>> List(
        string caseId, [FromQuery] int page = 1, [FromQuery] int pageSize = 10) =>
        Ok(await _reviews.GetReviewsAsync(caseId, page, pageSize));

    [HttpGet("summary")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<ReviewSummaryDto>>> Summary(string caseId) =>
        Ok(await _reviews.GetSummaryAsync(caseId));

    [HttpGet("eligibility")]
    public async Task<ActionResult<ApiResponse<ReviewEligibilityDto>>> Eligibility(string caseId) =>
        Ok(await _reviews.CheckEligibilityAsync(Caller, caseId));

    [HttpPost]
    public async Task<ActionResult<ApiResponse<ReviewDto>>> Submit(string caseId, [FromBody] SubmitReviewDto dto) =>
        Ok(await _reviews.SubmitReviewAsync(Caller, caseId, dto), "Review saved.");

    [HttpDelete("mine")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteMine(string caseId) =>
        Ok(await _reviews.DeleteOwnReviewAsync(CallerId, caseId), "Review removed.");
}
