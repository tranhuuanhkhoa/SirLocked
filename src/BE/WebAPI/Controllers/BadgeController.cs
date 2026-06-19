using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Badge;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// Public achievements for a detective profile. Standalone controller; the badge grid is meant to be
/// embedded into the Phase 4 profile page when that merges (see integration note in the deliverables).
/// </summary>
[Route("api/profile/{userId}/badges")]
public class BadgeController : BaseApiController
{
    private readonly IBadgeService _badges;

    public BadgeController(IBadgeService badges) => _badges = badges;

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<List<BadgeDto>>>> Get(string userId) =>
        Ok(await _badges.GetUserBadgesAsync(userId));
}
